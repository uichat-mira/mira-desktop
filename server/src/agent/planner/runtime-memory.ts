import {
  getHarnessLlmContentText,
  type HarnessLlmContent,
} from "@/harness/llm-content";
import {
  isToolImagePayloadUnavailable,
  resolveToolExecutionImageParts,
} from "../harness-multimodal";
import type {
  AgentExecutionObservation,
  AgentToolExecutionResult,
} from "../types";
import type { AgentGraphState } from "../node-runtime";
import { getToolTraceTargetPreview } from "../trace";

const PLANNER_RECENT_EVIDENCE_CONTENT_CHAR_LIMIT = 36_000;
const PLANNER_SINGLE_EVIDENCE_CONTENT_CHAR_LIMIT = 12_000;
const PLANNER_RECENT_EVIDENCE_ITEM_LIMIT = 6;
const PLANNER_ACTION_LEDGER_CHAR_LIMIT = 24_000;
const PLANNER_LEDGER_FINDING_CHAR_LIMIT = 320;

type AgentToolExecutionWithLlmContent = AgentToolExecutionResult & {
  llmContent?: HarnessLlmContent;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const trimPlannerText = (value: string, limit: number) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const clipEvidenceText = (value: string, limit: number) =>
  value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - 48)).trimEnd()}\n...[canonical result clipped]`;

const getObservationTarget = (observation: AgentExecutionObservation) => {
  if (
    observation.actionType === "tool" &&
    observation.toolId &&
    isRecord(observation.argsPreview)
  ) {
    return getToolTraceTargetPreview(observation.toolId, observation.argsPreview);
  }

  if (
    observation.actionType === "retrieve" &&
    isRecord(observation.argsPreview) &&
    typeof observation.argsPreview.query === "string"
  ) {
    return trimPlannerText(observation.argsPreview.query, 160);
  }

  return undefined;
};

const getSemanticActionKey = (observation: AgentExecutionObservation) => {
  if (isRecord(observation.argsPreview)) {
    const path = observation.argsPreview.path;
    const query = observation.argsPreview.query;

    if (
      (observation.actionType === "retrieve" ||
        observation.toolId === "read_discover" ||
        observation.toolId === "read_locate" ||
        observation.toolId === "codebase_explore") &&
      typeof query === "string" &&
      query.trim()
    ) {
      return `${observation.actionType}:${observation.toolId ?? "retrieval"}:query:${query.trim()}`;
    }

    if (
      observation.actionType === "tool" &&
      observation.toolId?.startsWith("read_") &&
      typeof path === "string" &&
      path.trim()
    ) {
      return `${observation.actionType}:${observation.toolId}:path:${path.trim()}`;
    }
  }

  return [
    observation.actionType,
    observation.toolId ?? "",
    observation.inputHash ?? observation.id,
  ].join(":");
};

/**
 * Compact full-run working ledger rebuilt from accumulated Evidence every Planner turn.
 * It is intentionally separate from the recent execution window: repeated semantic
 * targets collapse into one entry, so long Pi loops remember prior work without replaying
 * every raw executor payload into the task-model context.
 */
export const buildPlannerAccumulatedActionLedger = (
  observations: AgentExecutionObservation[],
  charLimit = PLANNER_ACTION_LEDGER_CHAR_LIMIT,
) => {
  const byAction = new Map<
    string,
    {
      actionType: AgentExecutionObservation["actionType"];
      toolId?: string;
      target?: string;
      status: AgentExecutionObservation["status"];
      attempts: number;
      inputHashes: string[];
      latestActionTaken?: string;
      latestFindings?: string[];
      latestGaps?: string[];
    }
  >();

  for (const observation of observations) {
    const semanticKey = getSemanticActionKey(observation);
    const previous = byAction.get(semanticKey);
    const target = getObservationTarget(observation);
    const inputHashes = [
      ...(previous?.inputHashes ?? []),
      ...(observation.inputHash ? [observation.inputHash.slice(0, 16)] : []),
    ].filter((item, index, items) => item && items.indexOf(item) === index);
    const summary = observation.summary;

    byAction.set(semanticKey, {
      actionType: observation.actionType,
      ...(observation.toolId ? { toolId: observation.toolId } : {}),
      ...(target ? { target } : {}),
      status: observation.status,
      attempts: (previous?.attempts ?? 0) + 1,
      inputHashes,
      ...(summary?.actionTaken
        ? {
            latestActionTaken: trimPlannerText(
              summary.actionTaken,
              PLANNER_LEDGER_FINDING_CHAR_LIMIT,
            ),
          }
        : {}),
      ...(summary?.keyFindings?.length
        ? {
            latestFindings: summary.keyFindings
              .slice(0, 3)
              .map((finding) =>
                trimPlannerText(finding, PLANNER_LEDGER_FINDING_CHAR_LIMIT),
              ),
          }
        : {}),
      ...(summary?.gaps?.length
        ? {
            latestGaps: summary.gaps
              .slice(0, 3)
              .map((gap) => trimPlannerText(gap, PLANNER_LEDGER_FINDING_CHAR_LIMIT)),
          }
        : {}),
    });
  }

  const entries = [...byAction.values()];
  const base = {
    totalExecutionObservations: observations.length,
    uniqueSemanticActions: entries.length,
    repeatedSemanticActions: entries.filter((entry) => entry.attempts > 1).length,
  };
  const selectedEntries: typeof entries = [];
  let usedChars = JSON.stringify(base).length;

  for (const entry of entries) {
    const entrySize = JSON.stringify(entry).length;
    if (usedChars + entrySize > charLimit) {
      break;
    }
    selectedEntries.push(entry);
    usedChars += entrySize;
  }

  return {
    ...base,
    entries: selectedEntries,
    omittedUniqueActions: Math.max(0, entries.length - selectedEntries.length),
    instruction:
      "This ledger is rebuilt from the full accumulated Evidence, not the recent-history window. Reuse successful prior work and do not repeat the same semantic target unless a concrete unresolved gap requires a materially different action.",
  };
};

type CanonicalEvidenceItem = {
  createdAt: string;
  header: string;
  content: string;
};

export const buildPlannerRecentImageEvidenceParts = (
  state: AgentGraphState,
) =>
  (state.evidence?.toolExecutions ?? [])
    .filter((execution) => execution.status === "completed")
    .slice(-PLANNER_RECENT_EVIDENCE_ITEM_LIMIT)
    .flatMap((execution) => resolveToolExecutionImageParts(execution));

const collectRecentCanonicalEvidence = (state: AgentGraphState) => {
  const items: CanonicalEvidenceItem[] = [];

  for (const execution of state.evidence?.toolExecutions ?? []) {
    if (execution.status !== "completed") {
      continue;
    }
    const llmContent = (execution as AgentToolExecutionWithLlmContent).llmContent;
    const text = getHarnessLlmContentText(llmContent).trim();
    const imagePayloadUnavailable = isToolImagePayloadUnavailable(execution);
    if ((!llmContent || !text) && !imagePayloadUnavailable) {
      continue;
    }
    const content = [
      text,
      ...(imagePayloadUnavailable
        ? [
            "imagePayload=unavailable",
            "requiredNextAction=read the same image path again before relying on its visual contents",
          ]
        : []),
    ]
      .filter(Boolean)
      .join("\n");
    items.push({
      createdAt: execution.finishedAt || execution.startedAt,
      header: [
        `source=tool`,
        `toolId=${execution.toolId}`,
        `args=${JSON.stringify(execution.args)}`,
        ...(execution.inputHash ? [`inputHash=${execution.inputHash}`] : []),
      ].join("\n"),
      content: clipEvidenceText(content, PLANNER_SINGLE_EVIDENCE_CONTENT_CHAR_LIMIT),
    });
  }

  for (const retrieval of state.evidence?.retrievals ?? []) {
    const text = retrieval.chunks
      .map((chunk) =>
        [
          `document=${chunk.documentName}`,
          `chunkId=${chunk.chunkId}`,
          chunk.content,
        ].join("\n"),
      )
      .join("\n\n")
      .trim();
    if (!text) {
      continue;
    }
    items.push({
      createdAt: retrieval.createdAt,
      header: `source=retrieval\nquery=${retrieval.query}\nchunkCount=${retrieval.chunkCount}`,
      content: clipEvidenceText(text, PLANNER_SINGLE_EVIDENCE_CONTENT_CHAR_LIMIT),
    });
  }

  items.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return items.slice(-PLANNER_RECENT_EVIDENCE_ITEM_LIMIT);
};

/**
 * Exposes recent canonical LLM-safe executor payloads to Planner, not just the latest one.
 * Older work is represented by execution summaries + accumulatedActionLedger, mirroring a
 * Pi-style continuous context with bounded compaction instead of replaying an unbounded log.
 * Never rebuild arbitrary raw tool results here: only Harness llmContent and retrieval
 * chunks that already belong to Evidence may enter this model context.
 */
export const buildPlannerLatestEvidenceContent = (
  state: AgentGraphState,
  _latestObservation: AgentExecutionObservation | undefined,
) => {
  const items = collectRecentCanonicalEvidence(state);
  if (items.length === 0) {
    return undefined;
  }

  const selected: string[] = [];
  let usedChars = 0;
  let truncated = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    const section = [
      `CANONICAL RESULT ${index + 1}/${items.length}`,
      item.header,
      "result:",
      item.content,
    ].join("\n");
    if (usedChars + section.length > PLANNER_RECENT_EVIDENCE_CONTENT_CHAR_LIMIT) {
      truncated = true;
      break;
    }
    selected.unshift(section);
    usedChars += section.length + 2;
  }

  return {
    source: "continuous" as const,
    itemCount: selected.length,
    truncated,
    includedCharCount: usedChars,
    content: selected.join("\n\n"),
  };
};
