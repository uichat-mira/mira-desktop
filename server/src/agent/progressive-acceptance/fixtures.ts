import type { ToolImplementation } from "@/mcp/core/definitions.js";
import { registerTool } from "@/harness/registry.js";
import type { AcceptanceToolSpec } from "./contract.js";

/**
 * Test-only Tool fixtures for the #311 acceptance matrix.
 *
 * These reuse the production Harness registry and the production capability
 * profile resolver. They are analogous fixtures built for the #311 matrix, not
 * the original #243 gold corpus (a point the report records explicitly).
 */

export const buildAcceptanceTool = (spec: AcceptanceToolSpec): ToolImplementation => ({
  definition: {
    id: spec.id,
    title: spec.title ?? spec.id,
    description: spec.description ?? `${spec.id} capability`,
    domain: spec.domain ?? "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
      additionalProperties: false,
    },
    tags: spec.tags ? [...spec.tags] : [],
    capabilities: { sideEffect: "none", requiresApproval: false },
  },
  execute() {
    return {};
  },
});

/**
 * Register every fixture through the real Harness registry. Runtime readiness
 * is attached through the same `registerTool` option the production startup uses.
 */
export const installAcceptanceTools = (specs: readonly AcceptanceToolSpec[]): void => {
  for (const spec of specs) {
    registerTool(
      buildAcceptanceTool(spec),
      spec.readiness ? { resolveReadiness: () => ({ ...spec.readiness! }) } : {},
    );
  }
};

export const noiseTools = (
  count: number,
  overrides: Partial<AcceptanceToolSpec> = {},
): AcceptanceToolSpec[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `noise_tool_${index}`,
    description: "generic unrelated capability noise",
    tags: ["noise"],
    ...overrides,
  }));

export const workspaceLookupTools = (): AcceptanceToolSpec[] => [
  { id: "glob", domain: "read", tags: ["read", "workspace", "pattern"] },
  { id: "grep", domain: "read", tags: ["read", "workspace", "search"] },
  { id: "list", domain: "read", tags: ["read", "workspace", "directory"] },
  { id: "read", domain: "read", tags: ["read", "workspace", "open"] },
];
