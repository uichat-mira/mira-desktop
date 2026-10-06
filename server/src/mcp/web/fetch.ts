import type {
  ToolInvocationContext,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  fetchWebResource,
  WebFetchTransportError,
  type WebFetchTransportInput,
  type WebFetchTransportResult,
} from "./transport.js";

export interface WebFetchRuntimeInput {
  url: string;
  signal: AbortSignal;
  pushEvent?: (event: ToolInvocationEventInput) => void;
  trace?: ToolInvocationContext["trace"];
  transport?: (input: WebFetchTransportInput) => Promise<WebFetchTransportResult>;
}

export interface WebFetchExecutionResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

export const executeWebFetch = async (
  input: WebFetchRuntimeInput,
): Promise<WebFetchExecutionResult> => {
  const url = input.url.trim();
  if (!url) {
    throw mcpBadRequest("url must be a non-empty string");
  }
  if (input.signal.aborted) {
    throw new WebFetchTransportError("cancelled");
  }

  input.pushEvent?.({
    type: "invocation:progress",
    message: "Fetching web resource",
  });
  const fetchSpan = input.trace?.startSpan({
    name: "Fetch web resource",
    kind: "command_execution",
  });

  const transport = input.transport ?? fetchWebResource;
  try {
    const result = await transport({ url, signal: input.signal });
    fetchSpan?.end({
      metadata: {
        status: result.status,
        byteLength: result.byteLength,
        truncated: result.truncated,
      },
    });
    return {
      url,
      finalUrl: result.finalUrl,
      status: result.status,
      contentType: result.contentType,
      content: result.body,
      byteLength: result.byteLength,
      truncated: result.truncated,
    };
  } catch (error) {
    fetchSpan?.end({ status: input.signal.aborted ? "cancelled" : "failed" });
    throw error;
  }
};
