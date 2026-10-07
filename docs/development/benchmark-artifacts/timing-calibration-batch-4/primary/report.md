# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `21c826fac0d65ebd74671bd122713891b900c53b`
- repetitions recorded: 15

## What this recorder consumed

- #221 raw repetition bundles: 15 rep bundle(s) from 15 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| ADV-04 | 1 | adapted | true |
| ADV-04 | 2 | adapted | true |
| ADV-04 | 3 | adapted | true |
| ADV-05 | 1 | adapted | true |
| ADV-05 | 2 | adapted | true |
| ADV-05 | 3 | adapted | true |
| beginner-07-rename-one-file | 1 | adapted | true |
| beginner-07-rename-one-file | 2 | adapted | true |
| beginner-07-rename-one-file | 3 | adapted | true |
| beginner-08-contextual-config-follow-up | 1 | adapted | true |
| beginner-08-contextual-config-follow-up | 2 | adapted | true |
| beginner-08-contextual-config-follow-up | 3 | adapted | true |
| intermediate-inspect-then-continue | 1 | adapted | true |
| intermediate-inspect-then-continue | 2 | adapted | true |
| intermediate-inspect-then-continue | 3 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADV-04 | 1 | completed | 1 | 23 | 1 | 5 | 5 | 111422 |
| ADV-04 | 2 | completed | 1 | 28 | 1 | 9 | 9 | 155330 |
| ADV-04 | 3 | completed | 1 | 26 | 1 | 7 | 7 | 136867 |
| ADV-05 | 1 | completed | 1 | 15 | 1 | 4 | 4 | 81098 |
| ADV-05 | 2 | completed | 1 | 12 | 1 | 4 | 4 | 94188 |
| ADV-05 | 3 | completed | 1 | 15 | 1 | 4 | 4 | 84393 |
| beginner-07-rename-one-file | 1 | completed | 2 | 1 | 0 | 1 | 1 | 10341 |
| beginner-07-rename-one-file | 2 | completed | 2 | 1 | 0 | 1 | 1 | 8378 |
| beginner-07-rename-one-file | 3 | completed | 2 | 1 | 0 | 1 | 1 | 9269 |
| beginner-08-contextual-config-follow-up | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 13292 |
| beginner-08-contextual-config-follow-up | 2 | waiting_user | 1 | 0 | 0 | 0 | 0 | 12288 |
| beginner-08-contextual-config-follow-up | 3 | waiting_user | 1 | 0 | 0 | 0 | 0 | 11313 |
| intermediate-inspect-then-continue | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 32531 |
| intermediate-inspect-then-continue | 2 | waiting_user | 1 | 0 | 0 | 0 | 0 | 44504 |
| intermediate-inspect-then-continue | 3 | waiting_user | 1 | 0 | 0 | 0 | 0 | 49392 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [111422,155330,136867,81098,94188,84393,10341,8378,9269,13292,12288,11313,32531,44504,49392]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (ADV-04 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-04 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-04 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-04 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-04 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-04 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-04 rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-04 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-04 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-05 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-05 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-05 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-05 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-05 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-05 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-05 rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-05 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-05 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-07-rename-one-file rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-07-rename-one-file rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-07-rename-one-file rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-07-rename-one-file rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-07-rename-one-file rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-07-rename-one-file rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-08-contextual-config-follow-up rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-08-contextual-config-follow-up rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-08-contextual-config-follow-up rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-08-contextual-config-follow-up rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-08-contextual-config-follow-up rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-08-contextual-config-follow-up rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-inspect-then-continue rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-inspect-then-continue rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-inspect-then-continue rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-inspect-then-continue rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-inspect-then-continue rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-inspect-then-continue rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
