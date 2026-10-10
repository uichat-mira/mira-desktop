import {
  getActiveCodeGraphStudioService,
} from "@/microapps/codegraph/index.js";
import {
  normalizeDeclaredRepoLocalCapabilityGate,
} from "@/microapps/codegraph/public-report.js";
import { codebaseExploreTool } from "@/mcp/managed-codegraph/codebase-explore.tool.js";
import {
  disposeRepoLocalManagedCodeGraphManagers,
} from "@/mcp/managed-codegraph/repo-local-manager-cache.js";
import {
  isRealCodeGraphCommand,
} from "@/mcp/managed-codegraph/repo-local-process-manager.js";
import {
  getToolImplementation,
  registerTool,
} from "./registry.js";

let lastRuntimeConfigFingerprint: string | null = null;

const disposeRepoLocalRuntime = () => {
  void disposeRepoLocalManagedCodeGraphManagers();
};

const getRuntimeConfigFingerprint = (
  draft: ReturnType<
    NonNullable<ReturnType<typeof getActiveCodeGraphStudioService>>["getDraft"]
  >,
) =>
  JSON.stringify({
    command: draft.command,
    startArgs: draft.startArgs,
    versionProbeArgs: draft.versionProbeArgs,
    telemetryProbeArgs: draft.telemetryProbeArgs,
    appDataRoot: draft.appDataRoot,
    timeoutMs: draft.timeoutMs,
  });

export const reconcileCodeGraphHarnessCapability = () => {
  // Keep the public read contract stable: codebase_explore is always registered.
  // Runtime/provider availability is reported by the tool result itself and can
  // degrade to its controlled fallback signal without changing the tool surface.
  if (!getToolImplementation("codebase_explore")) {
    registerTool(codebaseExploreTool);
  }

  const service = getActiveCodeGraphStudioService();

  if (!service) {
    disposeRepoLocalRuntime();
    lastRuntimeConfigFingerprint = null;
    return false;
  }

  const draft = service.getDraft();
  const runtimeConfigFingerprint = getRuntimeConfigFingerprint(draft);
  if (
    lastRuntimeConfigFingerprint &&
    lastRuntimeConfigFingerprint !== runtimeConfigFingerprint
  ) {
    disposeRepoLocalRuntime();
  }
  lastRuntimeConfigFingerprint = runtimeConfigFingerprint;

  const gate = normalizeDeclaredRepoLocalCapabilityGate(
    service.getCapabilityGate(),
    {
      command: draft.command,
      capabilityRegistered: true,
    },
  );
  const lazyManagedWorkspaceAvailable =
    draft.microAppEnabled &&
    isRealCodeGraphCommand(draft.command) &&
    gate.checks.appDataRootValid;
  const available = gate.available || lazyManagedWorkspaceAvailable;

  if (available) {
    return true;
  }

  disposeRepoLocalRuntime();
  return false;
};
