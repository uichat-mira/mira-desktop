import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { createArtifact } from "../core/artifacts.js";
import type {
  ToolArtifact,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { resolveWorkspacePath } from "../workspace.js";
import { buildContinuation, parseBoundedLimit, parseOffset } from "./paging.js";

export const DEFAULT_GENERIC_READ_LIMIT = 400;
export const MAX_GENERIC_READ_LIMIT = 2_000;

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

export type GenericReadTextResult = {
  type: "read";
  path: string;
  offset: number;
  limit: number;
  returnedCount: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  hasMore: boolean;
  truncated: boolean;
  nextOffset?: number;
  source: {
    kind: "text";
    mimeType: string;
    text: string;
    metadata: {
      encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030";
      sizeBytes: number;
    };
  };
};

export type GenericReadUnsupportedResult = {
  type: "unsupported";
  path: string;
  reason:
    | "office_owned"
    | "binary"
    | "unknown_encoding"
    | "multimodal_projection_unavailable";
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

export const sliceGenericText = (
  text: string,
  input: { offset?: unknown; limit?: unknown } = {},
) => {
  const offset = parseOffset(input.offset);
  const limit = parseBoundedLimit(input.limit, {
    defaultValue: DEFAULT_GENERIC_READ_LIMIT,
    maxValue: MAX_GENERIC_READ_LIMIT,
  });
  const lines = text.split(/\r?\n/);
  const selected = lines.slice(offset, offset + limit);
  const continuation = buildContinuation({
    offset,
    returnedCount: selected.length,
    totalCount: lines.length,
  });
  const startLine = selected.length > 0 ? offset + 1 : Math.min(offset + 1, lines.length + 1);
  const endLine = selected.length > 0 ? offset + selected.length : Math.min(offset, lines.length);

  return {
    text: selected.join("\n"),
    offset,
    limit,
    totalLines: lines.length,
    startLine,
    endLine,
    ...continuation,
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

const decodeText = (
  buffer: Buffer,
): DecodedText | { unsupportedEncoding: true } | null => {
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

  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "utf-8",
      sizeBytes,
    };
  } catch {
    // GB18030 is a superset of GBK and is already a direct server dependency
    // through iconv-lite. Only accept it when the decoded text round-trips to
    // the exact original bytes so invalid UTF-8 never silently becomes mojibake.
    const decoded = iconv.decode(buffer, "gb18030");
    if (iconv.encode(decoded, "gb18030").equals(buffer)) {
      return {
        text: decoded,
        encoding: "gb18030",
        sizeBytes,
      };
    }
    return { unsupportedEncoding: true };
  }
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
  if ("unsupportedEncoding" in decoded) {
    pushEvent?.({
      type: "invocation:progress",
      message: "Generic read outcome: text encoding could not be identified safely",
    });
    return {
      contents: {
        type: "unsupported",
        path: inputPath,
        reason: "unknown_encoding",
        fileType: extension ? extension.slice(1) : undefined,
      },
      artifacts: [],
    };
  }

  const sliced = sliceGenericText(decoded.text, {
    offset: args.offset,
    limit: args.limit,
  });
  const mimeType = mimeTypeForText(extension);
  const contents: GenericReadTextResult = {
    type: "read",
    path: inputPath,
    offset: sliced.offset,
    limit: sliced.limit,
    returnedCount: sliced.returnedCount,
    totalLines: sliced.totalLines,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    hasMore: sliced.hasMore,
    truncated: sliced.truncated,
    ...(sliced.nextOffset === undefined ? {} : { nextOffset: sliced.nextOffset }),
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
          offset: sliced.offset,
          limit: sliced.limit,
          returnedCount: sliced.returnedCount,
          totalLines: sliced.totalLines,
          hasMore: sliced.hasMore,
          ...(sliced.nextOffset === undefined ? {} : { nextOffset: sliced.nextOffset }),
        },
      }),
    ],
  };
};
