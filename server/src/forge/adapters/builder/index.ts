import {
  CODEX_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  PIAGENT_ADAPTER_ID,
} from "../../builder-contract.js";
import {
  createCodexBuilderRunner,
  parseCodexBuilderPrefixArgs,
  type CodexBuilderRunnerOptions,
} from "./codex.js";
import {
  createOpenCodeBuilderRunner,
  parseOpenCodeBuilderPrefixArgs,
  type OpenCodeBuilderRunnerOptions,
} from "./opencode.js";
import {
  createPiAgentBuilderRunner,
  parsePiAgentBuilderPrefixArgs,
  type PiAgentBuilderRunnerOptions,
} from "./piagent.js";
import type { BuilderRunner } from "./types.js";

export interface BuilderRunnerRegistryOptions {
  environment?: NodeJS.ProcessEnv;
  opencode?: OpenCodeBuilderRunnerOptions;
  piagent?: PiAgentBuilderRunnerOptions;
  codex?: CodexBuilderRunnerOptions;
}

export function createDefaultBuilderRunners(
  options: BuilderRunnerRegistryOptions = {},
): Map<string, BuilderRunner> {
  const environment = options.environment ?? process.env;

  const opencode = createOpenCodeBuilderRunner({
    bin:
      options.opencode?.bin ??
      environment.MIRA_FORGE_OPENCODE_BIN ??
      "opencode",
    prefixArgs:
      options.opencode?.prefixArgs ??
      parseOpenCodeBuilderPrefixArgs(
        environment.MIRA_FORGE_OPENCODE_PREFIX_ARGS,
      ),
    spawnImpl: options.opencode?.spawnImpl,
    environment: options.opencode?.environment ?? environment,
  });

  const piagent = createPiAgentBuilderRunner({
    bin:
      options.piagent?.bin ??
      environment.MIRA_FORGE_PIAGENT_BIN ??
      "pi",
    prefixArgs:
      options.piagent?.prefixArgs ??
      parsePiAgentBuilderPrefixArgs(
        environment.MIRA_FORGE_PIAGENT_PREFIX_ARGS,
      ),
    spawnImpl: options.piagent?.spawnImpl,
    environment: options.piagent?.environment ?? environment,
  });

  const codex = createCodexBuilderRunner({
    bin:
      options.codex?.bin ??
      environment.MIRA_FORGE_CODEX_DESKTOP_BUILDER_BIN ??
      null,
    prefixArgs:
      options.codex?.prefixArgs ??
      parseCodexBuilderPrefixArgs(
        environment.MIRA_FORGE_CODEX_BUILDER_PREFIX_ARGS,
      ),
    spawnImpl: options.codex?.spawnImpl,
    environment: options.codex?.environment ?? environment,
    resolveBin: options.codex?.resolveBin,
  });

  return new Map<string, BuilderRunner>([
    [OPENCODE_ADAPTER_ID, opencode],
    [PIAGENT_ADAPTER_ID, piagent],
    [CODEX_ADAPTER_ID, codex],
  ]);
}

export * from "./types.js";
export * from "./shared.js";
export * from "./opencode.js";
export * from "./piagent.js";
export * from "./codex.js";
