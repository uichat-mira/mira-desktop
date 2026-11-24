import { resolveHarnessCapabilityProfiles } from "@/harness/capability-profiles.js";
import type { ToolDefinition } from "@/mcp/core/definitions.js";
import { getAppMeta } from "@/utils/index.js";

export const REMOTE_MCP_SERVICE_ID = "mira-desktop" as const;
export const REMOTE_MCP_SERVER_NAME = "mira-desktop" as const;
export const REMOTE_MCP_RESOURCE_URI =
  "mira://service/mira-desktop/capabilities" as const;
export const REMOTE_MCP_RESOURCE_NAME =
  "mira-desktop-service-capabilities" as const;
export const REMOTE_MCP_RESOURCE_MIME_TYPE = "application/json" as const;
export const REMOTE_SERVICE_CAPABILITIES_SCHEMA =
  "mira.service-capabilities/v1" as const;
export const REMOTE_SERVICE_CAPABILITIES_VERSION = "1.0.0" as const;
export const REMOTE_MCP_DOCUMENTATION_URL =
  "https://github.com/uichat-mira/mira-desktop/blob/dev/docs/remote-access/desktop-mcp-server-v1.md" as const;

export type RemoteServiceAccess = "read" | "write" | "send" | "destructive";
export type RemoteServiceConfirmation =
  | "none"
  | "confirm-argument"
  | "identity-credential"
  | "draft-credential";

export type RemoteServiceCapability = {
  id: string;
  title: string;
  description: string;
  access: RemoteServiceAccess;
  requiredScopes: string[];
  confirmation: RemoteServiceConfirmation;
  tools: string[];
};

export type RemoteServiceCapabilitiesManifest = {
  schema: typeof REMOTE_SERVICE_CAPABILITIES_SCHEMA;
  version: typeof REMOTE_SERVICE_CAPABILITIES_VERSION;
  service: {
    id: typeof REMOTE_MCP_SERVICE_ID;
    name: string;
    description: string;
    documentation: string;
    mcp: {
      serverName: typeof REMOTE_MCP_SERVER_NAME;
      serverVersion: string;
      sdk: string;
      protocolVersions: string[];
    };
  };
  capabilities: RemoteServiceCapability[];
  fallback: {
    unknownSchema: string;
    unclassifiedTools: string;
  };
};

const toCapabilityId = (profileId: string) =>
  `${REMOTE_MCP_SERVICE_ID}.${profileId.replace(/[^A-Za-z0-9_.-]+/gu, "-")}`;

const accessFor = (definitions: readonly ToolDefinition[]): RemoteServiceAccess => {
  if (definitions.some((definition) => definition.capabilities.sideEffect === "process")) {
    return "destructive";
  }
  if (
    definitions.some(
      (definition) =>
        definition.capabilities.sideEffect === "local-write" ||
        definition.capabilities.requiresApproval,
    )
  ) {
    return "write";
  }
  return "read";
};

/**
 * Builds the optional semantic resource over the exact Remote/MCP tool
 * projection. Capability groups come only from authored capability profiles;
 * one-to-one fallback profiles are intentionally omitted so ungrouped tools stay
 * visible through tools/list without inventing a product capability.
 */
export const createRemoteServiceCapabilitiesManifest = (input: {
  definitions: readonly ToolDefinition[];
  toolNameById: ReadonlyMap<string, string>;
  serverVersion?: string;
}): RemoteServiceCapabilitiesManifest | null => {
  const profiles = resolveHarnessCapabilityProfiles([...input.definitions]);
  const seenTools = new Set<string>();
  const capabilities: RemoteServiceCapability[] = [];

  for (const profile of profiles) {
    if (profile.fallback) continue;

    const toolNames = profile.supportingToolIds.flatMap((toolId) => {
      const name = input.toolNameById.get(toolId);
      return name ? [name] : [];
    });
    if (toolNames.length === 0) continue;

    for (const name of toolNames) {
      if (seenTools.has(name)) {
        throw new Error(
          `Remote semantic capability groups map tool more than once: ${name}`,
        );
      }
      seenTools.add(name);
    }

    const definitions = profile.supportingToolIds.flatMap((toolId) => {
      const definition = input.definitions.find((item) => item.id === toolId);
      return definition ? [definition] : [];
    });
    const requiresApproval = definitions.some(
      (definition) => definition.capabilities.requiresApproval,
    );

    capabilities.push({
      id: toCapabilityId(profile.id),
      title: profile.title,
      description: profile.description,
      access: accessFor(definitions),
      requiredScopes: ["tools:read", "tools:invoke"],
      confirmation: requiresApproval ? "confirm-argument" : "none",
      tools: toolNames,
    });
  }

  if (capabilities.length === 0) {
    return null;
  }

  const appMeta = getAppMeta();
  return {
    schema: REMOTE_SERVICE_CAPABILITIES_SCHEMA,
    version: REMOTE_SERVICE_CAPABILITIES_VERSION,
    service: {
      id: REMOTE_MCP_SERVICE_ID,
      name: "Mira Desktop",
      description:
        "Mira Desktop Host tools projected from the authoritative Tool Core/Harness eligibility and readiness surface. This declaration describes capability groups; tools/list and tools/call remain authoritative.",
      documentation: REMOTE_MCP_DOCUMENTATION_URL,
      mcp: {
        serverName: REMOTE_MCP_SERVER_NAME,
        serverVersion: input.serverVersion ?? appMeta.version,
        sdk: "mira-desktop/fastify-jsonrpc@1",
        protocolVersions: ["2025-06-18"],
      },
    },
    capabilities,
    fallback: {
      unknownSchema:
        "Consumers that do not understand this resource version must ignore it and use the real tools/list metadata.",
      unclassifiedTools:
        "Every tools/list entry remains visible even when it is absent here. Do not invent a capability or permission for an ungrouped tool.",
    },
  };
};
