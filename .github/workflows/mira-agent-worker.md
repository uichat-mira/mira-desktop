---
name: Mira Agent Worker POC
description: Proves gh-aw + OpenCode Go + DeepSeek + portable Agent Skills before enabling real work-item dispatch.
on:
  push:
    branches:
      - feat/agent-dispatch-poc
    paths:
      - .github/agent-dispatch-poc-trigger
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
checkout:
  ref: dev
  fetch-depth: 1
network:
  allowed:
    - defaults
    - opencode.ai
tools:
  bash: false
  cli-proxy: false
  github: false
safe-outputs:
  # Explicit non-builtin output suppresses gh-aw's default create-issue fallback.
  # The read-only probe never invokes it.
  upload-artifact:
    max-uploads: 1
    retention-days: 1
    allowed-paths:
      - ".github/agent-dispatch-poc/**"
  missing-tool:
    create-issue: false
  missing-data:
    create-issue: false
  report-incomplete:
    create-issue: false
  noop:
    report-as-issue: false
  report-failure-as-issue: false
  report-failed-jobs: false
  threat-detection: false
timeout-minutes: 15
strict: true
max-turns: 8
---

# Mira Agent Worker POC

This run is a read-only wiring probe. It is intentionally NOT an implementation work item.

Do not edit files, run shell commands, call GitHub APIs, create outputs, or perform product work.

Prove the following chain using evidence available inside the checked-out repository and the installed Agent Skill:

1. Read the repository root `AGENTS.md` and identify the repository role in one short phrase.
2. Read `package.json` only to prove ordinary repository file access works.
3. Confirm that the portable Skill named `execute-work-item` is discoverable.
4. Load `execute-work-item` with OpenCode's native `skill` tool.
5. Confirm from the loaded Skill that execution authority is distinct from outcome authority.
6. Do NOT execute the Skill's implementation loop because no Issue has been assigned to this smoke test.

Return exactly this Markdown shape:

- `repo_read: PASS|FAIL`
- `portable_skill_discovered: PASS|FAIL`
- `portable_skill_loaded: PASS|FAIL`
- `authority_boundary_confirmed: PASS|FAIL`
- `overall: PASS|FAIL`
- `evidence: <one compact sentence>`

Set `overall: PASS` only if all four checks pass.
