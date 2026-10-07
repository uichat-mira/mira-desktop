import { mcpBadRequest } from "../core/errors.js";

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const ENVIRONMENT_ID = "*** Environment ID:";
const ADD_FILE = "*** Add File:";
const DELETE_FILE = "*** Delete File:";
const UPDATE_FILE = "*** Update File:";
const MOVE_TO = "*** Move to:";
const END_OF_FILE = "*** End of File";

export type ApplyPatchChunk = {
  oldLines: string[];
  newLines: string[];
  changeContext?: string;
  isEndOfFile: boolean;
};

export type ApplyPatchHunk =
  | {
      type: "add";
      path: string;
      contents: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "update";
      path: string;
      movePath?: string;
      chunks: ApplyPatchChunk[];
    };

export type ParsedApplyPatch = {
  patchText: string;
  environmentId?: string;
  hunks: ApplyPatchHunk[];
};

const invalidPatch = (message: string, lineNumber?: number): never => {
  throw mcpBadRequest(
    lineNumber === undefined ? message : `apply_patch line ${lineNumber}: ${message}`,
  );
};

const markerPath = (
  line: string,
  marker: string,
  lineNumber: number,
) => {
  const value = line.slice(marker.length).trim();
  if (!value) {
    invalidPatch(`${marker.slice(4, -1)} path is required`, lineNumber);
  }
  return value;
};

const isFileHeader = (line: string) =>
  line.startsWith(ADD_FILE) ||
  line.startsWith(DELETE_FILE) ||
  line.startsWith(UPDATE_FILE);

const normalizePatchLines = (patchText: string) => {
  const lines = patchText.replace(/\r\n|\r/g, "\n").split("\n");
  // Codex accepts one final LF after *** End Patch. Do not trim inner lines:
  // whitespace is patch data.
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
};

const parseAdd = (
  lines: string[],
  startIndex: number,
  endIndex: number,
): { hunk: ApplyPatchHunk; nextIndex: number } => {
  const path = markerPath(lines[startIndex]!, ADD_FILE, startIndex + 1);
  const content: string[] = [];
  let index = startIndex + 1;

  while (index < endIndex && !isFileHeader(lines[index]!)) {
    const line = lines[index]!;
    if (!line.startsWith("+")) {
      invalidPatch("Add File lines must start with '+'", index + 1);
    }
    content.push(line.slice(1));
    index += 1;
  }

  if (content.length === 0) {
    invalidPatch(`Add File hunk for path '${path}' is empty`, startIndex + 1);
  }

  return {
    hunk: {
      type: "add",
      path,
      contents: `${content.join("\n")}\n`,
    },
    nextIndex: index,
  };
};

const parseUpdate = (
  lines: string[],
  startIndex: number,
  endIndex: number,
): { hunk: ApplyPatchHunk; nextIndex: number } => {
  const path = markerPath(lines[startIndex]!, UPDATE_FILE, startIndex + 1);
  let index = startIndex + 1;
  let movePath: string | undefined;

  if (index < endIndex && lines[index]!.startsWith(MOVE_TO)) {
    movePath = markerPath(lines[index]!, MOVE_TO, index + 1);
    index += 1;
  }

  const chunks: ApplyPatchChunk[] = [];
  while (index < endIndex && !isFileHeader(lines[index]!)) {
    const header = lines[index]!;
    if (!header.startsWith("@@")) {
      invalidPatch("Update File changes must start with '@@'", index + 1);
    }

    const changeContext = header.slice(2).trim();
    index += 1;

    const oldLines: string[] = [];
    const newLines: string[] = [];
    let changeLineCount = 0;
    let isEndOfFile = false;

    while (
      index < endIndex &&
      !isFileHeader(lines[index]!) &&
      !lines[index]!.startsWith("@@")
    ) {
      const line = lines[index]!;
      if (line === END_OF_FILE) {
        isEndOfFile = true;
        index += 1;
        break;
      }
      if (line.startsWith(" ")) {
        const value = line.slice(1);
        oldLines.push(value);
        newLines.push(value);
      } else if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        newLines.push(line.slice(1));
      } else {
        invalidPatch(
          "Update File change lines must start with ' ', '+' or '-'",
          index + 1,
        );
      }
      changeLineCount += 1;
      index += 1;
    }

    if (changeLineCount === 0) {
      invalidPatch(`Update File hunk for path '${path}' has an empty change`, index + 1);
    }

    chunks.push({
      oldLines,
      newLines,
      ...(changeContext ? { changeContext } : {}),
      isEndOfFile,
    });
  }

  if (chunks.length === 0) {
    invalidPatch(`Update File hunk for path '${path}' is empty`, startIndex + 1);
  }

  return {
    hunk: {
      type: "update",
      path,
      ...(movePath ? { movePath } : {}),
      chunks,
    },
    nextIndex: index,
  };
};

export const parseApplyPatch = (patchText: string): ParsedApplyPatch => {
  if (typeof patchText !== "string" || !patchText.trim()) {
    invalidPatch("patchText is required");
  }

  const lines = normalizePatchLines(patchText);
  if (lines[0]?.trim() !== BEGIN_PATCH) {
    invalidPatch(`The first line must be '${BEGIN_PATCH}'`);
  }
  if (lines.at(-1)?.trim() !== END_PATCH) {
    invalidPatch(`The last line must be '${END_PATCH}'`);
  }

  const endIndex = lines.length - 1;
  let index = 1;
  let environmentId: string | undefined;
  const hunks: ApplyPatchHunk[] = [];

  if (index < endIndex && lines[index]!.startsWith(ENVIRONMENT_ID)) {
    environmentId = lines[index]!.slice(ENVIRONMENT_ID.length).trim();
    if (!environmentId) {
      invalidPatch("Environment ID must not be empty", index + 1);
    }
    index += 1;
  }

  while (index < endIndex) {
    const line = lines[index]!;

    if (line.startsWith(ADD_FILE)) {
      const parsed = parseAdd(lines, index, endIndex);
      hunks.push(parsed.hunk);
      index = parsed.nextIndex;
      continue;
    }

    if (line.startsWith(DELETE_FILE)) {
      hunks.push({
        type: "delete",
        path: markerPath(line, DELETE_FILE, index + 1),
      });
      index += 1;
      continue;
    }

    if (line.startsWith(UPDATE_FILE)) {
      const parsed = parseUpdate(lines, index, endIndex);
      hunks.push(parsed.hunk);
      index = parsed.nextIndex;
      continue;
    }

    invalidPatch("Expected Add File, Delete File, or Update File hunk", index + 1);
  }

  return {
    patchText,
    ...(environmentId ? { environmentId } : {}),
    hunks,
  };
};
