import fs from "node:fs";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { createArtifact } from "../core/artifacts.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  assertReadEnvironment,
  assertPathExists,
  describeReadPlan,
  listDirectory,
  readStructuredDocument,
  sliceExtractedText,
} from "../document-readers.js";
import { executeReadLocateWithDiagnostics, describeLocatePlan } from "./locate.js";
import { resolveWorkspacePath } from "../workspace.js";
import type { ReadListResult, ReadOpenResult, ReadSelection, ReadWindow } from "./types.js";

type ReadExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

type ReadExecutionResult = {
  contents: unknown;
  artifacts: ToolArtifact[];
};

export const DEFAULT_READ_MAX_LINES = 400;

export const createReadWindow = (
  slice: { startLine: number; endLine: number; totalLines: number },
  requestedEndLine: number,
): ReadWindow => {
  const boundedRequestedEnd = Math.min(requestedEndLine, slice.totalLines);
  const truncated = slice.endLine < boundedRequestedEnd;
  return {
    startLine: slice.startLine,
    endLine: slice.endLine,
    totalLines: slice.totalLines,
    truncated,
    ...(truncated ? { nextStartLine: slice.endLine + 1 } : {}),
  };
};

export const executeReadList = async ({
  args,
  environment,
  pushEvent,
}: ReadExecutionContext): Promise<ReadExecutionResult> => {
  assertReadEnvironment(environment);

  const targetPath = resolveWorkspacePath(args.path);
  assertPathExists(targetPath);

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw mcpBadRequest("read_list requires a directory path");
  }

  pushEvent?.({
    type: "invocation:progress",
    message: "Directory listing plan: node-fs-directory",
  });

  const entries = listDirectory(environment, targetPath);
  const maxResults = typeof args.maxResults === "number" && Number.isInteger(args.maxResults)
    ? Math.min(Math.max(args.maxResults, 1), 100)
    : undefined;
  const totalCount = entries.length;
  const visibleEntries = maxResults ? entries.slice(0, maxResults) : entries;
  const contents: ReadListResult = {
    type: "list",
    path: String(args.path),
    entries: visibleEntries,
    returnedCount: visibleEntries.length,
    totalCount,
    hasMore: visibleEntries.length < totalCount,
    truncated: visibleEntries.length < totalCount,
  };
  return {
    contents,
    artifacts: [
      createArtifact({
        kind: "table",
        title: `Directory ${String(args.path)}`,
        data: contents.entries,
        metadata: { path: args.path },
      }),
    ],
  };
};

export const executeReadOpen = async ({
  args,
  environment,
  pushEvent,
}: ReadExecutionContext): Promise<ReadExecutionResult> => {
  const harnessEnvironment = assertReadEnvironment(environment);

  const targetPath = resolveWorkspacePath(args.path);
  assertPathExists(targetPath);

  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) {
    throw mcpBadRequest("read requires a file path");
  }

  const plan = describeReadPlan(harnessEnvironment, targetPath);
  pushEvent?.({
    type: "invocation:progress",
    message: `Read plan: ${plan.chain.map((step) => step.id).join(" -> ")}`,
  });

  const result = await readStructuredDocument(harnessEnvironment, targetPath);
  const selection = parseReadSelection(args.selection);
  const slice = sliceExtractedText(result.text, {
    startLine: selection?.start ?? 1,
    endLine: selection?.end,
    maxLines: DEFAULT_READ_MAX_LINES,
  });
  const requestedEndLine = selection?.end ?? slice.totalLines;
  const window = createReadWindow(slice, requestedEndLine);
  const contents: ReadOpenResult = {
    type: "open",
    path: String(args.path),
    operation: selection ? "extract" : "open",
    ...(selection ? { selection } : {}),
    window,
    source: { ...result, text: slice.text },
  };
  return {
    contents,
    artifacts: [
      createArtifact({
        kind: result.kind,
        title: `Read ${String(args.path)}`,
        mimeType: result.mimeType,
        data: slice.text,
        metadata: { ...result.metadata, ...(selection ? { selection } : {}), window },
      }),
    ],
  };
};

const parseReadSelection = (value: unknown): ReadSelection | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mcpBadRequest("selection must be an object");
  }
  const selection = value as Record<string, unknown>;
  if (selection.kind !== "lines" && selection.kind !== "range") {
    throw mcpBadRequest("selection.kind must be one of: lines, range");
  }
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end)) {
    throw mcpBadRequest("selection.start and selection.end must be integers");
  }
  const start = selection.start as number;
  const end = selection.end as number;
  if (start < 1 || end < start) {
    throw mcpBadRequest("selection must use a positive inclusive range");
  }
  const keys = Object.keys(selection);
  if (keys.some((key) => !["kind", "start", "end"].includes(key))) {
    throw mcpBadRequest("selection contains unsupported fields");
  }
  return selection as ReadSelection;
};

export const executeReadLocateRuntime = async ({
  args,
  environment,
  pushEvent,
}: ReadExecutionContext): Promise<ReadExecutionResult> => {
  const harnessEnvironment = assertReadEnvironment(environment);

  const plan = describeLocatePlan(harnessEnvironment, {
    query: String(args.query ?? ""),
    path: typeof args.path === "string" ? args.path : undefined,
    searchMode:
      args.searchMode === "path" || args.searchMode === "content" || args.searchMode === "auto"
        ? args.searchMode
        : undefined,
    extensions: Array.isArray(args.extensions) ? (args.extensions as string[]) : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
  });
  pushEvent?.({
    type: "invocation:progress",
    message: `Locate plan: ${plan.chain.map((step) => step.id).join(" -> ")}`,
  });

  const execution = await executeReadLocateWithDiagnostics(harnessEnvironment, args);
  const result = execution.result;
  return {
    contents: result,
    artifacts: [
      createArtifact({
        kind: "search-results",
        title: `Locate ${String(args.query ?? "")}`,
        data: result.matches,
        metadata: {
          scope: result.scope,
          query: result.query,
          searchMode: result.searchMode,
          provider: execution.diagnostics.provider,
          providers: execution.diagnostics.providers,
          providerAttempts: execution.diagnostics.attempts,
        },
      }),
    ],
  };
};
