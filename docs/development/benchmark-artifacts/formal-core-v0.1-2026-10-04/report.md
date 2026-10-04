# Mira Agent Core Benchmark v0.1 — Formal Result

- Status: **incomplete** — 16/17 formal cases complete; ADV-02 is explicitly incomplete_case.
- Formal repetitions: **51/51 valid comparable** (adapted), 0 invalid, 0 noncanonical.
- Terminal distribution: 47 completed / 3 cancelled / 1 waiting_user.
- Mira under test: 43c4c6a84ef7b8dc191c1dc9c8284c85d6d3a5bf / v0.102.0.
- Host/runtime: darwin x64 / desktop-local-backend.
- Semantic judging: 30 repetitions completed from frozen GitHub packages.

## Canonical headline

No 17-case benchmark headline is published because ADV-02 cannot be completely scored from the frozen evidence. Task Success / Autonomy / Reliability / Governance remain null at benchmark level rather than silently averaging only the 16 complete cases.

## Complete-case descriptive view

| Tier | Cases | Task Success | Autonomy | Reliability | Governance |
| --- | ---: | ---: | ---: | ---: | ---: |
| beginner | 7 | 90.48 | 100.00 | 90.48 | 100.00 |
| intermediate | 4 | 85.00 | 100.00 | 83.33 | 100.00 |
| advanced | 5 | 86.68 | 100.00 | 66.67 | 100.00 |

Across the 16 complete cases only: Pass@1 12/16 (75%), Stable@3 12/16 (75%), Complete@3 12/16 (75%). These are descriptive and not the canonical 17-case metrics.

## ADV-02 incomplete-case

All three ADV-02 repetitions have semantic C5/C6 judged and the remaining deterministic criteria evaluated. C1 remains unavailable because the frozen execution evidence does not mechanically expose recoverable-vs-terminal failure classification (failureKind). The formal run is not rerun and the runtime is not modified to improve the score.

## Semantic Judge procedure

The 30 semantic repetitions were judged from the frozen packages committed at b3bf52a7b6b3dadbb9ad672e8534c759c0df309a. One fresh blank ChatGPT thread performed the batch, with explicit per-repetition evidence isolation. This is recorded as a methodology deviation from the stricter per-repetition fresh-thread wording in #230; it is not hidden or retroactively reclassified.

## Files

- judge-results.json — semantic outcomes + evidence refs.
- scoring/scoring.json — repetition-level deterministic + semantic scoring.
- scoring/summary.json — case/tier aggregation.
- public-result.json — sanitized website-facing result projection.
- package-audit.json — frozen package identity + secret audit.
- judge-packages/ — immutable Judge evidence transport.
