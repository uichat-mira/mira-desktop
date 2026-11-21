/** Production, development and tests share one default Agent engine.
 * LangGraph is retained only for explicit historical compatibility.
 */
export type AgentRuntimeName = "pi_loop" | "langgraph";

export const resolveAgentRuntimeName = (
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeName =>
  env.MIRA_AGENT_RUNTIME?.trim().toLowerCase() === "langgraph"
    ? "langgraph"
    : "pi_loop";
