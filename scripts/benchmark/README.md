# Mira Agent Core Benchmark — external executor / reference runner (#221)

This directory contains the **external local executor / reference runner** for the
Mira Agent Core Benchmark v0.1 contract
([`docs/development/agent-core-benchmark-v0.1.md`](../../docs/development/agent-core-benchmark-v0.1.md),
issue #216).

Scope of this runner (issue **#221**): drive Mira, isolate repetitions, observe
execution to a terminal state, apply mechanical approval/resume/timeout control,
and expose the **raw execution events** plus **structured executor/control facts**
that the Recorder (#223) consumes.

It deliberately does **not** implement the Recorder / Report work owned by #223
(`manifest.json`, `trajectory.jsonl`, `result.json`, `judge-input.json`,
`summary.json`, `report.md`, deterministic scoring/aggregation, public projection),
and it never scores semantic quality.

## What it reuses (no production code is changed)

The runner drives a **running Mira backend** through the existing product
control surface only:

| Capability | Existing interface |
| --- | --- |
| environment preflight | `GET /health`, `POST /login` |
| fixture binding | `POST /chat-workspaces` (`rootPath`) + `POST /threads` (`workspaceId`) |
| submit a case | `POST /proxy/chat/:provider` (`agentEnabled: true`) — provider is explicit per selected case; no implicit `default` fallback |
| raw execution events | `data-execution-node` SSE frames + persisted `execution-node` message parts (`GET /threads/:id/messages`) |
| terminal-state polling | `GET /agent/runs/:runId` |
| approval / resume | `run.pendingApproval` + `POST /agent/runs/:runId/approve` |
| cancel | `POST /agent/runs/:runId/cancel` |
| cleanup | `POST /threads/:id/archive`, `DELETE /chat-workspaces/:id` |

No new observability framework, no Agent/Harness/approval/resume/runtime edits.

## Prerequisites

- Node.js 20+ and `pnpm`.
- A Mira backend running with the provider named by each selected case. The runner
  never fabricates a model and never silently falls back to `default`; the backend
  still resolves model/provider configuration from its own `model_configs` /
  `provider_connections`.
- Login credentials for that backend. **The runner has no default credentials**
  and never logs in with a baked-in password; supply them via
  `--username`/`--password` or `MIRA_BENCH_USERNAME`/`MIRA_BENCH_PASSWORD`.
  Preflight fails clearly if they are missing.

### Starting a backend for a dry-run (Intel macOS)

To avoid writing benchmark data into the normal dev database, run the backend
against a throwaway copy:

```bash
# 1) consistent copy of the dev DB (keeps provider/model config incl. encrypted key)
sqlite3 server/data/uichat-rag-test.db \
  ".backup '.test-artifact/agent-core-benchmark/db/runner.db'"

# 2) start the backend against the copy on a scratch port
cd server
DATABASE_URL="file:$PWD/../.test-artifact/agent-core-benchmark/db/runner.db" \
UI_CHAT_BACKEND_PORT=8799 \
node ./node_modules/tsx/dist/cli.mjs src/index.ts
```

`GET /health` must return `{"success":true,...}` before running the runner.

## Running

```bash
# preflight only
MIRA_BENCH_USERNAME=Tomz MIRA_BENCH_PASSWORD=... \
node scripts/benchmark/agent-core-runner.mjs \
  --base-url http://127.0.0.1:8799 --preflight-only

# drive the selected cases (see selection.json)
MIRA_BENCH_USERNAME=Tomz MIRA_BENCH_PASSWORD=... \
node scripts/benchmark/agent-core-runner.mjs \
  --base-url http://127.0.0.1:8799 --keep-fixture
```

Options: `--username`, `--password`, `--selection <file>`, `--out <dir>`,
`--cases <id,id>`, `--repetitions <n>`, `--poll-interval-ms <n>`,
`--max-wait-ms <n>` (runner safety bound, **not** a case cutoff),
`--cancel-after-ms <n>` (executor control-path smoke, **not** a case cutoff).

### Guardrails (no silent green)

The runner fails fast instead of quietly doing nothing:

- `--cases` ids must each exist in both `selection.json` and the case set; an
  unknown id is an error.
- The resolved case set must be non-empty.
- `--repetitions` must be a positive integer (`0`, negatives, `NaN`, floats are
  rejected — they are not silently ignored).
- A failed repetition is recorded in the results with its error and makes the
  process exit non-zero; it is never dropped.
- Every selected case must declare an explicit safe provider id; missing/invalid
  provider values are selection errors, and the HTTP route uses that exact provider.
- The current #221 control surface supports `approvalPolicy: "auto-approve"` only.
  `deny`/reject is rejected during selection resolution because Mira exposes no
  benchmark reject endpoint; the runner never records a denial it did not send.

`selection.json` only decides which cases to drive, the explicit provider, which
fixture each needs, the supported mechanical approval policy, and the per-case
comparability classification. Case
**prompts** come from the case-set manifest
(`docs/development/agent-core-benchmark-v0.1-case-set-rc1.json`), so they are not
duplicated here.

## Output bundle

Per repetition under `<out>/<timestamp>/<case-id>/rep-<n>/`:

| File | Content |
| --- | --- |
| `execution-events.ndjson` | raw persisted execution-node events, verbatim (full history incl. resumed segments) |
| `stream-frames.ndjson` | raw SSE frames from the live turn(s) |
| `agent-run.json` | raw terminal `GET /agent/runs/:runId` payload |
| `workspace-manifest.{before,after}.json` | normalized path + bytes + SHA-256 |
| `workspace-diff.json` | added / removed / modified paths |
| `assistant-transcript.txt` | assistant text (human/debug only) |
| `executor-facts.json` | structured executor/control facts below |

### `executor-facts.json` (structured facts for #223)

- `hostPlatform` — OS/arch/release/hostname/node (separate from model platform).
- `executionMode` + `classificationRationale` + `comparabilityImpact` —
  `canonical | adapted | noncanonical`, with the explicit comparability impact for
  non-canonical runs (required, not free-form).
- `actualProcedure` / `referenceProcedure` — transport, endpoints, steps, deviations,
  reason for deviation, comparability impact.
- `executorInterventions` — approval / cancel / user_reply actions taken.
- `approval` — count, resume count, event list.
- `failureRetry` — tool failures, repeated semantic action count.
- `subagent` — Generic SubAgent starts.
- `toolExecutions` — tool id / status / input hash / duration.
- `plannerIterations`.
- `terminal` — status, terminal reason, blocked reason, selected tool.
- `finalization` — `hasRequiredFinalization`, `plannerTerminalType`, `finalizationEvidenceRefs`.
- `elapsed` — monotonic start/end + `elapsedMs`.
- `timing` — calibration mode, `tSoftMs`/`tHardMs`, soft/hard flags, cancel flag,
  runner safety bound flag.
- `observability` — per-signal `{ expected, present }` map plus a structured `gaps`
  list; each expected-but-missing execution-node fact becomes a
  `{ signal, expectedFrom, detail }` gap entry rather than a silent `null`.
  Expectations are scoped to the terminal state (completion facts are expected for
  `completed`/`waiting_user`, not for a cancelled/blocked/failed run), so a genuine
  observability failure is distinguishable from an early-terminated run. Also
  mirrored as `observerGaps`.
- `workspace` — before/after manifest hashes, diff, external target hashes.
- `notes`, `observerGaps`.

## Calibration mode

The RC case set stores `tSoftMs = null` / `tHardMs = null`
(see `docs/development/agent-core-benchmark-v0.1-calibration.md`). When timing is
not frozen the runner:

- starts a monotonic timer immediately before submitting the case to Mira;
- records complete elapsed time;
- **does not invent** a soft/hard cutoff and does not fail a case for having no
  timeout. `timing.calibrationMode = true`.

Once #220 freezes per-case `T_soft`/`T_hard`, the same runner applies the #216
soft-timeout / hard-cutoff behaviour (`softTimeoutSeen`, `hardCutoffApplied`,
`cancelRequested`).

Because a run with no timeout still needs a liveness bound, the runner has a
`--max-wait-ms` safety bound. When it trips it is recorded separately as
`timing.runnerSafetyCapReached`; it is not treated as a case timing cutoff.

## Platform and execution classification

Windows 11 + PowerShell 7 is the reference baseline. Acceptance is
platform-neutral: the same HTTP control surface, model access path, fixture,
governance and observability semantics are used on Intel macOS, so dry-runs here
are recorded as `adapted` (a different executor script/host with equivalent test
conditions), not `noncanonical`.

## Fixtures

Fixtures are materialized deterministically from `lib/fixtures.mjs`:

- `beginner-workspace-v0.1` — shared Beginner fixture (all 9 Beginner cases).
- `i08-health-call-chain-v1` — Intermediate I08 read-only call-chain fixture.
- `adv08-workspace-boundary-v1` — Advanced ADV-08 workspace-boundary fixture,
  including one workspace-external target that the runner hash-monitors.

Each repetition resets the fixture to its exact manifest before starting, so
repetitions do not leak state.

## Limitations / non-goals

- No semantic scoring, no Recorder schema, no report aggregation (all #223).
- No GUI coordinate clicking; control is purely scriptable HTTP.
- Not a three-platform official runner.
- The executor does not solve the task. It only submits the frozen prompt and
  applies the selected supported approval policy. For #221 that policy is explicitly
  `auto-approve` (approve the exact frozen invocation). A deny/reject policy is not
  implemented by the current Mira control surface, so selection rejects it instead
  of pretending a denial occurred.
