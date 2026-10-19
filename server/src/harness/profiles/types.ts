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
   * Compatibility aliases for this capability/profile identity. An alias resolves
   * to the same profile and reconciles to the same canonical Tool ids, so an
   * in-flight consumer that still uses a superseded id keeps working without a
   * second capability or duplicated runtime registration.
   */
  aliases?: string[];
  /**
   * Generic opt-in schema-disclosure seam. "group" (default) keeps the existing
   * behavior: selecting the capability discloses every supporting Tool schema.
   * "concrete" keeps the capability as first-level product/ownership metadata
   * but selects only the task-relevant concrete supporting Tool schema(s)
   * through the existing deterministic-first resolution cascade, so a large
   * grouped catalog is never eager-materialized.
   */
  schemaSelection?: "group" | "concrete";
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
