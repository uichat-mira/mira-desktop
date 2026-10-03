# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1-rc1`
- Mira commit: `d0a8a98aec2d8cac3dfd04029f99cd4e9707c24d`
- repetitions recorded: 15

## What this recorder consumed

- #221 raw repetition bundles: 15 rep bundle(s) from 15 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| ADV-03 | 1 | adapted | true |
| ADV-03 | 2 | adapted | true |
| ADV-03 | 3 | adapted | true |
| beginner-05-local-version-no-network | 1 | adapted | true |
| beginner-05-local-version-no-network | 2 | adapted | true |
| beginner-05-local-version-no-network | 3 | adapted | true |
| beginner-06-read-command-do-not-execute | 1 | adapted | true |
| beginner-06-read-command-do-not-execute | 2 | adapted | true |
| beginner-06-read-command-do-not-execute | 3 | adapted | true |
| intermediate-handshake-recovery | 1 | adapted | true |
| intermediate-handshake-recovery | 2 | adapted | true |
| intermediate-handshake-recovery | 3 | adapted | true |
| intermediate-version-validator | 1 | adapted | true |
| intermediate-version-validator | 2 | adapted | true |
| intermediate-version-validator | 3 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADV-03 | 1 | completed | 1 | 16 | 1 | 4 | 4 | 105099 |
| ADV-03 | 2 | completed | 1 | 16 | 1 | 6 | 6 | 103513 |
| ADV-03 | 3 | completed | 1 | 16 | 1 | 4 | 4 | 98096 |
| beginner-05-local-version-no-network | 1 | completed | 2 | 1 | 0 | 0 | 0 | 8238 |
| beginner-05-local-version-no-network | 2 | completed | 2 | 1 | 0 | 0 | 0 | 7239 |
| beginner-05-local-version-no-network | 3 | completed | 2 | 1 | 0 | 0 | 0 | 9228 |
| beginner-06-read-command-do-not-execute | 1 | completed | 2 | 1 | 0 | 0 | 0 | 7219 |
| beginner-06-read-command-do-not-execute | 2 | completed | 2 | 1 | 0 | 0 | 0 | 7227 |
| beginner-06-read-command-do-not-execute | 3 | completed | 2 | 1 | 0 | 0 | 0 | 8232 |
| intermediate-handshake-recovery | 1 | completed | 1 | 8 | 1 | 5 | 5 | 51070 |
| intermediate-handshake-recovery | 2 | completed | 1 | 10 | 1 | 5 | 5 | 57516 |
| intermediate-handshake-recovery | 3 | completed | 1 | 8 | 1 | 4 | 4 | 62359 |
| intermediate-version-validator | 1 | completed | 1 | 11 | 1 | 4 | 4 | 45060 |
| intermediate-version-validator | 2 | waiting_user | 1 | 6 | 1 | 1 | 1 | 27341 |
| intermediate-version-validator | 3 | completed | 1 | 9 | 1 | 4 | 4 | 49703 |

## Timing observations

- policy state: `calibration_pending`
- elapsed ms values: [105099,103513,98096,8238,7239,9228,7219,7227,8232,51070,57516,62359,45060,27341,49703]
- timing credit / on-time classification: not computed while `calibration_pending` (see gaps)

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (ADV-03 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-03 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-03 rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-03 rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-03 rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-03 rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (ADV-03 rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-03 rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (ADV-03 rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-05-local-version-no-network rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-05-local-version-no-network rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-05-local-version-no-network rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-05-local-version-no-network rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-05-local-version-no-network rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-05-local-version-no-network rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-06-read-command-do-not-execute rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-06-read-command-do-not-execute rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-06-read-command-do-not-execute rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-06-read-command-do-not-execute rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `recoverableFailureCount` (beginner-06-read-command-do-not-execute rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (beginner-06-read-command-do-not-execute rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-handshake-recovery rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-handshake-recovery rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-handshake-recovery rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-handshake-recovery rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-handshake-recovery rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-handshake-recovery rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-handshake-recovery rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-handshake-recovery rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-handshake-recovery rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-version-validator rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-version-validator rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-version-validator rep 1): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-version-validator rep 2): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-version-validator rep 2): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-version-validator rep 2): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence
- `childFailureCount` (intermediate-version-validator rep 3): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-version-validator rep 3): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `timingPolicy` (intermediate-version-validator rep 3): per-case T_soft/T_hard are null in the RC case set (core-v0.1-rc1); final freeze is gated on canonical Windows evidence

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
