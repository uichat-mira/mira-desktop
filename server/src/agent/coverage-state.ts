import type {
  AgentEvidencePayload,
  AgentEvidenceSummary,
  AgentReadLocateEvidenceData,
  AgentToolExecutionResult,
  CurrentTaskFrame,
} from "./types";
import {
  extractAgentRequiredWork,
  normalizeTaskTargetPath,
  type AgentRequiredWork,
} from "./task-intent";

export type AgentTargetCoverageStatus =
  | "pending"
  | "located"
  | "opened"
  | "mutated"
  | "verified"
  | "blocked";

export interface AgentTargetCoverageEntry {
  target: string;
  requiredActions: string[];
  completedActions: string[];
  pendingActions: string[];
  status: AgentTargetCoverageStatus;
  blocker?: string;
}

export interface AgentCoverageState {
  requiredWork: AgentRequiredWork;
  targets: AgentTargetCoverageEntry[];
  requiredTargets: string[];
  coveredTargets: string[];
  pendingTargets: string[];
  pendingActions: string[];
  globalPendingActions: string[];
  blockedReason?: string;
  taskCompletable: boolean;
}

type TargetProgress = {
  located: boolean;
  opened: boolean;
  mutated: boolean;
  verified: boolean;
  terminalMutationFailure?: string;
  terminalReadFailure?: string;
  recoverableFailure?: string;
};

const WORKSPACE_MUTATION_TOOL_IDS = new Set(["workspace_mutation", "edit_file"]);
const WORKSPACE_READ_TOOL_IDS = new Set([
  "read",
  "read_list",
  "read_open",
  "read_locate",
  "read_extract",
  "read_slice",
]);

const buildReason = (input: {
  pendingActions: string[];
  pendingTargets: string[];
  blockers: string[];
}) => {
  if (input.blockers.length > 0) {
    return input.blockers.join("; ");
  }

  if (input.pendingActions.length > 0 && input.pendingTargets.length > 0) {
    return `Task is not complete yet: pendingActions=${input.pendingActions.join(", ")}; missingTargets=${input.pendingTargets.join(", ")}.`;
  }

  if (input.pendingActions.length > 0) {
    return `Task is not complete yet: pendingActions=${input.pendingActions.join(", ")}.`;
  }

  if (input.pendingTargets.length > 0) {
    return `Task is not complete yet: missingTargets=${input.pendingTargets.join(", ")}.`;
  }

  return undefined;
};

const ensureTargetProgress = (
  map: Map<string, TargetProgress>,
  target: string,
): TargetProgress => {
  const existing = map.get(target);
  if (existing) {
    return existing;
  }

  const next: TargetProgress = {
    located: false,
    opened: false,
    mutated: false,
    verified: false,
  };
  map.set(target, next);
  return next;
};

const addLocateMatchTargets = (
  map: Map<string, TargetProgress>,
  matchedPaths: AgentReadLocateEvidenceData["matchedPaths"],
) => {
  for (const path of matchedPaths) {
    const normalized = normalizeTaskTargetPath(path);
    if (!normalized) {
      continue;
    }
    ensureTargetProgress(map, normalized).located = true;
  }
};

const markCompletedSummary = (
  map: Map<string, TargetProgress>,
  summary: AgentEvidenceSummary | undefined,
) => {
  if (!summary?.data) {
    return;
  }

  switch (summary.data.kind) {
    case "read_locate":
      addLocateMatchTargets(map, summary.data.matchedPaths);
      return;
    case "read_open": {
      const target = normalizeTaskTargetPath(summary.data.path);
      if (!target) {
        return;
      }
      const progress = ensureTargetProgress(map, target);
      progress.located = true;
      progress.opened = true;
      progress.verified = true;
      return;
    }
    case "workspace_mutation": {
      if (summary.data.changed !== true || summary.data.dryRun === true) {
        return;
      }

      for (const candidate of [
        summary.data.targetPath,
        summary.data.destinationPath,
      ]) {
        if (typeof candidate !== "string") {
          continue;
        }
        const target = normalizeTaskTargetPath(candidate);
        if (!target) {
          continue;
        }
        const progress = ensureTargetProgress(map, target);
        progress.located = true;
        progress.mutated = true;
      }
      return;
    }
    case "edit_file": {
      if (summary.data.changed !== true || summary.data.dryRun === true) {
        return;
      }

      if (typeof summary.data.targetPath !== "string") {
        return;
      }
      const target = normalizeTaskTargetPath(summary.data.targetPath);
      if (!target) {
        return;
      }
      const progress = ensureTargetProgress(map, target);
      progress.located = true;
      progress.mutated = true;
      return;
    }
    default:
      return;
  }
};

const markExecutionFailure = (
  map: Map<string, TargetProgress>,
  execution: AgentToolExecutionResult,
) => {
  const targetCandidates = ["path", "targetPath", "destinationPath"]
    .map((key) => execution.args[key])
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeTaskTargetPath(value))
    .filter(Boolean);

  if (execution.failureKind === "recoverable") {
    for (const target of targetCandidates) {
      ensureTargetProgress(map, target).recoverableFailure =
        execution.errorMessage ?? `${execution.toolId} failed recoverably.`;
    }
    return;
  }

  if (execution.failureKind !== "terminal") {
    return;
  }

  for (const target of targetCandidates) {
    const progress = ensureTargetProgress(map, target);
    if (WORKSPACE_MUTATION_TOOL_IDS.has(execution.toolId)) {
      progress.terminalMutationFailure =
        execution.errorMessage ?? `${execution.toolId} failed terminally.`;
      continue;
    }

    if (WORKSPACE_READ_TOOL_IDS.has(execution.toolId)) {
      progress.terminalReadFailure =
        execution.errorMessage ?? `${execution.toolId} failed terminally.`;
    }
  }
};

const collectTargetProgress = (input: {
  evidence?: AgentEvidencePayload;
  latestSummary?: AgentEvidenceSummary;
}) => {
  const targetProgress = new Map<string, TargetProgress>();

  for (const execution of input.evidence?.toolExecutions ?? []) {
    if (execution.status === "completed") {
      markCompletedSummary(targetProgress, execution.summary);
      continue;
    }

    if (execution.status === "failed") {
      markExecutionFailure(targetProgress, execution);
    }
  }

  markCompletedSummary(targetProgress, input.latestSummary);
  return targetProgress;
};

const hasSearchEvidence = (input: {
  evidence?: AgentEvidencePayload;
  latestSummary?: AgentEvidenceSummary;
}) => {
  if ((input.evidence?.retrievals.length ?? 0) > 0) {
    return true;
  }

  const summaries = [
    ...(input.evidence?.toolExecutions.map((item) => item.summary) ?? []),
    input.latestSummary,
  ];

  return summaries.some(
    (summary) =>
      summary?.data?.kind === "web_search" &&
      (summary.status === "completed" || summary.status === "truncated"),
  );
};

const hasListEvidence = (input: {
  evidence?: AgentEvidencePayload;
  latestSummary?: AgentEvidenceSummary;
}) => {
  const summaries = [
    ...(input.evidence?.toolExecutions.map((item) => item.summary) ?? []),
    input.latestSummary,
  ];

  return summaries.some(
    (summary) =>
      summary?.data?.kind === "read_list" &&
      (summary.status === "completed" || summary.status === "truncated"),
  );
};

const hasTerminalEvidence = (input: {
  evidence?: AgentEvidencePayload;
  latestSummary?: AgentEvidenceSummary;
}) => {
  const summaries = [
    ...(input.evidence?.toolExecutions.map((item) => item.summary) ?? []),
    input.latestSummary,
  ];

  return summaries.some(
    (summary) =>
      summary?.data?.kind === "terminal_session" &&
      summary.status === "completed" &&
      summary.data.processCompleted,
  );
};

const hasRecoverableFailure = (evidence: AgentEvidencePayload | undefined) =>
  evidence?.toolExecutions.some(
    (execution) =>
      execution.status === "failed" && execution.failureKind === "recoverable",
  ) ?? false;

const getRequiredTargetActions = (
  requiredWork: AgentRequiredWork,
  hasTargets: boolean,
) => {
  const actions: string[] = [];

  if (requiredWork.requiredActions.includes("locate")) {
    actions.push("locate");
  }
  if (
    requiredWork.requiredActions.includes("read_content") &&
    !(
      requiredWork.requiredActions.includes("mutate") &&
      requiredWork.requiredActions.includes("verify")
    )
  ) {
    actions.push("read_open");
  }
  if (requiredWork.requiredActions.includes("mutate")) {
    actions.push("mutation_execution");
  }
  if (requiredWork.requiredActions.includes("verify")) {
    actions.push(
      requiredWork.requiredActions.includes("mutate")
        ? "mutation_verification"
        : "verify",
    );
  }

  if (!hasTargets) {
    return [];
  }

  return actions;
};

const getObservedCompletedTargetActions = (
  progress: TargetProgress,
) => {
  const actions: string[] = [];
  if (progress.located || progress.opened || progress.mutated || progress.verified) {
    actions.push("locate");
  }
  if (progress.opened || progress.verified) {
    actions.push("read_open");
  }
  if (progress.mutated || progress.terminalMutationFailure) {
    actions.push("mutation_execution");
  }
  if (progress.verified) {
    actions.push("mutation_verification");
  }
  return actions;
};

const isTargetActionCompleted = (action: string, progress: TargetProgress) => {
  switch (action) {
    case "locate":
      return (
        progress.located ||
        progress.opened ||
        progress.mutated ||
        progress.verified
      );
    case "read_open":
      return progress.opened || progress.verified;
    case "mutation_execution":
      return progress.mutated || Boolean(progress.terminalMutationFailure);
    case "mutation_verification":
    case "verify":
      return progress.verified;
    default:
      return false;
  }
};

const getCoverageStatus = (progress: TargetProgress): AgentTargetCoverageStatus => {
  if (progress.terminalMutationFailure || progress.terminalReadFailure) {
    return "blocked";
  }
  if (progress.verified) {
    return "verified";
  }
  if (progress.mutated) {
    return "mutated";
  }
  if (progress.opened) {
    return "opened";
  }
  if (progress.located) {
    return "located";
  }
  return "pending";
};

export const reduceAgentCoverageState = (input: {
  question?: string;
  currentTaskFrame?: CurrentTaskFrame;
  evidence?: AgentEvidencePayload;
  latestSummary?: AgentEvidenceSummary;
}): AgentCoverageState => {
  const requiredWork = extractAgentRequiredWork({
    question: input.question,
    currentTaskFrame: input.currentTaskFrame,
  });
  const progressMap = collectTargetProgress(input);
  const targetRequiredActions = getRequiredTargetActions(
    requiredWork,
    requiredWork.requiredTargets.length > 0,
  );
  const targets = requiredWork.requiredTargets.map((target) => {
    const progress = progressMap.get(target) ?? {
      located: false,
      opened: false,
      mutated: false,
      verified: false,
    };
    const completedActions = getObservedCompletedTargetActions(progress);
    const blockedByTerminalMutationFailure = Boolean(progress.terminalMutationFailure);
    const hasPresence =
      progress.located || progress.opened || progress.mutated || progress.verified;
    const pendingActions = blockedByTerminalMutationFailure
      ? []
      : targetRequiredActions.filter((action) => {
          if (isTargetActionCompleted(action, progress)) {
            return false;
          }

          if (action === "locate") {
            return false;
          }

          if (action === "read_open" && !hasPresence) {
            return false;
          }

          if (action === "mutation_verification" && !progress.mutated) {
            return false;
          }

          return true;
        });

    return {
      target,
      requiredActions: [...targetRequiredActions],
      completedActions,
      pendingActions,
      status: getCoverageStatus(progress),
      blocker: progress.terminalMutationFailure ?? progress.terminalReadFailure,
      progress,
    };
  });

  const globalPendingActions: string[] = [];
  if (
    requiredWork.requiredActions.includes("list") &&
    !hasListEvidence(input)
  ) {
    globalPendingActions.push("read_list");
  }
  if (
    requiredWork.requiredActions.includes("search") &&
    !hasSearchEvidence(input)
  ) {
    globalPendingActions.push("search_execution");
  }
  if (
    requiredWork.requiredActions.includes("terminal") &&
    !hasTerminalEvidence(input)
  ) {
    globalPendingActions.push("terminal_execution");
  }
  if (
    requiredWork.requiredActions.includes("locate") &&
    requiredWork.requiredTargets.length === 0 &&
    !hasListEvidence(input)
  ) {
    globalPendingActions.push("read_locate");
  }
  if (
    requiredWork.requiredActions.includes("read_content") &&
    requiredWork.requiredTargets.length === 0
  ) {
    globalPendingActions.push("read_open");
  }
  if (
    requiredWork.requiredActions.includes("mutate") &&
    requiredWork.requiredTargets.length === 0
  ) {
    globalPendingActions.push("mutation_execution");
  }
  if (
    requiredWork.requiredActions.includes("verify") &&
    requiredWork.requiredTargets.length === 0
  ) {
    globalPendingActions.push("mutation_verification");
  }
  if (hasRecoverableFailure(input.evidence)) {
    globalPendingActions.push("recoverable_execution");
  }

  const coveredTargets = targets
    .filter(
      (entry) =>
        entry.status === "located" ||
        entry.status === "opened" ||
        entry.status === "mutated" ||
        entry.status === "verified",
    )
    .map((entry) => entry.target);

  const pendingTargets = targets
    .filter((entry) => {
      const progress = entry.progress;
      const hasPresence =
        progress.located ||
        progress.opened ||
        progress.mutated ||
        progress.verified;
      return !hasPresence && !progress.terminalMutationFailure;
    })
    .map((entry) => entry.target);

  const pendingActions = [
    ...new Set([
      ...targets.flatMap((entry) => entry.pendingActions),
      ...globalPendingActions,
    ]),
  ];

  const unresolvedBlockers = targets
    .filter(
      (entry) =>
        entry.status === "blocked" &&
        !entry.completedActions.includes("mutation_execution"),
    )
    .map((entry) => entry.blocker)
    .filter((value): value is string => Boolean(value));

  const blockedReason = buildReason({
    pendingActions,
    pendingTargets,
    blockers: unresolvedBlockers,
  });

  return {
    requiredWork,
    targets: targets.map(({ progress: _progress, ...entry }) => entry),
    requiredTargets: requiredWork.requiredTargets,
    coveredTargets,
    pendingTargets,
    pendingActions,
    globalPendingActions,
    blockedReason,
    taskCompletable: pendingActions.length === 0 && pendingTargets.length === 0 && !blockedReason,
  };
};
