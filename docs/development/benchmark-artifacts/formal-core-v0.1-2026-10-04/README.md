# Mira Agent Core Benchmark v0.1 — Formal Judge transport

Frozen semantic-Judge transport for #230 formal Core v0.1.

- Mira commit under test: `43c4c6a84ef7b8dc191c1dc9c8284c85d6d3a5bf`
- Mira version: `0.102.0`
- Formal automated scored set: 17 cases × 3 repetitions = 51 valid comparable repetitions
- Semantic Judge packages: 30 repetitions
- Execution classification: `adapted`
- Package identity audit: pass
- Secret audit: pass
- ADV-02 recoverable-failure classification remains mechanically unobservable and must stay incomplete for that criterion; do not infer it semantically.

Each `judge-packages/<case-id>/rep-<n>/` directory contains exactly:

- `case.json`
- `execution.json`
- `trajectory.jsonl`
- `result.json`
- `judge-input.json`

A fresh blank Judge must use only the selected repetition directory. GitHub is transport/evidence storage, not an extra evidence source. Do not inspect source code, Issues, PRs, other repetitions, or the internet to answer semantic criteria.

After this directory is committed, the immutable locator is:

`uichat-mira/mira-desktop + <exact commit SHA> + docs/development/benchmark-artifacts/formal-core-v0.1-2026-10-04/judge-packages/<case-id>/rep-<n>`

## Final scoring state

- 30/30 semantic repetitions judged and recorded in `judge-results.json`.
- 48/51 repetitions are fully scoreable; the remaining 3 are ADV-02 rep 1/2/3, each blocked only by deterministic C1 observability.
- 16/17 formal cases are complete.
- ADV-02 is explicitly `incomplete_case`; benchmark-level headline metrics remain null rather than averaging only the complete cases.
- `public-result.json` is the sanitized website-facing projection.
- `report.md` explains the incomplete case and the semantic-Judge methodology deviation.

Semantic judging used two blank-thread contexts: `ADV-02 / rep-1` in its own fresh blank thread, then the remaining 29 repetitions in one newly opened blank batch thread with per-repetition evidence isolation. Because #230's stricter handoff wording describes fresh-thread isolation per repetition, the batch portion is recorded as a methodology deviation instead of being hidden or retroactively reclassified.
