import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessDefinitionSource } from "../shared/types.js";

export interface HarnessCapabilityProfile {
  id: string;
  title: string;
  description: string;
  domain: ToolDefinition["domain"];
  source: HarnessDefinitionSource;
  tags: string[];
  inputSchema?: Record<string, unknown>;
  sourceLabel?: string;
  preferredToolId?: string;
  supportingToolIds: string[];
  /**
   * Opt-in schema-disclosure grouping.
   *
   * - "group" (or omitted): the historical behavior. When the capability is
   *   selected, every `supportingToolIds` member is promoted to the full schema
   *   stage as a product group.
   * - "task_relevant": `supportingToolIds` remains the product/workbench
   *   ownership group, but schema disclosure narrows to the concrete Tool(s)
   *   selected for this turn by the existing deterministic-first resolution
   *   cascade. Only the first-level `browser` Capability opts in today.
   *
   * This seam separates first-level Capability ownership from per-turn concrete
   * Tool selection. It never changes readiness, approval or execution authority;
   * it only decides which already-eligible Tool schemas reach the model.
   */
  schemaDisclosure?: "group" | "task_relevant";
  actionProfileId?: string;
  actionProfileTitle?: string;
  actionProfileDescription?: string;
  workbench?: {
    label: string;
    description: string;
    order: number;
    icon: string;
  };
}
