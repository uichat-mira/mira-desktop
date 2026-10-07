import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
} from "../../harness/invocations.js";
import {
  clearHarnessRegistry,
  registerTool,
} from "../../harness/registry.js";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { readTool } from "../../mcp/tools/read.tool.js";
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

test("Generate materializes selected raster read evidence through Mira's image message contract", async () => {
  const workspaceRoot = createTimestampedTestArtifactPath(
    "workspace",
    "finalization-image-evidence",
  );
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlE7h8AAAAASUVORK5CYII=",
      "base64",
    ),
  );

  clearHarnessRegistry();
  clearHarnessInvocations();
  registerTool(readTool);

  try {
    const invocation = await executeHarnessInvocation({
      toolId: "read",
      args: { path: "pixel.png" },
      environment: createHarnessEnvironmentSnapshot({
        workspace: {
          rootPath: workspaceRoot,
          source: "configured",
        },
      }),
    });

    assert.equal(invocation.status, "completed");
    assert.doesNotMatch(JSON.stringify(invocation.result), /base64|iVBORw0KGgo/);

    const imageEvidence: AgentEvidencePayload = {
      observations: [],
      retrievals: [],
      toolExecutions: [
        {
          toolId: "read",
          args: { path: "pixel.png" },
          invocationId: invocation.id,
          status: "completed",
          result: invocation.result,
          startedAt: "2026-10-06T00:00:00.000Z",
          finishedAt: "2026-10-06T00:00:01.000Z",
        },
      ],
    };
    const packet: AgentFinalizationPacket = {
      type: "answer",
      reason: "The image evidence covers the task.",
      completionProof: [
        {
          criterion: "inspect the image",
          evidenceRefs: ["tool:0"],
        },
      ],
      unresolvedGaps: [],
    };

    const result = materializeFinalizationEvidence({
      packet,
      evidence: imageEvidence,
    });

    assert.deepEqual(result.missingRefs, []);
    assert.equal(result.imageParts.length, 1);
    assert.equal(result.imageParts[0]?.type, "image");
    assert.equal(result.imageParts[0]?.filename, "pixel.png");
    assert.equal(result.imageParts[0]?.mediaType, "image/png");
    assert.match(
      result.imageParts[0]?.image ?? "",
      /^data:image\/png;base64,/,
    );
  } finally {
    clearHarnessInvocations();
    clearHarnessRegistry();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
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

