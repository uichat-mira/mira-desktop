import type {
  ForgeDispatchStatus,
  ForgeRuntimeState,
} from "../../types";

export const runtimeLabel: Record<ForgeRuntimeState, string> = {
  waiting: "Waiting",
  building: "Building",
  reviewing: "Reviewing",
  fixing: "Fixing",
  waiting_integration: "Waiting integration",
  interrupted: "Interrupted",
  stale: "Stale",
  review_passed: "Review passed",
  integrated: "Integrated",
};

export const dispatchLabel: Record<ForgeDispatchStatus, string> = {
  starting: "Starting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export const runtimeVariant = (state: ForgeRuntimeState) => {
  if (state === "review_passed" || state === "integrated") return "success" as const;
  if (state === "building" || state === "fixing") return "primary" as const;
  if (
    state === "reviewing" ||
    state === "waiting_integration" ||
    state === "stale"
  ) {
    return "warning" as const;
  }
  if (state === "interrupted") return "danger" as const;
  return "muted" as const;
};

export const dispatchVariant = (state: ForgeDispatchStatus) => {
  if (state === "completed") return "success" as const;
  if (state === "starting" || state === "running") return "primary" as const;
  if (state === "failed" || state === "interrupted") return "danger" as const;
  return "muted" as const;
};

export const repositoryVariant = (state: string) => {
  const normalized = state.trim().toUpperCase();
  if (normalized === "PASS" || normalized === "INTEGRATED") return "success" as const;
  if (normalized === "REVIEW") return "warning" as const;
  if (normalized === "DOING") return "primary" as const;
  return "muted" as const;
};

export const builderLabel = (builder: string) => {
  if (builder === "codex" || builder === "codex-desktop-local") return "Codex";
  if (builder === "piagent" || builder === "piagent-local") return "PiAgent";
  if (builder === "opencode" || builder === "opencode-local") return "OpenCode";
  return builder;
};
