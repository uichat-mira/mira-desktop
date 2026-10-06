import type {
  ToolInvocationContext,
  ToolInvocationEventInput,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { extractWebContent, type WebFetchContentKind } from "./extract.js";
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
  byteLength: number;
  truncated: boolean;
  kind: WebFetchContentKind;
  title?: string;
  content?: string;
  reason?: string;
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
  let result: WebFetchTransportResult;
  try {
    result = await transport({ url, signal: input.signal });
  } catch (error) {
    fetchSpan?.end({ status: input.signal.aborted ? "cancelled" : "failed" });
    throw error;
  }
  fetchSpan?.end({
    metadata: {
      status: result.status,
      byteLength: result.byteLength,
      truncated: result.truncated,
    },
  });

  input.pushEvent?.({
    type: "invocation:progress",
    message: "Extracting web content",
  });
  const extractSpan = input.trace?.startSpan({
    name: "Extract web content",
    kind: "result_normalization",
  });
  const extraction = extractWebContent({
    finalUrl: result.finalUrl,
    contentType: result.contentType,
    body: result.body,
  });
  extractSpan?.end({
    metadata: { kind: extraction.kind, truncated: result.truncated },
  });

  const base = {
    url,
    finalUrl: result.finalUrl,
    status: result.status,
    contentType: result.contentType,
    byteLength: result.byteLength,
    truncated: result.truncated,
  };

  switch (extraction.kind) {
    case "html":
      return {
        ...base,
        kind: "html",
        title: extraction.title,
        content: extraction.content,
      };
    case "text":
      return { ...base, kind: "text", content: extraction.content };
    case "browser_required":
      return { ...base, kind: "browser_required", reason: extraction.reason };
    case "unsupported":
      return { ...base, kind: "unsupported", reason: extraction.reason };
  }
};
