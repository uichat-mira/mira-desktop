import type { HarnessCapabilityProfile } from "@/harness/capability-profiles";
import type { CapabilityIntentDocument } from "./types";

const toCompactJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

const toSchemaSummary = (schema: Record<string, unknown>) => {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return "input schema: object";
  }
  const entries = Object.entries(properties as Record<string, unknown>).slice(0, 24);
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const fields = entries.map(([name, value]) => {
    const type = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).type
      : undefined;
    return `${name}${required.has(name) ? " (required)" : ""}${typeof type === "string" ? `: ${type}` : ""}`;
  });
  return `input schema: ${fields.join(", ") || "object"}`;
};

export const toCapabilityIntentDocument = (
  profile: HarnessCapabilityProfile,
): CapabilityIntentDocument => {
  const supportingToolsText = toCompactJson(profile.supportingToolIds);
  const schemaSummary = profile.inputSchema ? toSchemaSummary(profile.inputSchema) : "";
  const text = [
    profile.title,
    profile.id,
    profile.description,
    profile.domain,
    profile.tags.join(" "),
    supportingToolsText,
    schemaSummary,
    profile.sourceLabel,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  return {
    capabilityId: profile.id,
    title: profile.title,
    text,
    source: profile.source,
    domain: profile.domain,
    tags: profile.tags,
    ...(profile.inputSchema ? { inputSchema: profile.inputSchema } : {}),
    ...(profile.sourceLabel ? { sourceLabel: profile.sourceLabel } : {}),
    ...(profile.preferredToolId ? { preferredToolId: profile.preferredToolId } : {}),
    supportingToolIds: profile.supportingToolIds,
    actionProfileId: profile.actionProfileId,
  };
};

export const toCapabilityIntentDocuments = (
  profiles: HarnessCapabilityProfile[],
): CapabilityIntentDocument[] =>
  profiles.map(toCapabilityIntentDocument);
