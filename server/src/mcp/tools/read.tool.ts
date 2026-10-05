import { loadSkillResource } from "@/skills/context/index.js";
import { createArtifact } from "../core/artifacts.js";
import type { ToolInvocationEventInput, ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  executeGenericRead,
  parseGenericReadSelection,
  sliceGenericText,
} from "../read/generic.js";
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

const parseSkillId = (uri: string) => {
  const match = /^skill:\/\/([^/]+)\/.+/.exec(uri);
  if (!match?.[1]) throw mcpBadRequest(`Invalid skill resource URI: ${uri}`);
  return match[1];
};

const executeSkillResourceRead = async (input: {
  uri: string;
  selection?: unknown;
  pushEvent?: (event: ToolInvocationEventInput) => void;
}) => {
  const skillId = parseSkillId(input.uri);
  const loaded = await loadSkillResource({ skillId, uri: input.uri });
  const selection = parseGenericReadSelection(input.selection);
  const sliced = sliceGenericText(loaded.content, selection);

  input.pushEvent?.({
    type: "invocation:progress",
    message: `Generic read plan: skill-resource -> ${loaded.kind}`,
  });

  const contents = {
    type: "read" as const,
    path: input.uri,
    operation: selection ? ("range" as const) : ("read" as const),
    ...(selection ? { selection } : {}),
    window: sliced.window,
    source: {
      kind: "text" as const,
      mimeType: "text/markdown",
      text: sliced.text,
      metadata: {
        encoding: "utf-8" as const,
        sizeBytes: Buffer.byteLength(loaded.content, "utf8"),
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
        kind: "markdown",
        title: `Read ${input.uri}`,
        mimeType: "text/markdown",
        data: sliced.text,
        metadata: {
          scheme: "skill",
          skillId,
          resourceKind: loaded.kind,
          uri: loaded.uri,
          ...(selection ? { selection } : {}),
          window: sliced.window,
        },
      }),
    ],
  };
};

export const readTool: ToolImplementation = {
  definition: {
    id: "read",
    title: "Read",
    description:
      "Read a known generic workspace file or read-only skill:// text resource with bounded output. Office-native DOCX/XLSX/PPTX/PDF content is owned by the Office/WenShu Skill domain rather than parsed by this Tool.",
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
    tags: ["read", "workspace", "file", "text", "skill-resource"],
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
      ? await executeSkillResourceRead({
          uri: skillResourceUri,
          selection: context.args.selection,
          pushEvent: context.pushEvent,
        })
      : await executeGenericRead({
          args: {
            path: normalizedPath,
            ...(context.args.selection !== undefined
              ? { selection: context.args.selection }
              : {}),
          },
          environment: context.environment,
          pushEvent: context.pushEvent,
        });

    emitArtifacts(context, result.artifacts);
    return {
      structuredContent: result.contents,
    };
  },
};
