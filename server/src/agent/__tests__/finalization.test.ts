import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildPlannerEvidenceCatalog,
  materializeFinalizationEvidence,
  validateAndFreezeFinalizationPacket,
} from "../finalization";
import type {
  AgentEvidencePayload,
  AgentFinalizationPacket,
} from "../types";

const evidence: AgentEvidencePayload = {
  observations: [
    {
      id: "observation-0",
      runId: "run-finalization",
      stepId: "verify",
      status: "ok",
      facts: ["verification passed"],
      createdAt: "2026-07-22T00:00:00.000Z",
    },
  ],
  toolExecutions: [
    {
      toolId: "read_open",
      args: { path: "uncited.txt" },
      status: "completed",
      result: { type: "open", path: "uncited.txt", source: { text: "UNREFERENCED" } },
      startedAt: "2026-07-22T00:00:00.000Z",
      finishedAt: "2026-07-22T00:00:01.000Z",
    },
    {
      toolId: "read_open",
      args: { path: "cited.txt" },
      status: "completed",
      result: { type: "open", path: "cited.txt", source: { text: "REFERENCED" } },
      startedAt: "2026-07-22T00:00:02.000Z",
      finishedAt: "2026-07-22T00:00:03.000Z",
    },
  ],
  retrievals: [
    {
      query: "documentation",
      chunkCount: 1,
      chunks: [
        { chunkId: "chunk-0", documentName: "docs.md", content: "RETRIEVAL" },
      ],
      createdAt: "2026-07-22T00:00:04.000Z",
    },
  ],
};

test("Planner evidence catalog exposes stable typed references", () => {
  assert.deepEqual(
    buildPlannerEvidenceCatalog(evidence).map((item) => item.ref),
    ["tool:0", "tool:1", "retrieval:0", "observation:0"],
  );
});

test("Planner finalization rejects a missing Evidence reference", () => {
  const result = validateAndFreezeFinalizationPacket({
    action: {
      type: "answer",
      reason: "The task is complete.",
      completionProof: [
        { criterion: "read the target", evidenceRefs: ["tool:99"] },
      ],
      unresolvedGaps: [],
    },
    evidence,
  });

  assert.ok("error" in result);
  assert.match(result.error, /tool:99/);
});

test("Generate materializes only Evidence references frozen by Planner", () => {
  const packet: AgentFinalizationPacket = {
    type: "answer",
    reason: "The cited records cover the task.",
    completionProof: [
      {
        criterion: "read and verify the target",
        evidenceRefs: ["tool:1", "observation:0"],
      },
    ],
    unresolvedGaps: [],
  };

  const result = materializeFinalizationEvidence({ packet, evidence });
  const rendered = result.messages.map((message) => message.content).join("\n");

  assert.deepEqual(result.missingRefs, []);
  assert.match(rendered, /EVIDENCE REF tool:1/);
  assert.match(rendered, /cited\.txt/);
  assert.match(rendered, /EVIDENCE REF observation:0/);
  assert.doesNotMatch(rendered, /tool:0|uncited\.txt|UNREFERENCED/);
  assert.doesNotMatch(rendered, /retrieval:0|RETRIEVAL/);
});

test("Planner freezes the finalization packet before Generate receives it", () => {
  const result = validateAndFreezeFinalizationPacket({
    action: {
      type: "answer",
      reason: "The task is complete.",
      completionProof: [
        { criterion: "read the target", evidenceRefs: ["tool:1"] },
      ],
      unresolvedGaps: [],
    },
    evidence,
  });

  assert.ok("packet" in result);
  assert.equal(Object.isFrozen(result.packet), true);
  assert.equal(Object.isFrozen(result.packet.completionProof), true);
  assert.equal(Object.isFrozen(result.packet.completionProof[0]?.evidenceRefs), true);
});


test("Generate materializes only Planner-selected image Evidence", () => {
  const imageEvidence: AgentEvidencePayload = {
    observations: [],
    retrievals: [],
    toolExecutions: [
      {
        toolId: "read",
        args: { path: "uncited.png" },
        status: "completed",
        result: {
          type: "read",
          path: "uncited.png",
          mediaType: "image",
          mimeType: "image/png",
          sizeBytes: 3,
        },
        llmContent: {
          version: 1,
          source: "harness_result",
          blocks: [
            {
              type: "image",
              data: "T0xE",
              mimeType: "image/png",
              filename: "uncited.png",
            },
          ],
          truncated: false,
          originalCharCount: 0,
          includedCharCount: 0,
          omittedArrayItems: 0,
          omittedObjectKeys: 0,
        },
        startedAt: "2026-07-22T00:00:00.000Z",
        finishedAt: "2026-07-22T00:00:01.000Z",
      },
      {
        toolId: "read",
        args: { path: "cited.png" },
        status: "completed",
        result: {
          type: "read",
          path: "cited.png",
          mediaType: "image",
          mimeType: "image/png",
          sizeBytes: 3,
        },
        llmContent: {
          version: 1,
          source: "harness_result",
          blocks: [
            {
              type: "image",
              data: "TkVX",
              mimeType: "image/png",
              filename: "cited.png",
            },
          ],
          truncated: false,
          originalCharCount: 0,
          includedCharCount: 0,
          omittedArrayItems: 0,
          omittedObjectKeys: 0,
        },
        startedAt: "2026-07-22T00:00:02.000Z",
        finishedAt: "2026-07-22T00:00:03.000Z",
      },
    ],
  };

  const result = materializeFinalizationEvidence({
    packet: {
      type: "answer",
      reason: "The selected image is sufficient.",
      completionProof: [
        { criterion: "inspect selected image", evidenceRefs: ["tool:1"] },
      ],
      unresolvedGaps: [],
    },
    evidence: imageEvidence,
  });

  assert.deepEqual(result.imageParts, [
    {
      type: "image",
      image: "data:image/png;base64,TkVX",
      filename: "cited.png",
      mediaType: "image/png",
    },
  ]);
  assert.equal(
    result.imageParts.some((part) => part.image.includes("T0xE")),
    false,
  );
});
