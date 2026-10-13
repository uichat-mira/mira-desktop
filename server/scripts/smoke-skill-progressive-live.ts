/**
 * #309 one-call real-provider probe: the production Main Planner prompt and
 * Parser must choose a Skill from a summary-only scoped catalog. Then exercise
 * the real SkillContextProvider and Skill Child *preparation* contract.
 *
 * This is not a full Skill Child model-execution smoke: that separately requires
 * a configured production Agent Task provider and governed runtime.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SkillContextProvider } from "../src/skills/context/provider.js";
import { SkillMatcher } from "../src/skills/context/matcher.js";
import { SkillLoader } from "../src/skills/context/loader.js";
import { SkillRegistry, type SkillScanner } from "../src/skills/context/scanner.js";
import type { SkillManifest } from "../src/skills/context/types.js";
import { buildPlannerObservationContext } from "../src/agent/node-runtime.js";
import { buildNextActionPlannerMessages } from "../src/agent/planner/prompt.js";
import { parseNextActionPlannerOutput } from "../src/agent/planner/text-json-codec.js";
import { prepareSubAgent } from "../src/skills/agent/subagent-runtime.js";

const key = process.env.AI_PROVIDER_OPENCODE_GO_KEY?.trim();
if (!key) throw Error("OpenCode Go credential unavailable.");
const root = path.resolve(".test-artifact/issue-309-real-model");
const query =
  "请帮我按两种经营方案对比 2027 年每月预算，分别列出支出项、金额、总计，并提供可以编辑的二维明细成果；不要只给文字建议。";

const entry = (id: string) => path.join(root, id, "SKILL.md");
const manifests: SkillManifest[] = [
  {
    id: "tabular-planning",
    name: "Tabular Budget Builder",
    description: "Build and edit structured worksheets, budgets and numerical tables; calculate totals in a reusable tabular artifact.",
    version: "1.0",
    entry: entry("tabular-planning"),
    execution: { context: "fork", agent: "subAgent", allowedTools: [], runtimeBindings: [], workspaceBound: false },
  },
  {
    id: "narrative-planning",
    name: "Narrative Writer",
    description: "Draft prose essays and descriptive reports, not spreadsheet or row-and-column deliverables.",
    version: "1.0",
    entry: entry("narrative-planning"),
    execution: { context: "fork", agent: "subAgent", allowedTools: [], runtimeBindings: [], workspaceBound: false },
  },
];
const runner = async () => {
  await fs.mkdir(path.dirname(entry("tabular-planning")), { recursive: true });
  await fs.mkdir(path.dirname(entry("narrative-planning")), { recursive: true });
  await fs.writeFile(entry("tabular-planning"), "# Tabular budget builder\nCreate reusable tables and calculate totals.");
  await fs.writeFile(entry("narrative-planning"), "# Narrative writer\nOnly prose; not structured workbooks.");

  const registry = new SkillRegistry({ scan: async () => manifests } as unknown as SkillScanner);
  const provider = new SkillContextProvider(registry, new SkillMatcher(), new SkillLoader());
  const message = { role: "user" as const, content: query };
  const summary = await provider.prepare({ query, messages: [message] });
  if (summary?.primary) throw Error("Deterministic matcher preselected Skill: the smoke no longer tests summary-first.");
  const initial = summary?.skillVisibility?.skills ?? [];
  if (initial.length !== 2 || initial.some(e => e.disclosure !== "summary")) {
    throw Error("Missing initial compact summary catalog.");
  }

  const currentTaskFrame = {
    globalGoal: query,
    currentGoal: query,
    completionCriteria: ["Create editable monthly budget comparison table"],
    skillContext: summary,
  };
  const observations = buildPlannerObservationContext({
    currentTaskFrame,
    observations: [],
    evidence: { observations: [], retrievals: [], toolExecutions: [] },
  } as unknown as Parameters<typeof buildPlannerObservationContext>[0]);
  const messages = buildNextActionPlannerMessages({
    question: query,
    messages: [message],
    observationContext: observations,
    toolExposure: { exposedTools: [], toolMeta: [] },
    iteration: 0,
    maxIterations: 0,
  });
  const modelPayload = JSON.parse(messages[1]?.content ?? "{}");
  if (!Array.isArray(modelPayload.skillCatalog) || modelPayload.skillCatalog.length !== 2) {
    throw Error("The live production Planner message does not expose two Skill summaries.");
  }
  if (JSON.stringify(modelPayload.skillCatalog).includes("Create reusable tables")) {
    throw Error("SKILL.md leaked into the model-visible initial catalog.");
  }

  const start = Date.now();
  const response = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": "mira-ai-review/0",
      "x-opencode-session": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: "deepseek-v4.1-flash",
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
      thinking: { type: "disabled" },
    }),
  });
  const latencyMs = Date.now() - start;
  const text = await response.text();
  if (!response.ok) {
    throw Error(`OpenCode Go live call failed HTTP ${response.status}; no response content will be published.`);
  }
  const payload = JSON.parse(text);
  const completion = payload.choices?.[0]?.message?.content;
  if (typeof completion !== "string") throw Error("OpenCode Go returned no textual decision.");
  const action = parseNextActionPlannerOutput(completion);
  const usage = payload.usage ?? {};
  console.log(JSON.stringify({
    phase: "main_planner_real_model_selection",
    model: "opencode-go/deepseek-v4.1-flash",
    latencyMs,
    usage: { input: usage.prompt_tokens ?? null, output: usage.completion_tokens ?? null, total: usage.total_tokens ?? null },
    selectedAction: action?.type ?? "invalid",
    selectedSkillId: action?.type === "activate_skill" ? action.skillId : null,
  }));

  if (action?.type !== "activate_skill" || action.skillId !== "tabular-planning") {
    throw Error("Model did not activate the relevant summary-only tabular Skill.");
  }
  const selected = await provider.prepare({
    query: `$${action.skillId} ${query}`,
    messages: [message],
  });
  if (selected?.primary?.id !== action.skillId || !selected.primary.body.includes("Create reusable tables")) {
    throw Error("Skill body was not materialized after the model chose its summary.");
  }
  const state = selected.skillVisibility?.skills ?? [];
  const other = state.find(e => e.skillId === "narrative-planning");
  if (other?.disclosure !== "summary") throw Error("Unselected Skill body was disclosed.");
  const child = prepareSubAgent({
    goal: query,
    skillContext: selected,
    exposedHarnessToolIds: [],
    workspaceRoot: root,
  });
  if (child.skillVisibility.scopeKind !== "skill_child" || child.execution.skillContext.primary?.id !== action.skillId) {
    throw Error("Skill Child did not receive its own scoped activated body.");
  }
  if (child.execution.skillContext.primary?.execution?.allowedTools.length !== 0) {
    throw Error("Skill activation improperly widened Tool authority.");
  }
  console.log(JSON.stringify({
    phase: "provider_materialization_and_child_preparation",
    selectedSkillId: selected.primary.id,
    bodyDisclosed: true,
    siblingSummaryOnly: true,
    childScope: child.skillVisibility.scopeKind,
    newToolAuthority: false,
    childModelExecution: "NOT_RUN",
    verdict: "PARTIAL_LIVE_SMOKE_PASS",
  }));
};
runner()
  .finally(() => fs.rm(root, { recursive: true, force: true }))
  .catch(error => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
