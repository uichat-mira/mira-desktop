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
import { terminalSessionTool } from "../src/mcp/tools/terminal-session.tool.js";
import { codebaseExploreTool } from "../src/mcp/managed-codegraph/codebase-explore.tool.js";

const runs = Number(process.argv[2] ?? 3);
if (!Number.isInteger(runs) || runs < 3 || runs > 5) {
  throw new Error("Usage: pnpm exec tsx scripts/smoke-planner-delegation-selection.ts [3-5]");
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), CONFIG.DATABASE_DIR, CONFIG.DATABASE_NAME)}`;
}

const runtimeDefinitions = [
  readTool.definition,
  editFileTool.definition,
  terminalSessionTool.definition,
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

const cases = [
  {
    id: "composite-read-compare",
    question:
      "读取根目录 package.json 和 server/package.json，比较两边的 Node、包管理器和测试脚本配置，给出差异和证据。",
    expected: GENERIC_TASK_DELEGATE_TOOL_ID,
  },
  {
    id: "create-read-verify",
    question:
      "在当前工作区的 .test-artifact/ 下创建 subagent-smoke.txt，写入 subagent smoke passed，重新读取确认内容，最后汇报路径和验证结果。",
    expected: GENERIC_TASK_DELEGATE_TOOL_ID,
  },
  {
    id: "single-read",
    question: "读取 package.json。",
    expected: "read",
  },
  {
    id: "pure-answer",
    question: "只回复 SMOKE_OK。",
    expected: "answer",
  },
] as const;

const makeState = (question: string): AgentNodeState => ({
  runId: `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  threadId: "planner-delegation-selection-smoke",
  userId: 1,
  goal: createAgentGoal(question),
  question,
  messages: [{ role: "user", content: question, parts: [{ type: "text", text: question }] }],
  toolExposure: baseExposure,
  evidence: { observations: [], retrievals: [], toolExecutions: [] },
  iterationCount: 0,
  maxIterations: 0,
});

const metadata = providerProxyService.describeTaskChatInvocation([]);
const results: Array<Record<string, unknown>> = [];

for (const smokeCase of cases) {
  for (let attempt = 1; attempt <= runs; attempt += 1) {
    const startedAt = new Date().toISOString();
    try {
      const patch = await nextActionPlannerNode(makeState(smokeCase.question));
      const action = patch.nextAction as AgentNextAction | undefined;
      const firstAction = action?.type === "use_tool" ? action.toolId : action?.type;
      results.push({
        caseId: smokeCase.id,
        attempt,
        expected: smokeCase.expected,
        firstAction: firstAction ?? null,
        passed: firstAction === smokeCase.expected,
        reason: action?.reason ?? null,
        provider: metadata.providerCode,
        model: metadata.model,
        modelConfigId: metadata.modelConfigId,
        startedAt,
      });
    } catch (error) {
      results.push({
        caseId: smokeCase.id,
        attempt,
        expected: smokeCase.expected,
        firstAction: null,
        passed: false,
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
  const passed = caseResults.filter((item) => item.passed).length;
  return {
    caseId: smokeCase.id,
    expected: smokeCase.expected,
    passed,
    total: caseResults.length,
    passRate: `${passed}/${caseResults.length}`,
    firstActions: caseResults.map((item) => item.firstAction),
  };
});

const output = {
  kind: "real-task-model-planner-first-action-smoke",
  generatedAt: new Date().toISOString(),
  provider: metadata.providerCode,
  model: metadata.model,
  modelConfigId: metadata.modelConfigId,
  runsPerCase: runs,
  scope: "nextActionPlannerNode first valid action; no model output mock",
  results,
  summary,
};

const outputPath = path.resolve(process.cwd(), "..", ".test-artifact", "planner-delegation-selection-real-smoke.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
