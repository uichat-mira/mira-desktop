# Mira Agent Core Benchmark — Recorder / report package (#223)

This directory contains the **Recorder** for the Mira Agent Core Benchmark v0.1
contract ([`docs/development/agent-core-benchmark-v0.1.md`](../../../docs/development/agent-core-benchmark-v0.1.md),
issue #216). It is the second implementation card of the execution chain:

```text
Mira                       = system under test
#221 external runner       = executor (drives Mira, emits raw facts)
#223 Recorder (this dir)   = deterministic report layer
fresh blank ChatGPT thread = semantic Judge (#224)
```

## What it does

It consumes the raw execution bundles that **#221 already produced** for one or
more repetitions and turns them into a stable, versioned, machine-readable,
**offline-recomputable** artifact package. It never drives Mira, never
re-implements the #221 runner, and never scores semantic quality.

```text
raw #221 facts
  -> ingest (verbatim)
  -> normalize (order preserved, evidence refs)
  -> deterministic derive (pure)
  -> artifact serialization
  -> replay / judge handoff
```

## Input contract (consumed #221 raw fields)

Per repetition, the Recorder reads the #221 bundle:

| File | Used as |
| --- | --- |
| `execution-events.ndjson` | **authoritative** ordered raw trajectory (full history incl. resumed segments) |
| `stream-frames.ndjson` | secondary live SSE observation (may be truncated by executor abort) |
| `agent-run.json` | authoritative terminal run-state document (status / terminalReason / contextBudget) |
| `executor-facts.json` | executor/control facts: identity, timing, interventions, approvals, tool executions, workspace diff, observability gaps |
| `workspace-manifest.{before,after}.json`, `workspace-diff.json` | side-effect evidence |
| `assistant-transcript.txt` | Mira final answer (raw, not summarized) |

Specific raw fields consumed:

- `executorFacts.caseId / caseSetVersion / repetition / executionMode / difficulty`
- `executorFacts.hostPlatform / actualProcedure / referenceProcedure / classificationRationale / comparabilityImpact`
- `executorFacts.executorInterventions` (approval / cancel / user_reply mechanical control)
- `executorFacts.approval`, `executorFacts.failureRetry`, `executorFacts.subagent`
- `executorFacts.terminal`, `executorFacts.streamFinishReason`, `executorFacts.finalization`
- `executorFacts.elapsed`, `executorFacts.timing`
- `executorFacts.workspace`, `executorFacts.observability.gaps`, `executorFacts.notes`
- trajectory events: `agent-next-action-planner#done`, `agent-tool-call-normalize#done`,
  `agent-tool-N#done`, `agent-evidence#done`, `agent-approval#*`, `agent-resume-execution#done`,
  `agent-evaluate#done`, and `subagent-trace:*` child tool/approval events.

### Authoritative raw trajectory decision

The Recorder does **not** merge sources into one synthesized "truth". Persisted
`execution-events.ndjson` is authoritative (precedence 1); `stream-frames.ndjson`
is a secondary transport observation (precedence 2) and the terminal run state
comes from `agent-run.json`. This is recorded in every `execution.json`.

## Output artifact tree

```text
<out>/
  manifest.json                       # run manifest (#216 §14 identity)
  summary.json                        # machine-consumable aggregate
  report.md                           # human-readable projection
  public-summary.json                 # sanitized machine-readable projection
  raw/<case>-rep-<n>.snapshot.json    # raw snapshot for offline replay
  cases/<case-id>/
    case.json                         # frozen case contract (from pinned blob)
    repetitions/<n>/
      execution.json                  # under what conditions this rep ran
      trajectory.jsonl                # verbatim ordered raw trajectory + refs
      result.json                     # raw | deterministic | judge(null)
      judge-input.json                # frozen evidence pack for a blank Judge
```

`manifest.json` / `summary.json` / `report.md` are projections. Raw trajectory is
the fact source and is never replaced by a projection.

### Duplicate protection (fail-fast)

Two input bundles that resolve to the same `(caseId, repetition)` would silently
overwrite each other while `manifest.json` still counted both. The Recorder
verifies uniqueness of `(caseId, repetition)` **before** deleting the output
directory or writing any artifact, and exits non-zero listing the duplicate keys.

### Aggregate identity

`manifest.json` identity (`miraCommit`, `modelProvider`, `modelId`, `hostOs`,
`hostArch`, `runtimeMode`) is aggregated from the **recorded repetitions'
`execution.json`**, never inferred from the benchmark case-set identity. When all
repetitions agree, a shared value is emitted; when they differ the field becomes
`null` with `identityHeterogeneous.<field> = true` and a full
`perRepetitionIdentity[]` breakdown — the Recorder never silently picks the first.

### Frozen case contract (`case.json`) and self-contained Judge input

`case.json` is the frozen case contract extracted from the **exact Git blob**
pinned by the RC manifest (`source.path` + `source.blobSha`, via `git cat-file`).
It is never read from a possibly-drifted working tree; a missing or mismatched
blob fails loudly. The Recorder self-checks the frozen contract (weight sum = 100,
every `scorer: judge` criterion mapped by exactly one semantic question) before
publishing.

`judge-input.json` embeds that same frozen contract plus the Judge-owned criteria
and semantic questions, so a fresh blank Judge needs **no** repository, GitHub,
source markdown, running Mira, or executor context:

```text
semanticCriteria = {
  available: true,          # true == package complete
  criteria: [...],          # only scorer: judge
  questions: [...],         # id -> criterionId
  deterministicCriteriaNotJudgeable: [...]   # frozen context, Judge must not re-judge
}
```

A fully deterministic case yields `available: true` with empty
`criteria`/`questions` (not `available: false`) — the package is complete, there
is simply no semantic Judge work.

## Schema boundaries

- `execution.json` — **conditions**: benchmark identity, Mira identity, model
  identity, environment/classification, fixture identity, executor intervention
  (mechanical executor control vs Mira's own actions vs human help).
- `result.json` — three separated buckets:
  - `raw` — verbatim facts carried from raw sources;
  - `deterministic` — mechanically derived facts;
  - `judge` — always `null` at recorder time.
- `judge-input.json` — frozen evidence + deterministic measurements + raw
  trajectory reference + Mira final answer. Executor self-score, advocacy and
  hidden reasoning are explicitly excluded.

## Evidence references

Deterministic facts cite stable, machine-resolvable refs:

```text
trajectory:<index>
trajectory:<index>:<nodeId>
artifact:<name>
stream:<index>
```

`trajectory:<index>` is the record position inside the frozen raw array; the
Recorder never reorders it.

## Deterministic metrics (currently reliable)

- terminal state / terminal reason / stream finish reason
- planner iteration count, exposed tools, first selected tool
- action sequence (type + selected tool + index)
- parent tool call count, child (delegated) tool call count, total
- tool failure count (from `status`)
- delegation count
- parent approval count, child approval count, resume count
- `repeatedSemanticActionCount` (executor-reported)
- completionProof / unresolvedGaps (parsed from planner output preview)
- finalization facts (`hasRequiredFinalization`, `plannerTerminalType`)
- elapsed time / timing control flags
- fixture workspace side effects (added/removed/modified + external targets)

## Unknown / unavailable (no guessing)

- `recoverableFailureCount` / `terminalFailureCount` → `unknown` when the raw
  trajectory does not expose `failureKind` (structured `observerGap`).
- model provider, Mira commit/version, generation parameters → `unknown` /
  `provider-default` when not provable.
- `timingCredit` / late-completion classification → `unavailable_pending_calibration`
  while `T_soft`/`T_hard` are null (RC state).

## Calibration timing

Diagnostic/untimed cases in the frozen Core v0.1 set intentionally keep `tSoftMs = null` / `tHardMs = null`. The Recorder records
the real monotonic elapsed time, marks the policy `calibration_pending`, and does
**not** invent a cutoff, a timeout penalty, or a timing credit. The recorded
elapsed values are calibration input for #220.

## Running

```bash
# record a #221 dry-run/run root into a report package
pnpm benchmark:record -- \
  --input .test-artifact/agent-core-benchmark/dry-run/<stamp> \
  --out .test-artifact/agent-core-benchmark/report

# optionally attach a run manifest for exact Mira/model identity
pnpm benchmark:record -- --input <repRoot> --out <out> --manifest <run-manifest.json>

# offline deterministic replay from a saved raw snapshot (no Mira re-run)
pnpm benchmark:record -- --replay-from <out>/raw/<case>-rep-<n>.snapshot.json
```

## Tests

```bash
pnpm check:benchmark-recorder
```

Covers trajectory order preservation, offline replay identity, judge-field
nulls, structured observability gaps, adapted/noncanonical preservation, timing
calibration state, secret-safe public projection, fail-loud behavior for
malformed/incomplete input, terminal authority precedence, duplicate
`(caseId, repetition)` fail-fast, exact frozen-blob case extraction,
self-contained Judge criteria mapping (I08 / ADV-08 / deterministic-only), and
aggregate identity provenance.

## Non-goals

- No semantic scoring (fresh blank Judge, #224).
- No environment startup / fixture setup / prompt submit / polling / approval /
  cancel / provider routing (all #221).
- No database, dashboard, long-running service, Phoenix/OTel collector, Agent
  trace framework, benchmark SaaS, or GUI.
- No website projection (#131). This directory only defines the sanitized
  machine-readable result schema.
