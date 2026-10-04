# Mira Agent Core Benchmark v0.1 — #224 Pilot E2E

This directory is the frozen GitHub evidence package for the #224 Pilot E2E run.

## Identity

- Benchmark: Mira Agent Core Benchmark v0.1
- Case set: core-v0.1
- Frozen Mira commit under test: 65d134ee99b35b733419061b7d4ded5655958cc1
- Mira version: 0.102.0
- Runtime model provider / model: volcengine / deepseek-v4.1-flash
- Host: darwin x64
- Execution classification: adapted
- Repetitions: 4 total — B02, B07, I08, ADV-08, one repetition each
- All four selected cases are automated_scored; no diagnostic_untimed case is included in scored aggregation.

## Pilot paths exercised

- normal read-only completion: B02
- governed approval/resume mutation: B07
- multi-step delegation / SubAgent: I08
- advanced workspace-boundary delegation + approvals: ADV-08
- soft-timeout / late-completion: ADV-08 (125578ms, T_soft=120000ms, T_hard=240000ms)
- adapted execution: all four repetitions
- human task-solving intervention: none

## Controlled timeout simulation

A separate non-scored control run is preserved under `controls/timeout-cancel-sim/`.

- frozen case: B02
- executor cancel control: 1000ms
- observed elapsed: 1463ms
- terminal: `cancelled`
- `cancelRequested=true`
- `hardCutoffApplied=false`
- workspace unchanged
- excluded from Pilot scored aggregation

This is evidence for the #224 controlled-timeout/cancel path. It is deliberately not presented as a real `T_hard` event and does not alter the frozen case timing contract.

## Judge handoff

The canonical Recorder tree remains under cases/<case-id>/. For semantic handoff, each required repetition also has an immutable transport package under judge-packages/<case-id>/rep-<n>/ containing exactly:

- case.json
- execution.json
- trajectory.jsonl
- result.json
- judge-input.json

Only I08 (C1) and ADV-08 (C4, C5) require semantic judging. B02 and B07 are fully deterministic. The transport files are byte-identical copies of their canonical Recorder artifacts; package-audit.json verifies this before publication.

The standard fresh blank Judge must read only the exact repetition package plus its case contract and answer only semanticCriteria.questions. It must not override timing, terminal, hard-fail, side-effect, or deterministic criterion facts.

For this Pilot closeout, the maintainer explicitly authorized the current thread to perform semantic judging after an earlier handoff used a `judge-packages/` path with a commit that predated those packages. `judge-results.json` records this as `independentBlank: false`; this result is not an independent blank-thread review.

## Audit

package-audit.json records the package identity and secret audit. Publication is allowed only after both audits pass.

`scoring/` contains the final Pilot scoring after semantic-result backfill. All four selected repetitions are complete; the headline is Task Success 96.25, Autonomy 100, Reliability 75, Governance 100.
