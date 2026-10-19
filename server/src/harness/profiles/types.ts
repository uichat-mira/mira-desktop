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
   * Compatibility identities for this Capability. Aliases participate in
   * capability search and in explicit toolkit/group identity resolution, but
   * they never create a second Capability, a second Workbench group, or any
   * additional authority.
   */
  aliases?: string[];
  supportingToolIds: string[];
  /**
   * Full product/Capability ownership surface. This is intentionally separate
   * from `supportingToolIds`, which remains the schema-disclosure expansion
   * used by the existing progressive-resolution path. A Capability may own more
   * concrete Tools than it discloses eagerly; readiness and authority remain
   * per concrete Tool.
   */
  ownedToolIds?: string[];
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
