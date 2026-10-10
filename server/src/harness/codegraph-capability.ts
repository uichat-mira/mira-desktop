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
  getToolImplementation,
  registerTool,
} from "./registry.js";
import {
  registerToolRuntimeReadiness,
  type HarnessToolRuntimeReadiness,
} from "./runtime-readiness.js";

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

export const resolveCodeGraphHarnessRuntimeReadiness =
  (): HarnessToolRuntimeReadiness => {
    const service = getActiveCodeGraphStudioService();

    if (!service) {
      return {
        state: "unavailable",
        reason: "Code intelligence runtime is not configured.",
        code: "codegraph_runtime_unavailable",
      };
    }

    const draft = service.getDraft();
    const gate = normalizeDeclaredRepoLocalCapabilityGate(
      service.getCapabilityGate(),
      {
        command: draft.command,
        capabilityRegistered: true,
      },
    );

    if (gate.available) {
      return {
        state: "ready",
        reason: "Code intelligence runtime is ready for Agent use.",
      };
    }

    return {
      state: "unavailable",
      reason:
        gate.reasons[0]?.message ??
        "Code intelligence runtime is not ready for Agent use.",
      code: gate.reasons[0]?.code ?? "codegraph_runtime_unavailable",
    };
  };

export const reconcileCodeGraphHarnessCapability = () => {
  // Registration remains stable for diagnostics and Tool Lab. Runtime readiness
  // independently controls whether the Agent may see this capability.
  registerToolRuntimeReadiness(
    "codebase_explore",
    resolveCodeGraphHarnessRuntimeReadiness,
  );
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

  const readiness = resolveCodeGraphHarnessRuntimeReadiness();
  if (readiness.state !== "unavailable") {
    return true;
  }

  disposeRepoLocalRuntime();
  return false;
};
