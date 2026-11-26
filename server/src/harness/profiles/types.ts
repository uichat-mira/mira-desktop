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
   * Product admission scope shared by the Desktop capability surface and the
   * remote MCP catalog. Only authored capability profiles may be core; a
   * one-to-one fallback profile is registered Tool metadata, not a curated
   * product capability.
   */
  core?: boolean;
  /**
   * True when this is the one-to-one projection for a Tool that has no
   * authored semantic group. Consumers that publish capability groups must
   * not present this fallback as a fabricated product capability.
   */
  fallback?: boolean;
  /**
   * Tools owned by this capability/product surface. Workbench grouping and
   * grouped-capability expansion use this list.
   */
  supportingToolIds: string[];
  /**
   * Optional initial schema-disclosure subset. Defaults to supportingToolIds.
   * A capability that owns a large Tool family can keep ownership complete
   * without eagerly disclosing every schema; generic mid-run disclosure can
   * still materialize a concrete Tool on demand.
   */
  disclosureToolIds?: string[];
  /**
   * Temporary compatibility identities for persisted/grouped inputs. Aliases
   * resolve to the canonical profile id and never create a second profile, but
   * they are not Agent capability-search aliases unless a caller explicitly
   * projects them.
   */
  aliases?: string[];
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
