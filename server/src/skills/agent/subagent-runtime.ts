import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureParentDir,
  getWorkspaceSelection,
  resolveWorkspaceWritePath,
  runWithWorkspaceRootOverride,
} from "@/mcp/workspace.js";
import { loadSkillResource } from "@/skills/context/provider.js";
import type {
  SkillContext,
  SkillPackageOrigin,
} from "@/skills/context/types.js";
import { runPiSkillAgent } from "./pi-core.js";
import { resolveSubAgentExecutionProfile } from "./profiles.js";
import {
  createHarnessSkillAgentToolBinding,
  createPrivateWenShuRuntimeToolBinding,
} from "./tool-adapters.js";
import type {
  SubAgentApprovedInvocation,
  SubAgentCheckpoint,
  SubAgentExecutionInput,
  SubAgentExecutionResult,
  SubAgentRequirement,
  SubAgentRuntimeEvent,
  SubAgentToolBinding,
  SubAgentTraceEvent,
  SubAgentWorkingState,
} from "./types.js";

type SkillResourceRequestResolution =
  | { status: "resolved"; uri: string }
  | {
      status: "not_found" | "rejected";
      requested: string;
      availableUris: string[];
      reason: string;
    };

const cleanResourceRequest = (value: string) =>
  value
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();

export const resolveSkillResourceRequest = (input: {
  skillId: string;
  requested: string;
  availableUris: string[];
}): SkillResourceRequestResolution => {
  const requested = cleanResourceRequest(input.requested);
  const prefix = `skill://${input.skillId}/`;
  const availableUris = [...new Set(input.availableUris)].filter((uri) =>
    uri.startsWith(prefix),
  );

  if (!requested) {
    return {
      status: "not_found",
      requested,
      availableUris,
      reason: "No Skill resource URI or package-relative path was provided.",
    };
  }

  if (requested.startsWith("skill://") && !requested.startsWith(prefix)) {
    return {
      status: "rejected",
      requested,
      availableUris,
      reason: `Skill resource must belong to active Skill ${input.skillId}.`,
    };
  }

  let candidate = requested.startsWith(prefix)
    ? requested
    : `${prefix}${requested.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")}`;
  const relative = candidate.slice(prefix.length);
  const normalizedRelative = path.posix.normalize(relative);
  if (
    !normalizedRelative ||
    normalizedRelative === "." ||
    normalizedRelative === ".." ||
    normalizedRelative.startsWith("../")
  ) {
    return {
      status: "rejected",
      requested,
      availableUris,
      reason: "Skill resource path must stay inside the active Skill package.",
    };
  }
  candidate = `${prefix}${normalizedRelative}`;

  const exact = availableUris.find(
    (uri) => uri.toLowerCase() === candidate.toLowerCase(),
  );
  if (exact) return { status: "resolved", uri: exact };

  const requestedName = path.posix.basename(normalizedRelative).toLowerCase();
  const basenameMatches = availableUris.filter(
    (uri) => path.posix.basename(uri).toLowerCase() === requestedName,
  );
  if (basenameMatches.length === 1) {
    return { status: "resolved", uri: basenameMatches[0]! };
  }

  return {
    status: "not_found",
    requested,
    availableUris,
    reason: "Requested resource is not present in the active Skill package.",
  };
};

const resolveScriptResourceRelativePath = (input: {
  skillId: string;
  uri: string;
}) => {
  const prefix = `skill://${input.skillId}/`;
  if (!input.uri.startsWith(prefix)) {
    throw new Error(`Skill resource must belong to active Skill ${input.skillId}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(input.skillId)) {
    throw new Error(`Invalid Skill id for workspace materialization: ${input.skillId}`);
  }

  const relative = path.posix.normalize(input.uri.slice(prefix.length));
  if (
    !relative ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error(`Invalid Skill resource path: ${input.uri}`);
  }

  return path.posix.join(
    ".mira",
    "staging",
    "skill-resources",
    input.skillId,
    relative,
  );
};

export const materializeSkillScriptResource = async (input: {
  skillId: string;
  uri: string;
  content: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}) => {
  const workspacePath = resolveScriptResourceRelativePath({
    skillId: input.skillId,
    uri: input.uri,
  });

  await runWithWorkspaceRootOverride(input.workspaceRoot, async () => {
    const targetPath = resolveWorkspaceWritePath(workspacePath);
    ensureParentDir(targetPath);
    try {
      await fs.writeFile(targetPath, input.content, {
        encoding: "utf8",
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) {
        await fs.rm(targetPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  });

  return workspacePath;
};

const createSkillResourceTool = (input: {
  skillId: string;
  availableUris: string[];
  workspaceRoot?: string;
}): SubAgentToolBinding => ({
  id: "skill_read_resource",
  label: "Read Skill Resource",
  description:
    "Read one available reference/template/example/script resource belonging to the active Skill. Script resources are materialized into the bound workspace and return workspacePath; execute that path directly and never copy script source into a shell command. Pass either the exact skill:// URI or its package-relative path. A missing resource returns a recoverable result instead of failing the subAgent.",
  inputSchema: {
    type: "object",
    required: ["uri"],
    additionalProperties: false,
    properties: {
      uri: {
        type: "string",
        description: `One of ${JSON.stringify(input.availableUris)}, or its package-relative path.`,
      },
    },
  },
  execute: async (args, signal) => {
    if (signal?.aborted) {
      throw new Error("subAgent resource execution was cancelled.");
    }
    const requested = typeof args.uri === "string" ? args.uri : "";
    const resolution = resolveSkillResourceRequest({
      skillId: input.skillId,
      requested,
      availableUris: input.availableUris,
    });
    if (resolution.status !== "resolved") {
      return {
        result: resolution,
      };
    }

    try {
      const loaded = await loadSkillResource({
        skillId: input.skillId,
        uri: resolution.uri,
      });
      if (signal?.aborted) {
        throw new Error("subAgent resource execution was cancelled.");
      }

      if (loaded.kind === "script") {
        if (!input.workspaceRoot) {
          return {
            result: {
              status: "workspace_required",
              uri: loaded.uri,
              kind: loaded.kind,
              reason: "Script resources require a bound workspace for materialization.",
            },
          };
        }
        const workspacePath = await materializeSkillScriptResource({
          skillId: input.skillId,
          uri: loaded.uri,
          content: loaded.content,
          workspaceRoot: input.workspaceRoot,
          signal,
        });
        return {
          result: {
            status: "materialized",
            uri: loaded.uri,
            kind: loaded.kind,
            workspacePath,
            bytes: Buffer.byteLength(loaded.content, "utf8"),
          },
          evidence: {
            status: "completed",
            actionTaken: `Materialized Skill script ${loaded.uri}`,
            facts: [`Materialized ${loaded.uri} at ${workspacePath}`],
          },
        };
      }

      return {
        result: {
          status: "loaded",
          uri: loaded.uri,
          kind: loaded.kind,
          content: loaded.content,
        },
        evidence: {
          status: "completed",
          actionTaken: `Loaded Skill resource ${loaded.uri}`,
          facts: [`Loaded ${loaded.uri}`],
        },
      };
    } catch (error) {
      return {
        result: {
          status: "unavailable",
          uri: resolution.uri,
          availableUris: input.availableUris,
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});

const ACCEPTANCE_REPORT_PATTERN = /(?:项目|工程|系统|产品)?验收报告|acceptance\s+report/i;
const TEMPLATE_OR_EXAMPLE_PATTERN = /模板|示例|样例|范例|通用|演示|template|sample|example/i;
const ACCEPTANCE_FACT_PATTERNS = [
  /项目名称\s*[:：]/i,
  /(?:委托方|甲方|建设单位|客户)\s*[:：]/i,
  /(?:承接方|乙方|承建单位|实施单位|供应商)\s*[:：]/i,
  /验收日期\s*[:：]|\b20\d{2}[-/.年]\d{1,2}/i,
  /(?:验收内容|验收范围|交付物|交付清单)\s*[:：]/i,
  /(?:验收标准|验收依据|验收条件)\s*[:：]/i,
  /(?:验收结论|验收结果)\s*[:：]|(?:通过|不通过)验收/i,
];

const buildDeterministicNeedsInput = (input: {
  goal: string;
  skillContext: SkillContext;
  checkpoint?: SubAgentCheckpoint;
}): SubAgentExecutionResult | null => {
  const skillId = input.skillContext.primary?.id;
  if (skillId !== "docx" || input.checkpoint) return null;
  const goal = input.goal.trim();
  if (!ACCEPTANCE_REPORT_PATTERN.test(goal) || TEMPLATE_OR_EXAMPLE_PATTERN.test(goal)) {
    return null;
  }

  const suppliedFactGroups = ACCEPTANCE_FACT_PATTERNS.filter((pattern) =>
    pattern.test(goal),
  ).length;
  if (suppliedFactGroups >= 3) return null;

  const requirements: SubAgentRequirement[] = [
    {
      id: "docx:acceptance:project",
      kind: "user_input",
      description:
        "请提供项目名称、委托方/甲方、承接方/乙方，以及计划或实际验收日期。",
      requiredFor: "acceptance_report_identity",
    },
    {
      id: "docx:acceptance:scope",
      kind: "user_input",
      description:
        "请提供本次验收范围、主要交付物，以及采用的验收依据或通过标准。",
      requiredFor: "acceptance_report_scope",
    },
    {
      id: "docx:acceptance:result",
      kind: "user_input",
      description:
        "请提供实际完成情况、遗留问题（如有）和预期验收结论；若只需要空白模板，请明确说“生成模板”。",
      requiredFor: "acceptance_report_result",
    },
  ];

  return {
    status: "needs_input",
    summary:
      "A formal acceptance report requires project-specific facts; authoritative-looking business content must not be fabricated.",
    requirements,
    evidence: [],
    artifacts: [],
    trace: { engine: "pi-agent-core", skillId, toolCalls: [] },
  };
};

type PrepareSubAgentInput = {
  goal: string;
  skillContext: SkillContext;
  workspaceRoot?: string;
  exposedHarnessToolIds?: string[];
  userId?: number;
  threadId?: string;
  turnId?: string;
  approvedInvocations?: SubAgentApprovedInvocation[];
  checkpoint?: SubAgentCheckpoint;
  signal?: AbortSignal;
  onRuntimeEvent?: (event: SubAgentRuntimeEvent) => Promise<void> | void;
};

export const resolveSubAgentHarnessToolIds = (input: {
  origin?: SkillPackageOrigin;
  declaredToolIds: string[];
  canonicalToolIds?: string[];
}) => {
  const resolved = new Set(input.canonicalToolIds ?? []);

  // Built-in Skill packages are trusted execution manifests, but still not
  // permission grants. They may select their declared subAgent-local tools;
  // the adapter must still find a registered Harness implementation, and every
  // invocation still crosses Harness Policy, approval and provider authorization.
  // User and external Skills remain limited to the canonical ToolExposure.
  if (input.origin === "built-in") {
    for (const toolId of input.declaredToolIds) resolved.add(toolId);
  }

  return [...resolved];
};

const capabilityRequirement = (
  skillId: string,
  capabilityId: string,
): SubAgentRequirement => ({
  id: `capability:${skillId}:${capabilityId}`,
  kind: "capability",
  description: `Skill ${skillId} requires capability ${capabilityId}, but it is not available in the current governed ToolExposure/runtime environment.`,
  requiredFor: capabilityId,
});

const publishBlockedCapabilityState = async (input: {
  skillId: string;
  requirements: SubAgentRequirement[];
  onRuntimeEvent?: PrepareSubAgentInput["onRuntimeEvent"];
}) => {
  const runId = crypto.randomUUID();
  const timestamp = Date.now();
  const reason = input.requirements.map((item) => item.description).join("；");
  const state: SubAgentWorkingState = {
    runId,
    skillId: input.skillId,
    phase: "blocked",
    currentJudgement: "Skill 说明书已读取，但当前环境没有提供它声明的受管能力。",
    currentAction: "等待所需能力可用",
    nextAction: "启用、授权或让本轮 ToolExposure 选中该能力后重新发起任务",
    blockingReason: reason,
    updatedAt: timestamp,
  };
  const event: SubAgentTraceEvent = {
    runId,
    seq: 1,
    eventId: crypto.randomUUID(),
    skillId: input.skillId,
    type: "input.required",
    title: "subAgent 缺少执行能力",
    timestamp,
    details: {
      requirements: input.requirements.map((item) => ({
        kind: item.kind,
        requiredFor: item.requiredFor,
      })),
    },
  };
  await input.onRuntimeEvent?.({ kind: "trace", event });
  await input.onRuntimeEvent?.({ kind: "working_state", state });
  return { runId, state, event };
};

export const prepareSubAgent = (input: PrepareSubAgentInput) => {
  const primary = input.skillContext.primary;
  const skillId = primary?.id;
  if (!primary || !skillId) {
    throw new Error("subAgent requires one primary SkillContext");
  }
  const profile = resolveSubAgentExecutionProfile(primary);

  const selectedWorkspace = getWorkspaceSelection();
  const workspaceRoot =
    input.workspaceRoot?.trim() || selectedWorkspace.rootPath || undefined;
  if (profile.workspaceBound && !workspaceRoot) {
    throw new Error(`Skill ${skillId} requires an active workspace`);
  }

  const execution: SubAgentExecutionInput = {
    goal: input.goal,
    skillContext: input.skillContext,
    workspaceRoot,
    userId: input.userId,
    threadId: input.threadId,
    turnId: input.turnId,
    approvedInvocations: input.approvedInvocations,
    checkpoint: input.checkpoint,
    signal: input.signal,
    onRuntimeEvent: input.onRuntimeEvent,
  };

  const availableResourceUris = input.skillContext.resources
    .filter((resource) => resource.skillId === skillId)
    .map((resource) => resource.uri);
  const tools: SubAgentToolBinding[] = availableResourceUris.length > 0
    ? [
        createSkillResourceTool({
          skillId,
          availableUris: availableResourceUris,
          workspaceRoot,
        }),
      ]
    : [];
  const missingCapabilities: SubAgentRequirement[] = [];
  let availableCapabilityCount = 0;
  const declaredCapabilityCount =
    profile.allowedHarnessToolIds.length + profile.runtimeBindings.length;
  const exposedHarnessTools = new Set(
    resolveSubAgentHarnessToolIds({
      origin: primary.origin,
      declaredToolIds: profile.allowedHarnessToolIds,
      canonicalToolIds: input.exposedHarnessToolIds,
    }),
  );

  for (const toolId of profile.allowedHarnessToolIds) {
    if (!exposedHarnessTools.has(toolId)) {
      missingCapabilities.push(capabilityRequirement(skillId, toolId));
      continue;
    }
    try {
      tools.push(createHarnessSkillAgentToolBinding({ toolId, execution }));
      availableCapabilityCount += 1;
    } catch {
      missingCapabilities.push(capabilityRequirement(skillId, toolId));
    }
  }
  for (const binding of profile.runtimeBindings) {
    if (binding.status !== "ready") {
      missingCapabilities.push(capabilityRequirement(skillId, binding.id));
      continue;
    }
    try {
      tools.push(
        createPrivateWenShuRuntimeToolBinding({
          runtimeId: binding.id,
          execution,
        }),
      );
      availableCapabilityCount += 1;
    } catch {
      missingCapabilities.push(capabilityRequirement(skillId, binding.id));
    }
  }

  return {
    profile,
    execution,
    tools,
    missingCapabilities,
    availableCapabilityCount,
    declaredCapabilityCount,
  };
};

const normalizeMalformedCompletion = async (input: {
  result: SubAgentExecutionResult;
  skillId: string;
  onRuntimeEvent?: PrepareSubAgentInput["onRuntimeEvent"];
}): Promise<SubAgentExecutionResult | null> => {
  if (
    input.result.status !== "failed" ||
    !input.result.error?.includes("invalid completion envelope")
  ) {
    return null;
  }

  const governedToolCalls = (input.result.trace?.toolCalls ?? []).filter(
    (toolId) => toolId !== "skill_read_resource",
  );
  const hasAuthoritativeOutput =
    governedToolCalls.length > 0 &&
    (input.result.evidence.length > 0 || input.result.artifacts.length > 0);
  const runId = input.result.trace?.runId ?? crypto.randomUUID();
  const seq = input.result.trace?.nextSeq ?? 1;
  const timestamp = Date.now();
  const state: SubAgentWorkingState = {
    runId,
    skillId: input.skillId,
    phase: hasAuthoritativeOutput ? "completed" : "blocked",
    currentJudgement: hasAuthoritativeOutput
      ? "受管工具已经产出 Evidence 或 Artifact，最终格式错误不应抹掉真实执行结果。"
      : "subAgent 未返回有效完成状态，也没有产出可验证的执行结果。",
    currentAction: hasAuthoritativeOutput
      ? "根据权威执行结果恢复交付"
      : "保留证据缺口，拒绝宣称完成",
    nextAction: hasAuthoritativeOutput
      ? "把 Evidence 与 Artifact 交还给 Main Agent"
      : "重新执行并取得至少一项受管工具结果",
    ...(!hasAuthoritativeOutput
      ? { blockingReason: "Invalid completion envelope without governed Evidence or Artifact" }
      : {}),
    updatedAt: timestamp,
  };
  const event: SubAgentTraceEvent = {
    runId,
    seq,
    eventId: crypto.randomUUID(),
    skillId: input.skillId,
    type: hasAuthoritativeOutput ? "subagent.completed" : "input.required",
    title: hasAuthoritativeOutput
      ? "subAgent 交付格式已从权威结果恢复"
      : "subAgent 缺少可验证交付",
    timestamp,
    details: {
      normalizedInvalidCompletionEnvelope: true,
      governedToolCallCount: governedToolCalls.length,
      evidenceCount: input.result.evidence.length,
      artifactCount: input.result.artifacts.length,
    },
  };
  await input.onRuntimeEvent?.({ kind: "trace", event });
  await input.onRuntimeEvent?.({ kind: "working_state", state });

  const trace = {
    engine: "pi-agent-core" as const,
    skillId: input.skillId,
    toolCalls: input.result.trace?.toolCalls ?? [],
    ...(input.result.trace ?? {}),
    runId,
    nextSeq: seq + 1,
    workingState: state,
    events: [...(input.result.trace?.events ?? []), event],
  };

  if (hasAuthoritativeOutput) {
    return {
      status: "completed",
      summary:
        "The subAgent completed governed tool execution; its malformed final envelope was normalized from authoritative Evidence or Artifact output.",
      evidence: input.result.evidence,
      artifacts: input.result.artifacts,
      trace,
    };
  }

  return {
    status: "insufficient_evidence",
    summary:
      "The subAgent returned an invalid completion envelope and produced no authoritative governed Evidence or Artifact.",
    missingEvidence: [
      "At least one governed task-tool result or a valid terminal completion envelope is required.",
    ],
    evidence: input.result.evidence,
    artifacts: input.result.artifacts,
    trace,
  };
};

export const runSubAgent = async (
  input: PrepareSubAgentInput,
): Promise<SubAgentExecutionResult> => {
  const deterministicNeedsInput = buildDeterministicNeedsInput(input);
  if (deterministicNeedsInput) return deterministicNeedsInput;

  const prepared = prepareSubAgent(input);
  if (
    prepared.declaredCapabilityCount > 0 &&
    prepared.availableCapabilityCount === 0 &&
    prepared.missingCapabilities.length > 0
  ) {
    const published = await publishBlockedCapabilityState({
      skillId: prepared.profile.skillId,
      requirements: prepared.missingCapabilities,
      onRuntimeEvent: input.onRuntimeEvent,
    });
    return {
      status: "needs_input",
      summary:
        "The Skill instruction was loaded, but none of its declared governed capabilities are currently available.",
      requirements: prepared.missingCapabilities,
      evidence: [],
      artifacts: [],
      trace: {
        engine: "pi-agent-core",
        skillId: prepared.profile.skillId,
        toolCalls: [],
        runId: published.runId,
        nextSeq: 2,
        workingState: published.state,
        events: [published.event],
      },
    };
  }

  const result = await runPiSkillAgent({
    execution: prepared.execution,
    tools: prepared.tools,
  });
  const normalizedCompletion = await normalizeMalformedCompletion({
    result,
    skillId: prepared.profile.skillId,
    onRuntimeEvent: input.onRuntimeEvent,
  });
  if (normalizedCompletion) return normalizedCompletion;

  const requiresAuthoritativeRuntimeEvidence =
    prepared.profile.runtimeBindings.some((binding) => binding.status === "ready");
  if (
    requiresAuthoritativeRuntimeEvidence &&
    result.status === "completed" &&
    result.evidence.length === 0 &&
    result.artifacts.length === 0
  ) {
    return {
      status: "insufficient_evidence",
      summary:
        "The subAgent declared completion without authoritative Runtime Evidence or Artifact support.",
      evidence: result.evidence,
      artifacts: result.artifacts,
      missingEvidence: [
        "At least one authoritative Skill Runtime Evidence or Artifact record is required before completed may be accepted.",
      ],
      trace: result.trace,
    };
  }

  return result;
};

// Compatibility aliases for the previous WenShu-only entry point.
export const prepareWenShuPiSkillAgentPilot = prepareSubAgent;
export const runWenShuPiSkillAgentPilot = runSubAgent;
