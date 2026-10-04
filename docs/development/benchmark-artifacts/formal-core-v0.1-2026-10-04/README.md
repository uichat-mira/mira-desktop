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
