import type {
  McpResourceDefinition,
  McpResourceImplementation,
  ToolDefinition,
  ToolImplementation,
} from "./definitions.js";

const toolMap = new Map<string, ToolImplementation>();
const resourceMap = new Map<string, McpResourceImplementation>();

export const registerTool = (tool: ToolImplementation) => {
  toolMap.set(tool.definition.id, tool);
};

export const unregisterTool = (toolId: string) => {
  toolMap.delete(toolId);
};

export const registerResource = (resource: McpResourceImplementation) => {
  resourceMap.set(resource.definition.id, resource);
};

export const listToolDefinitions = () =>
  Array.from(toolMap.values(), (tool) => tool.definition);

export const listResourceDefinitions = () =>
  Array.from(resourceMap.values(), (resource) => resource.definition);

export const getToolImplementation = (toolId: string) => toolMap.get(toolId);

export const getResourceImplementation = (resourceId: string) =>
  resourceMap.get(resourceId);
export const clearRegistry = () => {
  toolMap.clear();
  resourceMap.clear();
};
