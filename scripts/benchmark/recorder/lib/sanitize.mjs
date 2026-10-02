// #223 Recorder — stage 4b: sanitized public projection.
//
// The canonical/internal artifacts may contain raw trajectory content, fixture
// absolute paths, host identity and executor notes. The public projection must
// NOT. This module produces a strictly allow-listed, machine-readable projection
// and asserts that no secret-shaped value survives.
//
// This is NOT the #131 website implementation. It only defines a stable,
// sanitized machine-readable result schema + a validator the report can rely on.

const SECRET_PATTERNS = [
  { name: "authorization_header", re: /\bauthorization\b\s*[:=]\s*\S+/i },
  { name: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._-]{12,}/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: "api_key_assignment", re: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/i },
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "openai_style_key", re: /\bsk-[A-Za-z0-9]{16,}/ },
];

export const findSecrets = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const hits = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) hits.push(name);
  }
  return hits;
};

/**
 * Build a sanitized public projection for one deterministic result.
 * Only allow-listed fields are copied; free-form notes, raw paths and host
 * identity are dropped.
 */
export const toPublicResult = ({ deterministic, identity }) => ({
  schemaVersion: "mira-agent-core-benchmark-public-result/0.1",
  benchmarkVersion: identity?.benchmarkVersion ?? null,
  caseSetVersion: identity?.caseSetVersion ?? null,
  caseId: identity?.caseId ?? null,
  repetition: identity?.repetition ?? null,
  executionMode: identity?.executionMode ?? null,
  comparable: identity?.comparable ?? null,
  terminalStatus: deterministic?.terminal?.status ?? null,
  plannerIterations: deterministic?.plannerIterations ?? null,
  toolCallCount: deterministic?.toolCallCount ?? null,
  parentToolCallCount: deterministic?.parentToolCallCount ?? null,
  childToolCallCount: deterministic?.childToolCallCount ?? null,
  delegationCount: deterministic?.delegationCount ?? null,
  approvalCount: deterministic?.approvalCount ?? null,
  resumeCount: deterministic?.resumeCount ?? null,
  repeatedSemanticActionCount: deterministic?.repeatedSemanticActionCount ?? null,
  elapsedMs: deterministic?.timing?.elapsedMs ?? null,
  timingState: deterministic?.timing?.state ?? null,
  workspaceChanged: deterministic?.sideEffects?.workspaceChanged ?? null,
  observabilityGapCount: Array.isArray(deterministic?.observabilityGaps)
    ? deterministic.observabilityGaps.length
    : 0,
  // Judge-owned fields stay null in the public projection too.
  semanticScore: null,
  semanticOutcome: null,
  hardFail: null,
});

/**
 * Assert a public projection leaks nothing secret-shaped.
 * Returns `{ ok, leaks }`; the caller must fail the projection if not ok.
 */
export const assertNoSecrets = (projection) => {
  const leaks = findSecrets(projection);
  return { ok: leaks.length === 0, leaks };
};
