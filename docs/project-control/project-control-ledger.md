---
status: historical
owner: docs
last_verified: 2026-09-16
layer: project-control-history
module: ProjectControl
feature: ProjectControlLedger
doc_type: historical-ledger
canonical: false
superseded_by:
  - https://github.com/uichat-mira/.github/blob/main/docs/governance/source-of-truth.md
related:
  - README.md
  - archive/pre-organization-governance-index.md
---

# Project Control Ledger — Historical Compatibility Entry

> This repository-local master ledger is archived. It must not be used as the current work-item or project-management source of truth.

Before Mira adopted the current Organization governance model, this file acted as the repository-wide control ledger for active streams, task-card states, review queues, blockers, and phase summaries.

That responsibility has been retired.

Current ownership is:

```text
GitHub Issue          = work-item contract + outcome
Project Status        = Todo / In Progress / Done management position
Organization fields   = Priority / Effort / dates
PR / Review / CI      = implementation + verification evidence
feat/dev/test/prod    = environment position
uichat-mira/.github   = Organization policy / SOP
code / runtime        = current technical reality
```

Do not add new streams, task states, priorities, dates, or acceptance outcomes to this file.

## Historical source

The complete pre-archive ledger remains available in Git history. The repository snapshot immediately before this cleanup is:

```text
uichat-mira/mira-desktop@0e313cf4f2f1ffc791c47334f90439e1e25b077e
```

The legacy ledger was still receiving repository-local state updates through 2026-09-09. Those records remain historical evidence; they are not migrated into a second Organization ledger.

See [`archive/pre-organization-governance-index.md`](archive/pre-organization-governance-index.md) for the archive boundary and current authority map.
