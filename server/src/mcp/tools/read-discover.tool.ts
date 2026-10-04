import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeReadList, executeReadLocateRuntime } from "../read/runtime.js";
import { emitArtifacts } from "./artifact-utils.js";
import type { ReadDiscoverResult } from "../read/types.js";

export const readDiscoverTool: ToolImplementation = {
  definition: {
    id: "read_discover",
    title: "Read Discover",
    description:
      "Discover workspace objects by listing directories or locating files by path/name. Use grep for text, symbols, references, or content matches.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      oneOf: [
        {
          type: "object",
          required: ["mode", "path"],
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["list"] },
            path: { type: "string" },
            maxResults: { type: "integer" },
          },
        },
        {
          type: "object",
          required: ["mode", "query"],
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["locate"] },
            query: { type: "string" },
            root: { type: "string" },
            maxResults: { type: "integer" },
          },
        },
      ],
    },
    outputSchema: { type: "object" },
    tags: ["read", "workspace", "discover", "locate", "directory", "path", "filename"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
      workspaceBoundary: { argKeys: ["path", "root"] },
    },
  },
  execute: async (context) => {
    const mode = context.args.mode;
    const maxResults = context.args.maxResults;
    if (typeof maxResults === "number" && (!Number.isInteger(maxResults) || maxResults < 1)) {
      throw mcpBadRequest("maxResults must be a positive integer");
    }

    if (mode === "list") {
      if (typeof context.args.path !== "string" || !context.args.path.trim()) {
        throw mcpBadRequest("path is required when mode is list");
      }
      const result = await executeReadList({
        args: { path: context.args.path, maxResults },
        environment: context.environment,
        pushEvent: context.pushEvent,
      });
      emitArtifacts(context, result.artifacts);
      const list = result.contents as Record<string, unknown>;
      const discover: ReadDiscoverResult = {
        ...list,
        type: "discover",
        mode,
        operation: "list",
      } as ReadDiscoverResult;
      return { structuredContent: discover };
    }

    if (mode === "locate") {
      if (typeof context.args.query !== "string" || !context.args.query.trim()) {
        throw mcpBadRequest("query is required when mode is locate");
      }
      const result = await executeReadLocateRuntime({
        args: {
          query: context.args.query,
          path: context.args.root,
          searchMode: "path",
          limit: maxResults,
        },
        environment: context.environment,
        pushEvent: context.pushEvent,
      });
      emitArtifacts(context, result.artifacts);
      const locate = result.contents as Record<string, unknown>;
      const discover: ReadDiscoverResult = {
        ...locate,
        type: "discover",
        mode,
        operation: "locate",
        ...(typeof context.args.root === "string" ? { root: context.args.root } : {}),
      } as ReadDiscoverResult;
      return { structuredContent: discover };
    }

    throw mcpBadRequest("mode must be one of: list, locate");
  },
};
