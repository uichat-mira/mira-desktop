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
} as const;

const terminalSessionLlmInputSchema = {
  type: "object",
  required: ["command"],
  properties: terminalProperties,
  additionalProperties: false,
} as const;

export const terminalSessionTool: ToolImplementation = {
  definition: {
    id: "terminal_session",
    title: "Terminal Session",
    description:
      "Run full host shell commands or PTY-backed persistent sessions with process-tree ownership and streamed output.",
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
    if (!command) {
      throw mcpBadRequest("command is required");
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
