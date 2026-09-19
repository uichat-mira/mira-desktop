import assert from "node:assert/strict";
import Fastify from "fastify";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getLoggerConfig } from "@/logger";
import { sendRouteError } from "@/utils/route-errors";
import agentRoute from "../routes";
import { agentRunStore } from "../run-store";
import { createAgentGoal } from "../nodes/index";
import * as resumeModule from "../resume";
import * as messagePersistenceModule from "@/routes/proxy-provider/message-persistence";
import { threadService } from "@/services/thread.service";

const requireAuthMock = vi.hoisted(() =>
  vi.fn(async (request: { authUser?: unknown }) => {
    request.authUser = {
      id: 1,
      username: "owner",
      role: "user",
    };
  }),
);

vi.mock("@/db/auth.db.js", () => ({
  requireAuth: requireAuthMock,
}));

const createRun = () => {
  const goal = createAgentGoal("answer the user");
  return agentRunStore.create({
    threadId: "thread-1",
    userId: 1,
    goal,
  });
};

const mockScheduledResume = () =>
  vi
    .spyOn(resumeModule, "scheduleApprovedAgentRunResume")
    .mockImplementation((runId) =>
      agentRunStore.update(runId, {
        status: "running",
        pendingApproval: undefined,
      }),
    );

describe("agent routes", () => {
  afterEach(() => {
    agentRunStore.clear();
    requireAuthMock.mockClear();
    vi.restoreAllMocks();
  });

  test("returns and updates runs", async () => {
    const scheduleSpy = mockScheduledResume();

    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(agentRoute);

    const run = createRun();
    agentRunStore.update(run.id, {
      status: "waiting_approval",
      runtimeInput: {
        messages: [],
        conversationWorkdir: {
          id: "workdir-1",
          threadId: "thread-1",
          rootPath: "/host-private/conversation-workdirs/thread-1",
        },
      },
      pendingApproval: {
        id: "approval-1",
        runId: run.id,
        stepId: "approval",
        toolId: "terminal_session",
        reason: "Needs approval",
        createdAt: new Date().toISOString(),
      },
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/agent/runs/${run.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    const getBody = getResponse.json() as {
      data: {
        id: string;
        selectedCapabilityId?: string;
        runtimeInput?: unknown;
      };
    };
    expect(getBody.data.id).toBe(run.id);
    expect(getBody.data.selectedCapabilityId).toBeUndefined();
    expect(getBody.data.runtimeInput).toBeUndefined();

    const approveResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${run.id}/approve`,
      payload: {},
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(scheduleSpy).toHaveBeenCalledWith(run.id);
    expect(
      (approveResponse.json() as { data: { status: string } }).data.status,
    ).toBe("running");

    const rejectResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${run.id}/reject`,
    });
    expect(rejectResponse.statusCode).toBe(200);
    expect(
      (rejectResponse.json() as { data: { status: string } }).data.status,
    ).toBe("running");
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${run.id}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect(
      (cancelResponse.json() as { data: { status: string } }).data.status,
    ).toBe("cancelled");
    await app.close();
  });

  test("returns 404 for unknown runs", async () => {
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(agentRoute);

    const response = await app.inject({
      method: "GET",
      url: "/agent/runs/missing",
    });

    assert.equal(response.statusCode, 404);

    await app.close();
  });

  test("approve is idempotent when run is not waiting approval", async () => {
    const scheduleSpy = vi.spyOn(resumeModule, "scheduleApprovedAgentRunResume");
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(agentRoute);

    const run = createRun();
    agentRunStore.update(run.id, {
      status: "completed",
      pendingApproval: undefined,
    });

    const response = await app.inject({
      method: "POST",
      url: `/agent/runs/${run.id}/approve`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: { status: string } }).data.status).toBe(
      "completed",
    );
    expect(scheduleSpy).not.toHaveBeenCalled();

    await app.close();
  });

  test("reject and cancel clear pending approval state", async () => {
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(agentRoute);

    const rejectedRun = createRun();
    agentRunStore.update(rejectedRun.id, {
      status: "waiting_approval",
      assistantMessageId: "assistant-reject-1",
      assistantParentId: "user-1",
      pendingApproval: {
        id: "approval-reject",
        runId: rejectedRun.id,
        stepId: "approval-step",
        toolId: "terminal_session",
        reason: "Needs approval",
        createdAt: new Date().toISOString(),
      },
    });
    const persistAssistantMessageSpy = vi
      .spyOn(messagePersistenceModule, "persistAssistantMessage")
      .mockImplementation(() => {});
    vi.spyOn(threadService, "getMessageById").mockReturnValue({
      id: "assistant-reject-1",
      threadId: "thread-1",
      role: "assistant",
      content: "等待审批",
      parts: [{ type: "text", text: "等待审批" }],
      metadata: {},
      createdAt: "2026-06-28T00:00:00.000Z",
    });

    const rejectResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${rejectedRun.id}/reject`,
    });
    expect(rejectResponse.statusCode).toBe(200);
    const rejectData = rejectResponse.json() as {
      data: {
        status: string;
        pendingApproval?: unknown;
        pendingToolCall?: unknown;
        terminalReason?: string;
      };
    };
    expect(rejectData.data.status).toBe("blocked");
    expect(rejectData.data.pendingApproval).toBeUndefined();
    expect(rejectData.data.pendingToolCall).toBeUndefined();
    expect(rejectData.data.terminalReason).toBe("approval_rejected");
    expect(persistAssistantMessageSpy).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: 1,
      assistantMessageId: "assistant-reject-1",
      parentId: "user-1",
      content: "你已拒绝这次需要审批的工具调用，工具没有执行。",
      parts: [
        {
          type: "text",
          text: "你已拒绝这次需要审批的工具调用，工具没有执行。",
        },
      ],
      metadata: {
        agent: {
          status: "blocked",
          runId: rejectedRun.id,
          traceId: expect.any(String),
          blockedReason: "User rejected the pending approval request.",
          terminalReason: "approval_rejected",
        },
      },
    });

    const cancelledRun = createRun();
    agentRunStore.update(cancelledRun.id, {
      status: "waiting_approval",
      pendingApproval: {
        id: "approval-cancel",
        runId: cancelledRun.id,
        stepId: "approval-step",
        toolId: "terminal_session",
        reason: "Needs approval",
        createdAt: new Date().toISOString(),
      },
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${cancelledRun.id}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    const cancelData = cancelResponse.json() as {
      data: {
        status: string;
        pendingApproval?: unknown;
        pendingToolCall?: unknown;
        terminalReason?: string;
      };
    };
    expect(cancelData.data.status).toBe("cancelled");
    expect(cancelData.data.pendingApproval).toBeUndefined();
    expect(cancelData.data.pendingToolCall).toBeUndefined();
    expect(cancelData.data.terminalReason).toBe("cancelled");
    expect(persistAssistantMessageSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });

  test("approve returns running before the resumed graph completes", async () => {
    const app = Fastify({
      logger: getLoggerConfig(),
      serializerOpts: { encoding: "utf8" },
    });
    app.setErrorHandler(sendRouteError);
    await app.register(agentRoute);

    const goal = createAgentGoal("answer the user");
    const run = agentRunStore.create({
      threadId: "thread-1",
      userId: 1,
      goal,
      runtimeInput: {
        messages: [
          {
            role: "user",
            content: "hello",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
        params: {},
      },
    });
    agentRunStore.update(run.id, {
      status: "waiting_approval",
      pendingApproval: {
        id: "approval-route-1",
        runId: run.id,
        stepId: "approval-step",
        toolId: "web_search",
        reason: "Needs approval",
        createdAt: new Date().toISOString(),
      },
    });

    const scheduleSpy = mockScheduledResume();

    const approveResponse = await app.inject({
      method: "POST",
      url: `/agent/runs/${run.id}/approve`,
      payload: {},
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(scheduleSpy).toHaveBeenCalledWith(run.id);
    const approveData = approveResponse.json() as {
      data: { status: string; pendingApproval?: unknown };
    };
    expect(approveData.data.status).toBe("running");
    expect(approveData.data.pendingApproval).toBeUndefined();

    await app.close();
  });
});


test("cancel is idempotent after an Agent run is terminal", async () => {
  const app = Fastify({
    logger: getLoggerConfig(),
    serializerOpts: { encoding: "utf8" },
  });
  app.setErrorHandler(sendRouteError);
  await app.register(agentRoute);

  const completedRun = createRun();
  agentRunStore.complete(completedRun.id, {
    status: "completed",
    terminalReason: "answered",
  });

  const response = await app.inject({
    method: "POST",
    url: `/agent/runs/${completedRun.id}/cancel`,
  });

  expect(response.statusCode).toBe(200);
  const data = (response.json() as { data: { status: string; terminalReason?: string } }).data;
  expect(data.status).toBe("completed");
  expect(data.terminalReason).toBe("answered");
  expect(agentRunStore.get(completedRun.id)?.status).toBe("completed");
  expect(agentRunStore.get(completedRun.id)?.terminalReason).toBe("answered");

  await app.close();
  agentRunStore.clear();
});
