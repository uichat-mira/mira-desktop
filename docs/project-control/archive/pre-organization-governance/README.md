---
status: current
owner: docs
last_verified: 2026-07-05
layer: project-control
module: ProjectControl
feature: Workboard
doc_type: index
canonical: true
related:
  - AGENTS.md
---

# Project Control

This directory is the project control center for active remediation, review, decision tracking, and phase-based archival work.

It is not a general documentation area. Do not place product guides, architecture references, UI specs, or implementation notes here unless they are directly tied to task control, review evidence, or owner decisions.

## Purpose

`docs/project-control/` exists to keep project work grounded in explicit task boundaries and verifiable evidence.

Use this directory to answer:

- what is currently being worked on
- which task package is active
- what is blocked
- what has been submitted for review
- what evidence exists for completed work
- which decisions have already been accepted
- what has been archived from previous phases

Do not use AI thread memory as the source of truth for project status.

## Directory Layout

```text
docs/project-control/
  README.md
  governance-principles.md
  project-control-ledger.md
  model-settings-workboard.md
  agent-workboard.md
  testEvidence/
    agent-nodes-V1.5 全新线程复测.md
  phase-conclusions/
    agent-nodes-V1.5 终审.md
    agent-phase-1-2-archive-decision.md
  tasks/
    T-001-example-task.md
  reviews/
    agent-phase-1-global-review.md
  decisions/
    D-001-example-decision.md
  archive/
    2026-06-agent-phase-1/
      workboard.snapshot.md
      tasks/
      reviews/
      decisions/
```

## File Responsibilities

### `governance-principles.md`

The delivery governance contract for high-risk work.

It defines evidence levels, black-box smoke requirements, environment and hardcoded configuration rules, review gates, and stop-the-line conditions.

Read it before starting AgentGraph, Harness, tool execution, approval, runtime, packaging, or other high-risk task packages.

### `project-control-ledger.md`

The single project-level control ledger.

All active project streams, review queues, blockers, and task indexes must be recorded here. Do not create another project-level workboard. Older workboards may remain as evidence sources, but they are not the current project ledger.

Task status is sourced from each task card's `task_state`. The ledger summarizes and indexes task status; it must not override a task card.

### `model-settings-workboard.md`

Model settings 专项工作台账。

It tracks the `modelset_` task package for model role expansion, image generation providers, custom provider instances, and the model settings UI refinement. It is scoped to this model settings roadmap and does not replace `project-control-ledger.md`.

### `agent-workboard.md`

Legacy Phase-1 remediation workboard.

It is retained as evidence and historical context. It is not the current project-level control ledger.

### `agent-nodes-workboard.md`

Legacy Agent node workboard.

It is retained as evidence and historical context. It is not the current project-level control ledger.

### `testEvidence/`

Test evidence and black-box smoke records.

Put concrete verification records here when they are larger than a task card should carry. Link to them from task cards and `project-control-ledger.md`.

### `phase-conclusions/`

Stage or phase conclusion documents.

Put final review summaries, phase conclusions, and owner acceptance summaries here. These files may cite test evidence, but they are not test evidence by themselves.

### `tasks/`

One task card per task package.

Each task card must define:

- task target
- allowed files or areas
- forbidden files or areas
- acceptance criteria
- verification steps
- evidence requirements
- known risks or blockers

A task card is the source of truth for the scope of that task.

### `reviews/`

Review documents used as evidence or planning input.

Reviews may explain why a task exists, but they are not executable task instructions by themselves.

### `decisions/`

Accepted owner or architecture decisions.

Use decision files to prevent repeated discussion of settled questions.

Each decision should record:

- the decision
- the reason
- affected areas
- rejected alternatives
- follow-up tasks, if any

### `archive/`

Historical snapshots from completed phases.

Archived files are reference material only. They must not override the active workboard or current task cards.

## Task Status Values

Only use these task states:

- `TODO`: not started
- `IN_PROGRESS`: implementation or review is active
- `BLOCKED`: cannot proceed without owner decision or missing information
- `READY_FOR_REVIEW`: changes are submitted with evidence and waiting for review
- `DONE`: accepted with evidence
- `DROPPED`: intentionally abandoned

Do not report progress by percentage.

Do not use soft completion wording such as "basically done", "almost done", or "mostly complete".

## Evidence Rules

A checklist item may be marked done only when it has concrete evidence.

Valid evidence includes:

- changed files
- relevant code locations
- diff summary
- test command output
- verification result
- documented manual check
- explicitly listed remaining gaps

A task may be marked `DONE` only when:

- all acceptance criteria have evidence
- forbidden files or areas were not modified
- verification was run, or the reason for not running it is documented
- unfinished items and risks are listed
- the project owner or review step accepts the result

## Remediation Workboard Rules

When an implementation thread completes one task package, it may update only its own task card status.

Do not change the overall remediation workboard entry for the parent review item from `OPEN` to `DONE` just because one implementation thread finished a local patch.

If the thread has produced code changes, tests, verification output, or acceptance evidence, put that evidence in the task card under `tasks/`.

For code changes, the task card evidence should include both:

- the `vitest` command and result for the directly affected scope, or the explicit reason it was not run
- the `typecheck` command and result for the directly affected package, or the explicit reason it was not run

Keep `agent-workboard.md` short:

- it may link to the task card
- it may keep the review item open until the project owner or review flow decides the parent item is accepted
- it must not duplicate detailed implementation evidence that belongs in the task card

## Task Lifecycle

Use this flow for active remediation work:

```text
review finding -> task card -> workboard entry -> implementation -> evidence submission -> review -> accepted or returned -> archive when phase ends
```

Do not let an implementation thread define its own task scope.

Do not merge unrelated tasks into one execution batch unless the project owner explicitly approves that grouping.

## Active Work Rules For AI Threads

When starting a task, read:

- `AGENTS.md`
- this `README.md`
- `agent-workboard.md`
- the active task card under `tasks/`

Before modifying code, restate:

- task target
- allowed files or areas
- forbidden files or areas
- acceptance criteria
- verification steps

After completing work, report:

- changed files
- diff summary
- verification commands and results
- acceptance criteria evidence
- unfinished items
- risks
- whether any forbidden area was touched

If a high-risk gate is triggered, stop and ask the project owner before implementing any workaround, fallback branch, compatibility shim, downgrade path, or alternative execution path.

## Archive Rules

At the end of a phase:

- record the phase-level conclusion under `phase-conclusions/`
- link the conclusion from `project-control-ledger.md`
- keep historical task cards in place unless the project owner explicitly approves a move
- if a dated archive directory is needed, use it for historical snapshots, not as a second active ledger
- keep only active or upcoming work in the single live project control ledger

Archived material should remain readable, but it should not compete with current project truth.

## Non-Goals

This directory is not for:

- general product documentation
- UI component documentation
- runtime architecture documentation
- API reference documentation
- scratch notes
- AI conversation dumps
- unfinished brainstorming without a task or decision link

Use the normal documentation tree for those materials.
