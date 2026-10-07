# Timing Calibration Batch 5 (#220)

Timing observations only. No formal score, semantic Judge result, or frozen timing cutoff was produced. `T_soft` and `T_hard` remain null.

## Identity and Procedure

- Repository: `uichat-mira/mira-desktop`
- Mira source commit: `d9e2e4bead50811768084cf89a38dd4913e0ea06`
- Case set: `core-v0.1-rc1`; frozen selection: `selection.json`
- Backend: local Mira backend on `127.0.0.1:8799`, backed by an isolated SQLite copy under ignored `.test-artifact/`.
- Host: macOS `darwin/x64`, Node `v22.22.3`; all runs are `adapted` and valid comparable observations.
- Runner safety bound: default 900000 ms; no safety-cap termination. Timing policy remains `calibration_pending`.

## Timing Observations

| Case | Valid comparable | Terminal outcomes | Min (ms) | Median (ms) | Max (ms) | Max/min |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| `beginner-09-ambiguous-rename-clarification` | 5 | waiting_user x5 | 6,215 | 16,260 | 19,248 | 3.10 |
| `intermediate-already-aligned-noop` | 5 | completed x4, failed x1 | 24,256 | 27,481 | 221,791 | 9.14 |
| `intermediate-release-region-followup` | 5 | waiting_user x5 | 45,520 | 58,747 | 228,433 | 5.02 |
| `ADV-06` | 3 | completed x3 | 137,505 | 138,665 | 190,054 | 1.38 |
| `ADV-07` | 3 | completed x1, waiting_user x2 | 180,685 | 210,583 | 271,892 | 1.50 |

The three cases with `max/min > 2.0` received the required two additional observations. Ratios remained above 2.0 after supplementation and are explicitly retained; no observation was hidden or discarded.

## Exceptions and Audit

- 21/21 observations were retained by Recorder; 10 completed, 10 ended `waiting_user`, and 1 failed.
- I07 (`intermediate-release-region-followup`) supplied the exact frozen follow-up only after Mira entered `waiting_user` in every repetition. ADV-07 used the same gate; rep-1 and rep-3 remained `waiting_user`, while rep-2 completed after the gated follow-up.
- I06 repetition 3 failed with terminal reason `Generation model returned an empty user answer.` It remains in raw and Recorder artifacts.
- Recorder observability gaps include unresolved `recoverableFailureCount` where raw execution nodes omit `failureKind`; delegated child-failure visibility is also unresolved where traces expose completion without a definitive failure status.
- No formal scoring was performed. No Benchmark contract was modified. No `T_soft`/`T_hard` values were frozen.

Recorder artifacts are in this directory, including raw snapshots, per-case execution/result/Judge-input records, `summary.json`, `report.md`, and `public-summary.json`.
