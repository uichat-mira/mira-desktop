---
status: historical
owner: docs
last_verified: 2026-09-19
layer: project-control-history
module: ProjectControl
feature: LegacyProjectControlArchive
doc_type: historical-index
canonical: false
---

# Legacy Project Control Archive — 2026-09-19

This directory freezes the retired repository-local project-control surfaces that predate Mira Organization governance.

Archive boundary:

```text
uichat-mira/mira-desktop@b2403eda97665868844b05ccda1d6e75851e30fc
```

## Archived surfaces

- `README.md` — former active Project Control index.
- `project-control-ledger.md` — former repository-wide master ledger.
- `agent-workboard.md` — former Agent remediation workboard.
- `agent-nodes-workboard.md` — former Agent node workboard.
- `model-settings-workboard.md` — former model-settings workboard.
- `governance-principles.md` — former repository-wide governance contract.

These copies are historical evidence only. Their old task states, review queues, priorities, and policy language must not be used as current truth.

Current ownership:

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

Exact original bytes remain recoverable from Git history at the archive boundary above.
