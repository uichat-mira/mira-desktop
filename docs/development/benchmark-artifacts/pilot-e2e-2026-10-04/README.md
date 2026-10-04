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

## Judge handoff

Each repetition package lives under cases/<case-id>/repetitions/<n>/ and includes execution.json, trajectory.jsonl, result.json, and judge-input.json; the matching frozen case.json is at the case root.

Only I08 (C1) and ADV-08 (C4, C5) require semantic judging. B02 and B07 are fully deterministic.

The fresh blank Judge must read only the exact repetition package plus its case contract and answer only semanticCriteria.questions. It must not override timing, terminal, hard-fail, side-effect, or deterministic criterion facts.

## Audit

package-audit.json records the pre-publication identity and secret audit. Publication was allowed only after both audits passed.

scoring/ contains the deterministic pre-Judge scoring projection. Semantic-dependent repetitions remain pending until a fresh blank Judge result is supplied.
