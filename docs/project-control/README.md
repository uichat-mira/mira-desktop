---
status: current
owner: docs
last_verified: 2026-09-19
layer: project-control-history
module: ProjectControl
feature: HistoricalProjectControlIndex
doc_type: index
canonical: true
related:
  - ../../AGENTS.md
  - archive/legacy-project-control-2026-09-19/README.md
---

# Project Control

`docs/project-control/` is now a **historical evidence and decision archive**. It is not the current project-management source of truth.

## Current authority

```text
GitHub Issue          = work-item contract + outcome
Project Status        = Todo / In Progress / Done management position
Organization fields   = Priority / Effort / dates
PR / Review / CI      = implementation + verification evidence
feat/dev/test/prod    = environment position
uichat-mira/.github   = Organization policy / reusable SOP
Desktop AGENTS.md     = repository-specific implementation constraints
code/config/runtime   = current technical reality
```

Do not create or maintain another repository-wide prose ledger or workboard that duplicates those surfaces.

## Historical evidence retained here

- `tasks/` — historical repository task cards and implementation contracts;
- `reviews/` — historical review evidence and findings;
- `testEvidence/` — verification records;
- `phase-conclusions/` — phase closeout and acceptance summaries;
- `decisions/` — repository decisions;
- `archive/` — explicit historical snapshots and migration indexes.

The former active ledger/workboards and repository governance contract were retired on 2026-09-19. Their full snapshots are under [`archive/legacy-project-control-2026-09-19/`](archive/legacy-project-control-2026-09-19/README.md).

The old root paths remain only as short compatibility entries so stale links fail safe instead of presenting obsolete task state as current.

## New work

New engineering work belongs in the GitHub Issue / Project flow under Organization governance. Historical task cards remain evidence; do not update them into a second management system.
