import {
  createGenericChildCapabilityScope,
  describeAgentCapabilityView,
  projectAgentCapabilityView,
  type AgentCapabilityViewTrace,
} from "@/harness/capability-view.js";
import {
  describeCapabilityDisclosure,
  projectCapabilityToolMetadata,
  type CapabilityDisclosureTrace,
  type CapabilityToolMetadata,
} from "@/harness/capability-disclosure.js";
import { listToolDefinitions } from "@/harness/registry.js";
import type { SkillContext } from "@/skills/context/types.js";
import type {
  AgentToolCallRequest,
  AgentToolExposureState,
} from "../types.js";

export const GENERIC_TASK_DELEGATE_TOOL_ID = "delegate_task";
export const GENERIC_TASK_SUBAGENT_SKILL_ID = "mira.generic-task";
export const GENERIC_TASK_SUBAGENT_VERSION = "1";

export type GenericTaskSpec = {
  goal: string;
  acceptanceCriteria: string[];
};

export type GenericTaskSpecParseResult =
  | { ok: true; task: GenericTaskSpec }
  | { ok: false; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const uniqueNonEmptyStrings = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) return null;
    const normalized = item.trim();
    if (!items.includes(normalized)) items.push(normalized);
  }
  return items;
};

/**
 * Parse the runtime protocol object by shape only. This deliberately contains
 * no keyword routing or natural-language classification.
 */
export const parseGenericTaskDelegationArgs = (
  value: unknown,
): GenericTaskSpecParseResult => {
  if (!isPlainObject(value)) {
    return { ok: false, error: "delegate_task args must be a JSON object." };
  }

  const nestedTask = isPlainObject(value.task) ? value.task : undefined;
  const payload = nestedTask ?? value;
  const goal = typeof payload.goal === "string" ? payload.goal.trim() : "";
  if (!goal) {
    return {
      ok: false,
      error: "delegate_task requires a non-empty string goal.",
    };
  }

  const acceptanceCriteria = uniqueNonEmptyStrings(payload.acceptanceCriteria);
  if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
    return {
      ok: false,
      error:
        "delegate_task requires a non-empty acceptanceCriteria string array.",
    };
  }
  if (acceptanceCriteria.length > 8) {
    return {
      ok: false,
      error: "delegate_task accepts at most 8 acceptance criteria.",
    };
  }

  return {
    ok: true,
    task: {
      goal,
      acceptanceCriteria,
    },
  };
};

const DELEGATE_TASK_TOOL_META: AgentToolExposureState["toolMeta"][number] = {
  toolId: GENERIC_TASK_DELEGATE_TOOL_ID,
  title: "Delegate Task",
  description:
    "Delegate one bounded, independently verifiable task to an isolated subAgent that may plan and use the currently governed tools until it completes, needs input, or fails. Prefer this for a coherent multi-step work package; use a normal tool directly for a simple one-shot action.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["goal", "acceptanceCriteria"],
    properties: {
      goal: {
        type: "string",
        minLength: 1,
        description: "The complete task-local goal delegated to the subAgent.",
      },
      acceptanceCriteria: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string", minLength: 1 },
        description:
          "Observable conditions the subAgent must cover before returning completed.",
      },
    },
  },
  domain: "agent_runtime",
  source: "internal",
  tags: ["subagent", "delegation", "runtime-protocol"],
};

/**
 * Planner-only protocol surface. A new exposure object is returned rather than
 * mutating Harness state. Child construction and resume explicitly remove the
 * protocol tool, so recursive delegation stays impossible in V1.
 */
export const withGenericTaskDelegationTool = (
  exposure: AgentToolExposureState,
): AgentToolExposureState => {
  if (exposure.exposedTools.includes(GENERIC_TASK_DELEGATE_TOOL_ID)) {
    return exposure;
  }
  return {
    ...exposure,
    exposedTools: [GENERIC_TASK_DELEGATE_TOOL_ID, ...exposure.exposedTools],
    toolMeta: [DELEGATE_TASK_TOOL_META, ...exposure.toolMeta],
  };
};

export const isGenericTaskSubAgentSkillId = (skillId: string) =>
  skillId === GENERIC_TASK_SUBAGENT_SKILL_ID;

const readFrozenGenericTaskToolIds = (
  pendingToolCall: AgentToolCallRequest | undefined,
): string[] => {
  const call = isPlainObject(pendingToolCall) ? pendingToolCall : undefined;
  if (call?.origin !== "skill_agent") return [];
  if (call.skillId !== GENERIC_TASK_SUBAGENT_SKILL_ID) return [];

  const checkpoint = isPlainObject(call.skillAgentCheckpoint)
    ? call.skillAgentCheckpoint
    : undefined;
  const snapshot = isPlainObject(checkpoint?.skillContextSnapshot)
    ? checkpoint.skillContextSnapshot
    : undefined;
  const primary = isPlainObject(snapshot?.primary) ? snapshot.primary : undefined;
  const execution = isPlainObject(primary?.execution)
    ? primary.execution
    : undefined;
  return (
    uniqueNonEmptyStrings(execution?.allowedTools) ?? []
  ).filter((toolId) => toolId !== GENERIC_TASK_DELEGATE_TOOL_ID);
};

/**
 * Approval is a resume of one frozen task, not a fresh capability-selection
 * turn. Rehydrate the child-visible ids from the checkpoint so a matcher result
 * for an approval message cannot accidentally remove the exact pending tool.
 * Harness registry lookup still happens when bindings are built, so a tool
 * that was actually revoked or unregistered remains unavailable.
 */
export const createGenericTaskResumeExposure = (input: {
  currentExposure?: AgentToolExposureState;
  pendingToolCall?: AgentToolCallRequest;
}): AgentToolExposureState => {
  const current = input.currentExposure ?? { exposedTools: [], toolMeta: [] };
  const currentHarnessToolIds = current.exposedTools.filter(
    (toolId) => toolId !== GENERIC_TASK_DELEGATE_TOOL_ID,
  );
  const frozenToolIds = readFrozenGenericTaskToolIds(input.pendingToolCall);
  return {
    ...current,
    exposedTools: [...new Set([...currentHarnessToolIds, ...frozenToolIds])],
    toolMeta: current.toolMeta.filter(
      (tool) => tool.toolId !== GENERIC_TASK_DELEGATE_TOOL_ID,
    ),
  };
};

export interface GenericChildCapabilityResolution {
  /** Parent's current disclosed/visible Tool IDs. Context only, not a ceiling. */
  parentVisibleToolIds: string[];
  /** Parent authority+readiness envelope the Child ceiling is derived from. */
  delegatedAuthorityToolIds: string[];
  /** Child task-local discoverable set derived from the scoped Capability View. */
  discoverableToolIds: string[];
  /** Child execution allowlist: discoverable set minus the delegation protocol. */
  allowedTools: string[];
  /**
   * Compact Tool metadata projection (no full schemas) for the Child's
   * discoverable set. This is the metadata disclosure stage the Child starts
   * from; full schemas are materialized per exact known Tool at execution time.
   */
  compactMetadata: CapabilityToolMetadata[];
  /** Per-capability disclosure trace distinguishing metadata from schema. */
  disclosureTrace: CapabilityDisclosureTrace;
  trace: AgentCapabilityViewTrace;
}

/**
 * Build the Generic Child scoped Capability View from the Parent authority +
 * readiness envelope instead of the Parent's current visible/disclosed Tool
 * snapshot. A Tool the Parent's ranked disclosure omitted can still be
 * discoverable to the Child when it is inside the delegated envelope and
 * runtime-ready; a Tool outside the envelope stays unavailable even when it is
 * globally registered and ready. The Parent visible set is retained as trace
 * context only.
 *
 * This is a visibility projection: it never grants authority, never registers a
 * Tool, and never makes an unavailable Tool ready. Harness Policy / Approval
 * still governs every Child invocation.
 */
export const resolveGenericChildCapabilityView = (input: {
  parentVisibleToolIds?: readonly string[];
  delegatedAuthorityToolIds: readonly string[];
}): GenericChildCapabilityResolution => {
  const parentVisibleToolIds = [...(input.parentVisibleToolIds ?? [])];
  const delegatedAuthorityToolIds = [
    ...new Set(input.delegatedAuthorityToolIds),
  ].filter(Boolean);

  const definitions = listToolDefinitions();
  const view = projectAgentCapabilityView({
    scope: createGenericChildCapabilityScope({
      scopeId: GENERIC_TASK_SUBAGENT_SKILL_ID,
      eligibleCapabilityIds: delegatedAuthorityToolIds,
    }),
    definitions,
  });

  const discoverableToolIds = [...view.capabilities.values()]
    .filter((entry) => entry.discoverable)
    .map((entry) => entry.capabilityId)
    .filter((toolId) => toolId !== GENERIC_TASK_DELEGATE_TOOL_ID);

  return {
    parentVisibleToolIds,
    delegatedAuthorityToolIds,
    discoverableToolIds,
    allowedTools: discoverableToolIds,
    compactMetadata: projectCapabilityToolMetadata(view, definitions),
    disclosureTrace: describeCapabilityDisclosure(view),
    trace: describeAgentCapabilityView(view),
  };
};

export const createGenericTaskSkillContext = (input: {
  task: GenericTaskSpec;
  parentVisibleToolIds?: readonly string[];
  delegatedAuthorityToolIds: readonly string[];
  /** Optional precomputed resolution so callers can reuse it for trace. */
  capabilityResolution?: GenericChildCapabilityResolution;
}): SkillContext => {
  const resolution =
    input.capabilityResolution ??
    resolveGenericChildCapabilityView({
      parentVisibleToolIds: input.parentVisibleToolIds,
      delegatedAuthorityToolIds: input.delegatedAuthorityToolIds,
    });
  const allowedTools = resolution.allowedTools;
  const taskPacket = JSON.stringify(input.task, null, 2);

  return {
    instruction:
      "Execute one bounded task in an isolated subAgent and return structured evidence to the Main Planner.",
    primary: {
      id: GENERIC_TASK_SUBAGENT_SKILL_ID,
      version: GENERIC_TASK_SUBAGENT_VERSION,
      name: "Generic Task Executor",
      origin: "built-in",
      body: [
        "Own exactly the delegated task below.",
        "Plan locally, use only the exposed tools, inspect results, repair recoverable failures, and stop only at a structured terminal status.",
        "Do not broaden the goal, do not delegate to another agent, and do not claim completed unless the acceptance criteria are covered by evidence or artifacts.",
        "Return completed only for this task package; the Main Planner alone decides whether the user's global goal is finished.",
        `<delegated-task>\n${taskPacket}\n</delegated-task>`,
      ].join("\n"),
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools,
        runtimeBindings: [],
        workspaceBound: false,
      },
    },
    resources: [],
    disclosedResources: [],
    match: {
      source: "explicit",
      reason: "Main Planner selected the runtime delegate_task protocol.",
      score: 1,
      secondarySkillIds: [],
    },
  };
};
