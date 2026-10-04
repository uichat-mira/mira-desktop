import { loadSkillResource } from "@/skills/context/index.js";
import { createArtifact } from "../core/artifacts.js";
import type { ToolInvocationEventInput, ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { sliceExtractedText } from "../document-readers.js";
import { executeReadOpen } from "../read/runtime.js";
import type { ReadOpenResult, ReadSelection } from "../read/types.js";
import { emitArtifacts } from "./artifact-utils.js";

const SKILL_RESOURCE_PREFIX = "skill://";
const NORMALIZED_SKILL_RESOURCE_PREFIX = "skill:/";

const canonicalizeSkillResourceUri = (value: string) => {
  if (value.startsWith(SKILL_RESOURCE_PREFIX)) return value;
  if (value.startsWith(NORMALIZED_SKILL_RESOURCE_PREFIX)) {
    return `${SKILL_RESOURCE_PREFIX}${value.slice(NORMALIZED_SKILL_RESOURCE_PREFIX.length)}`;
  }
  return null;
};

const parseSelection = (value: unknown): ReadSelection | undefined => {
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

const parseSkillId = (uri: string) => {
  const match = /^skill:\/\/([^/]+)\/.+/.exec(uri);
  if (!match?.[1]) throw mcpBadRequest(`Invalid skill resource URI: ${uri}`);
  return match[1];
};

const executeSkillResourceOpen = async (input: {
  uri: string;
  selection?: unknown;
  pushEvent?: (event: ToolInvocationEventInput) => void;
}) => {
  const skillId = parseSkillId(input.uri);
  const loaded = await loadSkillResource({ skillId, uri: input.uri });
  const selection = parseSelection(input.selection);
  const selectedText = selection
    ? sliceExtractedText(loaded.content, {
        startLine: selection.start,
        endLine: selection.end,
      }).text
    : loaded.content;

  input.pushEvent?.({
    type: "invocation:progress",
    message: `Read plan: skill-resource -> ${loaded.kind}`,
  });

  const contents: ReadOpenResult = {
    type: "open",
    path: input.uri,
    operation: selection ? "extract" : "open",
    ...(selection ? { selection } : {}),
    source: {
      kind: "text",
      mimeType: "text/markdown",
      text: selectedText,
      metadata: {
        scheme: "skill",
        skillId,
        resourceKind: loaded.kind,
        resourceName: loaded.name,
        uri: loaded.uri,
      },
    },
  };

  return {
    contents,
    artifacts: [
      createArtifact({
        kind: "text",
        title: `Read ${input.uri}`,
        mimeType: "text/markdown",
        data: selectedText,
        metadata: {
          scheme: "skill",
          skillId,
          resourceKind: loaded.kind,
          uri: loaded.uri,
          ...(selection ? { selection } : {}),
        },
      }),
    ],
  };
};

export const readOpenTool: ToolImplementation = {
  definition: {
    id: "read_open",
    title: "Read Open",
    description:
      "Open a known authorized workspace file or a read-only skill:// resource URI and return normalized contents.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        selection: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "start", "end"],
          properties: {
            kind: { type: "string", enum: ["lines", "range"] },
            start: { type: "integer" },
            end: { type: "integer" },
          },
        },
      },
    },
    outputSchema: {
      type: "object",
    },
    tags: ["read", "workspace", "document", "skill-resource"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["path"],
      },
    },
  },
  execute: async (context) => {
    const pathValue = context.args.path;
    if (typeof pathValue !== "string" || !pathValue.trim()) {
      throw mcpBadRequest("path is required");
    }
    const normalizedPath = pathValue.trim();
    const skillResourceUri = canonicalizeSkillResourceUri(normalizedPath);

    const result = skillResourceUri
      ? await executeSkillResourceOpen({
          uri: skillResourceUri,
          selection: context.args.selection,
          pushEvent: context.pushEvent,
        })
      : await executeReadOpen({
          args: {
            path: pathValue,
            ...(context.args.selection !== undefined ? { selection: context.args.selection } : {}),
          },
          environment: context.environment,
          pushEvent: context.pushEvent,
        });

    emitArtifacts(context, result.artifacts);
    return {
      result: result.contents,
    };
  },
};
