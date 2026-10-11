/**
 * nodes 模块入口：聚合 Agent 图兼容节点与 Pi-loop 语义步骤。
 *
 * `*Node` 导出继续服务旧 LangGraph 和现有外部适配；
 * 语义命名导出供 Pi-loop 直接调用，避免把内部职责继续绑定为图节点。
 */
export { createAgentGoal } from "./goal-plan";
export { getLatestUserQuestion } from "./shared";

export { prepareContextNode as basePrepareContextNode } from "./prepare-context";
export { prepareContextWithForkedSkillAgentNode } from "./prepare-context-with-forked-skill";
export {
  prepareContextWithDelegationNode as prepareContextNode,
} from "./prepare-context-with-delegation";
export {
  approvalNode,
  approvalNode as pauseForApproval,
} from "./approval";
export {
  errorNode,
  errorNode as finishWithError,
} from "./error";
export { retrieveNode } from "./retrieve";
export { activateSkillNode } from "./activate-skill";
export { generateNode as baseGenerateNode } from "./generate";
export {
  harnessAwareGenerateNode as generateNode,
  buildHarnessGenerateContextText,
  createHarnessAwareGenerateNode,
} from "./harness-generate-context";
export {
  externalMcpAwareGenerateNode,
  buildExternalMcpGenerateContextText,
  createExternalMcpAwareGenerateNode,
} from "./external-mcp-generate-context";
export {
  evaluateNode,
  evaluateNode as finalizeRun,
} from "./evaluate";

export { nextActionPlannerNode } from "./next-action-planner";
export {
  genericTaskSubAgentNode,
  createGenericTaskSubAgentNode,
} from "./generic-task-subagent";
export { policyNode } from "./policy-node";
export {
  toolCallNormalizeNode,
  toolCallNormalizeNode as normalizeAndFreezeToolCall,
} from "./tool-call-normalize";
export { toolNode as baseToolNode } from "./tool-node";
export {
  harnessAwareToolNode as toolNode,
  attachHarnessLlmContentToExecution,
  type AgentToolExecutionWithLlmContent,
} from "./harness-tool-result";
export {
  evidenceNode,
  evidenceNode as appendPendingEvidence,
} from "./evidence";

export {
  emitStepNode,
  getIterativeNodeId,
  getTraceAttemptMeta,
  type AgentGraphState,
  type AgentNodeState,
  type EmitAgentExecutionNode,
} from "../node-runtime";
