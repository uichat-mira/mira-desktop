import { END, START, StateGraph } from "@langchain/langgraph";
import {
  evaluateNode,
  approvalNode,
  errorNode,
  evidenceNode,
  generateNode,
  genericTaskSubAgentNode,
  nextActionPlannerNode,
  policyNode,
  prepareContextNode,
  retrieveNode,
  activateSkillNode,
  toolCallNormalizeNode,
  toolNode,
} from "../nodes/index";
import { AgentGraphStateAnnotation, createAgentNode } from "./state";
import {
  routeAfterApproval,
  routeAfterEvaluate,
  routeAfterEvidence,
  routeAfterGenerate,
  routeAfterGenericTaskSubAgent,
  routeAfterNextAction,
  routeAfterPolicy,
  routeAfterPrepareContext,
  routeAfterRetrieve,
  routeAfterTool,
  routeAfterToolCallNormalize,
} from "./routes";

export const compiledAgentStateGraph = new StateGraph(AgentGraphStateAnnotation)
  .addNode(
    "prepareContext",
    createAgentNode("prepareContext", prepareContextNode),
  )
  .addNode(
    "nextActionPlanner",
    createAgentNode("nextActionPlanner", nextActionPlannerNode),
  )
  .addNode(
    "genericTaskSubAgent",
    createAgentNode("genericTaskSubAgent", genericTaskSubAgentNode),
  )
  .addNode(
    "toolCallNormalize",
    createAgentNode("toolCallNormalize", toolCallNormalizeNode),
  )
  .addNode("policyStep", createAgentNode("policyStep", policyNode))
  .addNode("approval", createAgentNode("approval", approvalNode))
  .addNode("retrieve", createAgentNode("retrieve", retrieveNode))
  .addNode("activateSkill", createAgentNode("activateSkill", activateSkillNode))
  .addNode("tool", createAgentNode("tool", toolNode))
  .addNode("evidenceStage", createAgentNode("evidenceStage", evidenceNode))
  .addNode("generate", createAgentNode("generate", generateNode))
  .addNode("evaluate", createAgentNode("evaluate", evaluateNode))
  .addNode("error", createAgentNode("error", errorNode))
  .addEdge(START, "prepareContext")
  .addConditionalEdges("prepareContext", routeAfterPrepareContext, [
    "nextActionPlanner",
    "policyStep",
    "generate",
    "error",
  ])
  .addConditionalEdges("nextActionPlanner", routeAfterNextAction, [
    "generate",
    "retrieve",
    "activateSkill",
    "genericTaskSubAgent",
    "toolCallNormalize",
    "error",
  ])
  .addConditionalEdges(
    "genericTaskSubAgent",
    routeAfterGenericTaskSubAgent,
    ["evidenceStage", "nextActionPlanner", "approval", "error"],
  )
  .addConditionalEdges("toolCallNormalize", routeAfterToolCallNormalize, [
    "nextActionPlanner",
    "generate",
    "policyStep",
    "error",
  ])
  .addConditionalEdges("policyStep", routeAfterPolicy, [
    "approval",
    "tool",
    "generate",
    "error",
  ])
  .addConditionalEdges("approval", routeAfterApproval, [END, "error"])
  .addConditionalEdges("activateSkill", routeAfterGenericTaskSubAgent, [
    "evidenceStage", "nextActionPlanner", "approval", "error",
  ])
  .addConditionalEdges("retrieve", routeAfterRetrieve, [
    "evidenceStage",
    "generate",
    "error",
  ])
  .addConditionalEdges("tool", routeAfterTool, [
    "approval",
    "generate",
    "evidenceStage",
    "error",
  ])
  .addConditionalEdges("evidenceStage", routeAfterEvidence, [
    "nextActionPlanner",
    "approval",
    "generate",
    "error",
  ])
  .addConditionalEdges("generate", routeAfterGenerate, ["evaluate", "error"])
  .addConditionalEdges("evaluate", routeAfterEvaluate, [END, "error"])
  .addEdge("error", END)
  .compile();
