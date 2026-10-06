import fs from "node:fs";
import path from "node:path";
import { createHarnessEnvironmentSnapshot } from "../../environment.js";
import { planContextRead } from "../planner.js";
import type { ContextReadBenchCaseResult } from "./contract.js";
import { createContextReadBenchFixture, type ContextReadBenchFixture } from "./fixtures.js";
import { runWithWorkspaceRootOverride } from "../../../mcp/workspace.js";
import {
  executeGenericRead,
  sliceGenericText,
  type GenericReadResult,
  type GenericReadTextResult,
} from "../../../mcp/read/generic.js";
import { executeGrep } from "../../../mcp/read/grep.js";
import { executeList, type ListResult } from "../../../mcp/read/list.js";

const createBenchEnvironment = () => createHarnessEnvironmentSnapshot();

const requireTextRead = (result: GenericReadResult): GenericReadTextResult => {
  if (result.type !== "read" || !("source" in result)) {
    throw new Error(`Expected canonical text read result, received ${result.type}`);
  }
  return result;
};

const countChars = (value: string) => value.length;

const detectBom = (absolutePath: string) => {
  const buffer = fs.readFileSync(absolutePath);
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
};

const classifyEncoding = ({
  absolutePath,
  text,
  metadata,
  expectedText,
}: {
  absolutePath: string;
  text: string;
  metadata: Record<string, unknown>;
  expectedText?: string;
}) => {
  if (detectBom(absolutePath)) {
    return "utf-8-bom";
  }

  if (metadata.binary === true) {
    return "binaryDetected";
  }

  if (expectedText && text.includes(expectedText)) {
    return typeof metadata.encoding === "string" ? metadata.encoding : "decoded";
  }

  if (text.includes("\uFFFD")) {
    return "uncertain";
  }

  return typeof metadata.encoding === "string" ? metadata.encoding : "uncertain";
};

const buildFailure = (
  caseId: string,
  operation: string,
  input: Record<string, unknown>,
  error: unknown,
): ContextReadBenchCaseResult => ({
  caseId,
  operation,
  input,
  status: "failed",
  filesRead: 0,
  charsRead: 0,
  encoding: "unknown",
  truncated: false,
  diagnostics: [error instanceof Error ? error.message : String(error)],
});

const buildReadCaseResult = ({
  caseId,
  operation,
  input,
  readResult,
  absolutePath,
  expectedText,
  status,
  diagnostics,
  truncated = false,
}: {
  caseId: string;
  operation: string;
  input: Record<string, unknown>;
  readResult: GenericReadTextResult;
  absolutePath: string;
  expectedText?: string;
  status: "passed" | "failed";
  diagnostics: string[];
  truncated?: boolean;
}): ContextReadBenchCaseResult => ({
  caseId,
  operation,
  input,
  status,
  filesRead: 1,
  charsRead: countChars(readResult.source.text),
  encoding: classifyEncoding({
    absolutePath,
    text: readResult.source.text,
    metadata: readResult.source.metadata,
    expectedText,
  }),
  truncated,
  diagnostics,
});

const pickLineWindowWithinChars = (text: string, maxChars: number) => {
  const lines = text.split(/\r?\n/);
  let total = 0;
  let maxLines = 0;

  for (const line of lines) {
    const nextLength = total === 0 ? line.length : total + 1 + line.length;
    if (nextLength > maxChars) {
      break;
    }
    total = nextLength;
    maxLines += 1;
  }

  return Math.max(1, maxLines);
};

const buildInspectContext = async ({
  fixture,
  query,
  locateQuery,
  budget,
}: {
  fixture: ContextReadBenchFixture;
  query: string;
  locateQuery: string;
  budget: {
    maxFiles: number;
    maxChars: number;
  };
}) => {
  const environment = createBenchEnvironment();
  const planResult = planContextRead({
    query,
    budget,
  });
  if (planResult.plan.kind !== "inspect") {
    throw new Error(`inspect plan expected, received ${planResult.plan.kind}`);
  }

  const grepResult = (
    await executeGrep({
      args: {
        pattern: locateQuery,
        path: "inspect-module",
        literal: true,
        limit: Math.max(budget.maxFiles * 3, 3),
      },
      environment,
      signal: new AbortController().signal,
    })
  ).contents;

  const uniquePaths = [...new Set(grepResult.matches.map((match) => match.path))];
  const selectedPaths: string[] = [];
  const diagnostics: string[] = [
    `planner selected ${planResult.plan.kind}`,
    `locate returned ${uniquePaths.length} candidate files`,
  ];
  const chunks: string[] = [];
  let remainingChars = budget.maxChars;
  let truncated = false;

  for (const relativePath of uniquePaths) {
    if (selectedPaths.length >= budget.maxFiles) {
      diagnostics.push(`maxFiles reached at ${budget.maxFiles}`);
      truncated = true;
      break;
    }

    const readResult = requireTextRead(
      (
        await executeGenericRead({
          args: { path: relativePath },
          environment,
        })
      ).contents,
    );
    const text = readResult.source.text;

    if (remainingChars <= 0) {
      diagnostics.push("maxChars exhausted before reading next file");
      truncated = true;
      break;
    }

    const separator = chunks.length > 0 ? "\n\n" : "";
    const header = `FILE: ${relativePath}\n`;
    const availableChars = Math.max(0, remainingChars - countChars(separator) - countChars(header));
    if (availableChars <= 0) {
      diagnostics.push("maxChars exhausted before writing file header");
      truncated = true;
      break;
    }

    let snippet = text;
    if (countChars(text) > availableChars) {
      const maxLines = pickLineWindowWithinChars(text, availableChars);
      const sliceResult = sliceGenericText(text, {
        offset: 0,
        limit: maxLines,
      });
      snippet = sliceResult.text;
      if (countChars(snippet) > availableChars) {
        snippet = snippet.slice(0, availableChars);
      }
      truncated = true;
      diagnostics.push(`maxChars clipped file ${relativePath}`);
    }

    const chunk = `${separator}${header}${snippet}`;
    selectedPaths.push(relativePath);
    chunks.push(chunk);
    remainingChars = Math.max(0, remainingChars - countChars(chunk));
  }

  return {
    planResult,
    grepResult,
    selectedPaths,
    context: chunks.join(""),
    diagnostics,
    truncated,
  };
};

type ContextReadBenchCaseDefinition = {
  caseId: string;
  operation: string;
  input: Record<string, unknown>;
  run: (fixture: ContextReadBenchFixture) => Promise<ContextReadBenchCaseResult>;
};

const createBenchCases = (): ContextReadBenchCaseDefinition[] => [
  {
    caseId: "list-chinese-directory",
    operation: "list",
    input: { path: "中文目录" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const result = await executeList({
        args: { path: fixture.paths.chineseDir },
        environment,
      });
      const entries = (result.contents as ListResult).entries.map((entry) => entry.name);
      const passed = entries.includes("README.md") && entries.includes("中文文件名-说明.txt");
      return {
        caseId: "list-chinese-directory",
        operation: "list",
        input: { path: fixture.paths.chineseDir },
        status: passed ? "passed" : "failed",
        filesRead: 0,
        charsRead: 0,
        encoding: "n/a",
        truncated: false,
        diagnostics: passed
          ? ["中文目录列举成功，包含 README.md 和中文文件名。"]
          : [`目录项不完整：${entries.join(", ")}`],
      };
    },
  },
  {
    caseId: "read-chinese-filename",
    operation: "read",
    input: { path: "中文目录/中文文件名-说明.txt" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: { path: fixture.paths.chineseFile },
            environment,
          })
        ).contents,
      );
      const passed = readResult.source.text.includes(fixture.expected.chineseFileText);
      return buildReadCaseResult({
        caseId: "read-chinese-filename",
        operation: "read",
        input: { path: fixture.paths.chineseFile },
        readResult,
        absolutePath: path.join(fixture.rootPath, fixture.paths.chineseFile),
        expectedText: fixture.expected.chineseFileText,
        status: passed ? "passed" : "failed",
        diagnostics: passed
          ? ["中文文件名和 UTF-8 中文内容读取成功。"]
          : ["中文文件名读取后未匹配到预期 UTF-8 内容。"],
      });
    },
  },
  {
    caseId: "read-utf8-bom",
    operation: "read",
    input: { path: "带BOM的说明.txt" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: { path: fixture.paths.bomFile },
            environment,
          })
        ).contents,
      );
      const normalized = readResult.source.text.replace(/^\uFEFF/u, "");
      const passed = normalized.includes(fixture.expected.bomText);
      return buildReadCaseResult({
        caseId: "read-utf8-bom",
        operation: "read",
        input: { path: fixture.paths.bomFile },
        readResult,
        absolutePath: path.join(fixture.rootPath, fixture.paths.bomFile),
        expectedText: fixture.expected.bomText,
        status: passed ? "passed" : "failed",
        diagnostics: passed
          ? ["UTF-8 BOM 文件已读取，并单独标记 utf-8-bom。"]
          : ["UTF-8 BOM 文件读取后未匹配预期文本。"],
      });
    },
  },
  {
    caseId: "read-gbk",
    operation: "read",
    input: { path: "GBK-示例.txt" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: { path: fixture.paths.gbkFile },
            environment,
          })
        ).contents,
      );
      const encoding = classifyEncoding({
        absolutePath: path.join(fixture.rootPath, fixture.paths.gbkFile),
        text: readResult.source.text,
        metadata: readResult.source.metadata,
        expectedText: fixture.expected.gbkText,
      });
      const passed = encoding === "uncertain" || encoding === "decoded";
      return {
        caseId: "read-gbk",
        operation: "read",
        input: { path: fixture.paths.gbkFile },
        status: passed ? "passed" : "failed",
        filesRead: 1,
        charsRead: countChars(readResult.source.text),
        encoding,
        truncated: false,
        diagnostics: passed
          ? ["GBK 文件未崩溃，bench 已标记为 uncertain 或 decoded。"]
          : [`GBK 文件编码标记不符合预期：${encoding}`],
      };
    },
  },
  {
    caseId: "read-binary",
    operation: "read",
    input: { path: "二进制样本.bin" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const result = await executeGenericRead({
        args: { path: fixture.paths.binaryFile },
        environment,
      });
      const passed =
        result.contents.type === "unsupported" &&
        result.contents.reason === "binary";
      return {
        caseId: "read-binary",
        operation: "read",
        input: { path: fixture.paths.binaryFile },
        status: passed ? "passed" : "failed",
        filesRead: 1,
        charsRead: 0,
        encoding: "binaryDetected",
        truncated: false,
        diagnostics: passed
          ? ["canonical read 拒绝把二进制内容伪装成文本。"]
          : [`binary read outcome unexpected: ${JSON.stringify(result.contents)}`],
      };
    },
  },
  {
    caseId: "read-large-file-window",
    operation: "read",
    input: { path: "超大日志.log", offset: 119, limit: 5 },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: {
              path: fixture.paths.largeFile,
              offset: 119,
              limit: 5,
            },
            environment,
          })
        ).contents,
      );
      const lines = readResult.source.text.split("\n");
      const passed =
        lines.length === 5 &&
        lines[0] === "line-120 context budget trace" &&
        lines[lines.length - 1] === "line-124 context budget trace" &&
        readResult.hasMore;
      return {
        caseId: "read-large-file-window",
        operation: "read",
        input: { path: fixture.paths.largeFile, offset: 119, limit: 5 },
        status: passed ? "passed" : "failed",
        filesRead: 1,
        charsRead: countChars(readResult.source.text),
        encoding: readResult.source.metadata.encoding,
        truncated: readResult.truncated,
        diagnostics: passed
          ? ["大文件通过 canonical read(offset, limit) 返回 5 行窗口和 continuation。"]
          : [`read window 结果异常：${readResult.source.text}`],
      };
    },
  },
  {
    caseId: "grep-read",
    operation: "grep->read",
    input: { query: "预算约束", searchMode: "content", path: "inspect-module" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const grepResult = (
        await executeGrep({
          args: {
            pattern: fixture.expected.inspectKeyword,
            path: "inspect-module",
            literal: true,
          },
          environment,
          signal: new AbortController().signal,
        })
      ).contents;
      const firstPath = grepResult.matches[0]?.path;
      if (!firstPath) {
        return {
          caseId: "grep-read",
          operation: "grep->read",
          input: { query: fixture.expected.inspectKeyword, searchMode: "content", path: "inspect-module" },
          status: "failed",
          filesRead: 0,
          charsRead: 0,
          encoding: "n/a",
          truncated: false,
          diagnostics: ["grep 没有返回任何候选文件。"],
        };
      }

      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: { path: firstPath },
            environment,
          })
        ).contents,
      );
      const passed = readResult.source.text.includes(fixture.expected.inspectKeyword);
      return buildReadCaseResult({
        caseId: "grep-read",
        operation: "grep->read",
        input: { query: fixture.expected.inspectKeyword, searchMode: "content", path: "inspect-module" },
        readResult,
        absolutePath: path.join(fixture.rootPath, firstPath),
        expectedText: fixture.expected.inspectKeyword,
        status: passed ? "passed" : "failed",
        diagnostics: passed
          ? [`locate 命中 ${firstPath}，随后 open 读到关键词。`]
          : [`locate 命中 ${firstPath}，但 open 未读到关键词。`],
      });
    },
  },
  {
    caseId: "list-read-readme",
    operation: "list->read",
    input: { path: "产品说明" },
    run: async (fixture) => {
      const environment = createBenchEnvironment();
      const listResult = await executeList({
        args: { path: fixture.paths.listReadmeDir },
        environment,
      });
      const hasReadme = (listResult.contents as ListResult).entries.some(
        (entry) => entry.name === "README.md",
      );
      const readResult = requireTextRead(
        (
          await executeGenericRead({
            args: { path: fixture.paths.listReadme },
            environment,
          })
        ).contents,
      );
      const passed = hasReadme && readResult.source.text.includes(fixture.expected.listReadmeText);
      return buildReadCaseResult({
        caseId: "list-read-readme",
        operation: "list->read",
        input: { path: fixture.paths.listReadmeDir },
        readResult,
        absolutePath: path.join(fixture.rootPath, fixture.paths.listReadme),
        expectedText: fixture.expected.listReadmeText,
        status: passed ? "passed" : "failed",
        diagnostics: passed
          ? ["目录列举命中 README.md，随后 open 成功读取 README。"]
          : ["list -> open README 链路没有返回预期文本。"],
      });
    },
  },
  {
    caseId: "inspect-within-budget",
    operation: "inspect",
    input: { query: "检查 inspect 模块的预算和上下文实现", budget: { maxFiles: 2, maxChars: 120 } },
    run: async (fixture) => {
      const inspectResult = await buildInspectContext({
        fixture,
        query: "检查 inspect 模块的预算和上下文实现",
        locateQuery: fixture.expected.inspectKeyword,
        budget: {
          maxFiles: 2,
          maxChars: 120,
        },
      });
      const passed =
        inspectResult.planResult.plan.kind === "inspect" &&
        inspectResult.selectedPaths.length <= 2 &&
        countChars(inspectResult.context) <= 120 &&
        inspectResult.context.includes("预算约束");
      return {
        caseId: "inspect-within-budget",
        operation: "inspect",
        input: { query: "检查 inspect 模块的预算和上下文实现", budget: { maxFiles: 2, maxChars: 120 } },
        status: passed ? "passed" : "failed",
        filesRead: inspectResult.selectedPaths.length,
        charsRead: countChars(inspectResult.context),
        encoding: "utf-8",
        truncated: inspectResult.truncated,
        diagnostics: passed
          ? ["inspect 计划在预算内返回 context。", ...inspectResult.diagnostics]
          : [`inspect context 不满足预算或缺少关键词：${inspectResult.context}`, ...inspectResult.diagnostics],
      };
    },
  },
  {
    caseId: "inspect-max-files",
    operation: "inspect",
    input: { query: "检查 inspect 模块的预算实现", budget: { maxFiles: 1, maxChars: 400 } },
    run: async (fixture) => {
      const inspectResult = await buildInspectContext({
        fixture,
        query: "检查 inspect 模块的预算实现",
        locateQuery: fixture.expected.inspectKeyword,
        budget: {
          maxFiles: 1,
          maxChars: 400,
        },
      });
      const passed =
        inspectResult.selectedPaths.length === 1 &&
        inspectResult.diagnostics.some((item) => item.includes("maxFiles reached"));
      return {
        caseId: "inspect-max-files",
        operation: "inspect",
        input: { query: "检查 inspect 模块的预算实现", budget: { maxFiles: 1, maxChars: 400 } },
        status: passed ? "passed" : "failed",
        filesRead: inspectResult.selectedPaths.length,
        charsRead: countChars(inspectResult.context),
        encoding: "utf-8",
        truncated: inspectResult.truncated,
        diagnostics: passed
          ? ["maxFiles 已限制 inspect 只读取 1 个文件。", ...inspectResult.diagnostics]
          : ["maxFiles 没有限制住读取文件数。", ...inspectResult.diagnostics],
      };
    },
  },
  {
    caseId: "inspect-max-chars",
    operation: "inspect",
    input: { query: "检查 inspect 模块的预算和上下文实现", budget: { maxFiles: 3, maxChars: 60 } },
    run: async (fixture) => {
      const inspectResult = await buildInspectContext({
        fixture,
        query: "检查 inspect 模块的预算和上下文实现",
        locateQuery: fixture.expected.inspectKeyword,
        budget: {
          maxFiles: 3,
          maxChars: 60,
        },
      });
      const passed =
        countChars(inspectResult.context) <= 60 &&
        inspectResult.diagnostics.some((item) => item.includes("maxChars clipped file"));
      return {
        caseId: "inspect-max-chars",
        operation: "inspect",
        input: { query: "检查 inspect 模块的预算和上下文实现", budget: { maxFiles: 3, maxChars: 60 } },
        status: passed ? "passed" : "failed",
        filesRead: inspectResult.selectedPaths.length,
        charsRead: countChars(inspectResult.context),
        encoding: "utf-8",
        truncated: inspectResult.truncated,
        diagnostics: passed
          ? ["maxChars 已限制 inspect context 长度。", ...inspectResult.diagnostics]
          : ["maxChars 没有限制住 context 长度。", ...inspectResult.diagnostics],
      };
    },
  },
];

export const runContextReadBenchCases = async () => {
  const fixture = createContextReadBenchFixture();
  try {
    const cases: ContextReadBenchCaseResult[] = [];
    for (const definition of createBenchCases()) {
      const result = await runWithWorkspaceRootOverride(fixture.rootPath, async () => {
        try {
          return await definition.run(fixture);
        } catch (error) {
          return buildFailure(definition.caseId, definition.operation, definition.input, error);
        }
      });
      cases.push(result);
    }

    return {
      workspaceRoot: fixture.rootPath,
      cases,
    };
  } finally {
    fixture.cleanup();
  }
};
