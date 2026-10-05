import fs from "node:fs";
import path from "node:path";
import { createArtifact } from "../core/artifacts.js";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { resolveWorkspacePath } from "../workspace.js";

export const DEFAULT_GENERIC_READ_MAX_LINES = 400;

const OFFICE_SKILLS = new Map<string, "docx" | "xlsx" | "pptx" | "pdf">([
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pptx", "pptx"],
  [".pdf", "pdf"],
]);

const IMAGE_MIME_TYPES = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
]);

const CODE_EXTENSIONS = new Set([
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
]);

export type GenericReadSelection = {
  kind: "lines" | "range";
  start: number;
  end: number;
};

export type GenericReadWindow = {
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  nextStartLine?: number;
};

export type GenericReadTextResult = {
  type: "read";
  path: string;
  operation: "read" | "range";
  selection?: GenericReadSelection;
  window: GenericReadWindow;
  source: {
    kind: "text";
    mimeType: string;
    text: string;
    metadata: {
      encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
      sizeBytes: number;
    };
  };
};

export type GenericReadUnsupportedResult = {
  type: "unsupported";
  path: string;
  reason: "office_owned" | "binary" | "multimodal_projection_unavailable";
  fileType?: string;
  mimeType?: string;
  suggestedSkill?: "docx" | "xlsx" | "pptx" | "pdf";
};

export type GenericReadResult =
  | GenericReadTextResult
  | GenericReadUnsupportedResult;

type GenericReadExecutionResult = {
  contents: GenericReadResult;
  artifacts: ToolArtifact[];
};

type GenericReadExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

type DecodedText = {
  text: string;
  encoding: GenericReadTextResult["source"]["metadata"]["encoding"];
  sizeBytes: number;
};

const assertHarnessEnvironment = (
  environment?: ToolExecutionEnvironment,
): ToolExecutionEnvironment => {
  if (!environment || environment.source !== "harness") {
    throw mcpInternalError("Read execution requires a harness environment snapshot");
  }
  return environment;
};

export const parseGenericReadSelection = (
  value: unknown,
): GenericReadSelection | undefined => {
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
  if (
    Object.keys(selection).some(
      (key) => !["kind", "start", "end"].includes(key),
    )
  ) {
    throw mcpBadRequest("selection contains unsupported fields");
  }
  return { kind: selection.kind, start, end };
};

export const sliceGenericText = (
  text: string,
  selection?: GenericReadSelection,
): { text: string; window: GenericReadWindow } => {
  const lines = text.split(/\r?\n/);
  const startLine = selection?.start ?? 1;
  const requestedEndLine = Math.min(selection?.end ?? lines.length, lines.length);
  const endLine = Math.min(
    requestedEndLine,
    startLine + DEFAULT_GENERIC_READ_MAX_LINES - 1,
  );
  const selected = lines.slice(startLine - 1, endLine);
  const truncated = endLine < requestedEndLine;

  return {
    text: selected.join("\n"),
    window: {
      startLine,
      endLine,
      totalLines: lines.length,
      truncated,
      ...(truncated ? { nextStartLine: endLine + 1 } : {}),
    },
  };
};

const isLikelyBinary = (buffer: Buffer) => {
  if (buffer.length === 0) return false;

  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    const commonWhitespace = byte === 9 || byte === 10 || byte === 13;
    if (!commonWhitespace && (byte < 32 || byte === 127)) {
      controlBytes += 1;
    }
  }
  return controlBytes / buffer.length > 0.1;
};

const decodeText = (buffer: Buffer): DecodedText | null => {
  const sizeBytes = buffer.byteLength;

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return {
      text: buffer.subarray(3).toString("utf8"),
      encoding: "utf-8-bom",
      sizeBytes,
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: buffer.subarray(2).toString("utf16le"),
      encoding: "utf-16le",
      sizeBytes,
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const content = buffer.subarray(2);
    const swapped = Buffer.alloc(content.length - (content.length % 2));
    for (let index = 0; index + 1 < content.length; index += 2) {
      swapped[index] = content[index + 1]!;
      swapped[index + 1] = content[index]!;
    }
    return {
      text: swapped.toString("utf16le"),
      encoding: "utf-16be",
      sizeBytes,
    };
  }

  if (isLikelyBinary(buffer)) return null;

  return {
    text: buffer.toString("utf8"),
    encoding: "utf-8",
    sizeBytes,
  };
};

const mimeTypeForText = (extension: string) => {
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".json" || extension === ".jsonl") return "application/json";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".css") return "text/css";
  if (extension === ".csv") return "text/csv";
  if (extension === ".xml") return "application/xml";
  return "text/plain";
};

const artifactKindForText = (
  extension: string,
): "text" | "markdown" | "code" => {
  if (extension === ".md" || extension === ".markdown") return "markdown";
  return CODE_EXTENSIONS.has(extension) ? "code" : "text";
};

const readBuffer = (targetPath: string) => {
  try {
    return fs.readFileSync(targetPath);
  } catch (error) {
    throw mcpInternalError(`Failed to read file: ${targetPath}`, {
      cause: error,
    });
  }
};

export const executeGenericRead = async ({
  args,
  environment,
  pushEvent,
}: GenericReadExecutionContext): Promise<GenericReadExecutionResult> => {
  assertHarnessEnvironment(environment);

  const inputPath = args.path;
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw mcpBadRequest("path is required");
  }

  const targetPath = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(targetPath)) {
    throw mcpBadRequest(`Path does not exist: ${targetPath}`);
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) {
    throw mcpBadRequest("read requires a file path");
  }

  const extension = path.extname(targetPath).toLowerCase();
  const officeSkill = OFFICE_SKILLS.get(extension);
  if (officeSkill) {
    pushEvent?.({
      type: "invocation:progress",
      message: `Generic read routing: ${officeSkill} is owned by the Office/WenShu Skill domain`,
    });
    return {
      contents: {
        type: "unsupported",
        path: inputPath,
        reason: "office_owned",
        fileType: officeSkill,
        suggestedSkill: officeSkill,
      },
      artifacts: [],
    };
  }

  const imageMimeType = IMAGE_MIME_TYPES.get(extension);
  if (imageMimeType) {
    pushEvent?.({
      type: "invocation:progress",
      message: "Generic read routing: image requires shared multimodal ToolResult projection",
    });
    return {
      contents: {
        type: "unsupported",
        path: inputPath,
        reason: "multimodal_projection_unavailable",
        fileType: extension.slice(1),
        mimeType: imageMimeType,
      },
      artifacts: [],
    };
  }

  const decoded = decodeText(readBuffer(targetPath));
  if (!decoded) {
    pushEvent?.({
      type: "invocation:progress",
      message: "Generic read outcome: binary content is not decoded as text",
    });
    return {
      contents: {
        type: "unsupported",
        path: inputPath,
        reason: "binary",
        fileType: extension ? extension.slice(1) : undefined,
      },
      artifacts: [],
    };
  }

  const selection = parseGenericReadSelection(args.selection);
  const sliced = sliceGenericText(decoded.text, selection);
  const mimeType = mimeTypeForText(extension);
  const contents: GenericReadTextResult = {
    type: "read",
    path: inputPath,
    operation: selection ? "range" : "read",
    ...(selection ? { selection } : {}),
    window: sliced.window,
    source: {
      kind: "text",
      mimeType,
      text: sliced.text,
      metadata: {
        encoding: decoded.encoding,
        sizeBytes: decoded.sizeBytes,
      },
    },
  };

  pushEvent?.({
    type: "invocation:progress",
    message: `Generic read plan: text-buffer (${decoded.encoding})`,
  });

  return {
    contents,
    artifacts: [
      createArtifact({
        kind: artifactKindForText(extension),
        title: `Read ${inputPath}`,
        mimeType,
        data: sliced.text,
        metadata: {
          path: inputPath,
          encoding: decoded.encoding,
          sizeBytes: decoded.sizeBytes,
          ...(selection ? { selection } : {}),
          window: sliced.window,
        },
      }),
    ],
  };
};
