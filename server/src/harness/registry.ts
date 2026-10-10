import type {
  McpResourceDefinition,
  McpResourceImplementation,
  ToolDefinition,
  ToolImplementation,
} from "../mcp/core/definitions.js";
import {
  clearRegistry,
  getResourceImplementation as getCoreResourceImplementation,
  getToolImplementation as getCoreToolImplementation,
  listResourceDefinitions as listCoreResourceDefinitions,
  listToolDefinitions as listCoreToolDefinitions,
  registerResource as registerCoreResource,
  registerTool as registerCoreTool,
  unregisterTool as unregisterCoreTool,
} from "../mcp/core/registry.js";

import {
  clearToolRuntimeReadiness,
  registerToolRuntimeReadiness,
  unregisterToolRuntimeReadiness,
  type HarnessToolRuntimeReadinessResolver,
} from "./runtime-readiness.js";

export type RegisterHarnessToolOptions = {
  resolveReadiness?: HarnessToolRuntimeReadinessResolver;
};

export const registerTool = (
  tool: ToolImplementation,
  options: RegisterHarnessToolOptions = {},
) => {
  registerCoreTool(tool);
  if (options.resolveReadiness) {
    registerToolRuntimeReadiness(tool.definition.id, options.resolveReadiness);
  }
};

export const unregisterTool = (toolId: string) => {
  unregisterToolRuntimeReadiness(toolId);
  return unregisterCoreTool(toolId);
};

export const registerReadableResource = (resource: McpResourceImplementation) =>
  registerCoreResource(resource);

export const listToolDefinitions = (): ToolDefinition[] => listCoreToolDefinitions();

export const listInternalToolDefinitions = (): ToolDefinition[] =>
  listCoreToolDefinitions().filter((definition) => definition.source === "internal");

export const listReadableResourceDefinitions = (): McpResourceDefinition[] =>
  listCoreResourceDefinitions();

export const getToolImplementation = (toolId: string) => getCoreToolImplementation(toolId);

export const getReadableResourceImplementation = (resourceId: string) =>
  getCoreResourceImplementation(resourceId);

export const clearHarnessRegistry = () => {
  clearToolRuntimeReadiness();
  clearRegistry();
};
