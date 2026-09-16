---
status: current
owner: docs
last_verified: 2026-09-16
layer: project-control
module: ProjectControl
feature: HistoricalProjectControlIndex
Doc Type: index
canonical: true
related:
  - ../../AGENTS.md
  - archive/pre-organization-governance-index.md
---

# Project Control

`docs/project-control/` now serves primarily as the **historical evidence and decision archive** for Mira Desktop's repository-local task-card/workboard era.

It is no longer the current project-management source of truth.

## Current authority

After Mira adopted Organization governance, use the owner of each kind of truth:

```text
GitHub Issue          = work-item contract + outcome
Project Status        = coarse management workflow position
Organization fields   = Priority / Effort / dates
PR / Review / CI      = implementation + verification evidence
feat/dev/test/prod    = environment position
uichat-mira/.github   = Organization policy / reusable SOP
Desktop AGENTS.md     = repository-specific implementation constraints
code/config/runtime   = current technical reality
```

Do not create or maintain another repository-wide prose ledger that duplicates these surfaces.

## What remains here

Historical material remains useful for engineering archaeology and evidence:

- `tasks/` — old repository task cards and implementation contracts;
- `reviews/` — historical review evidence and findings;
- `testEvidence/` — larger verification records;
- `phase-conclusions/` — phase closeout and acceptance summaries;
- `decisions/` — repository decisions recorded before or alongside the current governance model;
- `archive/` — explicit historical snapshots and migration indexes.

These documents may explain why a current guard or architecture decision exists, but they do not automatically describe current work state or current runtime behavior.

## Archived former control surfaces

The following repository-local control documents are retired:

- `project-control-ledger.md` — former master ledger;
- `agent-workboard.md` — former Agent remediation workboard;
- `model-settings-workboard.md` — former model-settings workboard;
- `agent-nodes-workboard.md` — already archived historical Agent-node workboard;
- `governance-principles.md` — former repository-wide governance contract, superseded by Organization policy and root `AGENTS.md`.

Their full pre-archive state remains available in Git history. The common snapshot anchor immediately before this cleanup is:

```text
uichat-mira/mira-desktop@0e313cf4f2f1ffc791c47334f90439e1e25b077e
```

See [`archive/pre-organization-governance-index.md`](archive/pre-organization-governance-index.md).

## Current technical documentation

For current product and runtime facts, start from `docs/README.md` and the canonical current documents, including:

- `CURRENT_PRODUCT_TRUTH.md`;
- `CHAT_CURRENT_TRUTH.md`;
- `AGENT_CURRENT_TRUTH.md`;
- `TOOL_CURRENT_TRUTH.md`;
- `MICROAPP_CURRENT_TRUTH.md`;
- `PROVIDER_CURRENT_TRUTH.md`;
- domain-specific current contracts such as `forge/FORGE_CURRENT_CONTRACT.md`.

Always prefer current code/config/runtime over documentation when observable reality disagrees.

## New work

New engineering work should not be registered in a local master ledger first.

Follow the current Organization work-item process and authority model. A historical task card may be consulted for context, but a new or changed work-item contract belongs in the current GitHub Issue unless an explicit repository-specific contract says otherwise.

Do not bulk-rewrite old task cards merely to make them look current. Preserve history, repair only stale projections that could reasonably mislead current work, and keep one owner for each kind of truth.
