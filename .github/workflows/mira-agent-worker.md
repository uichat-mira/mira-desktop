---
name: Mira Agent Worker POC
description: Proves gh-aw + OpenCode Go + DeepSeek + portable Agent Skills before enabling real work-item dispatch.
on:
  push:
    branches:
      - feat/agent-dispatch-poc
    paths:
      - .github/workflows/mira-agent-worker.lock.yml
      - .github/agent-dispatch-poc-trigger
  workflow_dispatch:
permissions:
  contents: read
  issues: read
  pull-requests: read
engine:
  id: opencode-go
  version: "1.18.34"
model: opencode-go/deepseek-v4-flash
imports:
  - shared/opencode-go.md
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
  github:
    toolsets: [repos, issues, pull_requests]
  edit:
  bash:
    - "*"
safe-outputs:
  # A harmless non-builtin output prevents gh-aw v0.89.21 from auto-injecting
  # create-issue as its default fallback. The probe does not call this tool.
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
timeout-minutes: 20
strict: true
---

# Mira Agent Worker POC

This run is a wiring probe. Do not modify any repository file and do not create,
update, close, or accept any GitHub work item.

Prove the following chain using real evidence from this run:

1. Confirm the checked-out repository is `uichat-mira/mira-desktop` at `dev`.
2. Read the repository root `AGENTS.md`.
3. Through the GitHub tool, fetch the current `main` version of
   `uichat-mira/.github/AGENTS.md` and identify its current `Policy revision`.
4. Locate the installed `execute-work-item` portable Agent Skill under the
   engine skill directory, read its `SKILL.md`, and identify its completion
   boundary.
5. Read `package.json` only to prove ordinary repository file access works.

Do not edit files. Do not run builds or tests for this probe.

When all five checks are backed by observed evidence, invoke the `noop` safe
output exactly once. Its message must start with `MIRA_AGENT_POC_OK` and include
the observed Organization policy revision plus the installed Skill path.

If any check cannot be proven, invoke `noop` exactly once with a message starting
with `MIRA_AGENT_POC_BLOCKED` and state the exact missing capability or evidence.
Do not invent a substitute.
