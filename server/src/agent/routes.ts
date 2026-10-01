import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAuth } from "@/db/auth.db";
import { routeHandler } from "@/utils/route-errors";
import { success } from "@/utils/index";
import { successEnvelope, errorEnvelope } from "@/routes/schema-helpers";
import { agentRunStore } from "./run-store";
import { notFound } from "@/utils/route-errors";
import type { AgentRun } from "./types";
import {
  persistAgentAssistantState,
  scheduleApprovedAgentRunResume,
} from "./resume";
import { getAgentRunById } from "./run-read";
import { cancelAgentRunExecution } from "./run-control";

const agentApprovalRequestSchema = {
  type: "object",
  required: ["id", "runId", "stepId", "toolId", "reason", "createdAt"],
  properties: {
    id: { type: "string" },
    runId: { type: "string" },
    stepId: { type: "string" },
    toolId: { type: "string" },
    toolCallId: { type: "string" },
    reason: { type: "string" },
    input: {
      type: "object",
      additionalProperties: true,
    },
    inputHash: { type: "string" },
    createdAt: { type: "string" },
  },
} as const;

const agentRunSchema = {
  type: "object",
  required: [
    "id",
    "threadId",
    "userId",
    "goal",
    "status",
    "observations",
    "traceId",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    threadId: { type: "string" },
    userId: { type: "number" },
    goal: { type: "object", additionalProperties: true },
    status: {
      type: "string",
      enum: ["queued", "running", "waiting_approval", "waiting_user", "completed", "failed", "blocked", "cancelled"],
    },
    observations: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    traceId: { type: "string" },
    blockedReason: { type: "string" },
    terminalReason: { type: "string" },
    pendingApproval: agentApprovalRequestSchema,
    pendingToolCall: {
      type: "object",
      additionalProperties: true,
    },
    selectedToolId: { type: "string" },
    contextBudget: {
      type: "object",
      additionalProperties: true,
    },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

type AgentRouteParams = {
  runId: string;
};

const TERMINAL_AGENT_RUN_STATUSES = new Set<AgentRun["status"]>([
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

const verifyRunOwnership = (run: AgentRun | undefined, userId: number) => {
  if (!run) {
    return null;
  }

  return run.userId === userId ? run : null;
};

const registerAgentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: AgentRouteParams }>(
    "/agent/runs/:runId",
    {
      schema: {
        tags: ["Agent"],
        summary: "Get an agent run",
        operationId: "getAgentRun",
        response: {
          200: successEnvelope(agentRunSchema),
          404: errorEnvelope,
        },
      },
    },
    routeHandler("获取 Agent Run 失败", async (request) => {
      const authUser = request.authUser;
      if (!authUser) {
        throw notFound("Agent run not found");
      }

      const run = getAgentRunById(request.params.runId);
      const visibleRun = verifyRunOwnership(run, authUser.id);
      if (!visibleRun) {
        throw notFound("Agent run not found");
      }

      return success(visibleRun);
    }),
  );

  app.post<{ Params: AgentRouteParams }>(
    "/agent/runs/:runId/approve",
    {
      schema: {
        tags: ["Agent"],
        summary: "Approve a pending agent run",
        operationId: "approveAgentRun",
        response: {
          200: successEnvelope(agentRunSchema),
          404: errorEnvelope,
        },
      },
    },
    routeHandler("审批 Agent Run 失败", async (request) => {
      const authUser = request.authUser;
      if (!authUser) {
        throw notFound("Agent run not found");
      }

      const run = getAgentRunById(request.params.runId);
      const visibleRun = verifyRunOwnership(run, authUser.id);
      if (!visibleRun) {
        throw notFound("Agent run not found");
      }

      if (!visibleRun.pendingApproval) {
        return success(visibleRun);
      }

      const runningRun = scheduleApprovedAgentRunResume(visibleRun.id);
      return success(runningRun);
    }),
  );

  app.post<{ Params: AgentRouteParams }>(
    "/agent/runs/:runId/reject",
    {
      schema: {
        tags: ["Agent"],
        summary: "Reject a pending agent run",
        operationId: "rejectAgentRun",
        response: {
          200: successEnvelope(agentRunSchema),
          404: errorEnvelope,
        },
      },
    },
    routeHandler("拒绝 Agent Run 失败", async (request) => {
      const authUser = request.authUser;
      if (!authUser) {
        throw notFound("Agent run not found");
      }

      const run = getAgentRunById(request.params.runId);
      const visibleRun = verifyRunOwnership(run, authUser.id);
      if (!visibleRun) {
        throw notFound("Agent run not found");
      }

      if (visibleRun.status !== "waiting_approval" || !visibleRun.pendingApproval) {
        return success(visibleRun);
      }

      const next = agentRunStore.complete(visibleRun.id, {
        status: "blocked",
        pendingApproval: undefined,
        pendingToolCall: undefined,
        selectedToolId: undefined,
        blockedReason: "User rejected the pending approval request.",
        terminalReason: "approval_rejected",
      });
      persistAgentAssistantState({
        run: next,
        status: "blocked",
        content: "你已拒绝这次需要审批的工具调用，工具没有执行。",
        blockedReason: "User rejected the pending approval request.",
        terminalReason: "approval_rejected",
      });

      return success(next);
    }),
  );

  app.post<{ Params: AgentRouteParams }>(
    "/agent/runs/:runId/cancel",
    {
      schema: {
        tags: ["Agent"],
        summary: "Cancel an agent run",
        operationId: "cancelAgentRun",
        response: {
          200: successEnvelope(agentRunSchema),
          404: errorEnvelope,
        },
      },
    },
    routeHandler("取消 Agent Run 失败", async (request) => {
      const authUser = request.authUser;
      if (!authUser) {
        throw notFound("Agent run not found");
      }

      const run = getAgentRunById(request.params.runId);
      const visibleRun = verifyRunOwnership(run, authUser.id);
      if (!visibleRun) {
        throw notFound("Agent run not found");
      }

      if (TERMINAL_AGENT_RUN_STATUSES.has(visibleRun.status)) {
        return success(visibleRun);
      }

      cancelAgentRunExecution(visibleRun.id);
      const next = agentRunStore.complete(visibleRun.id, {
        status: "cancelled",
        pendingApproval: undefined,
        pendingToolCall: undefined,
        selectedToolId: undefined,
        terminalReason: "cancelled",
      });
      persistAgentAssistantState({
        run: next,
        status: "cancelled",
        content: "Agent 运行已取消。",
        terminalReason: "cancelled",
      });

      return success(next);
    }),
  );
};

export default registerAgentRoutes;
