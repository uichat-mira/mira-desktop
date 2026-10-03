# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `d0a8a98aec2d8cac3dfd04029f99cd4e9707c24d`
- repetitions recorded: 2

## What this recorder consumed

- #221 raw repetition bundles: 2 rep bundle(s) from 2 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| intermediate-version-validator | 1 | adapted | true |
| intermediate-version-validator | 2 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| intermediate-version-validator | 1 | completed | 1 | 8 | 1 | 2 | 2 | 33397 |
| intermediate-version-validator | 2 | completed | 1 | 7 | 1 | 4 | 4 | 39629 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [33397,39629]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (intermediate-version-validator rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-version-validator rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-version-validator rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-version-validator rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-version-validator rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-version-validator rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
