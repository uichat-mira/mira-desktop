import { mcpBadRequest } from "../mcp/core/errors.js";
import type { ToolDefinition } from "../mcp/core/definitions.js";

export interface HarnessActionProfile {
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  source: "internal";
  tags: string[];
  runtimeToolId: string;
  inputSchema: Record<string, unknown>;
}

const ACTION_PROFILE_BLUEPRINTS: Array<{
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  tags: string[];
  runtimeToolId: string;
  inputSchema: Record<string, unknown>;
  mapArgs: (args: Record<string, unknown>) => Record<string, unknown>;
}> = [
  {
    id: "terminal_execute_command",
    title: "Terminal Execute Command",
    description: "Execute a controlled terminal command in the current workspace runtime.",
    domain: "terminal",
    tags: ["terminal", "command", "shell", "process"],
    runtimeToolId: "terminal_session",
    inputSchema: {
      type: "object",
      required: ["command"],
      additionalProperties: false,
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
    mapArgs: (args) => ({
      command: args.command,
      ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
      ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {}),
    }),
  },
];

export const resolveHarnessActionProfiles = (
  definitions: ToolDefinition[],
): HarnessActionProfile[] => {
  const definitionIds = new Set(definitions.map((definition) => definition.id));

  return ACTION_PROFILE_BLUEPRINTS.filter((blueprint) => definitionIds.has(blueprint.runtimeToolId)).map(
    (blueprint) => ({
      id: blueprint.id,
      title: blueprint.title,
      description: blueprint.description,
      domain: blueprint.domain,
      source: "internal" as const,
      tags: blueprint.tags,
      runtimeToolId: blueprint.runtimeToolId,
      inputSchema: blueprint.inputSchema,
    }),
  );
};

export const resolveActionProfileInvocation = (input: {
  actionProfileId: string;
  args: Record<string, unknown>;
}) => {
  const blueprint = ACTION_PROFILE_BLUEPRINTS.find(
    (candidate) => candidate.id === input.actionProfileId,
  );
  if (!blueprint) {
    throw mcpBadRequest(`Unknown action profile: ${input.actionProfileId}`);
  }

  return {
    toolId: blueprint.runtimeToolId,
    args: blueprint.mapArgs(input.args),
  };
};
