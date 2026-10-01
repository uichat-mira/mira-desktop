import { spawn } from "node:child_process";
import type { BuilderProviderEvent, BuilderRunner } from "./types.js";
import {
  asRecord,
  optionalString,
  parsePrefixArgs,
  requiredString,
  runBuilderJsonProcess,
  type SpawnLike,
} from "./shared.js";

function assistantMessageText(message: unknown): string | null {
  const record = asRecord(message);
  if (!record || record.role !== "assistant") return null;
  if (typeof record.content === "string") {
    return optionalString(record.content);
  }
  if (!Array.isArray(record.content)) return null;
  const parts = record.content
    .map((item) => asRecord(item))
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) &&
        item?.type === "text" &&
        typeof item.text === "string",
    )
    .map((item) => String(item.text).trim())
    .filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function parsePiAgentBuilderPrefixArgs(value: unknown): string[] {
  return parsePrefixArgs(value, "MIRA_FORGE_PIAGENT_PREFIX_ARGS");
}

export function buildPiAgentBuilderArgs(input: {
  prefixArgs?: string[];
  projectRoot?: unknown;
  prompt?: unknown;
  model?: unknown;
}): string[] {
  requiredString(input.projectRoot, "projectRoot");
  const prompt = requiredString(input.prompt, "prompt");
  const args = [
    ...(input.prefixArgs ?? []),
    "--mode",
    "json",
    "-p",
    "--no-session",
  ];
  const model = optionalString(input.model);
  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

export function normalizePiAgentBuilderEvent(
  event: Record<string, unknown>,
): BuilderProviderEvent | null {
  const type = optionalString(event.type);
  if (!type) return null;

  if (type === "session" && optionalString(event.id)) {
    return {
      externalSessionId: optionalString(event.id),
      provider: {
        adapter: "piagent",
        eventType: type,
        status: "running",
      },
    };
  }

  if (type === "agent_start" || type === "agent_end") {
    return {
      provider: {
        adapter: "piagent",
        eventType: type,
        status: type === "agent_end" ? "completed" : "running",
      },
    };
  }

  if (type === "tool_execution_start" || type === "tool_execution_end") {
    const failed = Boolean(event.isError);
    const status =
      type === "tool_execution_end"
        ? failed
          ? "failed"
          : "completed"
        : "running";
    return {
      tool: {
        name: optionalString(event.toolName) ?? "tool",
        status,
      },
      provider: {
        adapter: "piagent",
        eventType: type,
        itemType: "tool",
        status,
      },
    };
  }

  return {
    provider: {
      adapter: "piagent",
      eventType: type,
      status: null,
    },
  };
}

export interface PiAgentBuilderRunnerOptions {
  bin?: string;
  prefixArgs?: string[];
  spawnImpl?: SpawnLike;
  environment?: NodeJS.ProcessEnv;
}

export function createPiAgentBuilderRunner(
  options: PiAgentBuilderRunnerOptions = {},
): BuilderRunner {
  const {
    bin = "pi",
    prefixArgs = [],
    spawnImpl = spawn as unknown as SpawnLike,
    environment = process.env,
  } = options;

  return {
    start(input) {
      const args = buildPiAgentBuilderArgs({
        prefixArgs,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        model: input.model,
      });
      const child = spawnImpl(bin, args, {
        cwd: input.projectRoot,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      return runBuilderJsonProcess({
        child,
        callbacks: input,
        consumeEvent: normalizePiAgentBuilderEvent,
        consumeResult(event) {
          const type = optionalString(event.type);
          const message = asRecord(event.message);
          if (type === "message_end") {
            const text = assistantMessageText(message);
            const errorText =
              message?.stopReason === "error"
                ? optionalString(message.errorMessage)
                : null;
            return {
              resultText: text ? text + "\n" : null,
              errorText,
            };
          }
          if (type === "turn_end") {
            return {
              errorText: optionalString(message?.errorMessage),
            };
          }
          return {};
        },
      });
    },
  };
}
