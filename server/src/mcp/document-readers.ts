import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { McpExecutionEnvironment, McpExecutionEnvironmentCapability } from "./core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "./core/errors.js";
import type { ReadDirectoryEntry, ReadSource } from "./read/types.js";

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".log",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".xml",
  ".ini",
  ".conf",
  ".cfg",
  ".env",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".toml",
  ".properties",
  ".gitignore",
  ".npmrc",
  ".editorconfig",
]);

type ReadDocumentResult = ReadSource;

type ReadTarget = {
  targetPath: string;
  basename: string;
  extension: string;
};

type ReadStrategyImplementation = {
  read: (target: ReadTarget) => Promise<ReadDocumentResult | null> | ReadDocumentResult | null;
  matches?: (target: ReadTarget) => boolean;
};

type PlannedReadStrategy = McpExecutionEnvironmentCapability & ReadStrategyImplementation;

// Windows ships `python`, while most POSIX hosts only expose `python3`.
// Resolve the interpreter for the current host instead of assuming one name.
const resolvePythonExecutable = (): string =>
  process.platform === "win32" ? "python" : "python3";

const runCommand = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw mcpInternalError(`${command} execution failed`, { cause: result.error });
  }

  if (result.status !== 0) {
    throw mcpInternalError(`${command} exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
};

const isLikelyBinary = (buffer: Buffer) => {
  if (buffer.length === 0) {
    return false;
  }

  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }

    const isCommonWhitespace = byte === 9 || byte === 10 || byte === 13;
    if (!isCommonWhitespace && (byte < 32 || byte === 127)) {
      controlBytes += 1;
    }
  }

  return controlBytes / buffer.length > 0.1;
};

const readTextBuffer = (filePath: string) => {
  const buffer = fs.readFileSync(filePath);
  if (isLikelyBinary(buffer)) {
    return null;
  }

  return buffer.toString("utf-8");
};

const readPdfCli = (filePath: string) => runCommand("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]).trim();

const readDocxCli = (filePath: string) =>
  runCommand(
    resolvePythonExecutable(),
    [
      "-c",
      [
        "import sys, zipfile",
        "from xml.etree import ElementTree as ET",
        "path = sys.argv[1]",
        "ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}",
        "with zipfile.ZipFile(path) as zf:",
        "    root = ET.fromstring(zf.read('word/document.xml'))",
        "paragraphs = []",
        "for paragraph in root.findall('.//w:p', ns):",
        "    pieces = [node.text for node in paragraph.iter() if node.text and node.tag.rsplit('}', 1)[-1] == 't']",
        "    if pieces:",
        "        paragraphs.append(''.join(pieces))",
        "sys.stdout.write('\\n'.join(paragraphs))",
      ].join("\n"),
      filePath,
    ],
  ).trim();

const readPptxCli = (filePath: string) =>
  runCommand(
    resolvePythonExecutable(),
    [
      "-c",
      [
        "import sys, zipfile",
        "from xml.etree import ElementTree as ET",
        "path = sys.argv[1]",
        "with zipfile.ZipFile(path) as zf:",
        "    names = sorted([n for n in zf.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')])",
        "    slides = []",
        "    for name in names:",
        "        root = ET.fromstring(zf.read(name))",
        "        text = ' '.join((node.text or '').strip() for node in root.iter() if node.text and node.tag.rsplit('}', 1)[-1] == 't')",
        "        slides.append(text.strip())",
        "sys.stdout.write('\\n\\n'.join([slide for slide in slides if slide]))",
      ].join("\n"),
      filePath,
    ],
  ).trim();

const readXlsxCli = (filePath: string) =>
  runCommand(
    resolvePythonExecutable(),
    [
      "-c",
      [
        "import sys",
        "from openpyxl import load_workbook",
        "wb = load_workbook(sys.argv[1], data_only=True, read_only=True)",
        "chunks = []",
        "for sheet in wb.worksheets:",
        "    chunks.append(f'Sheet {sheet.title}')",
        "    for row in sheet.iter_rows(values_only=True):",
        "        chunks.append('\\t'.join('' if cell is None else str(cell) for cell in row))",
        "    chunks.append('')",
        "sys.stdout.write('\\n'.join(chunks).strip())",
      ].join("\n"),
      filePath,
    ],
  ).trim();

const createReadTarget = (targetPath: string): ReadTarget => ({
  targetPath,
  basename: path.basename(targetPath),
  extension: path.extname(targetPath).toLowerCase(),
});

const applyStrategyMetadata = (result: ReadDocumentResult, strategy: PlannedReadStrategy): ReadDocumentResult => ({
  ...result,
  metadata: {
    ...result.metadata,
    readerStrategy: strategy.id,
    readerProvider: strategy.provider,
    readerPriority: strategy.priority,
  },
});

const strategyImplementations: Record<string, ReadStrategyImplementation> = {
  "pdf-cli-extract": {
    matches: (target) => target.extension === ".pdf",
    read: (target) => ({
      kind: "document",
      mimeType: "application/pdf",
      text: readPdfCli(target.targetPath),
      metadata: {},
    }),
  },
  "docx-cli-extract": {
    matches: (target) => target.extension === ".docx",
    read: (target) => ({
      kind: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: readDocxCli(target.targetPath),
      metadata: {},
    }),
  },
  "pptx-cli-extract": {
    matches: (target) => target.extension === ".pptx",
    read: (target) => ({
      kind: "document",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      text: readPptxCli(target.targetPath),
      metadata: {},
    }),
  },
  "xlsx-cli-extract": {
    matches: (target) => target.extension === ".xlsx",
    read: (target) => ({
      kind: "table",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      text: readXlsxCli(target.targetPath),
      metadata: {},
    }),
  },
  "text-known-extension": {
    read: (target) => {
      if (!TEXT_FILE_EXTENSIONS.has(target.extension)) {
        return null;
      }

      const text = readTextBuffer(target.targetPath);
      if (text === null) {
        return null;
      }

      return {
        kind: "text",
        mimeType: "text/plain",
        text,
        metadata: {
          encoding: "utf-8",
          sizeBytes: Buffer.byteLength(text, "utf-8"),
        },
      };
    },
  },
  "text-content-probe": {
    read: (target) => {
      const text = readTextBuffer(target.targetPath);
      if (text === null) {
        return null;
      }

      return {
        kind: "text",
        mimeType: "text/plain",
        text,
        metadata: {
          encoding: "utf-8",
          detectedBy: "content-probe",
          extension: target.extension || "(none)",
        },
      };
    },
  },
  "binary-summary": {
    read: (target) => {
      const stat = fs.statSync(target.targetPath);
      return {
        kind: "text",
        mimeType: "application/octet-stream",
        text: `Binary file preview is not available for ${path.basename(target.targetPath)}.`,
        metadata: {
          binary: true,
          sizeBytes: stat.size,
          extension: path.extname(target.targetPath).toLowerCase() || "(none)",
        },
      };
    },
  },
};

const buildStrategyList = (
  environment: McpExecutionEnvironment,
  kinds: Array<McpExecutionEnvironmentCapability["kind"]>,
) =>
  [...environment.read.capabilities]
    .filter((capability) => capability.available)
    .filter((capability) => kinds.includes(capability.kind))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .map((capability) => {
      const implementation = strategyImplementations[capability.id];
      if (!implementation) {
        return null;
      }

      return {
        ...capability,
        matches: implementation.matches,
        read: implementation.read,
      };
    })
    .filter(Boolean) as PlannedReadStrategy[];

const requireHarnessEnvironment = (environment?: McpExecutionEnvironment) => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Read execution requires a harness environment snapshot");
  }

  return environment;
};

export const assertReadEnvironment = (environment?: McpExecutionEnvironment) =>
  requireHarnessEnvironment(environment);

export const buildReadStrategies = (environment: McpExecutionEnvironment): PlannedReadStrategy[] =>
  buildStrategyList(environment, ["extract", "text", "fallback"]);

const buildDirectoryStrategy = (environment: McpExecutionEnvironment) =>
  [...environment.read.capabilities]
    .filter((capability) => capability.available)
    .filter((capability) => capability.kind === "directory")
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0];

export const describeReadPlan = (environment: McpExecutionEnvironment, targetPath: string) => {
  const harnessEnvironment = requireHarnessEnvironment(environment);
  const target = createReadTarget(targetPath);
  const chain = buildReadStrategies(harnessEnvironment)
    .filter((strategy) => strategy.matches?.(target) ?? true)
    .map((strategy) => ({
      id: strategy.id,
      provider: strategy.provider,
      priority: strategy.priority,
      selected:
        strategy.id === "text-content-probe"
          ? !TEXT_FILE_EXTENSIONS.has(target.extension)
          : strategy.id === "binary-summary"
            ? true
            : true,
    }));

  return {
    target: {
      basename: target.basename,
      extension: target.extension || "(none)",
    },
    chain,
  };
};

export const readStructuredDocument = async (
  environment: McpExecutionEnvironment | undefined,
  targetPath: string,
) => {
  const harnessEnvironment = requireHarnessEnvironment(environment);
  const target = createReadTarget(targetPath);
  const strategies = buildReadStrategies(harnessEnvironment).filter(
    (strategy) => strategy.matches?.(target) ?? true,
  );

  for (const strategy of strategies) {
    const result = await strategy.read(target);
    if (result) {
      return applyStrategyMetadata(result, strategy);
    }
  }

  throw mcpInternalError(`No read strategy resolved for ${target.basename}`);
};

export const sliceExtractedText = (
  text: string,
  input: { startLine?: number; endLine?: number; maxLines?: number } = {},
) => {
  const lines = text.split(/\r?\n/);
  const startLine = Math.max(1, Math.trunc(input.startLine ?? 1));
  const endLine = Math.max(startLine, Math.trunc(input.endLine ?? lines.length));
  const maxLines = input.maxLines ? Math.max(1, Math.trunc(input.maxLines)) : endLine - startLine + 1;
  const slice = lines.slice(startLine - 1, Math.min(endLine, startLine - 1 + maxLines));

  return {
    text: slice.join("\n"),
    startLine,
    endLine: Math.min(endLine, startLine - 1 + maxLines),
    totalLines: lines.length,
  };
};

export const assertPathExists = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    throw mcpBadRequest(`Path does not exist: ${targetPath}`);
  }
};

export const listDirectory = (
  environment: McpExecutionEnvironment | undefined,
  targetPath: string,
): ReadDirectoryEntry[] => {
  const harnessEnvironment = requireHarnessEnvironment(environment);
  const strategy = buildDirectoryStrategy(harnessEnvironment);
  if (!strategy) {
    throw mcpInternalError("No directory listing capability available in harness environment");
  }

  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .map((entry) => {
        const entryPath = path.join(targetPath, entry.name);
        const stat = fs.lstatSync(entryPath);
        const entryType: ReadDirectoryEntry["type"] = entry.isDirectory() ? "directory" : "file";

        return {
          name: entry.name,
          type: entryType,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          listingStrategy: strategy.id,
          listingProvider: strategy.provider,
        };
      })
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1;
        }

        return left.name.localeCompare(right.name, undefined, { numeric: true });
      });
  } catch (error) {
    throw mcpInternalError(`Failed to list directory: ${targetPath}`, { cause: error });
  }
};
