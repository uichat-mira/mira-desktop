import type {
  McpResourceDefinition,
  McpResourceImplementation,
  ToolDefinition,
  ToolImplementation,
} from "../mcp/core/definitions.js";
import {
  clearRegistry,
  getResourceImplementation,
  getToolImplementation,
  listResourceDefinitions,
  listToolDefinitions,
  registerResource,
  registerTool,
  unregisterTool,
} from "../mcp/core/registry.js";

export const registerCapability = (capability: ToolImplementation) =>
  registerTool(capability);

export const unregisterCapability = (capabilityId: string) =>
  unregisterTool(capabilityId);

export const registerReadableResource = (resource: McpResourceImplementation) =>
  registerResource(resource);

export const listCapabilityDefinitions = (): ToolDefinition[] =>
  listToolDefinitions();

export const listHarnessToolDefinitions = (): ToolDefinition[] =>
  listToolDefinitions();

export const listInternalCapabilityDefinitions = (): ToolDefinition[] =>
  listToolDefinitions().filter((definition) => definition.source === "internal");

export const listReadableResourceDefinitions = (): McpResourceDefinition[] =>
  listResourceDefinitions();

export const getCapabilityImplementation = (capabilityId: string) =>
  getToolImplementation(capabilityId);

export const getHarnessToolImplementation = (toolId: string) =>
  getToolImplementation(toolId);

export const getReadableResourceImplementation = (resourceId: string) =>
  getResourceImplementation(resourceId);

export const clearHarnessRegistry = () => clearRegistry();
