# ToolResult B' Contract and Harness Evidence Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move native and External MCP tools to the frozen neutral `ToolResult` contract while keeping invocation status, stable result records, Evidence, Skill Agent, private WenShu, and wire behavior compatible.

**Architecture:** `ToolResult` is the only Tool implementation return contract. Core invocation normalization separates explicit model content, structured result, and Tool outcome, stores the structured result in the existing invocation record, and projects normalized Evidence by explicit Tool identity. A transient normalized-content side channel feeds existing Harness LLM projection without adding public invocation fields. Main and Skill Agent consumers continue reading `record.evidence`.

**Tech Stack:** TypeScript, Fastify, Vitest, pnpm workspace.

**Spec:** GitHub issue #275, with maintainer decision in #266 and settled contracts in #242/#232.

## Global Constraints

- `ToolResult<S>` has optional `content`, `structuredContent`, and `isError`.
- Harness invocation failure and Tool outcome are separate axes.
- Evidence routing uses Tool identity; no result-shape taxonomy or `resultFamily`.
- Tool implementations do not author bespoke Evidence.
- Existing result/SSE/audit, Approval/Policy, Artifact/Trace, Planner/AgentGraph, CodeGraph, and private WenShu boundaries remain intact.
- External MCP preserves the stable `external_mcp` result wrapper and maps remote CallToolResult content/structuredContent/isError.

## Review Focus

- `{ isError: true }` completes the invocation and projects failed/partial Evidence.
- thrown runtime/transport errors still fail the invocation.
- terminal non-zero remains completed with `commandSucceeded=false`.
- codebase explore degraded/partial retrieval remains intact.
- Main Agent and Skill Agent receive normalized Evidence; private WenShu reuses the helper without global registration.

### Task 1: Neutral ToolResult and invocation normalization

**Files:** `server/src/mcp/core/definitions.ts`, new `server/src/mcp/core/tool-result.ts`, `server/src/mcp/core/invocations.ts`, `server/src/harness/invocations.ts`, focused core tests.

- [ ] Add `ToolContentBlock` and `ToolResult<S>`; change `ToolImplementation.execute` to return `ToolResult`.
- [ ] Add normalization/projector entry points and a transient content store keyed by invocation id.
- [ ] Write and run failing tests for structured fallback, explicit content, Tool `isError`, and thrown failure.
- [ ] Implement normalization while preserving `record.result`, statuses, events, and approval behavior.

### Task 2: Explicit Tool identity Evidence projection

**Files:** new/updated `server/src/harness/evidence-projectors.ts` or core shared projector, `server/src/agent/evidence.ts`, focused evidence tests.

- [ ] Route read/read-open/list/locate, terminal, GitHub, Office, browser, External MCP, codebase explore, and generic results by exact Tool id/definition metadata.
- [ ] Preserve current summaries, retrieval extraction, degraded signals, and terminal semantics.
- [ ] Remove central arbitrary result-field family guessing.

### Task 3: Native Tool migration

**Files:** authored-Evidence Tool implementations under `server/src/mcp/tools` and `server/src/mcp/managed-codegraph` plus tests.

- [ ] Convert returns to `structuredContent` (and explicit `isError` where already represented by Tool outcome).
- [ ] Remove authored `evidence` from Browser, GitHub, Office, expert, and codebase tools.
- [ ] Keep output schemas and observed result payloads unchanged.

### Task 4: Skill Agent and private WenShu

**Files:** `server/src/skills/agent/tool-adapters.ts`, `server/src/skills/agent/pi-core.ts`, related tests.

- [ ] Consume normalized `record.result`, `record.evidence`, and normalized model content.
- [ ] Reuse shared normalization/projector for private WenShu direct execution without global registration or authority changes.
- [ ] Cover approval/resume and Pi details evidence.

### Task 5: External MCP mapping and regression coverage

**Files:** `server/src/mcp/external.ts`, external adapter/blackbox tests, persistence/SSE compatibility tests.

- [ ] Map remote `content`, `structuredContent`, and `isError` into neutral ToolResult while retaining the existing `external_mcp` structured wrapper.
- [ ] Distinguish JSON-RPC/transport failures from remote CallToolResult `isError`.
- [ ] Add regression assertions for stable wrappers and model-facing content.

### Task 6: Verification and cleanup

- [ ] Grep/read-back confirms no Tool implementation authors `evidence` and no arbitrary central shape guessing remains.
- [ ] Run focused tests, server typecheck, and `pnpm check`.
- [ ] Commit the branch and push `refactor/275-tool-result-b-prime`; do not open a PR.
