import type { HarnessToolDefinition, ToolArtifact } from "@/shared/api/tools";
import type { ToolWorkbenchGroupId, WorkbenchToolDefinition } from "./types";

export const getToolGroups = (tools: WorkbenchToolDefinition[]): ToolWorkbenchGroupId[] =>
  [...new Set(tools.map((tool) => tool.workbench.groupId))].sort((left, right) => {
    const leftTool = tools.find((tool) => tool.workbench.groupId === left);
    const rightTool = tools.find((tool) => tool.workbench.groupId === right);
    return (leftTool?.workbench.groupOrder ?? Number.MAX_SAFE_INTEGER) -
      (rightTool?.workbench.groupOrder ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right, undefined, { numeric: true });
  });

export const formatToolGroup = (groupId: string) =>
  groupId
    .split(/[._-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const buildSchemaDraftValue = (schema: Record<string, unknown>): unknown => {
  if (!schema.type && !schema.oneOf && !schema.default && !schema.enum) {
    return {};
  }

  if (Array.isArray(schema.oneOf)) {
    const firstVariant = schema.oneOf.find(
      (variant): variant is Record<string, unknown> =>
        Boolean(variant && typeof variant === "object" && !Array.isArray(variant)),
    );
    return firstVariant ? buildSchemaDraftValue(firstVariant) : {};
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.type === "object") {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      return {};
    }

    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === "string")
        : Object.keys(properties),
    );
    return Object.fromEntries(
      [...required].flatMap((key) => {
        const property = (properties as Record<string, unknown>)[key];
        return property && typeof property === "object" && !Array.isArray(property)
          ? [[key, buildSchemaDraftValue(property as Record<string, unknown>)]]
          : [];
      }),
    );
  }

  if (schema.type === "array") {
    return [];
  }

  if (schema.type === "boolean") {
    return false;
  }

  if (schema.type === "number" || schema.type === "integer") {
    return 0;
  }

  return "";
};

export { getTerminalResultSummary, type TerminalResultSummary } from "@/shared/tools/terminalResult";

export function findPrimaryArtifact(artifacts: ToolArtifact[]) {
  return (
    artifacts.find((artifact) => artifact.kind === "search-results") ??
    artifacts.find((artifact) => artifact.kind === "document") ??
    artifacts.find((artifact) => artifact.kind === "table") ??
    artifacts.find((artifact) => artifact.kind === "text") ??
    artifacts.find((artifact) => artifact.kind === "code") ??
    null
  );
}

export function buildToolDraft(tool: HarnessToolDefinition) {
  if (tool.workbench?.defaultArgs) {
    return compactJson(tool.workbench.defaultArgs);
  }
  return compactJson(buildSchemaDraftValue(tool.inputSchema));
}
