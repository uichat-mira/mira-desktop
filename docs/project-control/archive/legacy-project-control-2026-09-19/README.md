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


## Successor authority rule

Archived stream rows do **not** imply a live successor.

Do not translate an old stream name, `TODO`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `DONE`, blocker, priority, or acceptance gate into current state unless a current GitHub Issue explicitly adopts that work-item contract.

If no current GitHub Issue adopts a historical stream, this archive makes **no claim that the stream is active**. This is intentional: creating a prose “stream -> successor” table here would recreate the second ledger this archive is retiring.

For current work:
1. inspect current GitHub Issues for the work-item contract/outcome;
2. inspect Project Status / Organization fields for management metadata;
3. inspect PR / Review / CI for implementation evidence;
4. inspect code/config/runtime for technical reality.

## Inbound-link compatibility decision

Old repository documents may still link to the retired root filenames such as `project-control-ledger.md`, `agent-workboard.md`, or `governance-principles.md`.

Those links are intentionally allowed to land on the short retirement stubs at the old paths. The stub is the compatibility boundary: it tells the reader that the old authority is retired and points to the full snapshot here.

Current/canonical documentation must not use those stubs as a current authority source. The docs index, Vault, Engineering Memory, Current Product Truth, Documentation Standards, and Forge current contract were updated in this cleanup to remove that authority relationship.

Historical task cards, reviews, decisions, and phase conclusions are not bulk-rewritten merely to make old links look modern; their links remain part of the historical evidence chain.


## Archived link behavior

The archived copies were relocated from `docs/project-control/`. Their Markdown relative links are rewritten for the archive location so historical navigation remains usable:

- links to the other retired control surfaces stay inside this archive;
- links to historical `tasks/`, `reviews/`, `decisions/`, phase conclusions, and current domain docs resolve back to their existing repository paths;
- archive frontmatter does not keep the old live `related` / `superseded_by` graph edges.

This rewriting is archive metadata/navigation only. Exact original bytes remain recoverable from Git history at the archive boundary.
