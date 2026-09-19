import { spawn } from "node:child_process";
import type { BuilderRunner, BuilderProviderEvent } from "./types.js";
import {
  appendBounded,
  asRecord,
  optionalString,
  parsePrefixArgs,
  requiredString,
  runBuilderJsonProcess,
  type SpawnLike,
} from "./shared.js";

export function parseOpenCodeBuilderPrefixArgs(value: unknown): string[] {
  return parsePrefixArgs(value, "MIRA_FORGE_OPENCODE_PREFIX_ARGS");
}

export function buildOpenCodeBuilderArgs(input: {
  prefixArgs?: string[];
  projectRoot?: unknown;
  prompt?: unknown;
  model?: unknown;
  agent?: unknown;
}): string[] {
  const projectRoot = requiredString(input.projectRoot, "projectRoot");
  const prompt = requiredString(input.prompt, "prompt");
  const args = [
    ...(input.prefixArgs ?? []),
    "run",
    "--format",
    "json",
    "--dir",
    projectRoot,
  ];
  const model = optionalString(input.model);
  const agent = optionalString(input.agent);
  if (model) args.push("--model", model);
  if (agent) args.push("--agent", agent);
  args.push(prompt);
  return args;
}

export function normalizeOpenCodeBuilderEvent(
  event: Record<string, unknown>,
): BuilderProviderEvent | null {
  const part = asRecord(event.part);
  const partType = optionalString(part?.type);
  const state = asRecord(part?.state);
  const providerStatus =
    optionalString(state?.status) ?? optionalString(part?.status);

  const normalized: BuilderProviderEvent = {
    externalSessionId: optionalString(event.sessionID),
    provider: {
      adapter: "opencode",
      eventType: optionalString(event.type),
      itemType: partType,
      status: providerStatus,
    },
  };

  if (partType && ["tool", "tool_use", "tool_result"].includes(partType)) {
    normalized.tool = {
      name:
        optionalString(part?.tool) ??
        optionalString(part?.name) ??
        partType,
      status: providerStatus,
    };
  }
  if (partType === "file_change") {
    normalized.artifact = {
      kind: "provider-file-change",
      ref: null,
    };
  }

  if (
    !normalized.externalSessionId &&
    !normalized.provider?.eventType &&
    !normalized.provider?.itemType
  ) {
    return null;
  }
  return normalized;
}

export interface OpenCodeBuilderRunnerOptions {
  bin?: string;
  prefixArgs?: string[];
  spawnImpl?: SpawnLike;
  environment?: NodeJS.ProcessEnv;
}

export function createOpenCodeBuilderRunner(
  options: OpenCodeBuilderRunnerOptions = {},
): BuilderRunner {
  const {
    bin = "opencode",
    prefixArgs = [],
    spawnImpl = spawn as unknown as SpawnLike,
    environment = process.env,
  } = options;

  return {
    start(input) {
      const args = buildOpenCodeBuilderArgs({
        prefixArgs,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        model: input.model,
        agent: input.agent,
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
        consumeEvent: normalizeOpenCodeBuilderEvent,
        consumeResult(event) {
          const part = asRecord(event.part);
          let resultText: string | null = null;
          let errorText: string | null = null;
          if (
            part?.type === "text" &&
            typeof part.text === "string" &&
            part.text.trim()
          ) {
            resultText = part.text + "\n";
          } else if (typeof event.text === "string" && event.text.trim()) {
            resultText = event.text + "\n";
          }

          const error = asRecord(event.error);
          const data = asRecord(error?.data);
          const apiError =
            optionalString(data?.message) ?? optionalString(error?.message);
          if (apiError) errorText = apiError;
          return { resultText, errorText };
        },
      });
    },
  };
}
