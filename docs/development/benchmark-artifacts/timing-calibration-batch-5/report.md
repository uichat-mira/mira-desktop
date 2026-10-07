# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `d9e2e4bead50811768084cf89a38dd4913e0ea06`
- repetitions recorded: 21

## What this recorder consumed

- #221 raw repetition bundles: 21 rep bundle(s) from 21 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| ADV-06 | 1 | adapted | true |
| ADV-06 | 2 | adapted | true |
| ADV-06 | 3 | adapted | true |
| ADV-07 | 1 | adapted | true |
| ADV-07 | 2 | adapted | true |
| ADV-07 | 3 | adapted | true |
| beginner-09-ambiguous-rename-clarification | 1 | adapted | true |
| beginner-09-ambiguous-rename-clarification | 2 | adapted | true |
| beginner-09-ambiguous-rename-clarification | 3 | adapted | true |
| beginner-09-ambiguous-rename-clarification | 4 | adapted | true |
| beginner-09-ambiguous-rename-clarification | 5 | adapted | true |
| intermediate-already-aligned-noop | 1 | adapted | true |
| intermediate-already-aligned-noop | 2 | adapted | true |
| intermediate-already-aligned-noop | 3 | adapted | true |
| intermediate-already-aligned-noop | 4 | adapted | true |
| intermediate-already-aligned-noop | 5 | adapted | true |
| intermediate-release-region-followup | 1 | adapted | true |
| intermediate-release-region-followup | 2 | adapted | true |
| intermediate-release-region-followup | 3 | adapted | true |
| intermediate-release-region-followup | 4 | adapted | true |
| intermediate-release-region-followup | 5 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADV-06 | 1 | completed | 1 | 16 | 1 | 15 | 15 | 138665 |
| ADV-06 | 2 | completed | 1 | 25 | 1 | 5 | 5 | 137505 |
| ADV-06 | 3 | completed | 1 | 29 | 1 | 13 | 13 | 190054 |
| ADV-07 | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 180685 |
| ADV-07 | 2 | completed | 1 | 38 | 2 | 13 | 13 | 271892 |
| ADV-07 | 3 | waiting_user | 1 | 0 | 0 | 0 | 0 | 210583 |
| beginner-09-ambiguous-rename-clarification | 1 | waiting_user | 1 | 3 | 1 | 0 | 0 | 16260 |
| beginner-09-ambiguous-rename-clarification | 2 | waiting_user | 2 | 1 | 0 | 0 | 0 | 6215 |
| beginner-09-ambiguous-rename-clarification | 3 | waiting_user | 1 | 5 | 1 | 0 | 0 | 19248 |
| beginner-09-ambiguous-rename-clarification | 4 | waiting_user | 1 | 11 | 1 | 0 | 0 | 18272 |
| beginner-09-ambiguous-rename-clarification | 5 | waiting_user | 2 | 1 | 0 | 0 | 0 | 6217 |
| intermediate-already-aligned-noop | 1 | completed | 1 | 6 | 1 | 1 | 1 | 31411 |
| intermediate-already-aligned-noop | 2 | completed | 1 | 4 | 1 | 1 | 1 | 26339 |
| intermediate-already-aligned-noop | 3 | failed | 1 | 3 | 1 | 0 | 0 | 221791 |
| intermediate-already-aligned-noop | 4 | completed | 1 | 4 | 1 | 0 | 0 | 24256 |
| intermediate-already-aligned-noop | 5 | completed | 1 | 6 | 1 | 1 | 1 | 27481 |
| intermediate-release-region-followup | 1 | waiting_user | 1 | 0 | 0 | 0 | 0 | 228433 |
| intermediate-release-region-followup | 2 | waiting_user | 1 | 0 | 0 | 0 | 0 | 46482 |
| intermediate-release-region-followup | 3 | waiting_user | 1 | 0 | 0 | 0 | 0 | 45520 |
| intermediate-release-region-followup | 4 | waiting_user | 1 | 0 | 0 | 0 | 0 | 58747 |
| intermediate-release-region-followup | 5 | waiting_user | 1 | 0 | 0 | 0 | 0 | 72902 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [138665,137505,190054,180685,271892,210583,16260,6215,19248,18272,6217,31411,26339,221791,24256,27481,228433,46482,45520,58747,72902]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (ADV-06 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-06 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-06 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-06 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-06 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-06 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-06 rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-06 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-06 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (ADV-07 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-07 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-07 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-07 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-07 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (ADV-07 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-07 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (beginner-09-ambiguous-rename-clarification rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (beginner-09-ambiguous-rename-clarification rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-09-ambiguous-rename-clarification rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-09-ambiguous-rename-clarification rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-09-ambiguous-rename-clarification rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (beginner-09-ambiguous-rename-clarification rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (beginner-09-ambiguous-rename-clarification rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-09-ambiguous-rename-clarification rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (beginner-09-ambiguous-rename-clarification rep 4): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (beginner-09-ambiguous-rename-clarification rep 4): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-09-ambiguous-rename-clarification rep 4): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-09-ambiguous-rename-clarification rep 5): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-09-ambiguous-rename-clarification rep 5): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-already-aligned-noop rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-already-aligned-noop rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-already-aligned-noop rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-already-aligned-noop rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-already-aligned-noop rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-already-aligned-noop rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-already-aligned-noop rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-already-aligned-noop rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-already-aligned-noop rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-already-aligned-noop rep 4): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-already-aligned-noop rep 4): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-already-aligned-noop rep 4): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-already-aligned-noop rep 5): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-already-aligned-noop rep 5): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-already-aligned-noop rep 5): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-release-region-followup rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-release-region-followup rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-release-region-followup rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-release-region-followup rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-release-region-followup rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-release-region-followup rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-release-region-followup rep 4): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-release-region-followup rep 4): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (intermediate-release-region-followup rep 5): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-release-region-followup rep 5): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
