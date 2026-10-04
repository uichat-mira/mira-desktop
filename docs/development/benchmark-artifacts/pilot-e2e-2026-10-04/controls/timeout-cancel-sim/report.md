# Mira Agent Core Benchmark — Recorder Report (#223)

- benchmark version: `0.1`
- case-set version: `core-v0.1`
- Mira commit: `65d134ee99b35b733419061b7d4ded5655958cc1`
- repetitions recorded: 1

## What this recorder consumed

- #221 raw repetition bundles: 1 rep bundle(s) from 1 dir(s)
- per-repetition raw sources: `execution-events.ndjson` (authoritative), `stream-frames.ndjson`, `agent-run.json`, `executor-facts.json`, workspace manifests

## Execution identity

| case | rep | mode | comparable |
| --- | ---: | --- | --- |
| beginner-02-locate-release-checklist | 1 | adapted | true |

## Deterministic facts

| case | rep | terminal | plannerIter | toolCalls | delegations | approvals | resumes | elapsedMs |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| beginner-02-locate-release-checklist | 1 | cancelled | 0 | 0 | 0 | 0 | 0 | 1463 |

## Timing observations

- policy state: `frozen`
- scope: `valid_comparable_terminal_elapsed_not_success_filtered`
- terminal elapsed ms values: [1463]
- terminal elapsed by status: {"cancelled":{"values":[1463],"median":1463,"max":1463,"count":1}}
- note: Recorder aggregate timing is descriptive terminal elapsed only. Final timing calibration must select observations by the frozen case-defined success boundary; failed or semantically unsuccessful terminal outcomes must not be treated as successful completion timing.
- timing credit / on-time classification is only computed when the case has frozen T_soft/T_hard

## Artifact completeness

Per repetition: `execution.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`.
Aggregate: `manifest.json`, `summary.json`, `report.md`, `public-summary.json`, `raw-snapshot.json`.

## Observability gaps

- `recoverableFailureCount` (beginner-02-locate-release-checklist rep 1): current #221 execution-node schema exposes per-tool `status` but not `failureKind`, so recoverable vs terminal failure cannot be proven from the raw trajectory alone

## Semantic criteria awaiting a fresh blank Judge

- Case semantic criteria/questions are extracted from the pinned frozen source blob and packaged into `case.json` / `judge-input.json` (`semanticCriteria.available = true`).
- Semantic *results* are still filled by a fresh blank Judge (#224); `result.json.judge` and `judge-input.json.judgeFields` remain `null` at recorder time.
