import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import iconv from "iconv-lite";
import { lookup as lookupMimeType } from "mime-types";
import { createArtifact } from "../core/artifacts.js";
import type {
  ToolArtifact,
  ToolContentBlock,
  ToolExecutionEnvironment,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import { resolveWorkspaceFilePath } from "../workspace.js";
import { buildContinuation, parseBoundedLimit, parseOffset } from "./paging.js";

export const DEFAULT_GENERIC_READ_LIMIT = 400;
export const MAX_GENERIC_READ_LIMIT = 2_000;
export const MAX_GENERIC_IMAGE_BYTES = 20 * 1024 * 1024;

const OFFICE_SKILLS = new Map<string, "docx" | "xlsx" | "pptx" | "pdf">([
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pptx", "pptx"],
  [".pdf", "pdf"],
]);

const resolveImageMimeType = (targetPath: string) => {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === ".svg") {
    return undefined;
  }
  const mimeType = lookupMimeType(targetPath);
  return typeof mimeType === "string" && mimeType.startsWith("image/")
    ? mimeType
    : undefined;
};

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
  totalLines?: number;
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

export type GenericReadImageResult = {
  type: "read";
  path: string;
  mediaType: "image";
  mimeType: string;
  sizeBytes: number;
};

export type GenericReadUnsupportedResult = {
  type: "unsupported";
  path: string;
  reason:
    | "office_owned"
    | "binary"
    | "unknown_encoding"
    | "file_too_large";
  fileType?: string;
  mimeType?: string;
  suggestedSkill?: "docx" | "xlsx" | "pptx" | "pdf";
  sizeBytes?: number;
  maxBytes?: number;
};

export type GenericReadResult =
  | GenericReadTextResult
  | GenericReadImageResult
  | GenericReadUnsupportedResult;

type GenericReadExecutionResult = {
  contents: GenericReadResult;
  content?: ToolContentBlock[];
  artifacts: ToolArtifact[];
};

type GenericReadExecutionContext = {
  args: Record<string, unknown>;
  environment?: ToolExecutionEnvironment;
  pushEvent?: (event: ToolInvocationEventInput) => void;
};

type DetectedTextEncoding =
  | {
      kind: "text";
      encoding: GenericReadTextResult["source"]["metadata"]["encoding"];
      iconvEncoding: string;
      bomBytes: number;
    }
  | { kind: "binary" }
  | { kind: "unknown_encoding" };


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

const READ_ENCODING_PROBE_BYTES = 64 * 1024;

const readEncodingProbe = (targetPath: string) => {
  const handle = fs.openSync(targetPath, "r");
  try {
    const buffer = Buffer.alloc(READ_ENCODING_PROBE_BYTES);
    const bytesRead = fs.readSync(
      handle,
      buffer,
      0,
      READ_ENCODING_PROBE_BYTES,
      0,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
};

const detectTextEncoding = (buffer: Buffer): DetectedTextEncoding => {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return {
      kind: "text",
      encoding: "utf-8-bom",
      iconvEncoding: "utf8",
      bomBytes: 3,
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      kind: "text",
      encoding: "utf-16le",
      iconvEncoding: "utf16-le",
      bomBytes: 2,
    };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      kind: "text",
      encoding: "utf-16be",
      iconvEncoding: "utf16-be",
      bomBytes: 2,
    };
  }

  if (isLikelyBinary(buffer)) {
    return { kind: "binary" };
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      kind: "text",
      encoding: "utf-8",
      iconvEncoding: "utf8",
      bomBytes: 0,
    };
  } catch {
    const decoded = iconv.decode(buffer, "gb18030");
    if (iconv.encode(decoded, "gb18030").equals(buffer)) {
      return {
        kind: "text",
        encoding: "gb18030",
        iconvEncoding: "gb18030",
        bomBytes: 0,
      };
    }
    return { kind: "unknown_encoding" };
  }
};

const readTextWindow = async (
  targetPath: string,
  input: { offset?: unknown; limit?: unknown },
) => {
  const offset = parseOffset(input.offset);
  const limit = parseBoundedLimit(input.limit, {
    defaultValue: DEFAULT_GENERIC_READ_LIMIT,
    maxValue: MAX_GENERIC_READ_LIMIT,
  });
  const sizeBytes = fs.statSync(targetPath).size;
  const detected = detectTextEncoding(readEncodingProbe(targetPath));
  if (detected.kind !== "text") {
    return { kind: detected.kind } as const;
  }

  const source = fs.createReadStream(targetPath, {
    start: detected.bomBytes,
  });
  const decoder = iconv.decodeStream(detected.iconvEncoding);
  source.pipe(decoder);
  const lines = readline.createInterface({
    input: decoder,
    crlfDelay: Infinity,
  });

  const selected: string[] = [];
  let lineIndex = 0;
  let hasMore = false;
  try {
    for await (const line of lines) {
      if (lineIndex < offset) {
        lineIndex += 1;
        continue;
      }
      if (selected.length >= limit) {
        hasMore = true;
        break;
      }
      selected.push(line);
      lineIndex += 1;
    }
  } finally {
    lines.close();
    source.destroy();
    decoder.destroy();
  }

  const returnedCount = selected.length;
  const startLine =
    returnedCount > 0 ? offset + 1 : Math.min(offset + 1, lineIndex + 1);
  const endLine =
    returnedCount > 0 ? offset + returnedCount : Math.min(offset, lineIndex);
  const reachedEof = !hasMore;
  const continuation = buildContinuation({
    offset,
    returnedCount,
    hasMore,
  });

  return {
    kind: "text" as const,
    text: selected.join("\n"),
    encoding: detected.encoding,
    sizeBytes,
    offset,
    limit,
    returnedCount,
    startLine,
    endLine,
    hasMore: continuation.hasMore,
    truncated: continuation.truncated,
    ...(continuation.nextOffset === undefined
      ? {}
      : { nextOffset: continuation.nextOffset }),
    ...(reachedEof ? { totalLines: lineIndex } : {}),
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

  const targetPath = resolveWorkspaceFilePath(inputPath);
  const stat = fs.statSync(targetPath);

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

  const imageMimeType = resolveImageMimeType(targetPath);
  if (imageMimeType) {
    if (stat.size > MAX_GENERIC_IMAGE_BYTES) {
      return {
        contents: {
          type: "unsupported",
          path: inputPath,
          reason: "file_too_large",
          fileType: extension.slice(1),
          mimeType: imageMimeType,
          sizeBytes: stat.size,
          maxBytes: MAX_GENERIC_IMAGE_BYTES,
        },
        artifacts: [],
      };
    }

    const data = (await fs.promises.readFile(targetPath)).toString("base64");
    pushEvent?.({
      type: "invocation:progress",
      message: `Generic read plan: image-inline-data (${imageMimeType})`,
    });
    return {
      contents: {
        type: "read",
        path: inputPath,
        mediaType: "image",
        mimeType: imageMimeType,
        sizeBytes: stat.size,
      },
      content: [
        {
          type: "text",
          text: `Read image file: ${inputPath}`,
        },
        {
          type: "image",
          data,
          mimeType: imageMimeType,
          filename: path.basename(targetPath),
        },
      ],
      artifacts: [],
    };
  }

  const sliced = await readTextWindow(targetPath, {
    offset: args.offset,
    limit: args.limit,
  });
  if (sliced.kind === "binary") {
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
  if (sliced.kind === "unknown_encoding") {
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

  const mimeType = mimeTypeForText(extension);
  const contents: GenericReadTextResult = {
    type: "read",
    path: inputPath,
    offset: sliced.offset,
    limit: sliced.limit,
    returnedCount: sliced.returnedCount,
    ...(sliced.totalLines === undefined ? {} : { totalLines: sliced.totalLines }),
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
        encoding: sliced.encoding,
        sizeBytes: sliced.sizeBytes,
      },
    },
  };

  pushEvent?.({
    type: "invocation:progress",
    message: `Generic read plan: streamed-line-window (${sliced.encoding})`,
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
          encoding: sliced.encoding,
          sizeBytes: sliced.sizeBytes,
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
