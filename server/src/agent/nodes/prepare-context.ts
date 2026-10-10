/**
 * 上下文准备节点：收集线程消息、可用工具、策略允许的自动工具列表和按需 Skill 语义。
 */
import { reconcileCodeGraphHarnessCapability } from "@/harness/codegraph-capability";
import {
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
} from "@/harness/capability-view";
import {
  describeCapabilityDisclosure,
  projectCapabilityToolMetadata,
  promoteCapabilitySchema,
  type CapabilityDisclosureTransition,
} from "@/harness/capability-disclosure";
import { listToolDefinitions } from "@/harness/registry";
import { reconcileWenshuOfficeHarnessCapabilities } from "@/harness/wenshu-office-capability";
import { externalExpertService } from "@/microapps/external-expert/index.js";
import { withWorkbenchMetadata } from "@/mcp/workbench-metadata.js";
import { resolveAgentTaskProvider } from "@/services/provider-proxy.service/resolution.js";
import { prepareSkillContext, type SkillContext } from "@/skills/context/index.js";
import { readSkillDirectiveFromRequestContext } from "@/skills/flow/context.js";
import type {
  SkillInterruption,
  SkillRequirement,
} from "@/skills/flow/types.js";
import { evaluateAgentToolPolicy } from "../policy";
import { emitStepNode } from "../node-runtime";
import type { AgentNodeState, EmitAgentExecutionNode } from "../node-runtime";
import { matchToolCandidatesByEmbedding } from "../intent/embedding-capability-matcher";
import type { AgentRequestedToolGroupHint } from "../types";
import { getLatestUserQuestion } from "./shared";

const EXTERNAL_EXPERT_TOOL_ID = "ask_external_expert";

const filterExternalExpertExposure = <T extends Awaited<
  ReturnType<typeof matchToolCandidatesByEmbedding>
>>(matcherResult: T, available: boolean): T => {
  if (available) return matcherResult;

  const unavailableReason =
    "ask_external_expert is unavailable until the current user creates a connection in 问策";
  return {
    ...matcherResult,
    topCandidates: matcherResult.topCandidates.filter(
      (candidate) => candidate.toolId !== EXTERNAL_EXPERT_TOOL_ID,
    ),
    toolCandidates: matcherResult.toolCandidates.filter(
      (candidate) => candidate.toolId !== EXTERNAL_EXPERT_TOOL_ID,
    ),
    eligibleToolIds: matcherResult.eligibleToolIds?.filter(
      (toolId) => toolId !== EXTERNAL_EXPERT_TOOL_ID,
    ),
    toolExposure: {
      ...matcherResult.toolExposure,
      exposedToolIds: matcherResult.toolExposure.exposedToolIds.filter(
        (toolId) => toolId !== EXTERNAL_EXPERT_TOOL_ID,
      ),
      exposedDefinitions: matcherResult.toolExposure.exposedDefinitions.filter(
        (definition) => definition.id !== EXTERNAL_EXPERT_TOOL_ID,
      ),
      reason: [...matcherResult.toolExposure.reason, unavailableReason],
    },
    exposureReasons: [...(matcherResult.exposureReasons ?? []), unavailableReason],
  };
};

const resolveRequestedToolGroupHints = (
  definitions: ReturnType<typeof listToolDefinitions>,
  requestedGroupIds: string[] | undefined,
): AgentRequestedToolGroupHint[] => {
  const requested = [
    ...new Set(
      (requestedGroupIds ?? []).map((groupId) => groupId.trim()).filter(Boolean),
    ),
  ];
  if (requested.length === 0) return [];

  const definitionsByGroup = new Map<
    string,
    ReturnType<typeof withWorkbenchMetadata>
  >();
  for (const definition of withWorkbenchMetadata(definitions)) {
    const groupId = definition.workbench?.groupId;
    if (!groupId) continue;
    const groupDefinitions = definitionsByGroup.get(groupId) ?? [];
    groupDefinitions.push(definition);
    definitionsByGroup.set(groupId, groupDefinitions);
  }

  return requested.map((groupId) => {
    const groupDefinitions = definitionsByGroup.get(groupId) ?? [];
    const workbench = groupDefinitions[0]?.workbench;
    return {
      groupId,
      groupLabel: workbench?.groupLabel ?? groupId,
      groupDescription: workbench?.groupDescription ?? "",
      toolIds: groupDefinitions.map((definition) => definition.id),
      exposedToolIds: [],
      status: groupDefinitions.length > 0 ? "unavailable" : "unknown",
    };
  });
};

const buildToolGroupBiasedQuery = (
  query: string,
  requestedToolGroups: AgentRequestedToolGroupHint[],
) => {
  const knownGroups = requestedToolGroups.filter((group) => group.toolIds.length > 0);
  if (knownGroups.length === 0) return query;

  const preference = knownGroups
    .map(
      (group) =>
        `${group.groupLabel} (${group.groupId}): ${group.groupDescription}; tools=${group.toolIds.join(", ")}`,
    )
    .join("\n");
  return `${query}\n\n用户明确选择了以下工具包作为本轮工具偏好：\n${preference}`;
};

const resolveRequestedToolGroupAvailability = (
  requestedToolGroups: AgentRequestedToolGroupHint[],
  exposedToolIds: string[],
): AgentRequestedToolGroupHint[] => {
  const exposed = new Set(exposedToolIds);
  return requestedToolGroups.map((group) => {
    const exposedGroupToolIds = group.toolIds.filter((toolId) => exposed.has(toolId));
    return {
      ...group,
      exposedToolIds: exposedGroupToolIds,
      status:
        group.status === "unknown"
          ? "unknown"
          : exposedGroupToolIds.length > 0
            ? "available"
            : "unavailable",
    };
  });
};

const toAgentToolExposureState = (
  exposedToolIds: string[],
  exposedDefinitions: Array<
    Awaited<ReturnType<typeof matchToolCandidatesByEmbedding>>["toolExposure"]["exposedDefinitions"][number]
  >,
  requestedToolGroups: AgentRequestedToolGroupHint[],
  eligibleToolIds: string[],
  schemaDisclosedToolIds: ReadonlySet<string>,
) => ({
  exposedTools: exposedToolIds,
  toolMeta: exposedDefinitions.map((definition) => ({
    toolId: definition.id,
    title: definition.title,
    description: definition.description,
    // Full schema is a disclosure stage, not an automatic property of exposure.
    // Only Tools promoted to the schema stage carry their input schema; a Tool
    // that never reached schema disclosure stays compact metadata only.
    ...(schemaDisclosedToolIds.has(definition.id)
      ? { inputSchema: definition.inputSchema }
      : {}),
    domain: definition.domain,
    source: definition.source,
    tags: definition.tags,
    capabilities: definition.capabilities,
  })),
  eligibleTools: eligibleToolIds,
  ...(requestedToolGroups.length > 0 ? { requestedToolGroups } : {}),
});

const mergeCapabilityDefinitions = (
  registryDefinitions: ReturnType<typeof listToolDefinitions>,
  exposedDefinitions: Array<
    Awaited<ReturnType<typeof matchToolCandidatesByEmbedding>>["toolExposure"]["exposedDefinitions"][number]
  >,
): ReturnType<typeof listToolDefinitions> => {
  const merged = [...registryDefinitions];
  const known = new Set(merged.map((definition) => definition.id));
  for (const definition of exposedDefinitions) {
    if (known.has(definition.id)) continue;
    merged.push(definition);
    known.add(definition.id);
  }
  return merged;
};

type SkillRuntimeProjection = {
  skillId: string;
  sessionId: string;
  phase: string;
  status: "running" | "interrupted" | "completed";
  flowCompleted: boolean;
  deliveryReady: boolean;
  interruptionReason?: SkillInterruption["reason"];
  round?: number;
  maxRounds?: number;
  requirements: SkillRequirement[];
};

type SkillAwareTaskFrame = NonNullable<AgentNodeState["currentTaskFrame"]> & {
  skillContext?: SkillContext;
  skillRuntime?: SkillRuntimeProjection;
};

const normalizeSkillRequirements = (
  requirements: SkillRequirement[] | undefined,
): SkillRequirement[] =>
  (requirements ?? [])
    .filter(
      (requirement) =>
        Boolean(requirement) &&
        typeof requirement.id === "string" &&
        typeof requirement.kind === "string" &&
        typeof requirement.description === "string" &&
        typeof requirement.requiredFor === "string",
    )
    .map((requirement) => ({
      id: requirement.id.trim(),
      kind: requirement.kind,
      description: requirement.description.trim(),
      requiredFor: requirement.requiredFor.trim(),
      ...(requirement.acceptedFormats?.length
        ? { acceptedFormats: [...requirement.acceptedFormats] }
        : {}),
      ...(requirement.alternatives?.length
        ? { alternatives: [...requirement.alternatives] }
        : {}),
    }))
    .filter(
      (requirement) =>
        requirement.id && requirement.description && requirement.requiredFor,
    );

const toSkillRuntimeProjection = (
  directive: ReturnType<typeof readSkillDirectiveFromRequestContext>,
): SkillRuntimeProjection | undefined => {
  if (!directive) return undefined;

  const structuredRequirements = normalizeSkillRequirements(
    directive.interruption?.requirements,
  );
  const legacyQuestion = directive.question?.trim();
  const requirements =
    structuredRequirements.length > 0
      ? structuredRequirements
      : directive.requiredAction === "ask_user" && legacyQuestion
        ? [
            {
              id: `${directive.skillId}:${directive.phase}:legacy-user-input`,
              kind: "user_input" as const,
              description: legacyQuestion,
              requiredFor: `${directive.skillId}:${directive.phase}`,
            },
          ]
        : [];
  const interruptionReason =
    directive.interruption?.reason ??
    (requirements.length > 0 ? "missing_requirement" : undefined);

  const status: SkillRuntimeProjection["status"] =
    directive.deliveryReady || directive.flowCompleted
      ? "completed"
      : interruptionReason || requirements.length > 0
        ? "interrupted"
        : "running";

  return {
    skillId: directive.skillId,
    sessionId: directive.sessionId,
    phase: directive.phase,
    status,
    flowCompleted: directive.flowCompleted,
    deliveryReady: directive.deliveryReady,
    ...(interruptionReason ? { interruptionReason } : {}),
    ...(directive.round !== undefined ? { round: directive.round } : {}),
    ...(directive.maxRounds !== undefined ? { maxRounds: directive.maxRounds } : {}),
    requirements,
  };
};

const withSkillRuntimeContext = (
  frame: AgentNodeState["currentTaskFrame"],
  skillContext: SkillContext | undefined,
  skillRuntime: SkillRuntimeProjection | undefined,
): AgentNodeState["currentTaskFrame"] => {
  if (!frame) return frame;
  const {
    skillContext: _previousSkillContext,
    skillRuntime: _previousSkillRuntime,
    ...baseFrame
  } = frame as SkillAwareTaskFrame;
  return {
    ...baseFrame,
    ...(skillContext ? { skillContext } : {}),
    ...(skillRuntime ? { skillRuntime } : {}),
  } as SkillAwareTaskFrame;
};

const toSkillTraceDetails = (skillContext: SkillContext | undefined) => {
  if (!skillContext?.primary) {
    return {
      status: "not_matched",
      primary: null,
      match: null,
      disclosure: {
        skillBodyLoaded: false,
        availableResourceCount: 0,
        availableResourceUris: [],
        disclosedResourceCount: 0,
        disclosedResourceUris: [],
      },
      toolExposureMutation: false,
    };
  }

  return {
    status: "matched",
    primary: {
      id: skillContext.primary.id,
      name: skillContext.primary.name,
      version: skillContext.primary.version,
    },
    match: skillContext.match
      ? {
          source: skillContext.match.source,
          reason: skillContext.match.reason,
          score: skillContext.match.score,
          secondarySkillIds: [...skillContext.match.secondarySkillIds],
        }
      : null,
    disclosure: {
      skillBodyLoaded: true,
      availableResourceCount: skillContext.resources.length,
      availableResourceUris: skillContext.resources.map((resource) => resource.uri),
      disclosedResourceCount: skillContext.disclosedResources.length,
      disclosedResourceUris: skillContext.disclosedResources.map((resource) => resource.uri),
    },
    toolExposureMutation: false,
  };
};

const summarizeSkillTrace = (skillContext: SkillContext | undefined) => {
  if (!skillContext?.primary) {
    return "未识别到匹配 Skill，本轮不注入 SkillContext";
  }

  const source = skillContext.match?.source ?? "unknown";
  const disclosedCount = skillContext.disclosedResources.length;
  if (source === "explicit") {
    return `已应用技能：${skillContext.primary.name}（${skillContext.primary.id}），披露 ${disclosedCount} 个参考资源`;
  }

  return `已识别 ${skillContext.primary.name}（${skillContext.primary.id}），${source} 匹配，披露 ${disclosedCount} 个参考资源`;
};

const resolveAgentToolModelHint = () => {
  try {
    return resolveAgentTaskProvider("default").model;
  } catch {
    return undefined;
  }
};

export const prepareContextNode = async (
  state: AgentNodeState,
  emit?: EmitAgentExecutionNode,
): Promise<Partial<AgentNodeState>> => {
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-prepare-context",
    nodeType: "reason",
    phase: "start",
    label: "准备上下文",
    summary: "正在读取线程上下文、可用工具和任务 Skill",
  });

  reconcileCodeGraphHarnessCapability();
  const wenshuCapabilityState = reconcileWenshuOfficeHarnessCapabilities();
  const externalExpertAvailable = externalExpertService.isAgentAvailable(state.userId);

  const toolDefinitions = listToolDefinitions();
  const autoAllowedTools = toolDefinitions
    .filter((definition) =>
      evaluateAgentToolPolicy(definition).type === "allow"
      && (definition.id !== EXTERNAL_EXPERT_TOOL_ID || externalExpertAvailable))
    .map((definition) => definition.id);
  const query = getLatestUserQuestion(state.messages) || state.goal.text;
  const requestedToolGroups = resolveRequestedToolGroupHints(
    toolDefinitions,
    state.requestedToolGroupIds,
  );
  const matcherResult = filterExternalExpertExposure(
    await matchToolCandidatesByEmbedding({
      query: buildToolGroupBiasedQuery(query, requestedToolGroups),
      config: state.intentConfig,
      modelHint: resolveAgentToolModelHint(),
    }),
    externalExpertAvailable,
  );
  const requestedToolGroupsWithAvailability = resolveRequestedToolGroupAvailability(
    requestedToolGroups,
    matcherResult.toolExposure.exposedToolIds,
  );
  const skillDirective = readSkillDirectiveFromRequestContext(
    state.requestContextMessages,
  );

  // SkillContext is semantic guidance only. It never registers tools and never
  // expands the canonical Planner-visible toolExposure produced by Harness.
  // A stateful flow contributes only a bounded runtime projection; Planner keeps
  // ownership of ask_user, tool choice, global completion and final answer.
  const skillContext = await prepareSkillContext({
    query: skillDirective ? `$${skillDirective.skillId} ${query}` : query,
    messages: state.messages,
  });
  const skillRuntime = toSkillRuntimeProjection(skillDirective);
  const currentTaskFrame = withSkillRuntimeContext(
    state.currentTaskFrame,
    skillContext,
    skillRuntime,
  );

  const eligibleToolIds =
    matcherResult.eligibleToolIds ?? matcherResult.toolExposure.exposedToolIds;

  // The Main Agent consumes the same Capability View disclosure semantics as a
  // delegated Child. Its scope makes the whole authority+readiness envelope
  // discoverable at the compact-metadata stage; full schemas are then
  // materialized only for the Tools Harness selected into this turn's exposure.
  // Metadata disclosure changes model context only and never grants authority:
  // every invocation still flows through Normalize / Policy / Approval / Harness.
  const capabilityDefinitions = mergeCapabilityDefinitions(
    toolDefinitions,
    matcherResult.toolExposure.exposedDefinitions,
  );
  const initialMainAgentCapabilityView = projectAgentCapabilityView({
    scope: createMainAgentCapabilityScope({
      scopeId: "main_agent",
      eligibleCapabilityIds: [...eligibleToolIds],
      discoverableCapabilityIds: [...eligibleToolIds],
    }),
    definitions: capabilityDefinitions,
  });

  const capabilityDisclosureTransitions: CapabilityDisclosureTransition[] = [];
  let mainAgentCapabilityView = initialMainAgentCapabilityView;
  for (const toolId of matcherResult.toolExposure.exposedToolIds) {
    const promoted = promoteCapabilitySchema({
      view: mainAgentCapabilityView,
      capabilityId: toolId,
      definitions: capabilityDefinitions,
    });
    mainAgentCapabilityView = promoted.view;
    capabilityDisclosureTransitions.push(promoted.transition);
  }

  const schemaDisclosedToolIds = new Set(
    [...mainAgentCapabilityView.capabilities.values()]
      .filter((entry) => entry.discoverable && entry.disclosure === "schema")
      .map((entry) => entry.capabilityId),
  );
  const capabilityDisclosureTrace = describeCapabilityDisclosure(
    mainAgentCapabilityView,
  );
  const compactCapabilityMetadata = projectCapabilityToolMetadata(
    mainAgentCapabilityView,
    capabilityDefinitions,
  );

  const toolExposure = toAgentToolExposureState(
    [...matcherResult.toolExposure.exposedToolIds],
    [...matcherResult.toolExposure.exposedDefinitions],
    requestedToolGroupsWithAvailability,
    [...eligibleToolIds],
    schemaDisclosedToolIds,
  );
  const toolIntent = matcherResult;

  // Skill matching/disclosure is a first-class observable event. Do not force
  // operators to infer Skill activation from model behavior or buried fields.
  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-skill-context",
    nodeType: "reason",
    phase: "done",
    label: skillContext?.match?.source === "explicit" ? "应用技能" : "技能上下文",
    summary: summarizeSkillTrace(skillContext),
    details: {
      query,
      activeSkillFlow: skillRuntime
        ? {
            skillId: skillRuntime.skillId,
            phase: skillRuntime.phase,
            status: skillRuntime.status,
            flowCompleted: skillRuntime.flowCompleted,
            deliveryReady: skillRuntime.deliveryReady,
            interruptionReason: skillRuntime.interruptionReason ?? null,
            requirementCount: skillRuntime.requirements.length,
            round: skillRuntime.round ?? null,
            maxRounds: skillRuntime.maxRounds ?? null,
          }
        : null,
      skillContext: toSkillTraceDetails(skillContext),
    },
  });

  if (requestedToolGroupsWithAvailability.length > 0) {
    const availableGroups = requestedToolGroupsWithAvailability.filter(
      (group) => group.status === "available",
    );
    const unavailableGroups = requestedToolGroupsWithAvailability.filter(
      (group) => group.status !== "available",
    );
    await emitStepNode(emit, {
      runId: state.runId,
      nodeId: "agent-toolkit-context",
      nodeType: "reason",
      phase: "done",
      label: availableGroups.length > 0 ? "应用工具包" : "工具包不可用",
      summary:
        availableGroups.length > 0
          ? `已将 ${availableGroups.map((group) => group.groupLabel).join("、")} 作为本轮工具偏好`
          : "所选工具包当前没有可供 Planner 调用的工具",
      details: {
        requestedToolGroups: requestedToolGroupsWithAvailability,
        availableGroupIds: availableGroups.map((group) => group.groupId),
        unavailableGroupIds: unavailableGroups.map((group) => group.groupId),
        selectionMode: "planner_preference",
        changesToolExposure: false,
      },
    });
  }

  await emitStepNode(emit, {
    runId: state.runId,
    nodeId: "agent-prepare-context",
    nodeType: "reason",
    phase: "done",
    label: "准备上下文",
    summary: "已完成 Agent 上下文准备",
    details: {
      messageCount: state.messages.length,
      requestContextCount: state.requestContextMessages?.length ?? 0,
      autoAllowedTools,
      exposedToolCount: toolExposure.exposedTools.length,
      exposedToolIds: toolExposure.exposedTools,
      eligibleToolCount: toolExposure.eligibleTools?.length ?? 0,
      eligibleToolIds: toolExposure.eligibleTools ?? [],
      requestedToolGroups: requestedToolGroupsWithAvailability,
      activeSkillId: skillContext?.primary?.id ?? null,
      activeSkillVersion: skillContext?.primary?.version ?? null,
      activeSkillFlowPhase: skillRuntime?.phase ?? null,
      activeSkillFlowStatus: skillRuntime?.status ?? null,
      activeSkillFlowCompleted: skillRuntime?.flowCompleted ?? null,
      activeSkillDeliveryReady: skillRuntime?.deliveryReady ?? null,
      activeSkillInterruptionReason: skillRuntime?.interruptionReason ?? null,
      activeSkillRequirementCount: skillRuntime?.requirements.length ?? 0,
      skillMatchSource: skillContext?.match?.source ?? null,
      skillResourceCount: skillContext?.resources.length ?? 0,
      disclosedSkillResourceCount: skillContext?.disclosedResources.length ?? 0,
      skillToolExposureMutation: false,
      wenshuRuntimePackAvailable: wenshuCapabilityState.runtimePackAvailable,
      wenshuRegisteredCapabilityIds: wenshuCapabilityState.registeredCapabilityIds,
      codebaseExploreExposed: toolExposure.exposedTools.includes("codebase_explore"),
      externalExpertAvailable,
      capabilityMetadataToolIds: compactCapabilityMetadata.map(
        (tool) => tool.capabilityId,
      ),
      capabilityMetadataDisclosedCount:
        capabilityDisclosureTrace.metadataDisclosedCount,
      capabilitySchemaDisclosedCount:
        capabilityDisclosureTrace.schemaDisclosedCount,
      capabilityDisclosureTrace,
      capabilityDisclosureTransitions,
      schemaMaterializedToolIds: [...schemaDisclosedToolIds],
      currentTaskFrameWriter:
        "prepareContextNode attaches SkillContext and a bounded Skill runtime projection; Planner remains the sole writer of goal/subtask/completion inference",
    },
  });

  return {
    toolIntent,
    toolExposure,
    currentTaskFrame,
  };
};
