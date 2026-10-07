# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `21c826fac0d65ebd74671bd122713891b900c53b`
- repetitions recorded: 4

## What this recorder consumed

- #221 raw repetition bundles: 4 rep bundle(s) from 4 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| beginner-08-contextual-config-follow-up | 1 | adapted | true |
| beginner-08-contextual-config-follow-up | 2 | adapted | true |
| intermediate-inspect-then-continue | 1 | adapted | true |
| intermediate-inspect-then-continue | 2 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| beginner-08-contextual-config-follow-up | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 13308 |
| beginner-08-contextual-config-follow-up | 2 | waiting_user | 1 | 0 | 0 | 0 | 0 | 12288 |
| intermediate-inspect-then-continue | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 43908 |
| intermediate-inspect-then-continue | 2 | waiting_user | 1 | 0 | 0 | 0 | 0 | 48950 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [13308,12288,43908,48950]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `recoverableFailureCount` (beginner-08-contextual-config-follow-up rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-08-contextual-config-follow-up rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-08-contextual-config-follow-up rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-08-contextual-config-follow-up rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-inspect-then-continue rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-inspect-then-continue rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-inspect-then-continue rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-inspect-then-continue rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
