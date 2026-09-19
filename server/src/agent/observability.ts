import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { AgentGraphInput, AgentGraphOutput } from "./types";
import type { AgentGraphState } from "./node-runtime";

const AGENT_TRACE_ENABLED_ENV = "AGENT_TRACE_PHOENIX";
const AGENT_TRACE_VERBOSE_ENV = "AGENT_TRACE_VERBOSE";
const PHOENIX_COLLECTOR_ENDPOINT_ENV = "PHOENIX_COLLECTOR_ENDPOINT";
const AGENT_TRACE_PROJECT_ENV = "AGENT_TRACE_PROJECT";

const DEFAULT_COLLECTOR_ENDPOINT = "http://localhost:16006";
const DEFAULT_PROJECT_NAME = "uichat-mira-dev";
const REDACTED_VALUE = "[REDACTED]";
const MAX_DEPTH = 5;
const MAX_ITEMS = 12;
const MAX_JSON_LENGTH = 4000;
const MAX_SUMMARY_TEXT_LENGTH = 400;

const SENSITIVE_FIELD_NAMES = new Set([
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "private_key",
  "session_token",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{4,}["']?/gi,
];

type PrimitiveAttribute = string | number | boolean | null;

export interface AgentTraceRecord {
  name: string;
  attributes: Record<string, PrimitiveAttribute>;
}

let tracingInitialized = false;
let tracingProvider: NodeTracerProvider | null = null;
let tracingEnabled = false;
let testTraceSink: ((record: AgentTraceRecord) => void) | undefined;

class CompositeSpanExporter implements SpanExporter {
  constructor(private readonly exporters: SpanExporter[]) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    if (this.exporters.length === 0) {
      resultCallback({ code: 0 });
      return;
    }

    let pending = this.exporters.length;
    let failedError: Error | undefined;

    const finish = (result: { code: number; error?: Error }) => {
      if (result.code !== 0 && !failedError) {
        failedError = result.error ?? new Error("Span export failed");
      }

      pending -= 1;
      if (pending === 0) {
        resultCallback(
          failedError ? { code: 1, error: failedError } : { code: 0 },
        );
      }
    };

    for (const exporter of this.exporters) {
      exporter.export(spans, finish);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.exporters.map((exporter) => exporter.shutdown()));
  }

  async forceFlush(): Promise<void> {
    await Promise.all(
      this.exporters
        .filter(
          (
            exporter,
          ): exporter is SpanExporter & { forceFlush: () => Promise<void> } =>
            typeof (exporter as { forceFlush?: unknown }).forceFlush ===
            "function",
        )
        .map((exporter) => exporter.forceFlush()),
    );
  }
}

class NullSpanExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: (result: { code: number }) => void,
  ): void {
    resultCallback({ code: 0 });
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}
}

const isTracingEnabled = () =>
  process.env[AGENT_TRACE_ENABLED_ENV]?.trim().toLowerCase() === "true";

const isVerboseTracingEnabled = () =>
  process.env[AGENT_TRACE_VERBOSE_ENV]?.trim().toLowerCase() === "true";

const getTraceProjectName = () =>
  process.env[AGENT_TRACE_PROJECT_ENV]?.trim() || DEFAULT_PROJECT_NAME;

const normalizeCollectorEndpoint = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
};

const normalizeFieldName = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");

const isSensitiveFieldName = (value: string) =>
  SENSITIVE_FIELD_NAMES.has(normalizeFieldName(value));

const sanitizeString = (value: string) => {
  let sanitized = value;

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE);
  }

  return sanitized.length > MAX_JSON_LENGTH
    ? `${sanitized.slice(0, MAX_JSON_LENGTH)}...[truncated]`
    : sanitized;
};

const sanitizeUnknown = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) {
    return "[MaxDepth]";
  }

  if (value === null || typeof value === "undefined") {
    return value ?? null;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => sanitizeUnknown(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = isSensitiveFieldName(key)
        ? REDACTED_VALUE
        : sanitizeUnknown(nestedValue, depth + 1);
    }
    return output;
  }

  return String(value);
};

const toJsonAttribute = (value: unknown) => {
  const json = JSON.stringify(sanitizeUnknown(value));
  if (!json) {
    return undefined;
  }
  return json.length > MAX_JSON_LENGTH
    ? `${json.slice(0, MAX_JSON_LENGTH)}...[truncated]`
    : json;
};

const toSummaryText = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const sanitized = sanitizeString(value).trim();
  if (!sanitized) {
    return undefined;
  }
  return sanitized.length > MAX_SUMMARY_TEXT_LENGTH
    ? `${sanitized.slice(0, MAX_SUMMARY_TEXT_LENGTH)}...[truncated]`
    : sanitized;
};

const summarizeState = (state: Partial<AgentGraphState>) => {
  const latestSummary = state.evidence?.latestSummary;

  return {
    runId: state.runId ?? null,
    threadId: state.threadId ?? null,
    iterationCount: state.iterationCount ?? 0,
    maxIterations: state.maxIterations ?? null,
    nextActionType: state.nextAction?.type ?? null,
    pendingToolId: state.pendingToolCall?.toolId ?? null,
    policyDecisionType: state.policyDecision?.type ?? null,
    pendingApprovalToolId: state.pendingApproval?.toolId ?? null,
    lastToolExecutionToolId: state.lastToolExecution?.toolId ?? null,
    latestEvidenceSource: latestSummary?.source ?? null,
    latestEvidenceToolId: latestSummary?.toolId ?? null,
    retrievedChunkCount: state.retrievedChunks?.length ?? 0,
    observationCount: state.observations?.length ?? 0,
    answerExists: Boolean(state.answer?.trim()),
    errorMessage: toSummaryText(state.errorMessage) ?? null,
    errorSourceNodeId: state.errorSourceNodeId ?? null,
    blockedReason: toSummaryText(state.blockedReason) ?? null,
  };
};

const summarizeGraphInput = (input: AgentGraphInput) => ({
  runId: input.runId,
  threadId: input.threadId,
  userId: input.userId,
  goalText: toSummaryText(input.goal.text) ?? "",
  messageCount: input.messages.length,
  requestContextCount: input.requestContextMessages?.length ?? 0,
  knowledgeBaseId: input.knowledgeBaseId ?? null,
  workspaceRoot: input.workspaceRoot ?? null,
  maxIterations: input.maxIterations ?? null,
  selectedToolId: input.selectedToolId ?? null,
  hasPendingToolCall: Boolean(input.pendingToolCall),
});

const summarizeGraphOutput = (output: AgentGraphOutput) => ({
  status: output.status,
  answerExists: Boolean(output.answer.trim()),
  pendingApprovalToolId: output.pendingApproval?.toolId ?? null,
  pendingToolId: output.pendingToolCall?.toolId ?? null,
  policyDecisionType: output.policyDecision?.type ?? null,
  selectedToolId: output.selectedToolId ?? null,
  blockedReason: toSummaryText(output.blockedReason) ?? null,
  terminalReason: output.terminalReason ?? null,
  errorMessage: toSummaryText(output.errorMessage) ?? null,
  errorSourceNodeId: output.errorSourceNodeId ?? null,
  retrievedChunkCount: output.retrievedChunks.length,
  observationCount: output.observations.length,
  latestEvidenceSource: output.evidence.latestSummary?.source ?? null,
  latestEvidenceToolId: output.evidence.latestSummary?.toolId ?? null,
});

const getVerboseStatePayload = (state: Partial<AgentGraphState>) => ({
  nextAction: state.nextAction,
  pendingToolCall: state.pendingToolCall,
  policyDecision: state.policyDecision,
  pendingApproval: state.pendingApproval,
  lastToolExecution: state.lastToolExecution,
  latestEvidenceSummary: state.evidence?.latestSummary,
  retrievedChunks: state.retrievedChunks?.map((chunk) => ({
    chunkId: chunk.chunkId,
    documentName: chunk.documentName,
    score: chunk.score ?? null,
    contentPreview: toSummaryText(chunk.content) ?? "",
  })),
  answerPreview: toSummaryText(state.answer),
});

const setPrimitiveAttributes = (
  span: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>,
  attributes: Record<string, PrimitiveAttribute | undefined>,
) => {
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "undefined") {
      continue;
    }
    if (value === null) {
      span.setAttribute(key, "null");
      continue;
    }
    span.setAttribute(key, value);
  }
};

const captureRecord = (record: AgentTraceRecord) => {
  testTraceSink?.(record);
};

const createSpanProcessors = (): SpanProcessor[] => {
  const exporters: SpanExporter[] = [];

  if (isTracingEnabled() && !testTraceSink) {
    exporters.push(
      new OTLPTraceExporter({
        url: normalizeCollectorEndpoint(
          process.env[PHOENIX_COLLECTOR_ENDPOINT_ENV]?.trim() ||
            DEFAULT_COLLECTOR_ENDPOINT,
        ),
      }),
    );
  }

  exporters.push(new NullSpanExporter());
  return [new SimpleSpanProcessor(new CompositeSpanExporter(exporters))];
};

const ensureTracingInitialized = () => {
  if (tracingInitialized) {
    return;
  }

  tracingEnabled = isTracingEnabled();
  if (!tracingEnabled) {
    tracingInitialized = true;
    return;
  }

  tracingProvider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "uichat-mira-agent",
      "service.namespace": "uichat-mira",
      "phoenix.project.name": getTraceProjectName(),
    }),
    spanProcessors: createSpanProcessors(),
  });
  tracingProvider.register();
  tracingInitialized = true;
};

const getTracer = () => {
  ensureTracingInitialized();
  return trace.getTracer("uichat-mira.agent");
};

export const runWithAgentNodeSpan = async <T>(input: {
  nodeName: string;
  state: AgentGraphState;
  run: () => Promise<T>;
  mergeResult?: (result: T) => Partial<AgentGraphState>;
}) => {
  if (!isTracingEnabled()) {
    return input.run();
  }

  const tracer = getTracer();
  return tracer.startActiveSpan(
    `agent.node.${input.nodeName}`,
    async (span) => {
      const startedAt = Date.now();
      const before = summarizeState(input.state);
      const verboseBefore = isVerboseTracingEnabled()
        ? getVerboseStatePayload(input.state)
        : undefined;

      setPrimitiveAttributes(span, {
        "agent.trace_project": getTraceProjectName(),
        "agent.run_id": before.runId,
        "agent.thread_id": before.threadId,
        "agent.node_name": input.nodeName,
        "agent.iteration_count": before.iterationCount,
        "agent.max_iterations": before.maxIterations,
        "agent.next_action_type": before.nextActionType,
        "agent.pending_tool_id": before.pendingToolId,
        "agent.policy_decision_type": before.policyDecisionType,
        "agent.pending_approval_tool_id": before.pendingApprovalToolId,
        "agent.last_tool_execution_tool_id": before.lastToolExecutionToolId,
        "agent.retrieved_chunk_count": before.retrievedChunkCount,
        "agent.observation_count": before.observationCount,
        "agent.answer_exists": before.answerExists,
        "agent.error_message": before.errorMessage,
        "agent.error_source_node_id": before.errorSourceNodeId,
        "agent.blocked_reason": before.blockedReason,
      });

      const beforeJson = toJsonAttribute(before);
      if (beforeJson) {
        span.setAttribute("agent.state.before.summary_json", beforeJson);
      }
      if (verboseBefore) {
        const verboseJson = toJsonAttribute(verboseBefore);
        if (verboseJson) {
          span.setAttribute("agent.state.before.verbose_json", verboseJson);
        }
      }

      try {
        const result = await input.run();
        const mergedState = input.mergeResult
          ? ({
              ...input.state,
              ...input.mergeResult(result),
            } as AgentGraphState)
          : input.state;
        const after = summarizeState(mergedState);
        const verboseAfter = isVerboseTracingEnabled()
          ? getVerboseStatePayload(mergedState)
          : undefined;
        const latencyMs = Date.now() - startedAt;

        setPrimitiveAttributes(span, {
          "agent.node_status": "ok",
          "agent.next_action_type_after": after.nextActionType,
          "agent.pending_tool_id_after": after.pendingToolId,
          "agent.policy_decision_type_after": after.policyDecisionType,
          "agent.pending_approval_tool_id_after": after.pendingApprovalToolId,
          "agent.last_tool_execution_tool_id_after":
            after.lastToolExecutionToolId,
          "agent.retrieved_chunk_count_after": after.retrievedChunkCount,
          "agent.observation_count_after": after.observationCount,
          "agent.answer_exists_after": after.answerExists,
          "agent.error_message_after": after.errorMessage,
          "agent.error_source_node_id_after": after.errorSourceNodeId,
          "agent.blocked_reason_after": after.blockedReason,
          "agent.latest_evidence_source_after": after.latestEvidenceSource,
          "agent.latest_evidence_tool_id_after": after.latestEvidenceToolId,
          "agent.latency_ms": latencyMs,
        });

        const afterJson = toJsonAttribute(after);
        if (afterJson) {
          span.setAttribute("agent.state.after.summary_json", afterJson);
        }
        if (verboseAfter) {
          const verboseJson = toJsonAttribute(verboseAfter);
          if (verboseJson) {
            span.setAttribute("agent.state.after.verbose_json", verboseJson);
          }
        }

        span.setStatus({ code: SpanStatusCode.OK });
        const recordAttributes = {
          "agent.node_name": input.nodeName,
          "agent.run_id": before.runId,
          "agent.thread_id": before.threadId,
          "agent.node_status": "ok",
          "agent.latency_ms": latencyMs,
          "agent.state.after.summary_json": afterJson ?? null,
          ...(verboseAfter
            ? {
                "agent.state.after.verbose_json":
                  toJsonAttribute(verboseAfter) ?? null,
              }
            : {}),
        } satisfies Record<string, PrimitiveAttribute>;
        captureRecord({
          name: `agent.node.${input.nodeName}`,
          attributes: recordAttributes,
        });
        return result;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        span.recordException(
          error instanceof Error ? error : new Error(errorMessage),
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: sanitizeString(errorMessage),
        });
        setPrimitiveAttributes(span, {
          "agent.node_status": "error",
          "agent.error_message_after": sanitizeString(errorMessage),
          "agent.latency_ms": latencyMs,
        });
        captureRecord({
          name: `agent.node.${input.nodeName}`,
          attributes: {
            "agent.node_name": input.nodeName,
            "agent.run_id": before.runId,
            "agent.thread_id": before.threadId,
            "agent.node_status": "error",
            "agent.error_message_after": sanitizeString(errorMessage),
            "agent.latency_ms": latencyMs,
          },
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
};

export const runWithAgentRunSpan = async <T>(input: {
  graphInput: AgentGraphInput;
  run: () => Promise<T>;
  summarizeResult?: (result: T) => AgentGraphOutput;
}) => {
  if (!isTracingEnabled()) {
    return input.run();
  }

  const tracer = getTracer();
  return tracer.startActiveSpan("agent.graph.run", async (span) => {
    const startedAt = Date.now();
    const summary = summarizeGraphInput(input.graphInput);
    const verboseInput = isVerboseTracingEnabled()
      ? {
          goal: input.graphInput.goal,
          params: input.graphInput.params,
          pendingToolCall: input.graphInput.pendingToolCall,
          approvedInvocations: input.graphInput.approvedInvocations,
        }
      : undefined;

    setPrimitiveAttributes(span, {
      "agent.trace_project": getTraceProjectName(),
      "agent.run_id": summary.runId,
      "agent.thread_id": summary.threadId,
      "agent.user_id": summary.userId,
      "agent.message_count": summary.messageCount,
      "agent.request_context_count": summary.requestContextCount,
      "agent.max_iterations": summary.maxIterations,
      "agent.knowledge_base_id": summary.knowledgeBaseId,
      "agent.workspace_root": summary.workspaceRoot,
      "agent.selected_tool_id": summary.selectedToolId,
      "agent.has_pending_tool_call": summary.hasPendingToolCall,
    });

    const inputJson = toJsonAttribute(summary);
    if (inputJson) {
      span.setAttribute("agent.run.input.summary_json", inputJson);
    }
    if (verboseInput) {
      const verboseJson = toJsonAttribute(verboseInput);
      if (verboseJson) {
        span.setAttribute("agent.run.input.verbose_json", verboseJson);
      }
    }

    try {
      const result = await input.run();
      const latencyMs = Date.now() - startedAt;
      const outputSummary = input.summarizeResult
        ? summarizeGraphOutput(input.summarizeResult(result))
        : undefined;

      setPrimitiveAttributes(span, {
        "agent.run_status": "ok",
        "agent.latency_ms": latencyMs,
        "agent.output_status": outputSummary?.status,
        "agent.output_answer_exists": outputSummary?.answerExists,
        "agent.output_pending_approval_tool_id":
          outputSummary?.pendingApprovalToolId,
        "agent.output_pending_tool_id": outputSummary?.pendingToolId,
        "agent.output_policy_decision_type": outputSummary?.policyDecisionType,
        "agent.output_blocked_reason": outputSummary?.blockedReason,
        "agent.output_terminal_reason": outputSummary?.terminalReason,
        "agent.output_error_message": outputSummary?.errorMessage,
        "agent.output_error_source_node_id": outputSummary?.errorSourceNodeId,
      });

      const outputJson = outputSummary
        ? toJsonAttribute(outputSummary)
        : undefined;
      if (outputJson) {
        span.setAttribute("agent.run.output.summary_json", outputJson);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      captureRecord({
        name: "agent.graph.run",
        attributes: {
          "agent.run_id": summary.runId,
          "agent.thread_id": summary.threadId,
          "agent.run_status": "ok",
          "agent.latency_ms": latencyMs,
          "agent.run.output.summary_json": outputJson ?? null,
        },
      });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      span.recordException(
        error instanceof Error ? error : new Error(errorMessage),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: sanitizeString(errorMessage),
      });
      setPrimitiveAttributes(span, {
        "agent.run_status": "error",
        "agent.error_message": sanitizeString(errorMessage),
        "agent.latency_ms": latencyMs,
      });
      captureRecord({
        name: "agent.graph.run",
        attributes: {
          "agent.run_id": summary.runId,
          "agent.thread_id": summary.threadId,
          "agent.run_status": "error",
          "agent.error_message": sanitizeString(errorMessage),
          "agent.latency_ms": latencyMs,
        },
      });
      throw error;
    } finally {
      span.end();
    }
  });
};

export const flushAgentTracing = async () => {
  await tracingProvider?.forceFlush();
};

export const shutdownAgentTracing = async () => {
  await tracingProvider?.shutdown();
  trace.disable();
  context.disable();
  tracingProvider = null;
  tracingInitialized = false;
  tracingEnabled = false;
};

export const __setAgentTraceSinkForTests = (
  sink: ((record: AgentTraceRecord) => void) | undefined,
) => {
  testTraceSink = sink;
};

export const __resetAgentTracingForTests = async () => {
  testTraceSink = undefined;
  await shutdownAgentTracing();
};

export const __sanitizeTraceValueForTests = sanitizeUnknown;
