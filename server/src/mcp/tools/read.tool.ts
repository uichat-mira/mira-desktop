import { loadSkillResource } from "@/skills/context/index.js";
import { createArtifact } from "../core/artifacts.js";
import type { ToolInvocationEventInput, ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeGenericRead, sliceGenericText } from "../read/generic.js";
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
  offset?: unknown;
  limit?: unknown;
  pushEvent?: (event: ToolInvocationEventInput) => void;
}) => {
  const skillId = parseSkillId(input.uri);
  const loaded = await loadSkillResource({ skillId, uri: input.uri });
  const sliced = sliceGenericText(loaded.content, {
    offset: input.offset,
    limit: input.limit,
  });

  input.pushEvent?.({
    type: "invocation:progress",
    message: `Generic read plan: skill-resource -> ${loaded.kind}`,
  });

  const contents = {
    type: "read" as const,
    path: input.uri,
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

export const readTool: ToolImplementation = {
  definition: {
    id: "read",
    title: "Read",
    description:
      "Read contents of a known file. Use glob when you do not know the path; use grep to search file contents.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      },
    },
    outputSchema: { type: "object" },
    tags: ["read", "file", "content"],
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
          offset: context.args.offset,
          limit: context.args.limit,
          pushEvent: context.pushEvent,
        })
      : await executeGenericRead({
          args: {
            path: normalizedPath,
            ...(context.args.offset !== undefined ? { offset: context.args.offset } : {}),
            ...(context.args.limit !== undefined ? { limit: context.args.limit } : {}),
          },
          environment: context.environment,
          pushEvent: context.pushEvent,
        });

    emitArtifacts(context, result.artifacts);
    return {
      ...(result.content?.length ? { content: result.content } : {}),
      structuredContent: result.contents,
    };
  },
};
