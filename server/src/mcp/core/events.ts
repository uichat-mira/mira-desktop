import type { ToolInvocationEvent, ToolInvocationEventInput } from "./definitions.js";

export const withEventMeta = (
  invocationId: string,
  event: ToolInvocationEventInput,
): ToolInvocationEvent => ({
  ...event,
  invocationId,
  at: new Date().toISOString(),
} as ToolInvocationEvent);

export const toSseChunk = (event: ToolInvocationEvent) =>
  `data: ${JSON.stringify(event)}\n\n`;
