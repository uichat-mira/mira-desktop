import type {
  ToolTrace,
  ToolTraceSpan,
  ToolTraceSpanKind,
} from "./definitions.js";
import { computerUseRepository } from "@/db/repositories/computer-use/repository.js";
import {
  DEFAULT_RETENTION_CONFIG,
  sweepRetentionMap,
  type RetentionConfig,
} from "@/utils/retention.js";

const traceMap = new Map<string, ToolTrace>();
let traceRetentionConfig: RetentionConfig = {
  ...DEFAULT_RETENTION_CONFIG,
};

const sweepTraces = () => {
  sweepRetentionMap(traceMap, {
    config: traceRetentionConfig,
    getUpdatedAt: (trace) => trace.finishedAt ?? trace.startedAt,
    keep: (trace) => !trace.finishedAt,
  });
};

const attachDebugView = (trace: ToolTrace): ToolTrace => {
  trace.debugView = {
    invocationId: trace.invocationId,
    toolId: trace.toolId,
    traceId: trace.traceId,
    spanCount: trace.spans.length,
    runningSpanCount: trace.spans.filter((span) => span.status === "running").length,
    kinds: [...new Set(trace.spans.map((span) => span.kind))],
  };

  return trace;
};

const persistIfComputerUse = (trace: ToolTrace) => {
  if (!trace.toolId.startsWith("browser_")) return;
  try { computerUseRepository.persistTrace(trace); } catch { /* optional before database startup */ }
};

export const createInvocationTrace = (input: {
  invocationId: string;
  toolId: string;
  startedAt: string;
}) => {
  sweepTraces();
  const trace: ToolTrace = {
    traceId: crypto.randomUUID(),
    invocationId: input.invocationId,
    toolId: input.toolId,
    startedAt: input.startedAt,
    spans: [],
  };
  traceMap.set(input.invocationId, trace);
  persistIfComputerUse(trace);
  return attachDebugView(trace);
};

export const getInvocationTrace = (invocationId: string) => {
  const trace = traceMap.get(invocationId);
  if (trace) return attachDebugView(trace);
  return computerUseRepository.getTrace(invocationId) ?? undefined;
};

export const clearInvocationTraces = () => {
  traceMap.clear();
};

export const configureInvocationTraceRetention = (
  config: Partial<RetentionConfig>,
) => {
  traceRetentionConfig = {
    ...traceRetentionConfig,
    ...config,
  };
};

export const sweepInvocationTraces = () => {
  sweepTraces();
};

export const finishInvocationTrace = (invocationId: string) => {
  const trace = traceMap.get(invocationId);
  if (!trace || trace.finishedAt) {
    return trace;
  }

  trace.finishedAt = new Date().toISOString();
  persistIfComputerUse(trace);
  sweepTraces();
  return attachDebugView(trace);
};

export const startTraceSpan = (input: {
  invocationId: string;
  parentSpanId?: string;
  name: string;
  kind: ToolTraceSpanKind;
  metadata?: Record<string, unknown>;
}) => {
  const trace = traceMap.get(input.invocationId);
  if (!trace) {
    throw new Error(`Trace not found for invocation ${input.invocationId}`);
  }

  const span: ToolTraceSpan = {
    id: crypto.randomUUID(),
    traceId: trace.traceId,
    invocationId: input.invocationId,
    ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
    name: input.name,
    kind: input.kind,
    status: "running",
    startedAt: new Date().toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  trace.spans.push(span);
  persistIfComputerUse(trace);
  attachDebugView(trace);

  return {
    spanId: span.id,
    end: (next?: {
      status?: "completed" | "failed" | "cancelled";
      metadata?: Record<string, unknown>;
    }) => {
      if (span.finishedAt) {
        return;
      }

      span.status = next?.status ?? "completed";
      span.finishedAt = new Date().toISOString();
      if (next?.metadata) {
        span.metadata = {
          ...(span.metadata ?? {}),
          ...next.metadata,
        };
      }
      attachDebugView(trace);
      persistIfComputerUse(trace);
    },
  };
};
