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
