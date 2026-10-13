import type { ToolDefinition } from "../mcp/core/definitions.js";

export type HarnessToolRuntimeReadinessState =
  | "ready"
  | "degraded"
  | "unavailable";

export type HarnessToolRuntimeReadiness = {
  state: HarnessToolRuntimeReadinessState;
  reason: string;
  code?: string;
};

export type HarnessToolRuntimeReadinessResolver =
  () => HarnessToolRuntimeReadiness;

const readinessResolvers = new Map<
  string,
  HarnessToolRuntimeReadinessResolver
>();

const DEFAULT_READY_READINESS: HarnessToolRuntimeReadiness = {
  state: "ready",
  reason: "Runtime prerequisites are satisfied.",
};

export const registerToolRuntimeReadiness = (
  toolId: string,
  resolver: HarnessToolRuntimeReadinessResolver,
) => {
  readinessResolvers.set(toolId, resolver);
};

export const unregisterToolRuntimeReadiness = (toolId: string) => {
  readinessResolvers.delete(toolId);
};

export const clearToolRuntimeReadiness = () => {
  readinessResolvers.clear();
};

export const resolveToolRuntimeReadiness = (
  toolId: string,
): HarnessToolRuntimeReadiness => {
  const resolver = readinessResolvers.get(toolId);
  if (!resolver) {
    return { ...DEFAULT_READY_READINESS };
  }

  try {
    const readiness = resolver();
    return {
      state: readiness.state,
      reason: readiness.reason,
      ...(readiness.code ? { code: readiness.code } : {}),
    };
  } catch {
    // Readiness is an eligibility signal, so failures resolve closed without
    // leaking configuration values or raw provider/runtime errors.
    return {
      state: "unavailable",
      reason: "Runtime readiness could not be verified.",
      code: "readiness_check_failed",
    };
  }
};

export const projectToolRuntimeReadiness = <T extends ToolDefinition>(
  definition: T,
): T & { runtimeReadiness: HarnessToolRuntimeReadiness } => ({
  ...definition,
  runtimeReadiness: resolveToolRuntimeReadiness(definition.id),
});

export const projectToolDefinitionsRuntimeReadiness = <
  T extends ToolDefinition,
>(
  definitions: T[],
): Array<T & { runtimeReadiness: HarnessToolRuntimeReadiness }> =>
  definitions.map(projectToolRuntimeReadiness);
