import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { codexDesktopBinaryCandidates } from "../main-thread/codex-desktop.js";
import type { BuilderProviderEvent, BuilderRunner } from "./types.js";
import {
  asRecord,
  optionalString,
  parsePrefixArgs,
  requiredString,
  runBuilderJsonProcess,
  type SpawnLike,
} from "./shared.js";

export function parseCodexBuilderPrefixArgs(value: unknown): string[] {
  return parsePrefixArgs(
    value,
    "MIRA_FORGE_CODEX_BUILDER_PREFIX_ARGS",
  );
}

export function resolveCodexBuilderBinary(
  options: {
    bin?: string | null;
    accessImpl?: typeof accessSync;
    home?: string;
    platform?: NodeJS.Platform;
  } = {},
): string {
  const {
    bin = null,
    accessImpl = accessSync,
    home = homedir(),
    platform = process.platform,
  } = options;

  const explicit = optionalString(bin);
  if (explicit) {
    try {
      accessImpl(explicit, constants.X_OK);
      return explicit;
    } catch {
      throw new Error(
        "Codex Builder backend is not executable: " + explicit,
      );
    }
  }

  if (platform !== "darwin") {
    throw new Error(
      "Codex Desktop Builder auto-discovery currently supports macOS " +
        "app bundles only; set MIRA_FORGE_CODEX_DESKTOP_BUILDER_BIN " +
        "explicitly",
    );
  }

  for (const candidate of codexDesktopBinaryCandidates(home)) {
    try {
      accessImpl(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue current/legacy bundle discovery.
    }
  }

  throw new Error(
    "Codex Desktop Builder backend was not found. Expected ChatGPT.app " +
      "or Codex.app in /Applications (or ~/Applications); set " +
      "MIRA_FORGE_CODEX_DESKTOP_BUILDER_BIN to override",
  );
}

export function buildCodexBuilderArgs(input: {
  prefixArgs?: string[];
  projectRoot?: unknown;
  prompt?: unknown;
  model?: unknown;
}): string[] {
  const projectRoot = requiredString(input.projectRoot, "projectRoot");
  const prompt = requiredString(input.prompt, "prompt");
  const args = [
    ...(input.prefixArgs ?? []),
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--cd",
    projectRoot,
  ];
  const model = optionalString(input.model);
  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

export function normalizeCodexBuilderEvent(
  event: Record<string, unknown>,
): BuilderProviderEvent | null {
  const type = optionalString(event.type);
  if (!type) return null;

  if (type === "thread.started" && optionalString(event.thread_id)) {
    return {
      externalSessionId: optionalString(event.thread_id),
      provider: {
        adapter: "codex",
        eventType: type,
        status: "running",
      },
    };
  }

  const item = asRecord(event.item);
  const itemType = optionalString(item?.type);
  if (
    (type === "item.started" || type === "item.completed") &&
    itemType
  ) {
    const status =
      optionalString(item?.status) ??
      (type === "item.completed" ? "completed" : "running");

    if (
      ["command_execution", "mcp_tool_call", "web_search"].includes(
        itemType,
      )
    ) {
      return {
        tool: {
          name: itemType,
          status,
        },
        provider: {
          adapter: "codex",
          eventType: type,
          itemType,
          status,
        },
      };
    }

    if (itemType === "file_change") {
      return {
        artifact: {
          kind: "provider-file-change",
          ref: null,
        },
        provider: {
          adapter: "codex",
          eventType: type,
          itemType,
          status,
        },
      };
    }

    return {
      provider: {
        adapter: "codex",
        eventType: type,
        itemType,
        status,
      },
    };
  }

  return {
    provider: {
      adapter: "codex",
      eventType: type,
      status: null,
    },
  };
}

export interface CodexBuilderRunnerOptions {
  bin?: string | null;
  prefixArgs?: string[];
  spawnImpl?: SpawnLike;
  environment?: NodeJS.ProcessEnv;
  resolveBin?: typeof resolveCodexBuilderBinary;
}

export function createCodexBuilderRunner(
  options: CodexBuilderRunnerOptions = {},
): BuilderRunner {
  const {
    bin = null,
    prefixArgs = [],
    spawnImpl = spawn as unknown as SpawnLike,
    environment = process.env,
    resolveBin = resolveCodexBuilderBinary,
  } = options;

  return {
    start(input) {
      const resolvedBin = resolveBin({ bin });
      const args = buildCodexBuilderArgs({
        prefixArgs,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        model: input.model,
      });
      const child = spawnImpl(resolvedBin, args, {
        cwd: input.projectRoot,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      return runBuilderJsonProcess({
        child,
        callbacks: input,
        consumeEvent: normalizeCodexBuilderEvent,
        consumeResult(event) {
          const item = asRecord(event.item);
          let resultText: string | null = null;
          let errorText: string | null = null;

          if (
            event.type === "item.completed" &&
            item?.type === "agent_message" &&
            typeof item.text === "string" &&
            item.text.trim()
          ) {
            resultText = item.text.trim() + "\n";
          }

          if (event.type === "turn.failed") {
            const error = asRecord(event.error);
            errorText =
              optionalString(error?.message) ??
              optionalString(event.message);
          }

          return { resultText, errorText };
        },
      });
    },
  };
}
