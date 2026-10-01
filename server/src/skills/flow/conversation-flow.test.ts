import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextActionPlannerNode } from "@/agent/nodes/next-action-planner.js";
import { fertilityAssessmentRuntime } from "../fertility-assessment/runtime.js";
import {
  buildSkillFlowRequestContextMessages,
  readSkillDeliveryFromRequestContext,
  readSkillDirectiveFromRequestContext,
} from "./context.js";
import {
  readSkillReportManifest,
  writeSkillReportManifest,
} from "./report-files.js";
import {
  getSkillFlowSession,
  saveSkillFlowSession,
} from "./state-store.js";
import type { StoredSkillFlowSession } from "./types.js";

const tempDirs: string[] = [];
const originalStateRoot = process.env.MIRA_SKILL_FLOW_STATE_ROOT;

afterEach(async () => {
  if (originalStateRoot === undefined) delete process.env.MIRA_SKILL_FLOW_STATE_ROOT;
  else process.env.MIRA_SKILL_FLOW_STATE_ROOT = originalStateRoot;
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

const createSession = (): StoredSkillFlowSession => ({
  sessionId: "session-1",
  threadId: "thread-1",
  userId: 1,
  skillId: "fertility-assessment",
  skillVersion: "1.0.0",
  status: "collecting",
  round: 0,
  maxRounds: 10,
  state: fertilityAssessmentRuntime.createInitialState(),
  processedMessageIds: [],
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
});

describe("Skill conversation flow", () => {
  it("keeps Planner directive compact while keeping delivery internal", () => {
    const messages = buildSkillFlowRequestContextMessages({
      skillId: "fertility-report",
      sessionId: "session-1",
      phase: "ready",
      flowCompleted: true,
      stateRef: "skill-flow:session-1",
      delivery: {
        kind: "markdown",
        content: "# report\nprivate rendered body",
      },
    });

    const directive = readSkillDirectiveFromRequestContext(messages);
    const delivery = readSkillDeliveryFromRequestContext(messages);

    expect(directive).toMatchObject({
      skillId: "fertility-report",
      phase: "ready",
      flowCompleted: true,
    });
    expect(directive).not.toHaveProperty("delivery");
    expect(delivery).toEqual({
      kind: "markdown",
      content: "# report\nprivate rendered body",
    });
    expect(messages.every((message) => message.requestContextScope === "agent-execution")).toBe(
      true,
    );
  });

  it("adds a compact hidden marker for inline report delivery instead of embedding html", () => {
    const messages = buildSkillFlowRequestContextMessages({
      skillId: "fertility-report",
      sessionId: "report-session-1",
      phase: "ready",
      flowCompleted: true,
      delivery: {
        kind: "inline_html",
        content: "报告已生成",
        inlineHtml: "<!doctype html><html><body>private html</body></html>",
        pdf: { available: true, fileName: "report.pdf" },
      },
    });

    const delivery = readSkillDeliveryFromRequestContext(messages);
    expect(delivery?.content).toContain("报告已生成");
    expect(delivery?.content).toContain(
      "<!--mira-skill-report:report-session-1:pdf-->",
    );
    expect(delivery?.content).not.toContain("private html");
  });

  it("starts an activation-only fertility request with a natural first question", async () => {
    const session = createSession();
    const result = await fertilityAssessmentRuntime.processTurn({
      session,
      threadId: session.threadId,
      userId: session.userId,
      userMessageId: "message-1",
      query: "帮我做一个备孕评估报告",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "帮我做一个备孕评估报告",
          parts: [],
        },
      ],
    });

    // requiredAction/question are read-only compatibility fields for sessions
    // created before structured interruptions replaced Skill-authored
    // questions, so the live contract is the interruption requirement itself.
    expect(result.directive).toMatchObject({
      skillId: "fertility-assessment",
      phase: "collecting",
      flowCompleted: false,
      round: 0,
      maxRounds: 10,
    });
    expect(result.directive.interruption?.reason).toBe("missing_requirement");
    const requirement = result.directive.interruption?.requirements?.[0];
    expect(requirement?.kind).toBe("user_input");
    expect(requirement?.userPrompt ?? "").not.toBe("");
    expect(result.session.round).toBe(0);
  });

  it("lets the Planner semantic step obey an ask_user directive without replanning", async () => {
    const requestContextMessages = buildSkillFlowRequestContextMessages({
      skillId: "fertility-assessment",
      sessionId: "session-1",
      phase: "collecting",
      flowCompleted: false,
      round: 2,
      maxRounds: 10,
      requiredAction: "ask_user",
      question: "男方有没有做过精液常规？记得多少说多少。",
    });

    const result = await nextActionPlannerNode({
      runId: "run-1",
      threadId: "thread-1",
      userId: 1,
      goal: {
        id: "goal-1",
        text: "继续备孕评估",
        successCriteria: ["完成备孕评估"],
        constraints: [],
        riskLevel: "low",
      },
      messages: [
        {
          id: "message-2",
          role: "user",
          content: "AMH 1.2，去年做过一次取卵。",
          parts: [],
        },
      ],
      requestContextMessages,
      currentTaskFrame: {
        currentGoal: "继续备孕评估",
        confirmedObjects: [],
        completionCriteria: ["完成备孕评估"],
      },
      observations: [],
      evidence: {
        observations: [],
        toolExecutions: [],
        retrievals: [],
      },
    });

    expect(result.nextAction).toEqual(
      expect.objectContaining({
        type: "ask_user",
        question: "男方有没有做过精液常规？记得多少说多少。",
      }),
    );
  });

  it("persists and replaces one thread flow state without duplicating files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-skill-flow-"));
    tempDirs.push(root);
    process.env.MIRA_SKILL_FLOW_STATE_ROOT = root;

    const first = createSession();
    await saveSkillFlowSession(first);
    await saveSkillFlowSession({
      ...first,
      round: 2,
      updatedAt: "2026-07-23T01:00:00.000Z",
    });

    const loaded = await getSkillFlowSession({
      threadId: first.threadId,
      userId: first.userId,
    });
    const files = await fs.readdir(root);

    expect(loaded?.round).toBe(2);
    expect(files.filter((file) => file.endsWith(".json"))).toHaveLength(1);
    expect(files.filter((file) => file.endsWith(".tmp"))).toHaveLength(0);
  });

  it("persists report ownership independently from the active flow state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-skill-report-"));
    tempDirs.push(root);
    process.env.MIRA_SKILL_FLOW_STATE_ROOT = root;

    await writeSkillReportManifest({
      sessionId: "report-session-1",
      threadId: "thread-1",
      userId: 7,
      title: "两个人的备孕全景报告",
      createdAt: "2026-07-23T02:00:00.000Z",
    });

    await saveSkillFlowSession({
      ...createSession(),
      sessionId: "different-session",
      threadId: "thread-1",
      userId: 7,
    });

    await expect(readSkillReportManifest("report-session-1")).resolves.toMatchObject({
      sessionId: "report-session-1",
      threadId: "thread-1",
      userId: 7,
    });
  });
});
