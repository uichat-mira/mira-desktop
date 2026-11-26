import type { ToolDefinition } from "@/mcp/core/definitions.js";
import { resolveHarnessCapabilityProfiles } from "./profiles/resolver.js";

export type CoreCapabilityProfile = {
  id: string;
  title: string;
  toolIds: string[];
};

export type CoreCapabilityScope = {
  profileIds: string[];
  toolIds: ReadonlySet<string>;
  profiles: CoreCapabilityProfile[];
};

/**
 * Resolves the one product admission scope shared by the Desktop capability
 * surface and the remote MCP catalog.
 *
 * Core is a property of authored Harness capability profiles, never a second
 * hand-maintained tool list. Fallback profiles are ordinary registered tools,
 * so a Tool does not become remotely available merely because it was
 * registered. Only tools currently present in the registry are returned;
 * acceptance placeholders and unregistered ids never enter this projection.
 */
export const resolveCoreCapabilityScope = (
  definitions: readonly ToolDefinition[],
): CoreCapabilityScope => {
  const profiles = resolveHarnessCapabilityProfiles([...definitions])
    .filter((profile) => profile.core === true && profile.fallback !== true)
    .map((profile) => ({
      id: profile.id,
      title: profile.title,
      toolIds: [...profile.supportingToolIds],
    }));

  return {
    profileIds: profiles.map((profile) => profile.id),
    toolIds: new Set(profiles.flatMap((profile) => profile.toolIds)),
    profiles,
  };
};

export const resolveCoreCapabilityToolIds = (
  definitions: readonly ToolDefinition[],
): ReadonlySet<string> => resolveCoreCapabilityScope(definitions).toolIds;
