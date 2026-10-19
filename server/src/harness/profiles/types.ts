import type { ToolDefinition } from "../../mcp/core/definitions.js";
import type { HarnessDefinitionSource } from "../shared/types.js";

/**
 * Metadata consumed by the opt-in task-relevant concrete Tool schema
 * selection seam. It only affects which concrete Tool schema is disclosed;
 * it never changes readiness, Policy, Approval or execution authority.
 */
export interface HarnessCapabilityTaskSelection {
  /**
   * Intent aliases per concrete Tool id. They are merged into the deterministic
   * exact/structural/lexical selection over the profile's own concrete Tools so
   * ordinary user language can reach an atomic Tool without a model roundtrip.
   */
  toolAliases?: Readonly<Record<string, readonly string[]>>;
  /**
   * Concrete Tool disclosed when the deterministic task-relevant selection is
   * not confident. It is the capability's own canonical entry Tool, never a
   * legacy facade.
   */
  defaultToolId?: string;
}

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
  actionProfileId?: string;
  actionProfileTitle?: string;
  actionProfileDescription?: string;
  /**
   * How selecting this capability narrows to concrete Tool schemas.
   *
   * - "grouped" (default): `supportingToolIds` are the schema disclosure unit,
   *   preserving the pre-existing grouped-profile behavior.
   * - "task_relevant": the profile stays the first-level / product ownership
   *   identity, while schema disclosure narrows to the deterministic
   *   task-relevant concrete Tool(s) described by `taskSelection`. This is an
   *   opt-in seam, so non-opt-in profiles keep "grouped" behavior.
   */
  schemaSelection?: "grouped" | "task_relevant";
  /** Metadata consumed only when `schemaSelection` is "task_relevant". */
  taskSelection?: HarnessCapabilityTaskSelection;
  /**
   * Compatibility aliases accepted as this capability's canonical identity.
   * Used for exact/known resolution while a legacy profile id is retired.
   */
  aliases?: string[];
  workbench?: {
    /**
     * Optional workbench group id override. Product grouping can stay stable
     * while the capability/profile identity changes; defaults to `id`.
     */
    groupId?: string;
    label: string;
    description: string;
    order: number;
    icon: string;
  };
}
