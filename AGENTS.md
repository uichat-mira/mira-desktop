# AGENTS.md

## Project Identity

UIChat Mira is a local-first desktop workspace with an Electron shell, a React renderer, and a bundled Fastify backend.

The app is a pnpm workspace using React, Vite, Electron, Fastify, TypeScript, and SQLite.

If other docs, comments, or legacy files still mention `UI Chat RAG Tester`, treat that as historical naming and verify the current product name against `README.md` and active runtime docs before propagating it further.

## Source Of Truth

- Start with `README.md` for project overview, development entry points, and packaging commands.
- Use `docs/README.md` as the central documentation index.
- Treat `docs/archive/` as historical reference only, not current product truth, unless the live code or active docs confirm the same behavior.
- Read `docs/architecture/README.md` before changing runtime boundaries, networking, or packaging flow.
- Read `docs/architecture/ipc-and-preload.md` before changing preload exposure, renderer/native boundaries, or IPC design.
- For chat UI work, read `docs/uchat.md` first.
- Shared UI component docs remain source-adjacent in `desktop/src/shared/ui/COMPONENTS.md` and `desktop/src/shared/ui/ui-design-guidelines-tailwind.md`.

## Scope And Boundaries

- AGENTS.md defines global rules only. For concrete implementation work, the active task card defines allowed files, forbidden files, acceptance criteria, and verification steps.
- Before starting work, restate the target, the files or areas that are allowed to change, the files or areas that are forbidden to change, and the acceptance criteria for the current task package.
- Work on one task package at a time. Do not merge multiple independent asks into a single execution batch unless the project owner explicitly approves that grouping.
- Do not modify unrelated modules, files, or architectural layers beyond the approved scope of the current task package.
- The project core feature set is now mostly settled. Treat any planned refactor or rewrite as high risk and assess its impact on existing behavior first.
- Before replacing an existing implementation, read the relevant docs and in-code comments first, then obtain explicit approval from the project owner.
- Keep renderer code free of direct Node APIs.
- Expose native and runtime details through preload.
- Keep backend route paths prefix-free unless the server itself explicitly registers a route prefix.
- Do not manually edit `pnpm-lock.yaml`.

## Working Protocol

- If local source code, local types, local package contents, or git history can verify a behavior, inspect them first. Do not drive code changes from guesses, wording like "maybe/probably", or inferred behavior that has not been checked locally.
- When handling a bug, first determine whether it is architecture-level or business-level. Do not treat all defects as local implementation issues by default.
- If a bug is architecture-level, or the likely fix may change runtime boundaries, protocol contracts, state ownership, persistence semantics, or other core structure, explicitly tell the project owner that the fix may require core architectural changes and wait for confirmation before proceeding.
- Never silently repair a bug without first communicating its severity, layer, and expected impact. This includes “small” patch-style fixes such as unapproved workarounds, compatibility shims, fallback branches, or local patches.
- When debugging a concrete defect, prefer a minimal reproducible check at the failing layer first, then state the cause. Do not keep asking the project owner to retest while the failure has not been pinned to a verified code path.
- If a bug has already been solved before and a new fix attempt is stuck after multiple rounds, stop re-deriving it from scratch and review the historical branches or commits for the prior solution path.
- Do not add `hardcoded local path`, temporary fallback, mock default, or silent fallback to the main flow just to make manual verification pass.
- If temporary verification logic is necessary, keep it only in test files or behind an explicit `DEBUG` configuration switch. Do not let that logic enter production code paths by default.
- Put test temporary artifacts under the repository root `.test-artifact/` directory. This includes SQLite main files and companion files such as `*.sqlite-wal`, `*.sqlite-shm`, `*.db-wal`, and `*.db-shm`. Do not place these files next to business data or source files, and do not commit them into version control.
- Unless there is already an explicitly confirmed business requirement for compatibility, do not add fallback logic in backend code. If compatibility behavior, downgrade paths, or silent兜底 seem necessary, stop and align on the design with the project owner first.
- If fallback or compatibility logic is explicitly approved and must remain, add a succinct comment explaining why it exists, which concrete failure mode it protects, and when it should be removed.
- If you find legacy code that is no longer applicable and does not affect current behavior, remove it during development instead of keeping dead paths around.
- Distinguish capability from tool usage precisely: capability is the intent or responsibility layer, while a tool is the concrete execution mechanism. Do not use the two terms interchangeably in specs, reviews, or implementation reasoning.

## Risk Gates

- High-risk operations require explicit confirmation from the project owner before execution. This includes work involving terminal control semantics, approval flow changes, resume logic, file write paths or file write policy changes, and any external send or outbound data transfer behavior.
- When a high-risk gate is triggered, do not implement any workaround, fallback, compatibility shim, or alternative execution path without explicit project-owner approval.
- Update docs when changing runtime networking, packaging, or backend route contracts.
- Keep release retention behavior centralized in `scripts/build-dist.js`; do not hardcode release cleanup in unrelated scripts.

## Runtime And UI Non-Negotiables

### Networking

1. Development renderer requests must use `/api/xxx`.
2. `/api` is only the Vite proxy prefix.
3. Backend routes never include `/api`, in development or production.
4. Production renderer requests use `window.desktopApi.backendUrl` directly.
5. Backend host and port come from `runtime.config.cjs`; do not duplicate numeric ports in code.
6. Backend should bind to a local host only, not a public network interface.

### Backend Startup

- Development: start desktop workflows through the root `pnpm dev:electron:win` commands.
- Do not refactor or replace the existing desktop dev startup chains unless you verify the full flow end-to-end. In particular, avoid changing the backend launch path, watch mode, or workspace invocation style without confirming that the relevant dev command still brings up Vite, backend health (`/health`), and the desktop shell together on Windows.
- Production: Electron main starts `resources/node-runtime/node.exe` with `resources/server/server.cjs`.
- Native dependencies for the backend are copied into `resources/server/node_modules` during packaging.

### UI

- The frontend UI interface design specifications and component documentation are located at `./desktop/src/shared/ui`.
- When implementing an interface, prioritize existing pure UI components. Only if they do not exist should you consider abstracting frequently used UI components, excluding business logic.
- You can modify or add components within the UI library, but the functionality must remain backward compatible. Any modification to the component library requires updating both the design specifications and the component documentation.
- The chat interface for this project is implemented with the app-owned `uchat` runtime. For related questions, refer to `docs/uchat.md` first.

## Verification And Delivery

- Do not claim progress or completion with percentages.
- Do not say work is “basically done”, “almost done”, or similar soft-completion wording. Report concrete evidence instead, such as changed files, reproduced behavior, command results, or remaining gaps.
- Do not mark checklist items as done unless each item has concrete evidence such as changed files, relevant code locations, verification results, or documented manual checks.
- After completing a task package, always provide a diff summary, the test or verification results with evidence, and any unfinished items, risks, or intentionally deferred work.
- If no test or verification was run, say that explicitly and explain why.

Run this before considering packaging or runtime changes complete:

```bash
pnpm check
```

Packaging notes:

- Do not run `pnpm package:electron:win` by default after every task. Run it only when the current task explicitly requires packaging verification or changes packaging/runtime behavior enough that a packaged build is part of the acceptance criteria.
- `pnpm package:electron:win` keeps the most recent `3` release directories by default.
- Use `RELEASE_KEEP_COUNT` to change the retention count for a run.
- If an old release directory is locked by Windows, cleanup is skipped instead of failing the build.
- For GitHub Actions builds, a successful desktop package build is the completion condition; GitHub CI does not need to run a packaged-app smoke test.

For a packaged build, verify:

```bash
curl http://<backend-host>:<backend-port>/health
```

Use host and port from `runtime.config.cjs`.
