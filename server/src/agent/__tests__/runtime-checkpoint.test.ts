import assert from "node:assert/strict";
import { expect, test } from "vitest";
import {
  applyAgentRuntimeCheckpoint,
  getAgentRuntimeCheckpoint,
  persistAgentRuntimeCheckpoint,
} from "../runtime-checkpoint";
import {
  buildCapabilityResolutionDocuments,
  resolveCapabilityCascade,
} from "@/harness/candidates-core/capability-resolution";
import { resolveHarnessCapabilityProfiles } from "@/harness/profiles";
import {
  createCapabilityToolIdResolver,
  createProgressiveResolutionState,
  readCapabilityDisclosure,
  recordProgressiveResolutionSearch,
  recordProgressiveResolutionSelection,
  reconcileProgressiveResolutionState,
  resolveAndDiscloseCapability,
} from "@/harness/progressive-resolution-state";
import { createAgentGoal } from "../nodes/goal-plan";
import type {
  AgentGraphInput,
  AgentGraphOutput,
  AgentRun,
} from "../types";

const goalText = "Read two files, compare them, edit one file, and verify.";

const runtimeInput: NonNullable<AgentRun["runtimeInput"]> = {
  messages: [
    {
      role: "user",
      content: goalText,
      parts: [{ type: "text", text: goalText }],
    },
  ],
  requestContextMessages: [],
  params: { temperature: 0 },
  knowledgeBaseId: null,
  workspaceRoot: "D:/workspace/mira",
};

const graphInput: AgentGraphInput = {
  runId: "run-checkpoint",
  threadId: "thread-checkpoint",
  userId: 1,
  goal: createAgentGoal(goalText),
  messages: runtimeInput.messages,
  requestContextMessages: runtimeInput.requestContextMessages,
  params: runtimeInput.params,
  knowledgeBaseId: runtimeInput.knowledgeBaseId,
  workspaceRoot: runtimeInput.workspaceRoot,
  approvedInvocations: [],
  pendingToolCall: {
    id: "pending-edit",
    toolId: "edit",
    args: {
      path: "README.md",
      edits: [{ oldText: "npm install", newText: "pnpm install" }],
    },
    inputHash: "hash-edit",
    source: "planner",
    status: "frozen",
    createdAt: "2026-07-18T00:00:00.000Z",
  },
};

const output = {
  answer: "",
  observations: [
    {
      id: "observation-readme",
      runId: "run-checkpoint",
      stepId: "tool",
      status: "ok",
      facts: ["README.md was opened."],
      createdAt: "2026-07-18T00:00:01.000Z",
    },
  ],
  evidence: {
    observations: [],
    retrievals: [],
    toolExecutions: [
      {
        toolCallId: "read-readme",
        toolId: "read_open",
        args: { path: "README.md" },
        inputHash: "hash-readme",
        status: "completed",
        result: { text: "npm install" },
        summary: {
          source: "tool",
          status: "completed",
          toolId: "read_open",
          actionTaken: "Opened README.md.",
          keyFindings: ["install=npm install"],
        },
        startedAt: "2026-07-18T00:00:00.000Z",
        finishedAt: "2026-07-18T00:00:01.000Z",
      },
    ],
  },
  retrievedChunks: [],
  currentTaskFrame: {
    currentGoal: goalText,
    currentSubtask: "Edit README.md.",
    confirmedObjects: [],
    completionCriteria: [goalText],
    coveredProgress: ["Opened README.md.", "Opened package.json."],
    remainingWork: ["Edit README.md.", "Verify the result."],
  },
  lastToolExecution: {
    toolCallId: "read-package",
    toolId: "read_open",
    args: { path: "package.json" },
    inputHash: "hash-package",
    status: "completed",
    result: { text: "pnpm" },
    startedAt: "2026-07-18T00:00:02.000Z",
    finishedAt: "2026-07-18T00:00:03.000Z",
  },
  pendingApproval: {
    id: "approval-edit",
    runId: "run-checkpoint",
    stepId: "approval",
    toolId: "edit",
    toolCallId: "pending-edit",
    reason: "Workspace write requires approval.",
    input: {
      path: "README.md",
      edits: [{ oldText: "npm install", newText: "pnpm install" }],
    },
    inputHash: "hash-edit",
    createdAt: "2026-07-18T00:00:04.000Z",
  },
  pendingToolCall: graphInput.pendingToolCall,
  approvedInvocations: [],
  blockedReason: "waiting approval",
  terminalReason: "waiting_approval",
  status: "waiting_approval",
  iterationCount: 2,
} satisfies AgentGraphOutput & { iterationCount: number };

test("runtime checkpoint survives persistence and restores planner state", () => {
  const persistedRuntimeInput = persistAgentRuntimeCheckpoint(
    runtimeInput,
    output,
  );
  const checkpoint = getAgentRuntimeCheckpoint(persistedRuntimeInput);
  const restoredInput = applyAgentRuntimeCheckpoint(graphInput, checkpoint);

  assert.equal(checkpoint?.iterationCount, 2);
  assert.equal(checkpoint?.evidence?.toolExecutions.length, 1);
  assert.deepEqual(checkpoint?.currentTaskFrame?.coveredProgress, [
    "Opened README.md.",
    "Opened package.json.",
  ]);
  assert.equal(restoredInput.iterationCount, 2);
  assert.equal(restoredInput.evidence?.toolExecutions[0]?.toolId, "read_open");
  assert.equal(
    restoredInput.currentTaskFrame?.remainingWork?.includes("Verify the result."),
    true,
  );
  assert.equal(restoredInput.pendingToolCall?.toolId, "edit");
});

test("progressive resolution state survives an approval checkpoint and resume", () => {
  const progressiveResolution = resolveAndDiscloseCapability(
    createProgressiveResolutionState(),
    { capabilityId: "read", target: "schema" },
  ).state;

  const waitingOutput = {
    ...output,
    progressiveResolution,
  } satisfies AgentGraphOutput;

  const persistedRuntimeInput = persistAgentRuntimeCheckpoint(
    runtimeInput,
    waitingOutput,
  );
  const checkpoint = getAgentRuntimeCheckpoint(persistedRuntimeInput);
  const restoredInput = applyAgentRuntimeCheckpoint(graphInput, checkpoint);

  expect(checkpoint?.progressiveResolution?.disclosure).toEqual({
    read: "schema",
  });
  expect(checkpoint?.progressiveResolution?.budget).toEqual({
    limit: 8,
    consumed: 1,
  });
  expect(restoredInput.progressiveResolution?.disclosure).toEqual({
    read: "schema",
  });
  expect(restoredInput.progressiveResolution?.budget.consumed).toBe(1);

  // Resuming the same capability does not re-spend budget; it is idempotent.
  const resumed = resolveAndDiscloseCapability(
    restoredInput.progressiveResolution!,
    { capabilityId: "read", target: "schema" },
  ).state;
  expect(resumed.budget.consumed).toBe(1);
});

const makeDefinition = (
  id: string,
  domain: "read" | "web_search" | "edit" | "terminal",
) => ({
  id,
  title: id,
  description: id,
  domain,
  source: "internal" as const,
  mode: "sync" as const,
  inputSchema: { type: "object", properties: {} },
  tags: [domain],
  capabilities: { sideEffect: "none" as const, requiresApproval: false },
});

test("real resolver disclosure survives checkpoint/resume and yields to revocation and readiness loss", async () => {
  const definitions = [
    makeDefinition("glob", "read"),
    makeDefinition("grep", "read"),
    makeDefinition("list", "read"),
    makeDefinition("read", "read"),
    makeDefinition("web_search", "web_search"),
    makeDefinition("web_fetch", "web_search"),
  ];

  // Real capability-profile resolution: the deterministic structural cascade
  // selects the grouped `workspace_lookup` capability from the tool surface.
  const profiles = resolveHarnessCapabilityProfiles(definitions);
  const resolution = await resolveCapabilityCascade({
    query: "search the workspace files for a pattern",
    capabilities: buildCapabilityResolutionDocuments(profiles),
  });
  expect(resolution.selectedCapabilityId).toBe("workspace_lookup");
  expect(resolution.path).toBe("structural");

  // The Profile -> supportingToolIds mapping the production node reuses.
  const resolveToolIds = createCapabilityToolIdResolver(profiles);
  expect([...resolveToolIds("workspace_lookup")]).toEqual([
    "glob",
    "grep",
    "list",
    "read",
  ]);

  let progressiveResolution = createProgressiveResolutionState();
  progressiveResolution = recordProgressiveResolutionSearch(progressiveResolution, {
    path: resolution.path,
  });
  for (const candidate of resolution.candidates) {
    progressiveResolution = recordProgressiveResolutionSelection(
      progressiveResolution,
      { capabilityId: candidate.capabilityId },
    );
  }
  // Canonical Tool-id storage: expand the resolved capability to its concrete
  // Tools, which is what the production prepare-context node now does.
  for (const toolId of resolveToolIds("workspace_lookup")) {
    progressiveResolution = resolveAndDiscloseCapability(progressiveResolution, {
      capabilityId: toolId,
      target: "schema",
    }).state;
  }
  expect(progressiveResolution.budget).toEqual({ limit: 8, consumed: 4 });

  const waitingOutput = {
    ...output,
    progressiveResolution,
  } satisfies AgentGraphOutput;
  const persistedRuntimeInput = persistAgentRuntimeCheckpoint(
    runtimeInput,
    waitingOutput,
  );
  const checkpoint = getAgentRuntimeCheckpoint(persistedRuntimeInput);
  expect(checkpoint?.progressiveResolution?.disclosure).toEqual({
    glob: "schema",
    grep: "schema",
    list: "schema",
    read: "schema",
  });
  const restoredInput = applyAgentRuntimeCheckpoint(graphInput, checkpoint);
  const restored = restoredInput.progressiveResolution!;

  const allEligible = definitions.map((definition) => definition.id);

  // A still-authoritative grouped capability keeps legitimate disclosure and the
  // already-spent budget across ordinary resume.
  const intact = reconcileProgressiveResolutionState({
    state: restored,
    definitions,
    eligibleCapabilityIds: allEligible,
    resolveToolIds,
  });
  expect(intact.disclosure).toEqual({
    glob: "schema",
    grep: "schema",
    list: "schema",
    read: "schema",
  });
  expect(intact.budget).toEqual({ limit: 8, consumed: 4 });

  // Registry revocation wins over stale persisted visibility for the revoked Tool.
  const revoked = reconcileProgressiveResolutionState({
    state: restored,
    definitions: definitions.filter((definition) => definition.id !== "read"),
    eligibleCapabilityIds: allEligible,
    resolveToolIds,
  });
  expect(readCapabilityDisclosure(revoked, "read")).toBe("hidden");
  expect(readCapabilityDisclosure(revoked, "glob")).toBe("schema");
  expect(revoked.budget.consumed).toBe(4);

  // Authority revocation (falling outside the eligibility envelope) is equivalent.
  const deauthorized = reconcileProgressiveResolutionState({
    state: restored,
    definitions,
    eligibleCapabilityIds: allEligible.filter((toolId) => toolId !== "read"),
    resolveToolIds,
  });
  expect(readCapabilityDisclosure(deauthorized, "read")).toBe("hidden");
  expect(readCapabilityDisclosure(deauthorized, "grep")).toBe("schema");

  // Readiness loss for the whole capability group drops the stale disclosure.
  const unready = reconcileProgressiveResolutionState({
    state: restored,
    definitions,
    readiness: () => ({ state: "unavailable", reason: "runtime missing" }),
    resolveToolIds,
  });
  expect(unready.disclosure).toEqual({});
  expect(unready.budget.consumed).toBe(4);

  // A capability-profile-keyed snapshot is no longer cleared merely because its
  // key is a profile id: reconcile resolves it through the same mapping.
  const profileKeyed = resolveAndDiscloseCapability(
    createProgressiveResolutionState(),
    { capabilityId: "workspace_lookup", target: "schema" },
  ).state;
  const profileIntact = reconcileProgressiveResolutionState({
    state: profileKeyed,
    definitions,
    eligibleCapabilityIds: allEligible,
    resolveToolIds,
  });
  expect(readCapabilityDisclosure(profileIntact, "workspace_lookup")).toBe(
    "schema",
  );
  const profileRevoked = reconcileProgressiveResolutionState({
    state: profileKeyed,
    definitions: [],
    resolveToolIds,
  });
  expect(readCapabilityDisclosure(profileRevoked, "workspace_lookup")).toBe(
    "hidden",
  );
  expect(profileRevoked.budget.consumed).toBe(1);
});

test("runtime checkpoint is cleared after the run leaves approval state", () => {
  const withCheckpoint = persistAgentRuntimeCheckpoint(runtimeInput, output);
  const completedOutput: AgentGraphOutput = {
    ...output,
    answer: "README.md was fixed and verified.",
    pendingApproval: undefined,
    pendingToolCall: undefined,
    blockedReason: undefined,
    terminalReason: "completed",
    status: "completed",
  };

  const clearedRuntimeInput = persistAgentRuntimeCheckpoint(
    withCheckpoint,
    completedOutput,
  );

  assert.equal(getAgentRuntimeCheckpoint(clearedRuntimeInput), undefined);
  assert.equal(clearedRuntimeInput.messages, runtimeInput.messages);
  assert.equal(clearedRuntimeInput.workspaceRoot, runtimeInput.workspaceRoot);
});
