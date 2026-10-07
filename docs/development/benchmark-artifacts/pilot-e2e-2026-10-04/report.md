# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1`
- Mira commit: `65d134ee99b35b733419061b7d4ded5655958cc1`
- repetitions recorded: 4

## What this recorder consumed

- #221 raw repetition bundles: 4 rep bundle(s) from 4 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| ADV-08 | 1 | adapted | true |
| beginner-02-locate-release-checklist | 1 | adapted | true |
| beginner-07-rename-one-file | 1 | adapted | true |
| intermediate-health-status-call-chain | 1 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADV-08 | 1 | completed | 1 | 22 | 2 | 6 | 6 | 125578 |
| beginner-02-locate-release-checklist | 1 | completed | 2 | 1 | 0 | 0 | 0 | 8232 |
| beginner-07-rename-one-file | 1 | completed | 2 | 1 | 0 | 1 | 1 | 11379 |
| intermediate-health-status-call-chain | 1 | completed | 1 | 16 | 1 | 1 | 1 | 37491 |

## Timing observations

- policy state: `frozen`
- scope: `valid_comparable_terminal_elapsed_not_success_filtered`
- terminal elapsed ms values: [125578,8232,11379,37491]
- terminal elapsed by status: {"completed":{"values":[125578,8232,11379,37491],"median":24435,"max":125578,"count":4}}
- note: Recorder aggregate timing is descriptive terminal elapsed only. Final timing calibration must select observations by the frozen case-defined success boundary; failed or semantically unsuccessful terminal outcomes must not be treated as successful completion timing.
- timing credit / on-time classification is only computed when the case has frozen T_soft/T_hard

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `childFailureCount` (ADV-08 rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (ADV-08 rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `recoverableFailureCount` (beginner-02-locate-release-checklist rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `recoverableFailureCount` (beginner-07-rename-one-file rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone
- `childFailureCount` (intermediate-health-status-call-chain rep 1): the #221 subagent-trace contract exposes child tool.started/tool.completed but no definite child success/failure fact (no tool.failed, no traceDetails.status), so delegated failures cannot be mechanically proven
- `recoverableFailureCount` (intermediate-health-status-call-chain rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
