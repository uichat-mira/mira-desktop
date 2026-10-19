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
  /**
   * Tools this Capability owns for the product/workbench surface. It is a
   * projection-only grouping: it never widens schema disclosure or execution
   * authority. When absent the Capability's `supportingToolIds` are used, so
   * existing grouped Profiles keep their current behavior.
   */
  ownedToolIds?: string[];
  /**
   * Legacy identities that resolve to this Capability without creating a second
   * independent Capability/Tool family. Used for temporary migration aliases.
   */
  aliases?: string[];
  supportingToolIds: string[];
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
