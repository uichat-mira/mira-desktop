import { agentGraph } from "./graph";
import type { AgentGraphInput, AgentGraphOutput } from "./types";

export { resolveAgentRuntimeName, type AgentRuntimeName } from "./runtime-selection";

export const runAgentRuntime = (
  input: AgentGraphInput,
): Promise<AgentGraphOutput> => agentGraph.run(input);
