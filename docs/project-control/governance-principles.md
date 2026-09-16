---
status: superseded
owner: docs
last_verified: 2026-09-16
layer: project-control-history
module: ProjectControl
feature: GovernancePrinciples
Doc Type: historical-contract
canonical: false
superseded_by:
  - https://github.com/uichat-mira/.github/blob/main/AGENTS.md
  - https://github.com/uichat-mira/.github/blob/main/docs/governance/source-of-truth.md
  - https://github.com/uichat-mira/.github/blob/main/docs/engineering/testing-standard.md
related:
  - README.md
  - archive/pre-organization-governance-index.md
  - ../../AGENTS.md
---

# Project Governance Principles — Superseded Compatibility Entry

> Superseded by Mira Organization governance plus the repository-local `AGENTS.md`.

This file previously defined repository-wide delivery governance, evidence layers, black-box smoke expectations, environment/configuration rules, review gates, and stop-the-line conditions.

Those concerns now have canonical owners:

- Organization-wide authority and collaboration rules: `uichat-mira/.github/AGENTS.md`;
- source-of-truth ownership: `uichat-mira/.github/docs/governance/source-of-truth.md`;
- shared verification layers and promotion gates: `uichat-mira/.github/docs/engineering/testing-standard.md`;
- Desktop-specific constraints, commands, risk gates, and delivery requirements: repository root `AGENTS.md`.

Do not update this file as a parallel policy document. When Desktop needs a repository-specific exception or stronger local rule, put it with the owning repository contract instead of restoring a second Organization policy copy here.

The full former governance document remains available in Git history at:

```text
uichat-mira/mira-desktop@0e313cf4f2f1ffc791c47334f90439e1e25b077e
```

See [`archive/pre-organization-governance-index.md`](archive/pre-organization-governance-index.md) for the archive map.
