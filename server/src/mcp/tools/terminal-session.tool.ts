import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { executeTerminalSessionRuntime } from "../terminal/runtime-host.js";
import { emitArtifacts } from "./artifact-utils.js";

const cwdDescription =
  "Execution directory. Defaults to the selected workspace. Relative paths resolve from the workspace; absolute paths and parent traversal are allowed after the normal approval review.";

const terminalProperties = {
  command: {
    type: "string",
    description:
      "Complete command text for the selected host shell. Python, Node, Git, package managers, scripts, pipelines, and shell-native syntax are supported.",
  },
  cwd: {
    type: "string",
    description: cwdDescription,
  },
  env: {
    type: "object",
    description:
      "Optional environment overrides merged onto the inherited host environment.",
  },
  timeoutMs: {
    type: "number",
    description:
      "Observation timeout in milliseconds. For persistent sessions, reaching this timeout does not terminate the PTY or its running process.",
  },
  attachSessionId: {
    type: "string",
    description:
      "Existing persistent terminal session to continue. Do not combine with cwd or env overrides.",
  },
  sessionMode: {
    type: "string",
    enum: ["ephemeral", "persistent"],
    description:
      "Use persistent for dev servers, watchers, REPLs, interactive shells, or commands that must remain available for later continuation.",
  },
  continuationId: {
    type: "string",
    description:
      "Opaque output continuation id returned by a persistent command. Use it without command to read later buffered output without starting another command.",
  },
  outputOffset: {
    type: "integer",
    minimum: 0,
    description:
      "Byte offset used only with continuationId. Start from nextOutputOffset returned by the previous page.",
  },
  outputLimitBytes: {
    type: "integer",
    minimum: 1,
    description:
      "Maximum output bytes returned in this Tool result. Persistent excess remains reachable through continuationId; ephemeral excess is truncated at this bound.",
  },
} as const;

const terminalSessionLlmInputSchema = {
  type: "object",
  anyOf: [
    { required: ["command"] },
    { required: ["continuationId"] },
  ],
  properties: terminalProperties,
  additionalProperties: false,
} as const;

export const terminalTool: ToolImplementation = {
  definition: {
    id: "terminal",
    title: "Terminal",
    description:
      "Run full host shell commands or PTY-backed persistent sessions, and continue reading bounded persistent output without starting another command. Use semantic file/read/search Tools instead when they directly fit the task.",
    domain: "terminal",
    source: "internal",
    mode: "stream",
    inputSchema: terminalSessionLlmInputSchema,
    inputSchemaByExposure: {
      agent_intent: terminalSessionLlmInputSchema,
      chat_surface: terminalSessionLlmInputSchema,
    },
    tags: ["terminal", "pty", "host-runtime", "process-tree"],
    capabilities: {
      sideEffect: "process",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["cwd"],
        argTypes: {
          cwd: "directory",
        },
      },
      longRunning: true,
      sandboxRequired: false,
    },
  },
  execute: async (context) => {
    const command =
      typeof context.args.command === "string" ? context.args.command.trim() : "";
    const continuationId =
      typeof context.args.continuationId === "string"
        ? context.args.continuationId.trim()
        : "";
    if (!command && !continuationId) {
      throw mcpBadRequest("command or continuationId is required");
    }

    const result = await executeTerminalSessionRuntime({
      invocationId: context.invocationId,
      args: context.args,
      environment: context.environment,
      signal: context.signal,
      pushEvent: context.pushEvent,
      trace: context.trace,
    });

    emitArtifacts(context, result.artifacts);

    return {
      structuredContent: result.contents,
    };
  },
};

export const terminalSessionCompatibilityTool: ToolImplementation = {
  definition: {
    ...terminalTool.definition,
    id: "terminal_session",
    title: "Terminal Session (Compatibility)",
    description:
      "Compatibility alias for persisted runs created before the canonical terminal Tool migration.",
  },
  execute: terminalTool.execute,
};
