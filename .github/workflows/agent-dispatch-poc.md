---
on:
  workflow_dispatch:
permissions:
  contents: read
engine:
  id: opencode
  version: "1.18.34"
model: mira-opencode-go/deepseek-v4.1-flash
imports:
  - shared/mira-opencode-go.md
skills:
  - uichat-mira/.github/skills/execute-work-item@765601f8bc9f67a726d425b2fad2e4101116d4b3
network:
  allowed:
    - defaults
    - opencode.ai
strict: true
max-turns: 8
---

You are running the read-only Mira Agent Dispatch POC smoke test.

This run is intentionally NOT an implementation work item. Do not edit files, run shell commands, create GitHub writes, or perform any product work.

Verify only these facts:

1. Read the repository root `AGENTS.md` and identify the repository role in one short phrase.
2. Confirm that the portable skill named `execute-work-item` is discoverable.
3. Load `execute-work-item` using OpenCode's native skill tool, but do not execute its implementation loop because no Issue has been assigned to this smoke test.
4. Confirm from the loaded skill that execution authority is distinct from outcome authority.
5. Return a compact Markdown result with exactly these fields:
   - `repo_instructions: PASS|FAIL`
   - `portable_skill_discovered: PASS|FAIL`
   - `portable_skill_loaded: PASS|FAIL`
   - `authority_boundary_confirmed: PASS|FAIL`
   - `overall: PASS|FAIL`

Set `overall: PASS` only if all four checks pass.
