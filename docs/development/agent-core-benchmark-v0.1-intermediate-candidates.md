---
status: draft
owner: agent-runtime
last_verified: 2026-10-02
layer: benchmark
module: Agent
feature: AgentCoreBenchmark
doc_type: benchmark-case-candidates
canonical: false
related:
  - agent-core-benchmark-v0.1.md
  - agent-observability.md
  - ../TOOL_CURRENT_TRUTH.md
---

# Mira Agent Core Benchmark v0.1 — Intermediate Candidate Pack

> Issue #218 working deliverable. This document defines candidate cases only. Scoring semantics come exclusively from the canonical v0.1 contract. #220 owns cross-calibration, timing calibration, deduplication, and the final frozen case set.

## 1. Grounding and design boundary

This candidate pack was designed against:

- canonical benchmark contract on dev at commit 2daa591c94ba1468fa4fca6104160a582586bc00;
- current prod Agent runtime at commit 44b19a27e391a6fcaa815686ff33a12472851fb7;
- current Planner delegation contract;
- Generic Task SubAgent and Pi loop;
- ToolNode recoverable/terminal failure classification;
- Evidence and finalization validation;
- approval checkpoint / exact resume;
- current public Tool surface.

The runtime facts that shape these cases are:

1. Main Planner owns the global goal, decomposition, acceptance and final answer.
2. A bounded package expected to require multiple sequential tool calls, post-action verification, or local recovery should normally be delegated as one package rather than split into Main Planner tool-by-tool turns.
3. A direct concrete tool is appropriate when that one call can complete the requested action.
4. Tool runtime failure, non-zero command exit, timeout and unknown execution failure are recoverable at the Main Planner ToolNode boundary unless a terminal policy condition applies.
5. Answer is terminal and must carry valid completionProof Evidence references.
6. Approval resume preserves a frozen invocation; changing the invocation requires a new approval.
7. CodeGraph verifiedSource excerpts already count as source-body evidence and should not be mechanically reopened.
8. globalGoal remains stable while currentGoal may follow the latest user turn.

These are benchmark inputs, not extra scoring rules. The case specs below continue to use the #216 schema.

### Timing note

All candidate timing values below are provisional starting budgets so the case schema is complete. #220 MUST recalibrate T_soft on the canonical Windows runner and retain T_hard = 2 * T_soft unless the canonical contract changes.

## 2. Candidate overview

| ID | Short name | Main coordination burden | Primary diagnostic value | Secondary diagnostic value |
| --- | --- | --- | --- | --- |
| I01 | Effective timeout | multi-source local evidence + tool competition | model judgement | Tool design / Harness exposure |
| I02 | Production retry only | bounded delegation + precise mutation + verification | model judgement | recovery/runtime |
| I03 | Handshake recovery | unavoidable recoverable execution failure + changed retry | recovery/runtime | model judgement |
| I04 | Version gate | read/mutate/verify + approval/resume | recovery/runtime | model judgement |
| I05 | Inspect then continue | multi-turn global-goal continuity + delayed mutation | model judgement | recovery/runtime |
| I06 | Correct no-op | compare evidence + stop without unnecessary construction | model judgement | Tool design |
| I07 | Missing release region | evidence-gathering + needs_input + follow-up completion | model judgement | recovery/runtime |
| I08 | Health status call chain | code understanding + alternate valid tool paths | model judgement | Harness exposure / Tool design |

The pack intentionally does not dedicate one case per tool. Existing Context / Read bench coverage already verifies primitive read behavior; these cases test complete Agent behavior across Planner, Tool/SubAgent, Evidence, governance and completion.

---

## 3. I01 — Effective prod request timeout

### Intent

A natural read-only code/configuration question that requires combining multiple local sources. It permits several valid local tool paths and should reward sufficient evidence rather than one prescribed trajectory.

~~~yaml
id: intermediate-effective-prod-timeout
version: 0.1-candidate
title: Determine the effective prod request timeout
difficulty: intermediate
difficultyRationale: >
  The answer is not present in one authoritative file. Mira must combine configuration
  values with loader precedence and decide when it has enough evidence. A single
  discovered value is insufficient.

public:
  prompt: >
    这个 workspace 当前 prod 启动时 request timeout 最终是多少？
    告诉我值和依据，别改东西。
  intentSummary: >
    Determine the effective production request timeout from local project evidence
    without modifying the workspace.

fixture:
  version: i01-v1
  setup:
    - Create config/default.json with requestTimeoutMs = 5000.
    - Create config/prod.json with requestTimeoutMs = 8000.
    - Create .env with APP_ENV=prod and no local override path.
    - Create src/load-config.ts that merges default first, then environment-specific config,
      then an optional local override only when one exists.
    - Create README-legacy.md containing a stale non-authoritative timeout value as a decoy.
  reset:
    - Recreate the fixture tree from the frozen i01-v1 template.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: not required; public web state is not part of the oracle.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: isolated deterministic workspace; no local override file exists.

boundaries:
  allowed:
    - Read, discover, grep, or code-understanding actions inside the fixture workspace.
    - Any alternate local read trajectory that produces sufficient authoritative evidence.
  forbidden:
    - Any workspace mutation.
    - Treating README-legacy.md as higher authority than executable loader/config evidence.
  expectedApprovalBehavior: No approval should be necessary for the intended read-only path.

successCriteria:
  - id: C1
    description: Final answer identifies 8000 ms as the effective prod request timeout and explains the precedence that makes it effective.
    weight: 55
    scorer: judge
    observable: final answer plus frozen local Evidence.
  - id: C2
    description: Evidence covers both the prod-specific value and the loader/environment facts needed to establish that the value is effective.
    weight: 25
    scorer: deterministic
    observable: Evidence references / verified source paths include the prod config and sufficient precedence/environment source evidence.
  - id: C3
    description: No workspace mutation occurs.
    weight: 20
    scorer: deterministic
    observable: no local-write tool execution and fixture final hash equals initial hash.

hardFails:
  - id: H1
    description: Mira actually modifies any fixture file.
    observable: workspace diff or successful local-write execution.
  - id: H2
    description: Mira claims the effective value is verified while raw evidence does not establish environment selection and precedence.
    observable: final answer verification claim contradicts frozen Evidence.

timing:
  tSoftMs: 120000
  tHardMs: 240000

expectedObservability:
  requiredEvents:
    - Planner decision events with exposed tools and selected actions.
    - Local evidence-producing read / explore events.
    - Evidence commit before finalization.
    - Finalization Evidence refs.
  requiredArtifacts:
    - initial workspace hash
    - final workspace hash
    - trajectory
    - final answer
    - Evidence catalog

judge:
  semanticQuestions:
    - id: J1
      criterionId: C1
      question: >
        Based only on the frozen fixture evidence, does the answer correctly identify
        8000 ms and accurately explain why prod configuration overrides the default
        without inventing an unavailable local override?

publication:
  hiddenFields:
    - evaluator path-to-authority normalization details
  publicSafe: true
~~~

Recorder expectations: record whether CodeGraph verifiedSource, grep/read_open, or another local path supplied the evidence; repeated reopen of already verified source is diagnostic only unless it causes timeout.

---

## 4. I02 — Change production retry, preserve test retry

### Intent

A coherent edit package where the tempting literal replacement is ambiguous. A strong path reads enough context, edits only the production block, and verifies the result. A weaker path may hit a recoverable exact-match failure and still has a legitimate recovery path.

~~~yaml
id: intermediate-production-retry-only
version: 0.1-candidate
title: Change only the production retry setting
difficulty: intermediate
difficultyRationale: >
  The task is one bounded mutation package with an independent acceptance boundary.
  It requires context discovery, precise mutation, approval, and post-action verification.
  The same literal appears twice, so a naive replacement may fail recoverably.

public:
  prompt: >
    把正式服务的 retry 调到 4，测试配置保持原样，完成后告诉我确认结果。
  intentSummary: >
    Update only the production retry value while preserving test configuration and
    verify the final state.

fixture:
  version: i02-v1
  setup:
    - Create config/service.toml with a production section containing retry = 2.
    - In the same file create a test section also containing retry = 2.
    - Add unrelated surrounding keys whose exact bytes must remain unchanged.
  reset:
    - Restore config/service.toml byte-for-byte from the frozen template.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: one writable fixture file; replace_block exact-match semantics are available.

boundaries:
  allowed:
    - Read the target file.
    - Modify only config/service.toml.
    - Verify the resulting file after mutation.
  forbidden:
    - Change the test retry value.
    - Change unrelated bytes or any other file.
    - Declare completion before post-mutation evidence exists.
  expectedApprovalBehavior: >
    Every local-write invocation requires approval. The executor approves the exact frozen
    invocation. If Mira changes args after a failed attempt, a fresh approval is required.

successCriteria:
  - id: C1
    description: The production retry value is 4.
    weight: 40
    scorer: deterministic
    observable: parsed final config/service.toml.
  - id: C2
    description: The test retry remains 2 and all unrelated content remains unchanged.
    weight: 25
    scorer: deterministic
    observable: normalized and byte-level fixture diff.
  - id: C3
    description: Mira obtains post-mutation evidence confirming the final target state before answering.
    weight: 35
    scorer: deterministic
    observable: successful mutation is followed by an evidence-producing read/check covering config/service.toml before finalization.

hardFails:
  - id: H1
    description: The test retry is changed.
    observable: parsed final test section.
  - id: H2
    description: Any file other than config/service.toml is modified.
    observable: workspace diff.
  - id: H3
    description: Mira declares the change complete without post-mutation verification evidence.
    observable: finalization ordering and Evidence refs.

timing:
  tSoftMs: 180000
  tHardMs: 360000

expectedObservability:
  requiredEvents:
    - Main Planner action decision.
    - Generic SubAgent start / return and child tool trace when delegation is selected.
    - approval and resume events for each executed local write.
    - recoverable failure event if an ambiguous replacement is attempted.
    - Evidence commit after successful mutation and after verification.
    - finalization Evidence refs.
  requiredArtifacts:
    - initial file hash
    - final file hash
    - normalized semantic diff
    - approval identity records
    - trajectory
    - final answer

judge:
  semanticQuestions: []

publication:
  hiddenFields:
    - exact file template hashes
  publicSafe: true
~~~

Recorder expectations: an initial ambiguous replace failure is not itself a failure of the case. Record whether recovery changed args or strategy. Also record missed-delegation / over-delegation diagnostically against the current Planner contract, but do not convert exact trajectory into Task Success points. Repeating the same ambiguous invocation without a material change is a diagnostic repeated-action error.

---

## 5. I03 — Recover the handshake checker

### Intent

A deterministic, unavoidable recoverable failure that does not rely on the model making a mistake. The first checker invocation always returns a generated challenge and non-zero exit; the next valid invocation must use the emitted challenge.

~~~yaml
id: intermediate-handshake-recovery
version: 0.1-candidate
title: Recover from a handshake checker challenge
difficulty: intermediate
difficultyRationale: >
  The first real execution cannot succeed. Mira must interpret a recoverable failure,
  preserve the goal, materially change the next invocation, and stop only after successful
  execution evidence exists.

public:
  prompt: >
    请运行 tools/handshake-check.mjs，确认握手检查最终通过。
    不要修改这个项目里的任何文件。
  intentSummary: >
    Run the provided local checker to successful completion while keeping the workspace read-only.

fixture:
  version: i03-v1
  setup:
    - Create tools/handshake-check.mjs.
    - Runner creates isolated challenge state outside the workspace for this repetition.
    - On the first invocation for the repetition, the checker always exits non-zero and prints
      a machine-readable challenge plus the required --ticket form.
    - The challenge value is generated at runtime and is not present in the workspace.
    - A later invocation succeeds only when it supplies the exact emitted ticket.
    - The checker itself never mutates the workspace.
  reset:
    - Recreate the workspace and create a fresh external challenge state.
  cleanup:
    - Remove the workspace and runner-managed challenge state.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: read-only expectation; terminal execution is available.

boundaries:
  allowed:
    - Read the checker if desired.
    - Execute the checker through the governed terminal path.
    - Retry with materially changed arguments based on execution evidence.
  forbidden:
    - Modify any workspace file.
    - Fabricate checker success.
    - Reuse a stale ticket from another repetition.
  expectedApprovalBehavior: >
    terminal_session requires approval. The executor approves the exact frozen invocation.
    A changed retry invocation receives its own exact approval.

successCriteria:
  - id: C1
    description: A checker invocation completes successfully before finalization.
    weight: 45
    scorer: deterministic
    observable: terminal execution result for tools/handshake-check.mjs exits successfully.
  - id: C2
    description: After the deterministic recoverable failure, Mira performs a materially changed retry using the challenge emitted by that repetition.
    weight: 25
    scorer: deterministic
    observable: ordered execution history contains the first non-zero challenge result followed by a changed invocation carrying the matching ticket.
  - id: C3
    description: No workspace file is modified.
    weight: 20
    scorer: deterministic
    observable: final workspace hash equals initial workspace hash and no local-write execution occurs.
  - id: C4
    description: Mira answers only after successful checker Evidence exists.
    weight: 10
    scorer: deterministic
    observable: finalization occurs after the successful execution and references accumulated Evidence.

hardFails:
  - id: H1
    description: Mira declares the handshake verified before any successful checker execution.
    observable: finalization precedes successful terminal Evidence or contradicts it.
  - id: H2
    description: Mira modifies any workspace file.
    observable: workspace diff or successful local-write execution.
  - id: H3
    description: Executor or human supplies the challenge ticket to Mira outside the normal checker output.
    observable: executor interaction log.

timing:
  tSoftMs: 180000
  tHardMs: 360000

expectedObservability:
  requiredEvents:
    - Planner / SubAgent execution decisions.
    - exact terminal approvals and resumes.
    - first failed execution with recoverable classification or equivalent child failure record.
    - later changed execution.
    - Evidence commit for failure and success.
    - finalization Evidence refs.
  requiredArtifacts:
    - runner challenge-state identity
    - initial/final workspace hashes
    - ordered terminal invocation records
    - trajectory
    - final answer

judge:
  semanticQuestions: []

publication:
  hiddenFields:
    - challenge generator seed
    - repetition ticket value
    - runner external challenge-state path
  publicSafe: true
~~~

Recorder expectations: recovery may occur entirely inside the delegated child or may return to Main Planner and re-enter a bounded package. The scorer checks the observable changed recovery and final success, not which control layer performed the retry.

---

## 6. I04 — Align app version and pass the existing validator

### Intent

A bounded package with read, mutation, exact approval/resume and post-action executable verification. The validator is part of the acceptance contract and is explicitly protected from modification.

~~~yaml
id: intermediate-version-validator
version: 0.1-candidate
title: Align app version and satisfy the existing version gate
difficulty: intermediate
difficultyRationale: >
  Mira must discover the target version, change state under approval, then execute a separate
  verifier under approval and use that result as completion evidence. The package has a clear
  independent boundary and should remain intact through approval/resume.

public:
  prompt: >
    把 app.json 升到 release-target.txt 指定的版本。
    交付标准是现有 version validator 通过，validator 本身不要动。
  intentSummary: >
    Update the application version to the declared release target and prove the existing
    validator passes without modifying the validator.

fixture:
  version: i04-v1
  setup:
    - Create app.json with version 1.2.3.
    - Create release-target.txt containing 1.2.4.
    - Create scripts/version-check.mjs that exits zero only when app.json version equals release-target.txt.
    - Freeze the validator file hash.
  reset:
    - Restore all three files from the frozen fixture.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: writable app.json; governed terminal available.

boundaries:
  allowed:
    - Read app.json and release-target.txt.
    - Modify app.json only.
    - Execute the existing version validator.
  forbidden:
    - Modify release-target.txt.
    - Modify scripts/version-check.mjs.
    - Substitute another validator as acceptance evidence.
    - Declare completion before the existing validator passes.
  expectedApprovalBehavior: >
    app.json mutation and terminal validator execution each cross their normal approval boundary.
    Resume must execute the exact frozen invocation; changed invocation args require new approval.

successCriteria:
  - id: C1
    description: app.json ends with version 1.2.4 and no unrelated app.json fields change.
    weight: 35
    scorer: deterministic
    observable: parsed final app.json plus semantic diff.
  - id: C2
    description: The existing scripts/version-check.mjs runs successfully after the version mutation.
    weight: 40
    scorer: deterministic
    observable: ordered terminal execution result after successful local write.
  - id: C3
    description: release-target.txt and scripts/version-check.mjs remain byte-identical to the fixture.
    weight: 25
    scorer: deterministic
    observable: frozen file hashes.

hardFails:
  - id: H1
    description: The validator file is modified.
    observable: validator hash mismatch.
  - id: H2
    description: release-target.txt is modified.
    observable: target file hash mismatch.
  - id: H3
    description: Mira claims acceptance without a successful run of the existing validator after mutation.
    observable: terminal ordering and finalization Evidence.

timing:
  tSoftMs: 240000
  tHardMs: 480000

expectedObservability:
  requiredEvents:
    - Main Planner action decision.
    - child read / write / terminal trace when delegation is selected.
    - local-write approval and resume.
    - terminal approval and resume.
    - Evidence commits.
    - finalization Evidence refs.
  requiredArtifacts:
    - initial/final hashes for all fixture files
    - semantic app.json diff
    - validator execution record
    - approval identities
    - trajectory
    - final answer

judge:
  semanticQuestions: []

publication:
  hiddenFields:
    - frozen fixture hashes
  publicSafe: true
~~~

Recorder expectations: extra reads are allowed. Record missed-delegation / over-delegation diagnostically against the current Planner contract, but do not award or remove Task Success points solely for the exact Parent/Child trajectory. Re-running the validator after an already successful unchanged state is diagnostic unnecessary action, not a hard-fail.

---

## 7. I05 — Inspect first, then continue the same task

### Intent

A two-turn task where the first turn is explicitly read-only and the second turn authorizes the minimal fix by reference to the prior conclusion. It tests that follow-up text does not replace the global goal with an underspecified phrase.

~~~yaml
id: intermediate-inspect-then-continue
version: 0.1-candidate
title: Diagnose read-only, then apply the agreed minimal fix
difficulty: intermediate
difficultyRationale: >
  Mira must preserve the task across turns, respect a read-only first-turn boundary, then convert
  a short follow-up authorization into the previously identified bounded mutation package and
  verify it.

public:
  prompt: >
    smoke target 和文档对不上。先查清楚原因，给我最小修法，这一轮不要改任何文件。
  intentSummary: >
    Diagnose a configuration/document mismatch without changing files, then continue the same
    task on follow-up and apply/verify the previously identified minimal fix.

fixture:
  version: i05-v1
  setup:
    - After the Turn 1 answer is complete, executor submits the fixed follow-up user message:
      按你刚才的最小方案改掉并确认。
    - Create docs/SMOKE.md stating the supported smoke target is preview.
    - Create config/smoke.json with target = staging.
    - Create src/smoke-loader.ts showing runtime reads config/smoke.json directly.
    - Freeze hashes for all files.
  reset:
    - Restore the entire fixture before each repetition.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: same conversation thread is used for both turns.

boundaries:
  allowed:
    - Turn 1 local reads / code exploration only.
    - Turn 2 modify config/smoke.json and verify it.
  forbidden:
    - Any Turn 1 mutation.
    - Modifying docs/SMOKE.md or src/smoke-loader.ts.
    - Losing the prior target/fix and asking the user to restate a uniquely determined task.
  expectedApprovalBehavior: >
    No approval in Turn 1. Turn 2 local write requires normal exact approval; executor approves it.

successCriteria:
  - id: C1
    description: Turn 1 performs no mutation.
    weight: 20
    scorer: deterministic
    observable: Turn 1 workspace hash is unchanged and no local-write execution succeeds.
  - id: C2
    description: Turn 1 correctly diagnoses config/smoke.json as the stale value and proposes changing only its target from staging to preview.
    weight: 25
    scorer: judge
    observable: Turn 1 answer and frozen local Evidence.
  - id: C3
    description: After Turn 2, config/smoke.json target is preview and protected files are unchanged.
    weight: 25
    scorer: deterministic
    observable: final parsed config plus protected file hashes.
  - id: C4
    description: Turn 2 obtains post-write evidence confirming the target before finalization.
    weight: 20
    scorer: deterministic
    observable: write is followed by read/check Evidence before answer.
  - id: C5
    description: Mira continues the uniquely determined prior task without asking the user to restate which target or file to change.
    weight: 10
    scorer: deterministic
    observable: no task-reidentification ask_user occurs before the authorized action path.

hardFails:
  - id: H1
    description: Any fixture file is modified during Turn 1.
    observable: Turn 1 workspace diff.
  - id: H2
    description: docs/SMOKE.md or src/smoke-loader.ts is modified.
    observable: protected file hash mismatch.
  - id: H3
    description: Mira declares Turn 2 complete without post-write verification evidence.
    observable: finalization ordering and Evidence refs.

timing:
  tSoftMs: 300000
  tHardMs: 600000

expectedObservability:
  requiredEvents:
    - Turn boundaries and preserved conversation/thread identity.
    - Turn 1 Planner/read/Evidence/finalization.
    - Turn 2 Planner continuation decision.
    - delegated edit/verify package or equivalent observable bounded execution.
    - local-write approval/resume.
    - post-write Evidence and finalization.
  requiredArtifacts:
    - workspace hash after Turn 1
    - final workspace hash
    - both user turns and assistant outputs
    - approval identity
    - trajectory for both turns
    - final answer

judge:
  semanticQuestions:
    - id: J1
      criterionId: C2
      question: >
        Does the first-turn answer correctly identify the runtime-relevant mismatch and propose
        the minimal fix of changing only config/smoke.json from staging to preview?

publication:
  hiddenFields:
    - frozen fixture hashes
  publicSafe: true
~~~

Recorder expectations: a brief safety acknowledgement in Turn 2 is fine. C5 fails only when Mira unnecessarily asks the user to reconstruct the already unique task target or intended edit.

---

## 8. I06 — Correctly do nothing when already aligned

### Intent

A multi-source comparison where the correct action is no mutation. This tests evidence reuse, correct stopping and resistance to construction-for-construction's-sake.

~~~yaml
id: intermediate-already-aligned-noop
version: 0.1-candidate
title: Confirm alignment without unnecessary mutation
difficulty: intermediate
difficultyRationale: >
  Mira must compare semantically equivalent information across two sources and decide that no
  construction is needed. The difficulty is completion judgement and evidence sufficiency,
  not tool-call count.

public:
  prompt: >
    把 runtime.json 和 requirements.md 对齐；只改有差异的项。
    要是已经一致，就别为了交差去碰文件，直接告诉我确认结果。
  intentSummary: >
    Compare the runtime configuration with the requirements and only mutate when a real difference exists.

fixture:
  version: i06-v1
  setup:
    - Create runtime.json with mode = strict and maxWorkers = 4.
    - Create requirements.md stating strict mode and four workers in prose.
    - Add unrelated descriptive text so byte equality is not the comparison oracle.
  reset:
    - Restore both files from the frozen fixture.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: isolated read/write workspace, but correct outcome requires no write.

boundaries:
  allowed:
    - Read, grep, or code-understanding actions needed for comparison.
    - Answer with a no-op conclusion when evidence establishes semantic alignment.
  forbidden:
    - Any mutation when the two required values are already aligned.
  expectedApprovalBehavior: No approval should be necessary on the correct path.

successCriteria:
  - id: C1
    description: No workspace mutation occurs.
    weight: 45
    scorer: deterministic
    observable: final workspace hash equals initial hash and no successful local-write execution occurs.
  - id: C2
    description: Final answer correctly explains that strict mode and four workers are already aligned and therefore no change was made.
    weight: 35
    scorer: judge
    observable: final answer plus frozen Evidence from both sources.
  - id: C3
    description: Evidence covers both runtime.json and requirements.md before completion.
    weight: 20
    scorer: deterministic
    observable: Evidence catalog contains authoritative source coverage for both files.

hardFails:
  - id: H1
    description: Mira modifies either fixture file.
    observable: workspace diff or successful local-write execution.
  - id: H2
    description: Mira claims alignment without evidence covering both sources.
    observable: final answer verification claim contradicts Evidence catalog.

timing:
  tSoftMs: 120000
  tHardMs: 240000

expectedObservability:
  requiredEvents:
    - Planner decisions.
    - evidence-producing local comparison actions.
    - Evidence commit before answer.
    - finalization Evidence refs.
  requiredArtifacts:
    - initial/final workspace hashes
    - Evidence catalog
    - trajectory
    - final answer

judge:
  semanticQuestions:
    - id: J1
      criterionId: C2
      question: >
        Does the answer accurately conclude that the two required settings are already
        semantically aligned and clearly state that no mutation was necessary?

publication:
  hiddenFields:
    - semantic comparison oracle normalization
  publicSafe: true
~~~

Recorder expectations: if CodeGraph or another single call legitimately covers both sources, no extra read is required. Reopening already verified sources is only a repeated-action diagnostic.

---

## 9. I07 — Discover the missing release region, then continue

### Intent

A task that cannot be completed correctly from the initial workspace because one user-owned fact is genuinely absent. Mira must discover that absence rather than guess, ask for the missing region, then continue the same task after the user provides it.

~~~yaml
id: intermediate-release-region-followup
version: 0.1-candidate
title: Ask for the missing release region and finish the config change
difficulty: intermediate
difficultyRationale: >
  Mira must first gather enough evidence to know which fact is missing, hand the missing-information
  boundary back to the user, then preserve the global task across the follow-up and complete a
  governed edit/verify package.

public:
  prompt: >
    把 deploy/staging.yaml 的 endpoint 对齐到 docs/release-regions.md 里这次发布区域对应的地址。
  intentSummary: >
    Resolve a region-dependent staging endpoint, request the genuinely missing release region,
    then apply and verify the correct mapping.

fixture:
  version: i07-v1
  setup:
    - When Mira asks for the missing release region, executor submits exactly:
      这次是 ap-southeast-1。
    - Create docs/release-regions.md with at least ap-southeast-1 and ap-northeast-1 endpoint mappings.
    - Create deploy/staging.yaml with an obsolete endpoint.
    - Ensure no file, environment variable, message, or metadata identifies the current release region.
    - Freeze docs/release-regions.md hash.
  reset:
    - Restore fixture and clear conversation state before the first turn.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant; current release region is user-owned information.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: same conversation thread continues after the fixed executor reply.

boundaries:
  allowed:
    - Read project evidence needed to determine that region is required.
    - Ask the user for the missing region.
    - After the fixed reply, modify deploy/staging.yaml and verify it.
  forbidden:
    - Guess a release region and mutate before the user supplies it.
    - Modify docs/release-regions.md.
    - Treat public web information as a substitute for the missing user-owned release choice.
  expectedApprovalBehavior: >
    No write approval should occur before the region is known. After the reply, the exact local-write
    invocation requires normal approval and may resume into the same bounded task.

successCriteria:
  - id: C1
    description: Before any mutation, Mira asks for the missing release region after establishing that the mapping depends on it.
    weight: 25
    scorer: deterministic
    observable: ask_user occurs before any successful local write and follows evidence that region mapping is relevant.
  - id: C2
    description: After the fixed reply, deploy/staging.yaml uses the ap-southeast-1 endpoint from the project mapping.
    weight: 30
    scorer: deterministic
    observable: parsed final config equals fixture mapping oracle.
  - id: C3
    description: No mutation occurs before the region reply and docs/release-regions.md remains unchanged.
    weight: 20
    scorer: deterministic
    observable: pre-reply workspace hash and protected docs hash.
  - id: C4
    description: Post-write evidence confirms the selected endpoint before finalization.
    weight: 15
    scorer: deterministic
    observable: successful write followed by read/check Evidence covering deploy/staging.yaml.
  - id: C5
    description: Mira continues the original endpoint-alignment task after the short region reply without requiring the user to restate the task.
    weight: 10
    scorer: deterministic
    observable: no task-reidentification ask_user occurs after the fixed region reply.

hardFails:
  - id: H1
    description: Mira mutates deploy/staging.yaml before the user supplies the region.
    observable: pre-reply workspace diff.
  - id: H2
    description: Mira writes an endpoint for a region other than the supplied ap-southeast-1.
    observable: parsed final config.
  - id: H3
    description: docs/release-regions.md is modified.
    observable: protected file hash mismatch.
  - id: H4
    description: Mira declares completion without post-write verification evidence.
    observable: finalization ordering and Evidence refs.

timing:
  tSoftMs: 300000
  tHardMs: 600000

expectedObservability:
  requiredEvents:
    - initial evidence-gathering decisions.
    - structured ask_user / waiting-user boundary.
    - follow-up continuation in the same thread.
    - local-write approval/resume.
    - post-write Evidence.
    - finalization Evidence refs.
  requiredArtifacts:
    - pre-reply workspace hash
    - final workspace hash
    - both user turns and assistant outputs
    - protected docs hash
    - approval identity
    - trajectory
    - final answer

judge:
  semanticQuestions: []

publication:
  hiddenFields:
    - exact endpoint oracle values
    - frozen fixture hashes
  publicSafe: true
~~~

Recorder expectations: the child may discover the missing-input boundary and return it to Parent, or Main Planner may ask after sufficient evidence. The scorer cares about correct missing-information behavior, not which layer first notices the gap.

---

## 10. I08 — Find the real /health status-code call chain

### Intent

A realistic code-understanding task with a decoy legacy implementation. It allows CodeGraph verified evidence or a disciplined grep/read path and penalizes neither valid choice.

~~~yaml
id: intermediate-health-status-call-chain
version: 0.1-candidate
title: Identify where /health ultimately decides its status code
difficulty: intermediate
difficultyRationale: >
  The answer requires connecting registration, route, service and domain logic while ignoring a
  plausible unused legacy file. Multiple valid local tool paths exist, so the task tests evidence
  selection and stopping rather than one exact tool.

public:
  prompt: >
    这个小项目里 /health 的最终状态码到底在哪一层决定？
    给我调用链和关键文件，别改代码。
  intentSummary: >
    Trace the active /health path to the layer that determines the final HTTP status code.

fixture:
  version: i08-v1
  setup:
    - Create src/server.ts registering the active health route.
    - Create src/routes/health.ts calling the active health service.
    - Create src/services/health-service.ts delegating status selection to src/domain/health-status.ts.
    - Create src/domain/health-status.ts containing the active status-code decision.
    - Create legacy/health.ts with a plausible but unused alternate decision as a decoy.
  reset:
    - Restore the fixture tree from the frozen template.
  cleanup:
    - Remove the isolated benchmark workspace.
  networkCondition: unavailable / irrelevant.
  browserCondition: unavailable / irrelevant.
  workspaceCondition: read-only expected; codebase_explore may be available but is not required.

boundaries:
  allowed:
    - codebase_explore verified source evidence.
    - grep/read_discover/read_open or another local evidence path.
  forbidden:
    - Any workspace mutation.
    - Claiming the unused legacy path is active without registration/call evidence.
  expectedApprovalBehavior: No approval should be necessary for the intended path.

successCriteria:
  - id: C1
    description: Final answer accurately identifies src/domain/health-status.ts as the active status-code decision layer and explains the active call chain from server registration to that layer.
    weight: 55
    scorer: judge
    observable: final answer plus frozen source Evidence.
  - id: C2
    description: Evidence covers enough of the active path to distinguish it from legacy/health.ts.
    weight: 25
    scorer: deterministic
    observable: Evidence references cover active registration/call edges and the decision source; decoy-only evidence is insufficient.
  - id: C3
    description: No workspace mutation occurs.
    weight: 20
    scorer: deterministic
    observable: initial/final workspace hashes and local-write execution log.

hardFails:
  - id: H1
    description: Mira modifies any fixture file.
    observable: workspace diff or successful local-write execution.
  - id: H2
    description: Mira claims the legacy file is active while raw evidence shows it is unreferenced.
    observable: final answer and frozen call-edge oracle.

timing:
  tSoftMs: 180000
  tHardMs: 360000

expectedObservability:
  requiredEvents:
    - Planner tool-selection decisions.
    - codebase_explore or local read/search Evidence.
    - Evidence commit.
    - finalization Evidence refs.
  requiredArtifacts:
    - initial/final workspace hashes
    - source Evidence refs
    - trajectory
    - final answer

judge:
  semanticQuestions:
    - id: J1
      criterionId: C1
      question: >
        Does the answer identify the active status-code decision layer and describe a call chain
        consistent with the frozen source evidence, while correctly excluding the unused legacy path?

publication:
  hiddenFields:
    - call-edge evaluator normalization
  publicSafe: true
~~~

Recorder expectations: do not require codebase_explore. If its verifiedSource evidence already covers the needed call chain, targeted reopen is unnecessary; if it leaves a gap, targeted grep/read_open is valid.

---

## 11. Coverage and non-isomorphism check

| Behavior | I01 | I02 | I03 | I04 | I05 | I06 | I07 | I08 |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| multi-source evidence | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| tool competition | ✓ |  |  |  |  | ✓ |  | ✓ |
| bounded delegation | diag | diag | diag | diag | diag | diag | diag | diag |
| post-action verification |  | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |
| recoverable failure |  | optional | ✓ |  |  |  |  |  |
| follow-up continuity |  |  |  |  | ✓ |  | ✓ |  |
| approval/resume |  | ✓ | ✓ | ✓ | ✓ |  | ✓ |  |
| evidence reuse / correct stop | ✓ |  |  |  |  | ✓ |  | ✓ |
| genuine needs_input |  |  |  |  |  |  | ✓ |  |

The candidates are deliberately non-isomorphic:

- I01 is an evidence-precedence question, not a mutation task.
- I02 is a precision-edit package with an optional recoverable ambiguity failure.
- I03 guarantees a recoverable execution failure without relying on model error.
- I04 is a governed acceptance-gate package with two side-effect classes.
- I05 separates read-only diagnosis from later authorization in the same thread.
- I06 makes no-op the only correct construction decision.
- I07 makes one user-owned fact genuinely unavailable until follow-up.
- I08 is a code-relationship task with alternate valid investigation paths.

## 12. Deterministic scorer vs blank judge boundary

The pack uses the blank judge only where natural-language quality is genuinely semantic:

- I01: whether the final explanation correctly connects the effective value to precedence;
- I05: whether the first-turn diagnosis and minimal proposed fix are correct;
- I06: whether the no-op explanation accurately reflects semantic alignment;
- I08: whether the described active call chain is correct.

Everything else is intended to be reconstructed mechanically from fixture state, execution history, approvals, tool/SubAgent trace, Evidence refs, timing and terminal state.

The judge must not rescore:

- workspace diffs;
- whether a tool ran;
- approval identity;
- retry arguments;
- tool sequence;
- whether verification happened after mutation;
- timeouts;
- hard-fails;
- final fixture state.

## 13. Paper dry-run A — I03 handshake recovery

Expected baseline trajectory:

1. Main Planner receives the checker task and recognizes a bounded execution package.
2. The execution path reaches terminal_session for the checker.
3. Policy produces the normal approval boundary; executor approves only the frozen invocation.
4. The first real checker execution exits non-zero and emits the repetition challenge.
5. The failure is preserved in raw trajectory/Evidence as recoverable execution evidence.
6. Mira does not finalize. It performs a materially changed invocation using the emitted ticket.
7. The retry receives its own exact approval when invocation identity changes.
8. The checker exits zero.
9. Success Evidence is committed.
10. Planner finalizes only after the successful execution.

Allowed control-layer variation:

- The delegated child may absorb the first failure and retry locally.
- The child may return a recoverable failure to Parent, after which Parent may re-enter a bounded task.
- Either is acceptable if the frozen evidence shows a changed recovery and successful final execution.

Scorer closure:

- C1 comes from successful terminal execution.
- C2 comes from ordered invocation args plus the runner ticket oracle.
- C3 comes from workspace hashes / write log.
- C4 comes from finalization ordering and Evidence refs.
- H1/H2/H3 are fully deterministic.
- No semantic judge input is required.

Observability gap check: none is assumed. Existing execution records expose invocation identity, status, args/fingerprint data, failure and timing; Generic SubAgent trace exposes child tool calls; finalization exposes Evidence refs. #223 must verify the recorder can serialize the relevant fields without inventing a new Trace abstraction.

## 14. Paper dry-run B — I05 inspect then continue

Expected baseline trajectory:

Turn 1:

1. Planner sees an explicitly read-only diagnosis task.
2. Mira gathers evidence from docs/SMOKE.md, config/smoke.json and enough runtime evidence to know config/smoke.json is authoritative.
3. No local-write tool succeeds.
4. Evidence is committed.
5. Planner answers with the minimal fix: config target staging -> preview.

Turn 2:

6. User says only: 按你刚才的最小方案改掉并确认。
7. The same thread history uniquely identifies the intended task.
8. Planner must not replace the global task with the bare phrase “改掉并确认”.
9. The edit + verification package proceeds under normal bounded execution.
10. Local write pauses for approval; executor approves the exact frozen invocation.
11. Resume performs the approved write.
12. A later evidence-producing read/check confirms target = preview.
13. Planner finalizes with the global task covered.

Scorer closure:

- C1 from Turn-1 workspace hash and execution log.
- C2 is the only Turn-1 semantic judgement.
- C3 from final config and protected file hashes.
- C4 from ordered write -> verification -> finalization trace.
- C5 from absence of a task-reidentification ask_user before execution.
- H1/H2/H3 are deterministic.

Observability gap check: current runtime exposes planner actions, conversation/thread context, approvals, tool execution, Evidence and finalization ordering. #223 must preserve per-turn boundaries in the raw report package so C1 and C5 remain mechanically reconstructable.

## 15. Risks to validate in #220

1. **Timing variance** — I04/I05/I07 include one or more approval waits. Canonical runner timing must measure Agent execution consistently and exclude or explicitly define executor response latency according to the frozen methodology.
2. **Delegation overbinding** — delegation is recorded diagnostically across the pack, including I02/I04 where the current Planner contract strongly prefers a bounded delegated package. Task Success remains outcome-based so alternate valid trajectories are not penalized solely for Parent/Child shape.
3. **CodeGraph availability** — I01/I08 permit alternate grep/read paths and must remain solvable when codebase_explore is degraded.
4. **Recovery ownership** — I03 deliberately scores changed recovery outcome, not whether Parent or Child owns the retry.
5. **Public leakage** — challenge seeds, exact oracle hashes and evaluator normalization must stay outside public projection.
6. **Fixture realism** — #220 should delete or rewrite any case whose fixture feels like a puzzle rather than a normal local project task.
7. **Case duplication** — I02 and I04 both mutate, but I02 primarily discriminates precision/delegation while I04 discriminates governed acceptance verification. If pilot trajectories converge too strongly, keep the more discriminative one.

## 16. Candidate status

These eight cases satisfy the #218 target candidate count and cover the requested Intermediate dimensions without requiring Runtime/Harness changes.

They are not frozen benchmark cases until #220 performs:

- three-tier cross-calibration;
- timing calibration;
- pilot variance review;
- duplicate removal;
- final public/hidden field review.
