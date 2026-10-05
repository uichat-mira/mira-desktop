import {
  getHarnessLlmContentText,
  projectHarnessResultForLlm,
  type HarnessLlmContent,
} from "@/harness/llm-content";
import { getHarnessInvocation } from "@/harness/invocations";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import {
  projectHarnessImagesToMessageParts,
  type NormalizedImageMessagePart,
} from "./harness-multimodal";
import type {
  AgentEvidencePayload,
  AgentEvidenceReference,
  AgentFinalizationPacket,
  AgentNextAction,
  AgentToolExecutionResult,
  PlannerObservationContext,
} from "./types";

type ToolExecutionWithLlmContent = AgentToolExecutionResult & {
  llmContent?: HarnessLlmContent;
};

const parseEvidenceReference = (ref: string) => {
  const match = /^(tool|retrieval|observation):(\d+)$/.exec(ref);
  if (!match) {
    return null;
  }
  return {
    source: match[1] as "tool" | "retrieval" | "observation",
    index: Number(match[2]),
  };
};

export const buildPlannerEvidenceCatalog = (
  evidence: AgentEvidencePayload,
): PlannerObservationContext["evidenceCatalog"] => [
  ...evidence.toolExecutions.map((execution, index) => ({
    ref: `tool:${index}` as const,
    source: "tool" as const,
    status: execution.status,
    label: execution.summary?.actionTaken ?? `${execution.toolId} ${execution.status}`,
  })),
  ...evidence.retrievals.map((retrieval, index) => ({
    ref: `retrieval:${index}` as const,
    source: "retrieval" as const,
    status: retrieval.chunkCount > 0 ? "completed" : "partial",
    label:
      retrieval.summary?.actionTaken ??
      `retrieval query=${retrieval.query} chunks=${retrieval.chunkCount}`,
  })),
  ...evidence.observations.map((observation, index) => ({
    ref: `observation:${index}` as const,
    source: "observation" as const,
    status: observation.status,
    label:
      observation.summary?.actionTaken ??
      `${observation.stepId}: ${observation.facts.join("; ")}`,
  })),
];

const evidenceReferenceExists = (
  evidence: AgentEvidencePayload,
  ref: AgentEvidenceReference,
) => {
  const parsed = parseEvidenceReference(ref);
  if (!parsed) {
    return false;
  }
  switch (parsed.source) {
    case "tool":
      return Boolean(evidence.toolExecutions[parsed.index]);
    case "retrieval":
      return Boolean(evidence.retrievals[parsed.index]);
    case "observation":
      return Boolean(evidence.observations[parsed.index]);
  }
};

const freezeFinalizationPacket = (
  action: Extract<AgentNextAction, { type: "answer" }>,
): AgentFinalizationPacket =>
  Object.freeze({
    type: "answer" as const,
    reason: action.reason,
    completionProof: Object.freeze(
      action.completionProof.map((proof) =>
        Object.freeze({
          criterion: proof.criterion,
          evidenceRefs: Object.freeze([...proof.evidenceRefs]),
        }),
      ),
    ) as unknown as AgentFinalizationPacket["completionProof"],
    unresolvedGaps: Object.freeze([
      ...action.unresolvedGaps,
    ]) as unknown as string[],
  });

export const validateAndFreezeFinalizationPacket = (input: {
  action: Extract<AgentNextAction, { type: "answer" }>;
  evidence: AgentEvidencePayload;
}) => {
  if (!input.action.reason.trim()) {
    return { error: "Planner answer finalization reason must not be empty." } as const;
  }
  if (input.action.completionProof.length === 0) {
    return {
      error: "Planner answer must include at least one completionProof item.",
    } as const;
  }
  if (input.action.unresolvedGaps.length > 0) {
    return {
      error: "Planner answer cannot contain unresolvedGaps.",
    } as const;
  }

  for (const proof of input.action.completionProof) {
    if (!proof.criterion.trim()) {
      return {
        error: "Planner completionProof criterion must not be empty.",
      } as const;
    }
    for (const ref of proof.evidenceRefs) {
      if (!evidenceReferenceExists(input.evidence, ref)) {
        return {
          error: `Planner completionProof references missing Evidence: ${ref}`,
        } as const;
      }
    }
  }

  return { packet: freezeFinalizationPacket(input.action) } as const;
};

const toSystemMessage = (content: string): NormalizedChatMessage => ({
  role: "system",
  content,
  parts: [{ type: "text", text: content }],
});

const stringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "[unserializable]";
  }
};

const renderToolEvidence = (
  ref: AgentEvidenceReference,
  execution: AgentToolExecutionResult,
) => {
  const enriched = execution as ToolExecutionWithLlmContent;
  const llmContent =
    enriched.llmContent ?? projectHarnessResultForLlm(execution.result);
  return [
    `EVIDENCE REF ${ref}`,
    "source=tool",
    `toolId=${execution.toolId}`,
    `status=${execution.status}`,
    `args=${stringify(execution.args)}`,
    execution.errorMessage ? `error=${execution.errorMessage}` : "",
    execution.summary ? `summary=${stringify(execution.summary)}` : "",
    llmContent ? `result:\n${getHarnessLlmContentText(llmContent)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const materializeFinalizationEvidence = (input: {
  packet: AgentFinalizationPacket;
  evidence: AgentEvidencePayload;
}) => {
  const orderedRefs = [
    ...new Set(input.packet.completionProof.flatMap((proof) => proof.evidenceRefs)),
  ];
  const messages: NormalizedChatMessage[] = [];
  const imageParts: NormalizedImageMessagePart[] = [];
  const missingRefs: AgentEvidenceReference[] = [];

  for (const ref of orderedRefs) {
    const parsed = parseEvidenceReference(ref);
    if (!parsed) {
      missingRefs.push(ref);
      continue;
    }

    if (parsed.source === "tool") {
      const execution = input.evidence.toolExecutions[parsed.index];
      if (!execution) {
        missingRefs.push(ref);
        continue;
      }
      messages.push(toSystemMessage(renderToolEvidence(ref, execution)));
      imageParts.push(
        ...projectHarnessImagesToMessageParts(
          execution.invocationId
            ? getHarnessInvocation(execution.invocationId)?.llmContent
            : (execution as ToolExecutionWithLlmContent).llmContent,
        ),
      );
      continue;
    }

    if (parsed.source === "retrieval") {
      const retrieval = input.evidence.retrievals[parsed.index];
      if (!retrieval) {
        missingRefs.push(ref);
        continue;
      }
      messages.push(
        toSystemMessage(
          [
            `EVIDENCE REF ${ref}`,
            "source=retrieval",
            `query=${retrieval.query}`,
            `chunkCount=${retrieval.chunkCount}`,
            ...retrieval.chunks.map(
              (chunk) =>
                `document=${chunk.documentName}\nchunkId=${chunk.chunkId}\n${chunk.content}`,
            ),
          ].join("\n\n"),
        ),
      );
      continue;
    }

    const observation = input.evidence.observations[parsed.index];
    if (!observation) {
      missingRefs.push(ref);
      continue;
    }
    messages.push(
      toSystemMessage(
        [
          `EVIDENCE REF ${ref}`,
          "source=observation",
          `stepId=${observation.stepId}`,
          `status=${observation.status}`,
          `facts=${stringify(observation.facts)}`,
          observation.errorMessage ? `error=${observation.errorMessage}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }

  return { messages, imageParts, missingRefs };
};
