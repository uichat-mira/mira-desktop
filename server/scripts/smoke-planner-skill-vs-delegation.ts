import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import CONFIG from "../src/config/index.js";
import { providerProxyService } from "../src/services/provider-proxy.service/index.js";
import { createAgentGoal } from "../src/agent/nodes/goal-plan.js";
import { nextActionPlannerNode } from "../src/agent/planner/node.js";
import {
  GENERIC_TASK_DELEGATE_TOOL_ID,
  withGenericTaskDelegationTool,
} from "../src/agent/delegation/contract.js";
import type { AgentNodeState } from "../src/agent/node-runtime.js";
import type { AgentNextAction } from "../src/agent/types.js";
import { readTool } from "../src/mcp/tools/read.tool.js";
import { editFileTool } from "../src/mcp/tools/edit-file.tool.js";
import { terminalTool } from "../src/mcp/tools/terminal-session.tool.js";
import { codebaseExploreTool } from "../src/mcp/managed-codegraph/codebase-explore.tool.js";

/**
 * Opt-in first-action probe for AGT-001 (#339).
 *
 * This is intentionally a BOUNDED FIRST-ACTION probe, not an end-to-end outcome
 * acceptance: it records which canonical action the Planner selects when both a
 * specialist Skill summary and delegate_task are visible. Real task completion,
 * mixed-task execution and final disposition remain owned by #311.
 *
 * Samples are exploratory and must not be reported as global success-rate
 * estimates. Run only against a configured model (OpenCode Go when available):
 * `pnpm --filter @ui-chat-mira/server smoke:planner-skill-vs-delegation`.
 * Do not paste raw prompts, credentials, or private model output into public logs.
 */
const runs = Number(process.argv[2] ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
  throw new Error(
    "Usage: pnpm exec tsx scripts/smoke-planner-skill-vs-delegation.ts [1-5]",
  );
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), CONFIG.DATABASE_DIR, CONFIG.DATABASE_NAME)}`;
}

const runtimeDefinitions = [
  readTool.definition,
  editFileTool.definition,
  terminalTool.definition,
  codebaseExploreTool.definition,
];

const baseExposure = withGenericTaskDelegationTool({
  exposedTools: runtimeDefinitions.map((definition) => definition.id),
  toolMeta: runtimeDefinitions.map((definition) => ({
    toolId: definition.id,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    domain: definition.domain,
    source: definition.source,
    tags: definition.tags,
    capabilities: definition.capabilities,
  })),
});

const summarySkill = (skillId: string, description: string) => ({
  skillId,
  name: skillId,
  description,
  version: "smoke",
  discoverable: true,
  disclosure: "summary" as const,
  resources: [],
});

const skillVisibility = (skills: ReturnType<typeof summarySkill>[]) => ({
  scopeId: "main_agent",
  scopeKind: "main_agent" as const,
  maxSkillDisclosure: "body" as const,
  maxResourceDisclosure: "content" as const,
  skills,
});

const tabularSkill = summarySkill(
  "tabular-planning",
  "Plan and build tabular artifacts such as multi-column reports.",
);
const unrelatedSkill = summarySkill(
  "pdf-report",
  "Generate printable PDF reports from supplied content.",
);

const cases = [
  {
    id: "specialist-artifact-skill",
    category: "specialist artifact skill",
    question:
      "把季度销售数据整理成一张多列对比表，并给出结构化的表格化计划。",
    skills: [tabularSkill],
    preferredFirstAction: "activate_skill",
    permittedFirstActions: ["activate_skill", GENERIC_TASK_DELEGATE_TOOL_ID],
  },
  {
    id: "ordinary-multistep-generic-delegation",
    category: "ordinary multi-step with an unrelated Skill summary visible",
    question:
      "读取根目录 package.json 和 server/package.json，比较两边的 Node 与测试脚本配置，给出差异和证据。",
    skills: [unrelatedSkill],
    preferredFirstAction: GENERIC_TASK_DELEGATE_TOOL_ID,
    permittedFirstActions: [GENERIC_TASK_DELEGATE_TOOL_ID],
  },
  {
    id: "simple-direct-tool",
    category: "simple one-step direct action",
    question: "读取 package.json。",
    skills: [tabularSkill],
    preferredFirstAction: "read",
    permittedFirstActions: ["read", "read_open", "read_list", "read_discover"],
  },
  {
    id: "simple-answer",
    category: "simple pure answer",
    question: "只回复 SMOKE_OK。",
    skills: [tabularSkill],
    preferredFirstAction: "answer",
    permittedFirstActions: ["answer"],
  },
  {
    id: "no-relevant-skill",
    category: "multi-step with no discoverable Skill",
    question:
      "读取 package.json 和 server/package.json，比较配置差异并给出证据。",
    skills: [],
    preferredFirstAction: GENERIC_TASK_DELEGATE_TOOL_ID,
    permittedFirstActions: [GENERIC_TASK_DELEGATE_TOOL_ID],
  },
] as const;

const makeState = (
  question: string,
  skills: ReturnType<typeof summarySkill>[],
): AgentNodeState =>
  ({
    runId: `smoke-skill-vs-delegation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId: "planner-skill-vs-delegation-smoke",
    userId: 1,
    goal: createAgentGoal(question),
    question,
    messages: [
      { role: "user", content: question, parts: [{ type: "text", text: question }] },
    ],
    currentTaskFrame: {
      currentGoal: question,
      currentSubtask: "Determine the next action.",
      confirmedObjects: [],
      completionCriteria: [question],
      skillContext: {
        instruction: "Skill context is guidance only.",
        resources: [],
        disclosedResources: [],
        skillVisibility: skillVisibility([...skills]),
      },
    },
    toolExposure: baseExposure,
    evidence: { observations: [], retrievals: [], toolExecutions: [] },
    iterationCount: 0,
    maxIterations: 0,
  }) as unknown as AgentNodeState;

const metadata = providerProxyService.describeTaskChatInvocation([]);
const results: Array<Record<string, unknown>> = [];

for (const smokeCase of cases) {
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    const startedAt = new Date().toISOString();
    try {
      const patch = await nextActionPlannerNode(
        makeState(smokeCase.question, [...smokeCase.skills]),
      );
      const action = patch.nextAction as AgentNextAction | undefined;
      const firstAction =
        action?.type === "use_tool" ? action.toolId : action?.type;
      results.push({
        caseId: smokeCase.id,
        category: smokeCase.category,
        attempt,
        preferredFirstAction: smokeCase.preferredFirstAction,
        permittedFirstActions: smokeCase.permittedFirstActions,
        skillVisible: smokeCase.skills.length > 0,
        chosenFirstAction: firstAction ?? null,
        preferredMatch: firstAction === smokeCase.preferredFirstAction,
        permittedMatch:
          firstAction !== undefined &&
          (smokeCase.permittedFirstActions as readonly string[]).includes(
            firstAction,
          ),
        reason: action?.reason ?? null,
        provider: metadata.providerCode,
        model: metadata.model,
        modelConfigId: metadata.modelConfigId,
        startedAt,
      });
    } catch (error) {
      results.push({
        caseId: smokeCase.id,
        category: smokeCase.category,
        attempt,
        preferredFirstAction: smokeCase.preferredFirstAction,
        permittedFirstActions: smokeCase.permittedFirstActions,
        skillVisible: smokeCase.skills.length > 0,
        chosenFirstAction: null,
        preferredMatch: false,
        permittedMatch: false,
        provider: metadata.providerCode,
        model: metadata.model,
        modelConfigId: metadata.modelConfigId,
        startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const summary = cases.map((smokeCase) => {
  const caseResults = results.filter((item) => item.caseId === smokeCase.id);
  const permitted = caseResults.filter((item) => item.permittedMatch).length;
  const preferred = caseResults.filter((item) => item.preferredMatch).length;
  return {
    caseId: smokeCase.id,
    category: smokeCase.category,
    preferredFirstAction: smokeCase.preferredFirstAction,
    permittedFirstActions: [...smokeCase.permittedFirstActions],
    preferredMatch: `${preferred}/${caseResults.length}`,
    permittedMatch: `${permitted}/${caseResults.length}`,
    chosenFirstActions: caseResults.map((item) => item.chosenFirstAction),
  };
});

const output = {
  kind: "real-task-model-planner-skill-vs-delegation-first-action-probe",
  issue: "#339 (AGT-001)",
  generatedAt: new Date().toISOString(),
  provider: metadata.providerCode,
  model: metadata.model,
  modelConfigId: metadata.modelConfigId,
  runsPerCase: runs,
  probeScope:
    "nextActionPlannerNode first valid action only; no model output mock. This does NOT prove end-to-end task outcome or success rate.",
  skillCatalogMode:
    "Summary Skills are injected directly into currentTaskFrame.skillContext for first-action probing; activate_skill execution is not run here.",
  acceptanceOwner: "#311 retains independent success-first acceptance and final disposition.",
  interpretation:
    "Samples are exploratory. A delegate_task selection is not automatically a failure; verify the actual end result and specialist requirements in #311.",
  results,
  summary,
};

const outputPath = path.resolve(
  process.cwd(),
  "..",
  ".test-artifact",
  "planner-skill-vs-delegation-real-smoke.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
