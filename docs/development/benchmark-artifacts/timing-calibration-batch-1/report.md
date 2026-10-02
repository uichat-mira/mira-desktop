# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `unknown`
- repetitions recorded: 17

## What this recorder consumed

- #221 raw repetition bundles: 17 rep bundle(s) from 17 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| ADV-08 | 1 | adapted | true |
| ADV-08 | 2 | adapted | true |
| ADV-08 | 3 | adapted | true |
| beginner-01-concise-rewrite | 1 | adapted | true |
| beginner-01-concise-rewrite | 2 | adapted | true |
| beginner-01-concise-rewrite | 3 | adapted | true |
| beginner-02-locate-release-checklist | 1 | adapted | true |
| beginner-02-locate-release-checklist | 2 | adapted | true |
| beginner-02-locate-release-checklist | 3 | adapted | true |
| intermediate-effective-prod-timeout | 1 | adapted | true |
| intermediate-effective-prod-timeout | 2 | adapted | true |
| intermediate-effective-prod-timeout | 3 | adapted | true |
| intermediate-effective-prod-timeout | 4 | adapted | true |
| intermediate-effective-prod-timeout | 5 | adapted | true |
| intermediate-health-status-call-chain | 1 | adapted | true |
| intermediate-health-status-call-chain | 2 | adapted | true |
| intermediate-health-status-call-chain | 3 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADV-08 | 1 | completed | 1 | 12 | 1 | 3 | 3 | 53138 |
| ADV-08 | 2 | completed | 1 | 14 | 1 | 5 | 5 | 70146 |
| ADV-08 | 3 | completed | 1 | 13 | 1 | 5 | 5 | 83502 |
| beginner-01-concise-rewrite | 1 | completed | 1 | 0 | 0 | 0 | 0 | 4733 |
| beginner-01-concise-rewrite | 2 | completed | 1 | 0 | 0 | 0 | 0 | 6736 |
| beginner-01-concise-rewrite | 3 | completed | 1 | 0 | 0 | 0 | 0 | 4223 |
| beginner-02-locate-release-checklist | 1 | completed | 2 | 1 | 0 | 0 | 0 | 10269 |
| beginner-02-locate-release-checklist | 2 | completed | 2 | 1 | 0 | 0 | 0 | 7243 |
| beginner-02-locate-release-checklist | 3 | completed | 2 | 1 | 0 | 0 | 0 | 6240 |
| intermediate-effective-prod-timeout | 1 | completed | 1 | 190 | 6 | 6 | 6 | 277760 |
| intermediate-effective-prod-timeout | 2 | completed | 1 | 5 | 1 | 2 | 2 | 29802 |
| intermediate-effective-prod-timeout | 3 | completed | 1 | 217 | 7 | 8 | 8 | 393317 |
| intermediate-effective-prod-timeout | 4 | completed | 1 | 26 | 1 | 1 | 1 | 41671 |
| intermediate-effective-prod-timeout | 5 | completed | 1 | 76 | 2 | 2 | 2 | 114234 |
| intermediate-health-status-call-chain | 1 | completed | 1 | 10 | 1 | 0 | 0 | 30408 |
| intermediate-health-status-call-chain | 2 | completed | 1 | 14 | 1 | 0 | 0 | 31937 |
| intermediate-health-status-call-chain | 3 | completed | 1 | 14 | 1 | 0 | 0 | 34543 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [53138,70146,83502,4733,6736,4223,10269,7243,6240,277760,29802,393317,41671,114234,30408,31937,34543]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (ADV-08 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-08 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-08 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-08 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-08 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-08 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-08 rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-08 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-08 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-01-concise-rewrite rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-01-concise-rewrite rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-01-concise-rewrite rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-01-concise-rewrite rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-01-concise-rewrite rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-01-concise-rewrite rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-02-locate-release-checklist rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-02-locate-release-checklist rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-02-locate-release-checklist rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-02-locate-release-checklist rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-02-locate-release-checklist rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-02-locate-release-checklist rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-effective-prod-timeout rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-effective-prod-timeout rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-effective-prod-timeout rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-effective-prod-timeout rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-effective-prod-timeout rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-effective-prod-timeout rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-effective-prod-timeout rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-effective-prod-timeout rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-effective-prod-timeout rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-effective-prod-timeout rep 4): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-effective-prod-timeout rep 4): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-effective-prod-timeout rep 4): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-effective-prod-timeout rep 5): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-effective-prod-timeout rep 5): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-effective-prod-timeout rep 5): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-health-status-call-chain rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-health-status-call-chain rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-health-status-call-chain rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-health-status-call-chain rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-health-status-call-chain rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-health-status-call-chain rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-health-status-call-chain rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-health-status-call-chain rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-health-status-call-chain rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
