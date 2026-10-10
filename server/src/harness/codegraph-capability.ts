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

const resolveCodeGraphGate = (
  service: NonNullable<ReturnType<typeof getActiveCodeGraphStudioService>>,
) => {
  const draft = service.getDraft();
  const gate = normalizeDeclaredRepoLocalCapabilityGate(
    service.getCapabilityGate(),
    {
      command: draft.command,
      capabilityRegistered: true,
    },
  );
  return { draft, gate };
};

const isCodeGraphRuntimeAvailable = (input: {
  draft: ReturnType<
    NonNullable<ReturnType<typeof getActiveCodeGraphStudioService>>["getDraft"]
  >;
  gate: ReturnType<typeof normalizeDeclaredRepoLocalCapabilityGate>;
}) => {
  const lazyManagedWorkspaceAvailable =
    input.draft.microAppEnabled &&
    isRealCodeGraphCommand(input.draft.command) &&
    input.gate.checks.appDataRootValid;
  return input.gate.available || lazyManagedWorkspaceAvailable;
};

/**
 * Pure readiness probe for the CodeGraph-backed `codebase_explore` capability.
 *
 * Unlike `reconcileCodeGraphHarnessCapability`, this does not mutate runtime
 * state or register tools. Exposure/readiness resolution needs to know whether
 * the current machine can actually run the capability without triggering a
 * dispose side effect on every turn.
 */
export const resolveCodeGraphHarnessAvailability = (): {
  available: boolean;
  reason?: string;
} => {
  const service = getActiveCodeGraphStudioService();
  if (!service) {
    return {
      available: false,
      reason: "CodeGraph microapp configuration is unavailable.",
    };
  }

  const { draft, gate } = resolveCodeGraphGate(service);
  if (isCodeGraphRuntimeAvailable({ draft, gate })) {
    return { available: true };
  }

  const reason =
    gate.reasons[0]?.message ??
    (!draft.microAppEnabled ? "CodeGraph microapp is disabled." : undefined);
  return { available: false, ...(reason ? { reason } : {}) };
};

export const reconcileCodeGraphHarnessCapability = () => {
  // Keep the public read contract stable: codebase_explore stays registered so
  // Tool Lab / diagnostics retain the contract. Agent visibility is gated
  // separately by native capability readiness; a runtime that degrades after
  // exposure still reports its controlled fallback signal from the tool result.
  if (!getToolImplementation("codebase_explore")) {
    registerTool(codebaseExploreTool);
  }

  const service = getActiveCodeGraphStudioService();

  if (!service) {
    disposeRepoLocalRuntime();
    lastRuntimeConfigFingerprint = null;
    return false;
  }

  const { draft, gate } = resolveCodeGraphGate(service);
  const runtimeConfigFingerprint = getRuntimeConfigFingerprint(draft);
  if (
    lastRuntimeConfigFingerprint &&
    lastRuntimeConfigFingerprint !== runtimeConfigFingerprint
  ) {
    disposeRepoLocalRuntime();
  }
  lastRuntimeConfigFingerprint = runtimeConfigFingerprint;

  if (isCodeGraphRuntimeAvailable({ draft, gate })) {
    return true;
  }

  disposeRepoLocalRuntime();
  return false;
};
