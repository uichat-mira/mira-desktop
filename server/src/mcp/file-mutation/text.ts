import fs from "node:fs";
import iconv from "iconv-lite";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";

export type MutationTextEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "gb18030";

export type MutationLineEnding = "\n" | "\r\n" | "\r";

export type MutationTextFormat = {
  encoding: MutationTextEncoding;
  lineEnding: MutationLineEnding | null;
};

export type MutationTextFile = MutationTextFormat & {
  text: string;
};

type DetectedText =
  | {
      kind: "text";
      encoding: MutationTextEncoding;
      iconvEncoding: string;
      bom: Buffer;
      text: string;
    }
  | { kind: "binary" }
  | { kind: "unknown_encoding" };

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);
const FORMAT_PROBE_BYTES = 64 * 1024;

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

const decodeWithBom = (
  buffer: Buffer,
  input: {
    encoding: MutationTextEncoding;
    iconvEncoding: string;
    bom: Buffer;
  },
): DetectedText => ({
  kind: "text",
  encoding: input.encoding,
  iconvEncoding: input.iconvEncoding,
  bom: input.bom,
  text: iconv.decode(buffer.subarray(input.bom.length), input.iconvEncoding),
});

const detectText = (buffer: Buffer): DetectedText => {
  if (buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    return decodeWithBom(buffer, {
      encoding: "utf-8-bom",
      iconvEncoding: "utf8",
      bom: UTF8_BOM,
    });
  }
  if (buffer.subarray(0, UTF16LE_BOM.length).equals(UTF16LE_BOM)) {
    return decodeWithBom(buffer, {
      encoding: "utf-16le",
      iconvEncoding: "utf16-le",
      bom: UTF16LE_BOM,
    });
  }
  if (buffer.subarray(0, UTF16BE_BOM.length).equals(UTF16BE_BOM)) {
    return decodeWithBom(buffer, {
      encoding: "utf-16be",
      iconvEncoding: "utf16-be",
      bom: UTF16BE_BOM,
    });
  }

  if (isLikelyBinary(buffer)) {
    return { kind: "binary" };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      kind: "text",
      encoding: "utf-8",
      iconvEncoding: "utf8",
      bom: Buffer.alloc(0),
      text,
    };
  } catch {
    const text = iconv.decode(buffer, "gb18030");
    if (iconv.encode(text, "gb18030").equals(buffer)) {
      return {
        kind: "text",
        encoding: "gb18030",
        iconvEncoding: "gb18030",
        bom: Buffer.alloc(0),
        text,
      };
    }
  }

  return { kind: "unknown_encoding" };
};

const countOccurrences = (value: string, pattern: RegExp) =>
  [...value.matchAll(pattern)].length;

export const detectLineEnding = (text: string): MutationLineEnding | null => {
  const crlf = countOccurrences(text, /\r\n/g);
  const withoutCrlf = text.replace(/\r\n/g, "");
  const lf = countOccurrences(withoutCrlf, /\n/g);
  const cr = countOccurrences(withoutCrlf, /\r/g);

  const candidates: Array<{
    value: MutationLineEnding;
    count: number;
    first: number;
  }> = [
    { value: "\r\n", count: crlf, first: text.indexOf("\r\n") },
    { value: "\n", count: lf, first: text.indexOf("\n") },
    { value: "\r", count: cr, first: text.indexOf("\r") },
  ].filter((candidate) => candidate.count > 0);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (left, right) =>
      right.count - left.count ||
      (left.first < 0 ? Number.MAX_SAFE_INTEGER : left.first) -
        (right.first < 0 ? Number.MAX_SAFE_INTEGER : right.first),
  );
  return candidates[0].value;
};

export const adaptLineEndings = (
  text: string,
  lineEnding: MutationLineEnding | null,
) => {
  if (!lineEnding) {
    return text;
  }

  return text.replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, lineEnding);
};

const readBuffer = (targetPath: string) => {
  try {
    return fs.readFileSync(targetPath);
  } catch (error) {
    throw mcpInternalError(`Failed to read workspace file: ${targetPath}`, {
      cause: error,
    });
  }
};

const readProbe = (targetPath: string) => {
  try {
    const handle = fs.openSync(targetPath, "r");
    try {
      const buffer = Buffer.alloc(FORMAT_PROBE_BYTES);
      const bytesRead = fs.readSync(
        handle,
        buffer,
        0,
        FORMAT_PROBE_BYTES,
        0,
      );
      return buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    throw mcpInternalError(`Failed to inspect workspace file: ${targetPath}`, {
      cause: error,
    });
  }
};

export const readMutationTextFile = (targetPath: string): MutationTextFile => {
  const detected = detectText(readBuffer(targetPath));
  if (detected.kind === "binary") {
    throw mcpBadRequest("edit only supports text files");
  }
  if (detected.kind === "unknown_encoding") {
    throw mcpBadRequest("edit could not determine the file text encoding safely");
  }

  return {
    text: detected.text,
    encoding: detected.encoding,
    lineEnding: detectLineEnding(detected.text),
  };
};

export const inspectMutationTextFormat = (
  targetPath: string,
): MutationTextFormat | null => {
  const detected = detectText(readProbe(targetPath));
  if (detected.kind !== "text") {
    return null;
  }

  return {
    encoding: detected.encoding,
    lineEnding: detectLineEnding(detected.text),
  };
};

const encodeText = (text: string, encoding: MutationTextEncoding) => {
  switch (encoding) {
    case "utf-8-bom":
      return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
    case "utf-16le":
      return Buffer.concat([UTF16LE_BOM, iconv.encode(text, "utf16-le")]);
    case "utf-16be":
      return Buffer.concat([UTF16BE_BOM, iconv.encode(text, "utf16-be")]);
    case "gb18030":
      return iconv.encode(text, "gb18030");
    case "utf-8":
    default:
      return Buffer.from(text, "utf8");
  }
};

export const encodeMutationText = (
  text: string,
  format: MutationTextFormat,
) => encodeText(adaptLineEndings(text, format.lineEnding), format.encoding);
