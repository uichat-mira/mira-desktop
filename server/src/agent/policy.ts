import type { ToolDefinition } from "@/mcp/core/definitions";

export type AgentPolicyDecision =
  | { type: "allow"; reason: string }
  | { type: "require_approval"; reason: string }
  | { type: "deny"; reason: string };

const SAFE_AUTO_DOMAINS = new Set<ToolDefinition["domain"]>([
  "read",
  "web_search",
]);

export const evaluateAgentToolPolicy = (
  definition: ToolDefinition,
): AgentPolicyDecision => {
  if (definition.capabilities.requiresApproval) {
    return {
      type: "require_approval",
      reason: `${definition.id} requires explicit approval before Agent execution.`,
    };
  }

  if (definition.capabilities.sideEffect !== "none") {
    if (definition.domain === "web_search") {
      return {
        type: "allow",
        reason: "Web search is an approved low-risk network capability for Agent MVP.",
      };
    }

    return {
      type: "require_approval",
      reason: `${definition.id} has side effect "${definition.capabilities.sideEffect}".`,
    };
  }

  if (SAFE_AUTO_DOMAINS.has(definition.domain)) {
    return {
      type: "allow",
      reason: `${definition.id} is allowed for Agent MVP.`,
    };
  }

  return {
    type: "require_approval",
    reason: `${definition.id} is outside the Agent MVP auto-run surface.`,
  };
};

