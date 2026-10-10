# Tool Discovery / Progressive Resolution POC

Status: Draft
Owner: harness / agent-exposure
Last verified: 2026-10-10
Layer: raw-source
Module: Harness
Feature: ToolExposure
Doc Type: research
Issue: #243
Base SHA: 553675edb35ee209660c80d8699cb6e381139230

## Purpose

Isolated, deterministic POC for issue #243. It validates the **smallest useful
implementation of the settled progressive resolution loop** before any
production Planner exposure change, and compares three paths on the same
synthetic catalog:

- **A. current Mira baseline** — real `resolveHarnessToolCandidatesForTurn`
  (`<= 20` eager, `> 20` embedding + rerank top 20, first-20 fallback when
  ranking is unavailable);
- **B. layered capability disclosure** — compact capability/domain catalog →
  tool metadata → concrete Tool schema;
- **C. Tool Search resolver** — optional lexical resolver inside the *same*
  loop for large/dynamic catalogs.

This document is research material. It does not change the production Planner,
Harness exposure, permissions, MCP configuration, or runtime, and it does not
reopen the settled progressive-resolution architecture.

## Explicit non-goals

- No production Planner switch, namespace taxonomy, or MCP product UI.
- No adoption of Pi Codemode / Pi extension runtime / Pi Tool Search as a
  dependency; Pi is a reference implementation only.
- No migration of Mira's Main Agent loop to Pi.
- No removal of embedding/reranker from packaging.
- No vector/FTS/search-engine bake-off; keyword overlap is a POC resolver only.
- No authorization or execution merely because discovery found a Tool.

## Evidence classification (what this POC can and cannot claim)

- **Real source definitions + deterministic synthetic candidate cases.**
  The catalog is built from the real registry/exposure/profile contract using
  anonymous fixed fixtures. The outcome is reproducible.
- **Not a live model benchmark.** No Mira Agent run, no Tool Lab run, no real
  MCP server, no provider call, no live model. Model tool-selection win-rate,
  provider token usage, transport cost, latency, and cache behavior are
  **not_measured** here.
- JSON UTF-8 byte counts are a **structural cost proxy**, not tokens.

## Current code baseline read back from `dev`

- `server/src/agent/nodes/prepare-context.ts` → `matchToolCandidatesByEmbedding`
  → `server/src/agent/intent/embedding-capability-matcher.ts` →
  `server/src/harness/candidates-core/resolver.ts`.
- `server/src/harness/exposure-core/resolver.ts` projects internal/external
  eligibility and the model Workspace Edit facade.
- `server/src/harness/candidates-core/resolver.ts`: public tool set `<= 20`
  exposes everything; `> 20` uses embedding + rerank and exposes top 20;
  missing query / empty profiles / embedding failure falls back to a
  deterministic **first 20** (`fallbackTop20`).
- `server/src/harness/exposure-core/filters.ts`: external MCP exposure requires
  the explicit Agent Access allowlist; no native runtime-readiness gate lives
  here (that governance gap is owned by #292).
- `server/src/harness/profiles/resolver.ts`: internal capability blueprints
  (`workspace_lookup`, `workspace_edit`, `web`, `browser_computer_use`,
  `browser_attached`, `terminal_execution`, …) plus a per-tool fallback profile.
- `server/src/harness/edit-facade.ts` + `exposure-core/resolver.ts`: selective
  Workspace Edit materialization (`primitives` vs `apply_patch`), a positive
  precedent reused by the POC.

## Progressive resolution model under test

Loop shape:

```
known core (eager) + compact capability catalog
        ↓ resolve capability        (consumes 1)
tool metadata disclosed
        ↓ resolve/declare tool      (consumes 1)
concrete Tool schema declared  → normal Normalize / Policy / Approval / Harness
```

Rules encoded in `server/src/harness/candidates-core/tool-discovery-poc.ts`:

- distinct configurable resolution budget; Phase 2 default `8`
  (`PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT`);
- budget is consumed only by **additional** capability resolution/disclosure;
- idempotent re-resolution (`already_disclosed`) does not consume;
- budget exhaustion returns `budget_exhausted` and never implies completion; the
  session keeps already-disclosed capabilities usable;
- disclosure is visibility/schema only (`declarationOnly: true`) and never
  grants invocation authority;
- negative outcomes are distinguishable: `not_found`, `unavailable`,
  `not_authorized`, `budget_exhausted`, `already_disclosed`;
- capability descriptions stay coarse; Tool metadata/schema stays precise;
- `preferredToolId` is not treated as an implicit default action.

This helper is **not exported from the production barrel**
(`server/src/harness/candidates-core/index.ts` is unchanged), so it is not part
of the production import graph.

## Test entry and verification commands

Primary directed test:

```
server/src/harness/candidates-core/tool-discovery-poc.test.ts
```

Caller-fixed verification commands:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @ui-chat-mira/server exec vitest run src/harness/candidates-core/tool-discovery-poc.test.ts
pnpm --filter @ui-chat-mira/server typecheck
```

Worker execution note: this Worker had repository read/search/edit/write access
only — no shell/terminal. The commands above are executed by the trusted GitHub
Actions verification step; this document does not represent them as run by the
Worker.

## Acceptance mapping

| Acceptance criterion | Where covered |
| --- | --- |
| Baseline measured, not remembered | baseline tests: `<=20` eager, `>20` ranking/top-20, embedding-unavailable first-20 fallback |
| Skill-style progressive disclosure on a realistic catalog | layered tests: compact catalog → metadata → schema; budget steps |
| Tool Search as optional resolver + combined case | Tool Search tests + combined compact → search → `apply_patch` schema |
| Pi declared/callable/registered + exposure modes assessed | reference assessment section below |
| Mixed native + MCP-adapted Tools, same governance | governance test: same exposure path; both `requiresApproval` |
| No-match, wrong-match, unavailable/degraded, recovery | `not_found`, `unavailable`, `not_authorized`, baseline missing-gold then loop recovery |
| Context/token/latency captured or marked | bytes measured structurally; tokens/latency **not_measured** |
| Decision brief, no loop reopen | recommendation section |
| Reusable loop, not Tool-Search-only | helper models one loop with capability/tool/search steps |
| Distinct budget default 8 | `PROGRESSIVE_RESOLUTION_BUDGET_DEFAULT = 8` + budget tests |
| Budget only for resolution/disclosure | idempotency + eager-core + ordinary-step assertions |
| Exhaustion ≠ completion | exhaustion tests assert disclosed capabilities remain |
| Recovery budget separate | POC leaves failure/no-progress recovery to existing policy |
| Maintainer decision recorded | open (below); production owner unassigned |

## Pi 1.0.2 reference assessment

From the maintainer-supplied primary source
(`packages/coding-agent/docs/mcp.md`):

- **Accepted as reference:** registered / callable / declared separation; per
  server and per individual-tool exposure override; `searchTools` /
  `describeTool`-style lookup returning metadata rather than executing;
  compact pre-schema descriptions.
- **Rejected for Mira:** Pi Codemode execution runtime, Pi extension runtime,
  adopting Pi Tool Search as a dependency, and migrating the Mira Main Agent
  loop. Mira already owns Normalize / Policy / Approval / Harness; the POC
  reproduces the useful disclosure seam without those runtimes.

Other primary sources supplied for context and used only as directional
references (not implemented): OpenAI Tool Search hosted/client-executed and MCP
deferred loading; VS Code tool sets; Gemini CLI ToolRegistry. Independent
network refresh of these links was not available to this Worker and is marked
as a validation gap.

## Decision brief (recommendation, not a maintainer decision)

Recommendation: **adopt the layered capability disclosure loop as the single
progressive-resolution seam, and treat Tool Search as an optional resolver step
inside it** — not as a separate control path. Start with a compact,
authorization-filtered capability catalog plus eager high-frequency core; add
Tool Search only when a large/dynamic MCP catalog makes hierarchical disclosure
insufficient. Keep the distinct configurable resolution budget (default 8) and
keep discovery strictly separate from Policy/Approval/invocation.

Prefer this over a Tool-Search-only design because:

- it preserves the full accepted capability surface (reachability) while
  reducing prompt load;
- it reuses the existing single Tool source of truth (Registry → eligibility →
  exposure) instead of creating a second registry/authority;
- it matches the settled loop and the product principle *simple, smart, without
  unnecessary complexity*.

**This card does not perform a production migration.** Production adoption still
requires: a real mixed registry/MCP dataset, same model/provider/budget task
comparison, measured tool hit-rate, token/latency/cache data, the resume/
approval state machine, and coordination with #292 readiness. #245 cannot start
removal work until a maintainer decision selects the production path and that
path has accepted implementation evidence.

## Maintainer decision

Open. No maintainer decision has been recorded in this run; the explicit choice
of which card/change owns the production progressive-disclosure implementation
is still required before any production migration starts.
