// #223 Recorder — deterministic test fixtures.
//
// These build minimal but faithful #221-shaped bundles in a temp workspace so
// schema / derivation / sanitization / gap tests never depend on the gitignored
// `.test-artifact/` dry-run output. Shapes are copied from real #221 bundles
// (agent-tool-N, planner done nodes, subagent-trace tool events, approval nodes).

export const plannerDoneEvent = ({ iteration, actionType, toolId, exposedToolIds = [], raw }) => ({
  nodeId: "agent-next-action-planner",
  nodeType: "plan",
  phase: "done",
  emittedAt: `2026-10-02T00:00:0${iteration}.000Z`,
  details: {
    iteration,
    selectedActionType: actionType,
    selectedToolId: toolId ?? null,
    exposedToolIds,
    exposedToolCount: exposedToolIds.length,
    repeatedSemanticActionCount: 0,
    rawOutputPreview: raw ? JSON.stringify(raw) : undefined,
  },
});

export const parentToolDoneEvent = ({ index, toolId, status = "completed" }) => ({
  nodeId: `agent-tool-${index}`,
  nodeType: "tool",
  phase: "done",
  emittedAt: `2026-10-02T00:01:0${index}.000Z`,
  details: { toolId, status, inputHash: `hash-${index}`, toolCallId: `call-${index}`, durationMs: 5 },
});

export const childToolCompletedEvent = ({ seq, toolId, inputHash = null }) => ({
  nodeId: `subagent-trace:child-run:${seq}`,
  nodeType: "tool",
  phase: "done",
  emittedAt: `2026-10-02T00:02:0${seq % 10}.000Z`,
  details: {
    subAgentRunId: "child-run",
    subAgentEventType: "tool.completed",
    traceDetails: { toolId, toolCallId: `child-call-${seq}`, inputHash, artifactCount: 1 },
  },
});

export const approvalStartEvent = ({ nodeId = "agent-approval", toolId, resumed = false }) => ({
  nodeId,
  nodeType: "approval",
  phase: "start",
  emittedAt: "2026-10-02T00:03:00.000Z",
  details: { toolId, toolCallId: `call-${toolId}`, inputHash: `hash-${toolId}`, resumedFromApproval: resumed },
});

export const evaluateDoneEvent = ({ hasRequiredFinalization = true, plannerTerminalType = "answer" }) => ({
  nodeId: "agent-evaluate",
  nodeType: "evaluate",
  phase: "done",
  emittedAt: "2026-10-02T00:04:00.000Z",
  details: { hasRequiredFinalization, plannerTerminalType, blockedReason: null },
});

export const executorFacts = (overrides = {}) => ({
  runner: "agent-core-runner/0.1",
  issue: 221,
  caseSetVersion: "core-v0.1-rc1",
  caseId: "beginner-02-locate-release-checklist",
  difficulty: "beginner",
  repetition: 1,
  executionMode: "adapted",
  classificationRationale: "test",
  comparabilityImpact: "none: test",
  hostPlatform: { platform: "darwin", arch: "x64", node: "v22.0.0" },
  actualProcedure: { transport: "http", provider: "default" },
  executorInterventions: [],
  approval: { count: 0, resumeCount: 0, events: [] },
  failureRetry: { toolFailures: [], toolFailureCount: 0, repeatedSemanticActionCount: 0 },
  subagent: { starts: [], startCount: 0 },
  toolExecutions: [],
  plannerIterations: 1,
  terminal: { status: "completed", terminalReason: "completed", blockedReason: null, selectedToolId: null },
  streamFinishReason: "stop",
  finalization: { hasRequiredFinalization: true, plannerTerminalType: "answer", finalizationEvidenceRefs: ["tool:0"] },
  elapsed: { startedAt: "2026-10-02T00:00:00.000Z", endedAt: "2026-10-02T00:00:10.000Z", elapsedMs: 10000, clock: "monotonic" },
  timing: {
    calibrationMode: true,
    tSoftMs: null,
    tHardMs: null,
    timingStatus: "pending_canonical_windows_calibration",
    softTimeoutSeen: false,
    hardCutoffApplied: false,
    cancelRequested: false,
    runnerSafetyCapReached: false,
  },
  workspace: { fixtureId: "beginner-workspace-v0.1", beforeManifestHash: "a", afterManifestHash: "a", diff: { added: [], removed: [], modified: [], changed: false }, externalTargets: [] },
  notes: [],
  observability: { signals: [], gaps: [] },
  observerGaps: [],
  ...overrides,
});

export const makeBundle = ({ events, facts = {}, agentRun = {}, workspace = {} }) => ({
  repDir: "<test>",
  executorFacts: executorFacts(facts),
  executionEvents: events,
  streamFrames: [],
  agentRun: { status: "completed", terminalReason: "completed", ...agentRun },
  workspace: { before: {}, after: {}, diff: null, ...workspace },
  assistantTranscript: "final answer",
  provenance: {},
});
