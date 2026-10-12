import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GENERIC_TASK_DELEGATE_TOOL_ID,
  withGenericTaskDelegationTool,
} from "../src/agent/delegation/contract.js";
import {
  buildPlannerObservationContext,
  type AgentNodeState,
} from "../src/agent/node-runtime.js";
import { buildNextActionPlannerMessages } from "../src/agent/planner/prompt.js";
import { withPlannerTaskPlanContract } from "../src/agent/planner/task-plan.js";
import { parseNextActionPlannerOutput } from "../src/agent/planner/text-json-codec.js";
import type { AgentNextAction } from "../src/agent/types.js";
import { readTool } from "../src/mcp/tools/read.tool.js";
import { editTool } from "../src/mcp/tools/edit.tool.js";
import { terminalTool } from "../src/mcp/tools/terminal-session.tool.js";
import { codebaseExploreTool } from "../src/mcp/managed-codegraph/codebase-explore.tool.js";

/**
 * Opt-in real-model first-action probe for AGT-001 (#339).
 *
 * This is intentionally a BOUNDED FIRST-ACTION probe, not an end-to-end outcome
 * acceptance. It builds the production Planner contract messages
 * (`buildNextActionPlannerMessages` + `withPlannerTaskPlanContract`), sends them
 * directly to the configured real model through a test-only provider call, and
 * parses the model decision with the production `parseNextActionPlannerOutput`.
 * It records which canonical first action the model selects when both a
 * specialist Skill summary and delegate_task are visible.
 *
 * This probe deliberately does NOT use `nextActionPlannerNode` or the
 * app-resident Agent Task/provider tables, so it can run in clean CI without a
 * Mira Desktop database. It is first-action only: it does not execute the chosen
 * action, does not run the full graph, and does not prove task completion or a
 * success rate. Real task completion, mixed-task execution, and final
 * disposition remain owned by #311.
 *
 * Run only against a configured model (OpenCode Go when available):
 * `pnpm --filter @ui-chat-mira/server smoke:planner-skill-vs-delegation`.
 * Do not paste raw prompts, credentials, or private model output into public logs.
 */
const runs = Number(process.argv[2] ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
  throw new Error(
    "Usage: pnpm exec tsx scripts/smoke-planner-skill-vs-delegation.ts [1-5]",
  );
}

const OPENCODE_GO_ENDPOINT = "https://opencode.ai/zen/go/v1/chat/completions";
const OPENCODE_GO_MODEL = "deepseek-v4.1-flash";
const openCodeGoKey = process.env.AI_PROVIDER_OPENCODE_GO_KEY?.trim();
if (!openCodeGoKey) {
  throw new Error(
    "AI_PROVIDER_OPENCODE_GO_KEY is required for the #339 real-model first-action probe; refusing to fake or skip the model decision.",
  );
}

type ProbeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const runtimeDefinitions = [
  readTool.definition,
  editTool.definition,
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

type SummarySkill = ReturnType<typeof summarySkill>;

const skillVisibility = (skills: SummarySkill[]) => ({
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
    permittedFirstActions: ["read"],
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
  skills: SummarySkill[],
): AgentNodeState =>
  ({
    runId: `smoke-skill-vs-delegation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId: "planner-skill-vs-delegation-smoke",
    userId: 1,
    goal: {
      id: "smoke-goal",
      text: question,
      successCriteria: [question],
      constraints: [],
      riskLevel: "low",
    },
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

const buildProbeMessages = (
  question: string,
  skills: SummarySkill[],
): ProbeMessage[] => {
  const state = makeState(question, skills);
  const observationContext = buildPlannerObservationContext(state);
  const baseMessages = buildNextActionPlannerMessages({
    question,
    messages: state.messages,
    observationContext,
    toolExposure: baseExposure,
    iteration: 0,
    maxIterations: 0,
  });
  return withPlannerTaskPlanContract(baseMessages).map((message) => ({
    role: message.role as ProbeMessage["role"],
    content: String(message.content),
  }));
};

const normalizeUsage = (usage: unknown) => {
  const record =
    usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const numeric = (value: unknown) =>
    typeof value === "number" ? value : null;
  return {
    input: numeric(record.prompt_tokens),
    output: numeric(record.completion_tokens),
    total: numeric(record.total_tokens),
  };
};

const invokeOpenCodeGo = async (
  messages: ProbeMessage[],
): Promise<{ completion: string; latencyMs: number; usage: ReturnType<typeof normalizeUsage> }> => {
  const startedAt = Date.now();
  const response = await fetch(OPENCODE_GO_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openCodeGoKey}`,
      "Content-Type": "application/json",
      "User-Agent": "mira-worker-339/0",
      "x-opencode-session": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: OPENCODE_GO_MODEL,
      messages,
      max_tokens: 4096,
      thinking: { type: "disabled" },
    }),
  });
  const latencyMs = Date.now() - startedAt;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenCode Go request failed with HTTP ${response.status}; no response content will be published.`,
    );
  }
  const payload = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  };
  const completion = payload.choices?.[0]?.message?.content;
  if (typeof completion !== "string" || !completion.trim()) {
    throw new Error("OpenCode Go returned no textual decision.");
  }
  return { completion, latencyMs, usage: normalizeUsage(payload.usage) };
};

const results: Array<Record<string, unknown>> = [];
let providerFailureCount = 0;

for (const smokeCase of cases) {
  const permittedFirstActions = smokeCase.permittedFirstActions as readonly string[];
  const caseSkills = smokeCase.skills as unknown as SummarySkill[];
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    const startedAt = new Date().toISOString();
    try {
      const messages = buildProbeMessages(smokeCase.question, [...caseSkills]);
      const { completion, latencyMs, usage } = await invokeOpenCodeGo(messages);
      const action = parseNextActionPlannerOutput(completion) as AgentNextAction | null;
      const chosenFirstAction =
        action?.type === "use_tool" ? action.toolId : (action?.type ?? null);
      const chosenSkillId =
        action?.type === "activate_skill" ? action.skillId : null;
      const actionIsValid =
        action !== null &&
        (action.type !== "use_tool" ||
          baseExposure.exposedTools.includes(action.toolId)) &&
        (action.type !== "activate_skill" ||
          caseSkills.some((skill) => skill.skillId === action.skillId));
      results.push({
        caseId: smokeCase.id,
        category: smokeCase.category,
        attempt,
        skillVisible: smokeCase.skills.length > 0,
        preferredFirstAction: smokeCase.preferredFirstAction,
        permittedFirstActions: [...permittedFirstActions],
        chosenFirstAction,
        chosenSkillId,
        actionIsValid,
        preferredMatch: actionIsValid && chosenFirstAction === smokeCase.preferredFirstAction,
        permittedMatch:
          actionIsValid &&
          chosenFirstAction !== null &&
          permittedFirstActions.includes(chosenFirstAction),
        latencyMs,
        usage,
        startedAt,
        verdict: action ? "decision_observed" : "invalid_output",
      });
    } catch (error) {
      providerFailureCount += 1;
      results.push({
        caseId: smokeCase.id,
        category: smokeCase.category,
        attempt,
        skillVisible: smokeCase.skills.length > 0,
        preferredFirstAction: smokeCase.preferredFirstAction,
        permittedFirstActions: [...permittedFirstActions],
        chosenFirstAction: null,
        chosenSkillId: null,
        actionIsValid: false,
        preferredMatch: false,
        permittedMatch: false,
        startedAt,
        verdict: "provider_error",
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
    verdicts: caseResults.map((item) => item.verdict),
  };
});

const output = {
  kind: "real-task-model-planner-skill-vs-delegation-first-action-probe",
  issue: "#339 (AGT-001)",
  generatedAt: new Date().toISOString(),
  provider: "opencode-go",
  model: OPENCODE_GO_MODEL,
  runsPerCase: runs,
  probeScope:
    "Test-only OpenCode Go first-action probe using the production buildNextActionPlannerMessages + withPlannerTaskPlanContract contracts and parseNextActionPlannerOutput. No model decision mock. It does NOT run nextActionPlannerNode, execute the chosen action, or prove end-to-end task outcome or success rate.",
  skillCatalogMode:
    "Summary Skills are injected directly into currentTaskFrame.skillContext for first-action probing; activate_skill execution is not run here.",
  acceptanceOwner: "#311 retains independent success-first acceptance and final disposition.",
  interpretation:
    "Samples are exploratory. A delegate_task selection is not automatically a failure; verify the actual end result and specialist requirements in #311.",
  providerFailureCount,
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

if (providerFailureCount > 0) {
  throw new Error(
    `${providerFailureCount} of ${results.length} real-model attempts failed at the provider layer; the probe is inconclusive and will not report a green run.`,
  );
}
