import {
  createCodexDesktopMainThreadAdapter,
  type CodexDesktopMainThreadAdapterOptions,
} from "./codex-desktop.js";
import {
  createCodexMainThreadAdapter,
  createOpenCodeMainThreadAdapter,
  parseMainThreadPrefixArgs,
  type ProcessMainThreadAdapterOptions,
} from "./process-adapters.js";
import type { MainThreadAdapter } from "./types.js";

export interface MainThreadAdapterRegistryOptions {
  opencode?: ProcessMainThreadAdapterOptions;
  codex?: ProcessMainThreadAdapterOptions;
  codexDesktop?: CodexDesktopMainThreadAdapterOptions;
  environment?: NodeJS.ProcessEnv;
}

export function createDefaultMainThreadAdapters(
  options: MainThreadAdapterRegistryOptions = {},
): Map<string, MainThreadAdapter> {
  const environment = options.environment ?? process.env;

  const opencode = createOpenCodeMainThreadAdapter({
    bin:
      options.opencode?.bin ??
      environment.MIRA_FORGE_OPENCODE_BIN ??
      "opencode",
    prefixArgs:
      options.opencode?.prefixArgs ??
      parseMainThreadPrefixArgs(
        environment.MIRA_FORGE_OPENCODE_PREFIX_ARGS,
        "MIRA_FORGE_OPENCODE_PREFIX_ARGS",
      ),
    spawnImpl: options.opencode?.spawnImpl,
    environment: options.opencode?.environment ?? environment,
    timeoutMs: options.opencode?.timeoutMs ?? 3_000_000,
  });

  const codex = createCodexMainThreadAdapter({
    bin:
      options.codex?.bin ??
      environment.MIRA_FORGE_CODEX_BIN ??
      "codex",
    prefixArgs:
      options.codex?.prefixArgs ??
      parseMainThreadPrefixArgs(
        environment.MIRA_FORGE_CODEX_PREFIX_ARGS,
        "MIRA_FORGE_CODEX_PREFIX_ARGS",
      ),
    spawnImpl: options.codex?.spawnImpl,
    environment: options.codex?.environment ?? environment,
    timeoutMs: options.codex?.timeoutMs ?? 3_000_000,
  });

  const codexDesktop = createCodexDesktopMainThreadAdapter({
    bin:
      options.codexDesktop?.bin ??
      environment.MIRA_FORGE_CODEX_DESKTOP_BIN ??
      null,
    prefixArgs: options.codexDesktop?.prefixArgs ?? [],
    spawnImpl: options.codexDesktop?.spawnImpl,
    environment: options.codexDesktop?.environment ?? environment,
    timeoutMs: options.codexDesktop?.timeoutMs ?? 3_000_000,
    resolveBin: options.codexDesktop?.resolveBin,
  });

  return new Map<string, MainThreadAdapter>([
    [opencode.id, opencode],
    [codexDesktop.id, codexDesktop],
    [codex.id, codex],
  ]);
}

export * from "./types.js";
export * from "./process-adapters.js";
export * from "./codex-desktop.js";
