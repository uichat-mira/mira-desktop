---
status: historical
owner: docs
last_verified: 2026-09-16
layer: project-control-history
module: ProjectControl
feature: PreOrganizationGovernanceArchive
doc_type: historical-index
canonical: false
related:
  - ../README.md
  - ../project-control-ledger.md
  - ../agent-workboard.md
  - ../model-settings-workboard.md
  - ../governance-principles.md
---

# Pre-Organization Governance Archive

This page indexes the repository-local work ledgers and governance documents that predate Mira's current Organization governance model.

They remain useful as historical evidence: they explain why contracts were formed, which remediation packages existed, and what verification was recorded at the time. They no longer own current work-item state, priority, acceptance, or Organization policy.

## Archive boundary

The last untouched `dev` snapshot before this archival cleanup is:

```text
uichat-mira/mira-desktop@0e313cf4f2f1ffc791c47334f90439e1e25b077e
```

Use that commit, or earlier Git history, when the full legacy ledger/workboard text is needed for forensic or historical review.

The old master ledger was still being edited as late as 2026-09-09. Its latest pre-archive content can therefore be reconstructed from repository history; it must not be copied forward as a second active management database.

## Archived control surfaces

- `project-control-ledger.md` — former repository-wide master ledger.
- `agent-workboard.md` — early Agent Phase-1 remediation workboard.
- `model-settings-workboard.md` — model-settings roadmap workboard.
- `agent-nodes-workboard.md` — already archived before this cleanup; retained as historical evidence.
- `governance-principles.md` — former repository-wide delivery governance contract, now superseded by Organization policy plus repository-local `AGENTS.md`.

Historical task cards, reviews, phase conclusions, decisions, and test evidence remain in place. They are not bulk-moved because their paths are useful evidence references and Git already preserves their chronology.

## Current authority after Organization governance

Current work management follows the Organization source-of-truth model:

```text
GitHub Issue          = work-item contract + outcome
Project Status        = coarse workflow position
Organization fields   = Priority / Effort / dates
PR / Review / CI      = implementation + verification evidence
feat/dev/test/prod    = environment position
uichat-mira/.github   = Organization policy / SOP
repository code/docs  = current technical reality / repository-specific contract
```

Repository-local historical ledgers must not recreate these responsibilities.

## Current policy anchors

- `uichat-mira/.github/AGENTS.md` — Organization AI collaboration entry.
- `uichat-mira/.github/docs/governance/source-of-truth.md` — source-of-truth ownership.
- `uichat-mira/.github/docs/engineering/testing-standard.md` — shared verification language and gates.
- `uichat-mira/mira-desktop/AGENTS.md` — Desktop-specific implementation and verification constraints.

## Reading rule

Use legacy project-control material to answer:

- how a historical decision was reached;
- what an old task card required;
- what evidence existed at that time;
- why a current contract has a particular guard.

Do not use it to answer:

- what work is active now;
- whether an Issue is accepted or closed;
- current Priority / Effort / dates;
- current Project Status;
- current Organization policy;
- current runtime behavior when code or canonical current docs disagree.
