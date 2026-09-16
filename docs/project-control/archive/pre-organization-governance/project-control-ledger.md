---
status: current
owner: project-owner
last_verified: 2026-07-22
layer: project-control
module: ProjectControl
feature: ProjectControlLedger
doc_type: master-ledger
canonical: true
related:
  - AGENTS.md
  - docs/project-control/README.md
  - docs/project-control/governance-principles.md
  - docs/project-control/phase-conclusions/agent-phase-1-2-archive-decision.md
---

# Project Control Ledger

这是 `docs/project-control/` 下唯一的项目总控制台账。

规则：

- 所有当前项目、任务流、评审队列和阻塞项都必须登记在这里。
- 旧 `agent-workboard.md`、`agent-nodes-workboard.md`、评审文档、复测文档和任务卡可以作为证据来源，但不能再作为项目总台账。
- 历史任务卡不要求迁移、不要求重写；本文件只记录当前可管理状态和索引。
- 任务实际状态以任务卡中的 `task_state` 为准。
- 如果本文件状态与任务卡冲突，必须修正本文件；如果任务卡缺少 `task_state` 或元数据异常，本文件只能标记为 `TASK_CARD_STATE_MISSING` 或 `TASK_CARD_STATE_INVALID`，不能替任务卡判定完成。
- 如果旧 workboard 与任务卡冲突，以任务卡为准；旧 workboard 只作为历史证据。
- 新任务开工前必须先在本文件登记。

## Current Streams

| Stream | State | Current Focus | Evidence / Source | Ledger Note |
| --- | --- | --- | --- | --- |
| Forge / 淬行 Integration | `IN_PROGRESS` | T001-T009 已完成；T010 `READY_FOR_REVIEW`。`dev` 的 `pnpm check` + Forge cutover gate PASS，Windows staged server Forge/native smoke PASS；旧 `mira-forge` 的 dev/main 首页已标 Historical 并指向新仓。剩余真实 provider product-loop / cancel / restart 与当前 Windows Electron package evidence | [T001](tasks/forge_T001-integration-contract-and-source-baseline.md), [Forge Contract](../forge/FORGE_CURRENT_CONTRACT.md), [Source Map](../forge/migration-source-map.md), [T002](tasks/forge_T002-core-import-and-dependency-unification.md), [T003](tasks/forge_T003-runtime-lifecycle-and-persistence-ownership.md), [T004](tasks/forge_T004-project-registry-and-repository-task-source.md), [T005](tasks/forge_T005-main-thread-runtime-and-provider-adapters.md), [T006](tasks/forge_T006-builder-dispatch-and-process-supervision.md), [T007](tasks/forge_T007-review-handoff-and-runtime-state-guards.md), [T008](tasks/forge_T008-mira-server-api-and-desktop-client-contract.md), [T009](tasks/forge_T009-desktop-cuixing-product-surface.md), [T010](tasks/forge_T010-end-to-end-cutover-and-legacy-retirement.md), [Cutover Smoke](../forge/cutover-smoke.md) | 自动 cutover 与 non-destructive legacy retirement 已有 current evidence；旧 T018 不继承 PASS。未观察真实 Builder → builder_result → next Main Thread turn 前不得标 DONE。 |
| Remote Pairing Compatibility | `DONE` | T005 已完成：配对 claim 的 requestedScopes 向前兼容；route 接受有界字符串，service 只保留 Host 已知 scope，授权边界不放松 | [remote_pairing_T005](tasks/remote_pairing_T005-forward-compatible-scope-negotiation.md) | 实现 `cf2bf072`；owner 指示小改不等待整套 Desktop CI 作为合并门槛，待 MOB-044 真机复测确认实际故障是否消失 |
| Project Control Governance | `IN_PROGRESS` | 建立唯一总控制台账，停止多 workboard 争抢当前真相 | [governance-principles.md](governance-principles.md) | 本文件建立后，其他 workboard 只作为证据来源 |
| Harness Context System | `DONE` | Context Read Bench 已验收通过，补齐真实读取压测 | [harness_context_T001](tasks/harness_context_T001-context-read-plan-dsl.md), [harness_context_T002](tasks/harness_context_T002-context-read-bench.md) | T001、T002 已 DONE；整仓检查仍有任务外 typecheck 阻断 |
| AgentGraph / Agent V1.5 | `READY_FOR_REVIEW` | T044 已实现 contextual follow-up、`ask_user` 确定性交付与内部 tool-call 文本泄漏防护 | [agent_node_T044](tasks/agent_node_T044-contextual-followup-ask-user-protocol-guard.md), [agent-nodes-workboard.md](agent-nodes-workboard.md) | 定向回归、server typecheck、`pnpm check` 已通过；等待 owner smoke 与正式评审 |
| Agent V1.5 Stabilization 8-Card Package | `TODO` | 登记 T01-T08 施工任务卡，按依赖顺序推进 Agent V1.5 稳定化 | [Agent V1.5 Index](#agent-v15-stabilization-index), [T01](tasks/agent_v15_T01-state-ssot.md) | 8 张任务卡已纳入当前总台账；施工卡状态统一为 `TODO`，尚未开始实现 |
| Harness / Sandbox | `READY_FOR_REVIEW` | 候选排序、sandbox direct contract、artifact/output contract；L1 workspace sandbox runner 已通过，跨层 diagnostics 闭环已补专门回归并通过 `pnpm check` | [T-010](tasks/T-010-harness-candidate-ordering.md), [T-011](tasks/T-011-sandbox-contract-direct-bench.md), [T-012](tasks/T-012-l1-workspace-sandbox-runner.md), [T-013](tasks/T-013-sandbox-artifact-output-contract.md), [T-014](tasks/T-014-cross-layer-diagnostics-closure.md) | T-012、T-013、T-014 已 DONE，其余仍按各自任务状态处理 |
| Deep Agents Spike | `IN_PROGRESS` | `T-DeepAgents-02` 已整改为诚实 baseline：fake wiring 与 real selector quality 已拆开；当前 real selector baseline 因缺少环境配置而 `SKIPPED`，`T-03` 保持阻塞 | [T-DeepAgents-01](tasks/T-DeepAgents-01-deepagents-js-spike.md), [T-DeepAgents-02](tasks/T-DeepAgents-02-selector-middleware-baseline.md) | 独立 spike package，`T-01` 已形成条件通过结论；`T-02` 当前结论是 middleware wiring 通过、middleware extractability 部分成立，但 real selector quality 仍未证明 |
| Core Tools | `READY_FOR_REVIEW` | read / write / terminal / web-search 工具治理尾项 | `core_tools_T001-T019` | 多数已完成，仍有 review 队列 |
| Codebase Understanding Docs | `IN_PROGRESS` | `code_T015` 已把 repo pollution 风险固定成刚性阻断；`code_T016` 已把 blocked-safe 状态做成 owner 可理解的前端工作台；`code_T017` 现已把微应用配置、owner 显式授权、Harness capability reconcile 和 Fake Provider E2E 验证接成闭环，但真实 `CodeGraph 1.3.0` 仍保持 blocked | [code_T001](tasks/code_T001-codebase-understanding-consensus-doc-integration.md), [code_T002](tasks/code_T002-codebase-engine-benchmark.md), [code_T003](tasks/code_T003-codegraph-managed-mcp-spike.md), [code_T004](tasks/code_T004-codebase-engine-abstraction.md), [code_T006](tasks/code_T006-codegraph-benchmark-spike.md), [code_T007](tasks/code_T007-codegraph-wrapper-contract.md), [code_T008](tasks/code_T008-codegraph-managed-mcp-runtime-implementation-plan.md), [code_T009](tasks/code_T009-codegraph-managed-mcp-runtime-spike.md), [code_T010](tasks/code_T010-codebase-explore-wrapper-runtime.md), [code_T011](tasks/code_T011-codegraph-verification-bridge.md), [code_T012](tasks/code_T012-codegraph-trace-diagnostics.md), [code_T013](tasks/code_T013-codegraph-controlled-planner-exposure.md), [code_T014](tasks/code_T014-codegraph-real-provider-smoke.md), [code_T015](tasks/code_T015-codegraph-external-index-root-repo-pollution-control.md), [code_T016](tasks/code_T016-codegraph-studio-desktop-ux-polish.md), [code_T017](tasks/code_T017-codegraph-microapp-controlled-capability-wiring.md), [code_T014 report](reviews/code_T014-codegraph-real-provider-smoke-report.md), [code_T015 report](reviews/code_T015-codegraph-external-index-root-report.md), [review](reviews/codebase-understanding-docs-review-index.md), [codegraph benchmark spike](reviews/codegraph-benchmark-spike.md), [code_T009 review](reviews/code_T009-codegraph-managed-mcp-runtime-spike-review.md), [code_T010 review](reviews/code_T010-codebase-explore-wrapper-runtime-review.md), [code_T011 review](reviews/code_T011-codegraph-verification-bridge-review.md), [code_T012 review](reviews/code_T012-codegraph-trace-diagnostics-review.md), [code_T013 review](reviews/code_T013-codegraph-controlled-planner-exposure-review.md), [code_T014 review](reviews/code_T014-codegraph-real-provider-smoke-review.md), [TD-T016-01](decisions/TD-T016-01-microapp-definition-reconcile-gap.md) | 默认不启用 `codebase_explore`；不允许把 blocked 写成 pass；真实 provider 仍保持 blocked；Fake Provider 仅用于端到端验证；`micro_app_definitions` 旧记录回填仍依赖 seed reconcile |
| Agent Runtime T29-T33 Task Pack | `TODO` | 登记 `server` 测试全绿、failed tool 路径合同、terminal 结果语义、结构化 failure code、核心工具 summary contract 五个任务包 | [agent-runtime-t29-t33-ledger.md](../tooling-runtime/agent-runtime-t29-t33-ledger.md), [agent_node_T029](tasks/agent_node_T029-server-test-report-green.md), [agent_node_T030](tasks/agent_node_T030-failed-tool-path-contract.md), [agent_node_T031](tasks/agent_node_T031-terminal-result-semantics.md), [agent_node_T032](tasks/agent_node_T032-structured-failure-code.md), [agent_node_T033](tasks/agent_node_T033-core-tool-summary-contracts.md) | 已完成仓库内正式登记；当前只新增任务卡和专项台账，未开始实现 |
| MCP Agent Job Release | `IN_PROGRESS` | 外部 MCP 市场应用接入 Agent 的资格、候选暴露与黑盒调用闭环；按 T001 → T002 → T003 顺序审查 | [mcp_agent_T001](tasks/mcp_agent_T001-external-mcp-agent-eligibility.md), [mcp_agent_T002](tasks/mcp_agent_T002-external-mcp-agent-exposure-and-selection.md), [mcp_agent_T003](tasks/mcp_agent_T003-external-mcp-agent-invocation-blackbox.md) | T001、T002 已通过本地主审查；T003 进入下一阶段审查 |
| Attached Browser Integration | `READY_FOR_REVIEW` | T001 Runtime 接入与 T002 Tool Workbench capability ownership 分组均已待评审 | [browser_attached_T001](tasks/browser_attached_T001-harness-capability-integration.md), [browser_attached_T002](tasks/browser_attached_T002-tool-workbench-capability-grouping.md) | T002 已显示 `Computer Use 3` 与 `触界 4`，产品文案已改为“产品能力组”；触界四 tab 的独立 Electron 切换实测仍待补 |
| Agent Phase 1 | `ARCHIVED_DONE` | Agent MVP 主链历史归档 | [agent-phase-1-2-archive-decision.md](phase-conclusions/agent-phase-1-2-archive-decision.md), [agent-phase-1-checklist.md](../chat/agent-phase-1-checklist.md) | 一期完成归档；剩余增强项转后续 |
| Agent Phase 2 | `ARCHIVED_PARTIAL_SUPERSEDED` | 可用闭环阶段部分归档，后续由 Agent V1.5 / 老三期接管 | [agent-phase-1-2-archive-decision.md](phase-conclusions/agent-phase-1-2-archive-decision.md), [agent-phase-2-checklist.md](../chat/agent-phase-2-checklist.md) | 不按完成归档；未完成项不得口头升级为 DONE |
| Phase-1 Remediation | `DONE_WITH_HISTORY` | 早期 P0/P1/P2 缺陷整改 | [agent-workboard.md](agent-workboard.md), `T-001-T008` | 仅作为历史证据，不再作为当前项目台账；阶段口径见 Agent Phase 1 |
| Test Report / Evidence Hygiene | `PROPOSED` | 测试报告 JSON 合并与瘦身 | [T-009](tasks/T-009-test-report-json-consolidation.md) | `status: proposed`, `canonical: false`，未进入当前执行 |
| Skill Docs Foundation | `DONE` | `docs/skill` 基础数据 POC 整理为 docs-only Phase 0 | [skill_T001](tasks/skill_T001-docs-only-foundation.md), [docs/skill/roadmap.md](../skill/roadmap.md) | docs-only Phase 0 评审通过；未批准 runtime / DB / UI / AgentGraph / Harness / MCP 实现 |
| MicroAPP Image Generation POC | `READY_FOR_REVIEW` | 生图微应用 docs-only 基础建设：兼容底座、统一任务生命周期、ComfyUI workflow runner 边界；当前仅服务微应用界面调试 | [microapp_T001](tasks/microapp_T001-image-generation-poc-docs-foundation.md), [image-generation-microapp-poc.md](../microapp/image-generation-microapp-poc.md) | 当前只提交 docs-only POC；未批准 runtime / DB / UI / provider 实现 |
| MicroAPP Image Generation Interaction Spec | `READY_FOR_REVIEW` | 生图微应用调试页交互说明：页面结构、状态反馈、Prompt/Workflow 双模式 | [microapp_T011](tasks/microapp_T011-image-generation-debug-workspace-interaction-spec.md), [interaction-spec.md](../microapp/image-generation-debug-workspace-interaction-spec.md) | 当前只提交 docs-only 交互说明；未批准 UI 实现 |
| MicroAPP Computer Use POC | `READY_FOR_REVIEW` | `computer_use` 微应用 docs-only 基础建设：隔离执行面优先、审批链、回放 artifact 与 Electron / Tauri 边界 | [microapp_T002](tasks/microapp_T002-computer-use-poc-docs-foundation.md), [computer-use-microapp-poc.md](../microapp/computer-use-microapp-poc.md) | 当前只提交 docs-only POC；未批准 runtime / DB / UI / preload / desktop automation 实现 |
| MicroAPP Computer Use Feature Design | `READY_FOR_REVIEW` | `computer_use` 第一阶段浏览器工作台功能设计：入口、状态、审批、安装引导、结果回放 | [microapp_T003](tasks/microapp_T003-computer-use-feature-design.md), [computer-use-feature-design.md](../microapp/computer-use-feature-design.md) | 当前只提交 docs-only 功能设计；未批准 runtime / DB / UI / browser runtime implementation |
| MicroAPP Computer Use Parallel Build | `READY_FOR_REVIEW` | 并行施工代码隔离：共享注册层、server core、runtime/executor、route、desktop API、desktop 工作台，以及产品入口衔接卡 | [microapp_T020](tasks/microapp_T020-computer-use-parallel-code-isolation.md), [microapp_T110-T116](tasks/microapp_T110-computer-use-shared-registry-and-seed.md) | 当前已补入口衔接任务卡；实现与评审按各自任务状态推进 |
| MicroAPP Computer Use Smoke | `READY_FOR_REVIEW` | `Computer Use Studio` 产品入口级冒烟已补第二轮真实证据：即使目标明确要求输出页面标题和主标题文本，当前链路仍只生成“导航 + 截图”plan，并返回同样的截图型结果摘要 | [microapp_T117](tasks/microapp_T117-computer-use-browser-smoke.md) | 证据目录已回填到 `.test-artifact/computer-use-smoke/2026-07-06-T117/`；当前阻塞已收敛为一期能力边界，不再只是证据缺失 |
| MicroAPP Computer Use Debugger Rebuild | `READY_FOR_REVIEW` | 用 5 张新任务卡重建真实浏览器调试闭环：运行时、浏览器工具、MCP/模型治理、全新 Debugger UI、集成验收 | [microapp_T118-T122](tasks/microapp_T118-computer-use-runtime-and-managed-browser.md) | T122-fix 已完成代码和前台 Debugger 复测；observe/stop HTTP 500 已修复，Agent 真实 provider tool-loop 因模型未配置仍待条件复测 |
| MicroAPP Computer Use Browser Runtime Platformization | `READY_FOR_REVIEW` | T123：修复 macOS 浏览器运行时平台缺口——托管 Chromium 配置按平台分发、darwin 系统浏览器探测、托管元数据平台一致性校验；Windows 合同不变 | [microapp_T123](tasks/microapp_T123-computer-use-browser-runtime-platformization.md), [TD-T118-01](decisions/TD-T118-01-computer-use-browser-runtime-platform-gap.md), [缺陷台账](../developments/defect-log.md) | 2026-09-08 实施完成：定向测试 16 项通过、server typecheck 通过、darwin-arm64 实机以 playwright-core 真实启动托管 Chrome for Testing 与系统 Chrome 均成功；错误 win64 记录已判无效并清理；Windows 未实机复测（合同级回归） |
| MicroAPP Info MCP | `DONE` | 资讯中心接入 `web_search` 内部来源，邮件中心接入单一 `mail_query`，复用 Harness embedding / rerank 能力并补齐 MCP 治理 | [microapp_info_mcp_001](tasks/microapp_info_mcp_001-news-search-integration.md), [microapp_info_mcp_002](tasks/microapp_info_mcp_002-mail-query.md), [microapp_info_mcp_003](tasks/microapp_info_mcp_003-harness-mcp-governance.md) | 三张任务卡已完成；OpenAI tunnel / 倾城时光不在本包 |
| MicroAPP Image Generation Parallel Build | `IN_PROGRESS` | 并行施工代码隔离：共享注册层、server domain、adapter、route、desktop API、desktop 调试页，以及产品入口衔接卡 | [microapp_T010](tasks/microapp_T010-image-generation-parallel-code-isolation.md), [microapp_T100](tasks/microapp_T100-image-generation-shared-registry-and-seed.md), [microapp_T106](tasks/microapp_T106-image-generation-desktop-entry-integration.md) | `T100`、`T101`、`T103`、`T104`、`T105`、`T106` 已 DONE；`T102` 待评审 |
| MicroAPP Image Generation Smoke | `DONE` | `ComfyUI Local` 产品入口级冒烟：从当前微应用列表页进入 `Image Generation Studio`，使用合法 workflow 跑真实任务终态并保留证据 | [microapp_T107](tasks/microapp_T107-image-generation-comfyui-smoke.md), [image-generation-comfyui-smoke-guide.md](../microapp/image-generation-comfyui-smoke-guide.md) | 已完成两轮真实冒烟；第二轮在补齐 `UI_CHAT_IMAGE_GENERATION_COMFYUI_BASE_URL` 并重启 backend 后成功到 `succeeded` |
| MicroAPP Chat Media Integration | `DONE` | 在现有聊天消息完成后接入 TTS 和 RP 生图；只扩展媒体任务、线程开关、消息关联、界面展示和清理，不修改 AgentGraph、RAG、Chat、Role 核心逻辑 | [microapp_chat_T001](tasks/microapp_chat_T001-media-persistence-and-lifecycle.md), [microapp_chat_T002](tasks/microapp_chat_T002-thread-media-capabilities-and-orchestration.md), [microapp_chat_T003](tasks/microapp_chat_T003-chat-media-ui.md), [microapp_chat_T004](tasks/microapp_chat_T004-integration-acceptance.md) | T001、T002、T003 已 DONE；T004 仍为 `TODO`，按 T001 → T002 → T003 → T004 执行 |

## Active Review Queue

这些是当前不应从视野里消失的非 DONE 项。

| Task | State | Area | Required Next Step |
| --- | --- | --- | --- |
| [agent_node_T002](tasks/agent_node_T002-tool-call-normalize-node.md) | `TODO` | AgentGraph | 状态异常审计：代码与后续任务显示 normalize 已接入，但任务卡仍是 TODO |
| [agent_node_T012](tasks/agent_node_T012-repeated-tool-guard.md) | `READY_FOR_REVIEW` | AgentGraph | 评审 repeated guard 是否可接受，以及旧线程 `<function_calls>` 异常是否另开任务 |
| [agent_node_T016](tasks/agent_node_T016-local-tool-routing-and-schema-guard.md) | `READY_FOR_REVIEW` | AgentGraph | 评审弱模型防线和最新前台 smoke 证据 |
| [agent_node_T037](tasks/agent_node_T037-planner-task-coverage-view.md) | `TODO` | AgentGraph | 起一张轻量 `TaskCoverageView` 卡，收紧 Planner 完成判定，并把剩余未完成目标稳定传给后续 ToolSelect / Harness query |
| [agent_node_T038](tasks/agent_node_T038-task-intent-required-work-extractor.md) | `DONE` | AgentGraph | `Task Intent / Required Work Extractor` 审查通过；提取层已独立，定向回归 93/93 通过，整包 `typecheck` 仍被任务外 `microapps` 现存错误阻断 |
| [agent_node_T039](tasks/agent_node_T039-coverage-state-reducer.md) | `DONE` | AgentGraph | `Coverage State Reducer` 审查通过；已基于完整 evidence 形成 target × action 覆盖状态并兼容现有 `AgentTaskCoverageView`，定向回归 92/92 通过 |
| [agent_node_T040](tasks/agent_node_T040-planner-transition-policy.md) | `DONE` | AgentGraph | `Planner Transition Policy` 已完成：Planner 先按 `coverageState` 决定 `nextAction`，再在不确定时回退到 bridge / task model；定向回归 89/89 通过，`pnpm check` 已通过 |
| [agent_node_T041](tasks/agent_node_T041-toolselect-coverage-aware-routing.md) | `DONE` | AgentGraph | `ToolSelect Coverage-Aware Routing` 已完成：`effectiveQuery` 固定输出 original query / review context / remaining coverage / preferred next action 四段，matcher 与 selector 共同围绕剩余缺口选工具；定向回归 27/27 通过，`pnpm check` 已通过 |
| [agent_node_T042](tasks/agent_node_T042-recovery-replan-coverage-contract.md) | `DONE` | AgentGraph | `Recovery / Replan Coverage Contract` 已完成：正式施工卡已回填，recoverable / terminal / repeated guard / recovery exhausted 合同已用定向回归固化；`coverage-state`、planner、graph 与 terminal failure 定向回归 8 条通过，`pnpm check` 已通过 |
| [agent_node_T043](tasks/agent_node_T043-coverage-driven-blackbox-regression-suite.md) | `DONE` | AgentGraph | `Coverage-driven Blackbox Regression Suite` 已完成：补齐 single-target `read_locate` answer、`read_locate -> read_open` bridge、双文件内容任务必须全量完成后才 answer 的近黑盒回归；定向图测试 3 条通过，`pnpm check` 已通过 |
| [agent_node_T044](tasks/agent_node_T044-contextual-followup-ask-user-protocol-guard.md) | `READY_FOR_REVIEW` | AgentGraph | 三项最小整改及自动回归已完成；等待 owner smoke A/B 和正式评审 |
| [core_tools_T008](tasks/core_tools_T008-read-locate-keyword-preview.md) | `READY_FOR_REVIEW` | Core Tools | 评审 read locate preview |
| [core_tools_T011](tasks/core_tools_T011-selector-create-file-prefers-edit.md) | `READY_FOR_REVIEW` | Core Tools | 评审 create-file selector 策略 |
| [core_tools_T017](tasks/core_tools_T017-web-search-artifact-sensitive-field-scrubbing.md) | `READY_FOR_REVIEW` | Core Tools | 评审敏感字段清理 |
| [code_T001](tasks/code_T001-codebase-understanding-consensus-doc-integration.md) | `READY_FOR_REVIEW` | Docs / Tooling Runtime | 评审 `CARD-01` 本地化后的代码库理解共识文档 |
| [code_T002](tasks/code_T002-codebase-engine-benchmark.md) | `DONE` | Docs / Tooling Runtime | benchmark 问题集、评估维度、评分模板和通过/不通过规则已落入正式文档 |
| [code_T006](tasks/code_T006-codegraph-benchmark-spike.md) | `DONE` | Docs / Tooling Runtime | 本地 CodeGraph benchmark spike 已完成；review 记录见 `reviews/codegraph-benchmark-spike.md`，结论是继续做受控候选，不直接接 runtime |
| [code_T004](tasks/code_T004-codebase-engine-abstraction.md) | `DONE` | Docs / Tooling Runtime | 抽象层设计文档、索引与台账已回填；2026-07-08 项目 owner 明确要求直接标记完成，后续仍执行总审查 |
| [code_T007](tasks/code_T007-codegraph-wrapper-contract.md) | `READY_FOR_REVIEW` | Docs / Tooling Runtime | 评审 CodeGraph wrapper 合同是否足够固定 scope、裁剪、核验和降级边界 |
| [code_T008](tasks/code_T008-codegraph-managed-mcp-runtime-implementation-plan.md) | `DONE` | Docs / Tooling Runtime | CodeGraph Managed MCP runtime implementation plan 已评审通过，可作为后续 runtime spike / wrapper / verification / trace 任务的设计约束 |
| [T-011](tasks/T-011-sandbox-contract-direct-bench.md) | `READY_FOR_REVIEW` | Harness / Sandbox | 评审 sandbox direct bench contract |
| [T-DeepAgents-01](tasks/T-DeepAgents-01-deepagents-js-spike.md) | `READY_FOR_REVIEW` | Agent Runtime / Spike | 已完成 runtime feasibility spike；按项目 owner 结论为“有条件通过” |
| [T-DeepAgents-02](tasks/T-DeepAgents-02-selector-middleware-baseline.md) | `READY_FOR_REVIEW` | Agent Runtime / Spike | 已完成整改：fake wiring 与 real selector baseline 已拆开，新增 116 条 fixtures、high-risk 双口径指标和 runtime middleware smoke tests；当前因缺少 `DEEPAGENTS_SELECTOR_BASE_URL / MODEL`，real selector baseline 为 `SKIPPED`，`T-03` 继续阻塞 |
| [mcp_agent_T001](tasks/mcp_agent_T001-external-mcp-agent-eligibility.md) | `DONE` | MCP Agent / Eligibility | 本地主审查通过；定向测试、两端 typecheck 与 `pnpm check` 均通过 |
| [mcp_agent_T002](tasks/mcp_agent_T002-external-mcp-agent-exposure-and-selection.md) | `DONE` | MCP Agent / Exposure and Selection | 本地主审查通过；真实 eligibility matcher 接线、allowlist/disabled/stale 过滤、task model、Tool Guard、topK/maxTools 和四态 diagnostics 已有证据；定向测试 190/190，`pnpm check` 通过 |
| [mcp_agent_T003](tasks/mcp_agent_T003-external-mcp-agent-invocation-blackbox.md) | `BLOCKED` | MCP Agent / Invocation Blackbox | 任务卡原始 `task_state: BLOCKED_BY_T002`；T002 通过后进入审查；要求完整黑盒和真实前台 smoke |
| [browser_attached_T001](tasks/browser_attached_T001-harness-capability-integration.md) | `READY_FOR_REVIEW` | Harness / Attached Browser | 自动验证通过；等待 owner 明确请求评审，真实扩展 look → act → look 与 stale / timeout / auth 集成证据仍缺失 |
| [browser_attached_T002](tasks/browser_attached_T002-tool-workbench-capability-grouping.md) | `READY_FOR_REVIEW` | Tool Workbench / Capability Grouping | Capability ownership 投影、前端 group 分组和产品组文案已实现；自动验证和 3/4 UI 展示通过，触界四 tab 的独立 Electron 切换实测待补 |
| [T-012](tasks/T-012-l1-workspace-sandbox-runner.md) | `DONE` | Harness / Sandbox | Review 02 已通过：L1 workspace sandbox runner |
| [T-009](tasks/T-009-test-report-json-consolidation.md) | `PROPOSED` | Evidence Hygiene | 决定是否进入执行队列 |
| [harness_context_T002](tasks/harness_context_T002-context-read-bench.md) | `DONE` | Harness Context | 已验收通过；保留任务外 typecheck 阻断记录 |
| [microapp_T001](tasks/microapp_T001-image-generation-poc-docs-foundation.md) | `READY_FOR_REVIEW` | MicroAPP | 评审 docs-only 生图微应用兼容底座、ComfyUI runner 边界，以及“仅微应用界面调试”范围是否可接受 |
| [microapp_T011](tasks/microapp_T011-image-generation-debug-workspace-interaction-spec.md) | `READY_FOR_REVIEW` | MicroAPP | 评审生图微应用调试页的交互语言是否足够完整，能否直接进入设计出稿 |
| [microapp_T002](tasks/microapp_T002-computer-use-poc-docs-foundation.md) | `READY_FOR_REVIEW` | MicroAPP | 评审 docs-only `computer_use` 微应用边界、隔离执行面优先级和后续高风险切片是否可接受 |
| [microapp_T003](tasks/microapp_T003-computer-use-feature-design.md) | `READY_FOR_REVIEW` | MicroAPP | 评审 `computer_use` 第一阶段浏览器工作台功能设计是否可接受 |
| [microapp_T020](tasks/microapp_T020-computer-use-parallel-code-isolation.md) | `READY_FOR_REVIEW` | MicroAPP | 评审 `computer_use` 并行施工的代码隔离、共享文件归属和推荐批次是否可接受 |
| [microapp_T117](tasks/microapp_T117-computer-use-browser-smoke.md) | `READY_FOR_REVIEW` | MicroAPP | 评审两轮真实冒烟证据，并确认当前阻塞应按一期能力边界处理，还是另开实现卡修复 |
| [microapp_T010](tasks/microapp_T010-image-generation-parallel-code-isolation.md) | `READY_FOR_REVIEW` | MicroAPP | 评审 `image_generation` 并行施工的代码隔离、共享文件归属和推荐批次是否可接受 |

## A18 AgentGraph Tech Debt / Sandbox Task Index

任务卡元数据已补齐，A18_T001 当前进入实现阶段；其余 A18 任务仍按各自任务卡状态管理。

| Task | Ledger State | Area | Required Next Step |
| --- | --- | --- | --- |
| [A18_T001](tasks/A18_T001-workspace-path-contract.md) | `DONE` | AgentGraph / Workspace Path | 评审通过；sentinel-only path normalization、boundary、approval smoke、定向 76/76 与 server typecheck 有证据；其余 A18 任务不受本卡结论影响；评审提示词见 [review prompt](reviews/A18_T001-workspace-path-contract-review-prompt.md) |
| [A18_T002](tasks/A18_T002-structured-tool-evidence.md) | `DONE` | AgentGraph / Evidence | 评审通过；generic 7/7、Planner 55/55、Generate 19/19、server typecheck 通过，mail_query/browser_observe 适配器样本及有界敏感字段证据已记录；`pnpm check` 与完整 server 测试的既有失败已记录；评审提示词见 [review prompt](reviews/A18_T002-structured-tool-evidence-review-prompt.md) |
| [A18_T003](tasks/A18_T003-execution-object-confirmation.md) | `TASK_CARD_STATE_INVALID` | AgentGraph / Execution Object | 补齐合法 `task_state`，等待 A18_T001；评审提示词见 [review prompt](reviews/A18_T003-execution-object-confirmation-review-prompt.md) |
| [A18_T004](tasks/A18_T004-microapp-definition-migration.md) | `TASK_CARD_STATE_INVALID` | MicroAPP / Definition Migration | 补齐合法 `task_state`，确认后独立施工与 PR；评审提示词见 [review prompt](reviews/A18_T004-microapp-definition-migration-review-prompt.md) |
| [A18_T005](tasks/A18_T005-sandbox-contract-and-runner.md) | `TASK_CARD_STATE_INVALID` | Harness / Sandbox | 补齐合法 `task_state`，等待 A18_T001/A18_T002/A18_T003；评审提示词见 [review prompt](reviews/A18_T005-sandbox-contract-and-runner-review-prompt.md) |
| [A18_T006](tasks/A18_T006-managed-python-sandbox.md) | `TASK_CARD_STATE_INVALID` | Harness / Managed Python Sandbox | 补齐合法 `task_state`，等待 A18_T005/A18_T002；评审提示词见 [review prompt](reviews/A18_T006-managed-python-sandbox-review-prompt.md) |

## MicroAPP Image Generation Parallel Task Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [microapp_T100](tasks/microapp_T100-image-generation-shared-registry-and-seed.md) | `DONE` | 共享注册层、默认 seed、runtime 识别入口 |
| [microapp_T101](tasks/microapp_T101-image-generation-server-domain-core.md) | `DONE` | `server/src/microapps/image-generation/core/**` 领域核心 |
| [microapp_T102](tasks/microapp_T102-image-generation-server-adapters-and-artifacts.md) | `READY_FOR_REVIEW` | provider adapter、ComfyUI runner、artifact 回收 |
| [microapp_T103](tasks/microapp_T103-image-generation-server-http-surface.md) | `DONE` | `server/src/routes/microapps/**` 和 server 注册 |
| [microapp_T104](tasks/microapp_T104-image-generation-desktop-api-client.md) | `DONE` | `desktop/src/shared/api/imageGeneration.ts` 共享 API client |
| [microapp_T105](tasks/microapp_T105-image-generation-desktop-debug-workspace.md) | `DONE` | 微应用界面调试页和 settings route 挂载 |
| [microapp_T106](tasks/microapp_T106-image-generation-desktop-entry-integration.md) | `DONE` | 已补列表页稳定主入口、详情页边界说明和页面测试证据；用户无需手输 URL 即可进入 `Image Generation Studio` |
| [microapp_T107](tasks/microapp_T107-image-generation-comfyui-smoke.md) | `DONE` | 已完成 `ComfyUI Local` 冒烟；第二轮已真实跑通 `queued -> running -> succeeded`，并回收到本地预览图 |

## MicroAPP Chat Media Integration Task Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [microapp_chat_T001](tasks/microapp_chat_T001-media-persistence-and-lifecycle.md) | `DONE` | 媒体消息关联、绝对路径持久化、读取接口、删除和生图任务持久化；不修改 ChatMessagePart；定向测试 5 files / 44 tests，server typecheck 通过 |
| [microapp_chat_T002](tasks/microapp_chat_T002-thread-media-capabilities-and-orchestration.md) | `DONE` | GPT-SoVITS 聊天调用链已接入；桌面定向 20 项、服务端定向 27 项、两端 typecheck 与带堆上限的 `pnpm check` 通过。Provider 配置使用权威 `serverRefAudioId`，真实专用合成已验证 |
| [microapp_chat_T003](tasks/microapp_chat_T003-chat-media-ui.md) | `DONE` | TTS 播放按钮、图片按钮显示规则、助手文字下方图片和媒体状态展示；前台烟测通过，定向 UI 回归 39 tests passed |
| [microapp_chat_T004](tasks/microapp_chat_T004-integration-acceptance.md) | `DONE` | 完成 Chat/RAG/Role/Role+RAG 集成验收；服务端媒体回归 6 files / 62 tests、桌面媒体回归 5 files / 50 tests、两端 typecheck、带堆上限的 `pnpm check` 通过；未修改产品业务代码 |

## MicroAPP Computer Use Parallel Task Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [microapp_T110](tasks/microapp_T110-computer-use-shared-registry-and-seed.md) | `DONE` | 共享注册层、默认 seed、runtime 识别入口和 `computer-use.microapp.ts` 桥接文件 |
| [microapp_T111](tasks/microapp_T111-computer-use-server-domain-core.md) | `DONE` | `server/src/microapps/computer-use/core/**` 领域核心 |
| [microapp_T112](tasks/microapp_T112-computer-use-browser-runtime-and-executor.md) | `DONE` | 浏览器运行时管理、Playwright 执行器和 `.test-artifact/computer-use/**` |
| [microapp_T113](tasks/microapp_T113-computer-use-server-http-surface.md) | `DONE` | `server/src/routes/microapps/computer-use/**`、route 聚合和 server 注册 |
| [microapp_T114](tasks/microapp_T114-computer-use-desktop-api-client.md) | `DONE` | `desktop/src/shared/api/computerUse.ts` 共享 API client |
| [microapp_T115](tasks/microapp_T115-computer-use-desktop-studio-workspace.md) | `DONE` | 浏览器工作台、settings route 挂载和 settings i18n 文案 |
| [microapp_T116](tasks/microapp_T116-computer-use-desktop-entry-integration.md) | `DONE` | 当前微应用列表页 / 详情页到 `Computer Use Studio` 的产品入口衔接 |
| [microapp_T117](tasks/microapp_T117-computer-use-browser-smoke.md) | `READY_FOR_REVIEW` | 两轮真实证据都只证明“导航 + 截图”成功；当前仍未证明能把页面标题和主标题文本产出到结果里 |

## MicroAPP Info MCP Task Index

| Task | Ledger State | Scope |
| --- | --- | --- |
| [microapp_info_mcp_001](tasks/microapp_info_mcp_001-news-search-integration.md) | `DONE` | 通用检索基础适配与资讯接入 `web_search` |
| [microapp_info_mcp_002](tasks/microapp_info_mcp_002-mail-query.md) | `DONE` | 邮件丰富查询、详情读取和显式 IMAP 同步 |
| [microapp_info_mcp_003](tasks/microapp_info_mcp_003-harness-mcp-governance.md) | `DONE` | MCP tool、capability profile、Harness exposure、审批、trace 和测试 |

### MicroAPP Computer Use Debugger Rebuild Task Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [microapp_T118](tasks/microapp_T118-computer-use-runtime-and-managed-browser.md) | `DONE` | 固定受管 Chromium 配置、运行时探测、下载、校验和安装状态；任务卡已有定向测试和 `pnpm check` 证据 |
| [microapp_T119](tasks/microapp_T119-computer-use-browser-session-and-tools.md) | `TODO` | 浏览器 session 与 `browser_observe / browser_act / browser_assert` 执行能力 |
| [microapp_T120](tasks/microapp_T120-computer-use-mcp-model-governance.md) | `TODO` | MCP 注册、真实模型循环、审批、trace、evidence 和调用持久化 |
| [microapp_T121](tasks/microapp_T121-computer-use-debugger-rebuild.md) | `TODO` | 从零重建 Debugger 页面，不参考当前 `Computer Use Studio` 界面 |
| [microapp_T122](tasks/microapp_T122-computer-use-integration-and-acceptance.md) | `READY_FOR_REVIEW` | 集成验收、前端黑盒用例和端到端证据；第二轮前台黑盒 `PASS=9`、`FAIL=8`、`SKIPPED=3`；剩余 browser_act action schema 和正确标题断言缺陷 |
| [microapp_T122-fix](tasks/microapp_T122-fix-computer-use-runtime-and-agent-entry.md) | `READY_FOR_REVIEW` | Debugger observe/stop HTTP 500 已修复；浏览器意图只暴露 `browser_*`，真实 provider 前台复测待模型配置；明确不得修改 AgentGraph |
| [microapp_T122-hotFix](tasks/microapp_T122-hotFix-computer-use-tool-session-lifecycle.md) | `READY_FOR_REVIEW` | 工具侧完成 Session 创建、复用和内部注入；Agent-facing schema 不再要求 `sessionId`；定向 12 测试和 `pnpm check` 通过，待真实 AgentTaskModel 前台复测 |
| [microapp_T123](tasks/microapp_T123-computer-use-agent-task-model-config-and-run.md) | `DONE` | Debugger 已显示 AgentTaskModel 并完成真实 Computer Use task run；不得修改 AgentGraph |

## Agent Nodes Index

| Task | Ledger State | Task Card State | Notes |
| --- | --- | --- | --- |
| [agent_node_T001](tasks/agent_node_T001-next-action-planner-node.md) | `DONE` | `DONE` | nextAction planner node |
| [agent_node_T002](tasks/agent_node_T002-tool-call-normalize-node.md) | `TODO_REVIEW_STATE` | `TODO` | 后续代码与任务显示 normalize 已接入；需要确认是否只是任务卡未更新 |
| [agent_node_T003](tasks/agent_node_T003-agent-graph-wiring.md) | `DONE` | `DONE` | 旧 `agent-nodes-workboard.md` 顶部表格仍标 TODO，是旧台账错误 |
| [agent_node_T004](tasks/agent_node_T004-policy-node-consume-pending-tool-call.md) | `DONE` | `DONE` | 旧 `agent-nodes-workboard.md` 顶部表格仍标 TODO，是旧台账错误 |
| [agent_node_T005](tasks/agent_node_T005-tool-node-execute-frozen-pending-tool-call.md) | `DONE` | `DONE` | toolNode frozen call |
| [agent_node_T006](tasks/agent_node_T006-evidence-loop-routing.md) | `DONE` | `DONE` | evidence loop routing |
| [agent_node_T007](tasks/agent_node_T007-decision-loop-acceptance-regression-guardrails.md) | `DONE` | `DONE` | regression guardrails |
| [agent_node_T008](tasks/agent_node_T008-v1-cleanup-release-hardening.md) | `DONE` | `DONE` | V1 cleanup |
| [agent_node_T009](tasks/agent_node_T009-evidence-summary-answer-stop-rule.md) | `DONE` | `DONE` | evidence summary / answer stop |
| [agent_node_T010](tasks/agent_node_T010-next-action-planner-json-contract-hardening.md) | `DONE` | `DONE` | planner JSON hardening |
| [agent_node_T011](tasks/agent_node_T011-workspace-path-argument-contract.md) | `DONE` | `DONE` | workspace path contract |
| [agent_node_T012](tasks/agent_node_T012-repeated-tool-guard.md) | `READY_FOR_REVIEW` | `READY_FOR_REVIEW` | repeated tool guard |
| [agent_node_T013](tasks/agent_node_T013-evidence-grounded-final-answer.md) | `DONE` | `DONE` | grounded final answer |
| [agent_node_T014](tasks/agent_node_T014-approval-resume-contract.md) | `DONE` | `DONE` | approval resume contract |
| [agent_node_T015](tasks/agent_node_T015-phoenix-minimum-human-observability.md) | `DONE` | `DONE` | Phoenix observability |
| [agent_node_T016](tasks/agent_node_T016-local-tool-routing-and-schema-guard.md) | `READY_FOR_REVIEW` | `READY_FOR_REVIEW` | local routing / schema guard |
| [agent_node_T017](tasks/agent_node_T017-toolcall-loop-regression-matrix.md) | `DONE` | `DONE` | Review 02 已通过；toolCall loop 黑盒回归矩阵 |
| [agent_node_T029](tasks/agent_node_T029-server-test-report-green.md) | `TODO` | `TODO` | 外部 `T29` 正式登记；必须先于 `T30-T33` |
| [agent_node_T030](tasks/agent_node_T030-failed-tool-path-contract.md) | `DONE` | `DONE` | failed tool 路径合同断言已与 C 合同对齐；定向 vitest 26/26 通过；未回填 `T29` |
| [agent_node_T031](tasks/agent_node_T031-terminal-result-semantics.md) | `DONE` | `DONE` | terminal result 三层语义已拆开；受限回答与 `T30` 失败路径合同复核通过 |
| [agent_node_T032](tasks/agent_node_T032-structured-failure-code.md) | `DONE` | `DONE` | ToolNode 与 Harness failure 已接入最小结构化 `failureCode`；结构化优先、fallback 与 evidence 可见性复核通过 |
| [agent_node_T033](tasks/agent_node_T033-core-tool-summary-contracts.md) | `DONE` | `DONE` | edit/workspace mutation/action profile summary contract 已补齐；dry-run、真实写入与 unknown fallback 复核通过 |
| [agent_node_T037](tasks/agent_node_T037-planner-task-coverage-view.md) | `TODO` | `TODO` | 轻量 `TaskCoverageView`：在不改主执行链的前提下，把任务覆盖度变成 Planner 的刚性判定输入 |
| [agent_node_T038](tasks/agent_node_T038-task-intent-required-work-extractor.md) | `DONE` | `DONE` | 任务意图提取层已独立成 `task-intent.ts`；输出 `taskKind / requiredTargets / requiredActions / completionHints`，覆盖多目标与中文裸 mutation target，且未改 `AgentGraph` 主线 |
| [agent_node_T039](tasks/agent_node_T039-coverage-state-reducer.md) | `DONE` | `DONE` | 覆盖状态已独立成 `coverage-state.ts`；按 target × action 归约完整 evidence，区分 `pending / located / opened / mutated / verified / blocked`，并继续兼容 `AgentTaskCoverageView` |
| [agent_node_T040](tasks/agent_node_T040-planner-transition-policy.md) | `DONE` | `DONE` | 已新增 `coverage-transition.ts`，让 Planner 优先按 `coverageState` 做确定性 `nextAction` 转移，并保留 bridge / task model fallback；外部搜索 query 归一化、mutation / multi-target / verify 路径回归已补齐 |
| [agent_node_T041](tasks/agent_node_T041-toolselect-coverage-aware-routing.md) | `DONE` | `DONE` | 已加固 `toolSelectNode` 的 coverage-aware `effectiveQuery` 结构与 preferred next action 路由提示；matcher / selector 共同使用增强 query，`resolvedToolIntent.query` 仍保持原始用户语义 |
| [agent_node_T042](tasks/agent_node_T042-recovery-replan-coverage-contract.md) | `DONE` | `DONE` | 已把误建的评审卡覆盖回正式施工卡；当前运行时代码无需追加修改，主要补的是 T042 相关图测试口径和正式任务证据，少量其他旧测试仍按 task-model 调用次数计数，后续可单独整理 |
| [agent_node_T043](tasks/agent_node_T043-coverage-driven-blackbox-regression-suite.md) | `DONE` | `DONE` | 已补齐 T043 最容易回归的近黑盒闸门：单目标 locate 可回答、locate 后仍要内容时必须转 `read_open`、README.md / AGENTS.md 双文件内容任务必须全量完成后才 answer；当前不改运行时代码，只补正式任务卡、台账和图测试证据 |
| [agent_node_T044](tasks/agent_node_T044-contextual-followup-ask-user-protocol-guard.md) | `READY_FOR_REVIEW` | `READY_FOR_REVIEW` | Planner contextual follow-up、deterministic ask_user、narrow protocol leak guard 已实现并通过定向回归；待 owner smoke / 正式评审 |

## Agent V1.5 Stabilization Index

| Task | Ledger State | Task Card State | Dependency / Scope |
| --- | --- | --- | --- |
| [agent_v15_T01](tasks/agent_v15_T01-state-ssot.md) | `DONE` | `DONE` | State 单一事实源与字段所有权；R01 复审通过，专项测试 46/46 |
| [agent_v15_T02](tasks/agent_v15_T02-tool-exposure.md) | `DONE` | `DONE` | Tool Exposure 收敛；整改复审通过，T02 相关测试 67/67 |
| [agent_v15_T03](tasks/agent_v15_T03-remove-pretool-selector.md) | `DONE` | `DONE` | 移除 Planner 前置工具选择链路；按 Mira PR #4 口径复审通过，专项测试 7/7 |
| [agent_v15_T04](tasks/agent_v15_T04-remove-static-plan.md) | `DONE` | `DONE` | 移除静态 Plan 层与 AgentPlan 持久化状态；复审通过，T04 定向测试通过 |
| [agent_v15_T05](tasks/agent_v15_T05-remove-shadow-deciders.md) | `DONE` | `DONE` | 移除 Shadow Deciders、桥接器与 Action Rewrite；复审通过，T05 定向测试 73/73 通过 |
| [agent_v15_T06](tasks/agent_v15_T06-evidence-boundary.md) | `DONE` | `DONE` | Evidence 单一职责与显式回流节点；已接入显式 Evidence 回流节点并移除执行节点直接写入 |
| [agent_v15_T07](tasks/agent_v15_T07-read-surface.md) | `DONE` | `DONE` | Read 公共工具面收敛；复审通过，公共面仅保留 `read_discover/read_open`，相关测试 160/160 通过 |
| [agent_v15_T08](tasks/agent_v15_T08-strengthen-planner.md) | `DONE` | `DONE` | Planner 正向增强与主线收口；本地复审通过，核心回归 179/179，待 Mira PR 复审 |
| [agent_v15_T08-R01-global-audit-remediation](reviews/agent_v15_T08-R01-global-audit-remediation.md) | `DONE` | `N/A` | T08 前置全局审计整改：清理死状态、收紧 Tool Exposure SSOT、统一 Evidence 后事实读取关系；复审通过，专项回归 191/191，待 Mira PR 复审 |

## Core Tools Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [core_tools_T001](tasks/core_tools_T001-edit-workspace-boundary.md) | `DONE` | edit workspace boundary |
| [core_tools_T002](tasks/core_tools_T002-web-search-provider-input-hardening.md) | `DONE` | web search provider input |
| [core_tools_T003](tasks/core_tools_T003-terminal-llm-input-surface.md) | `DONE` | terminal LLM input surface |
| [core_tools_T004](tasks/core_tools_T004-terminal-command-approval.md) | `DONE` | terminal command approval |
| [core_tools_T005](tasks/core_tools_T005-write-file-create-empty-content.md) | `DONE` | write file empty content |
| [core_tools_T006](tasks/core_tools_T006-write-file-overwrite-approval.md) | `DONE` | overwrite approval |
| [core_tools_T007](tasks/core_tools_T007-replace-block-unique-match.md) | `DONE` | replace block unique match |
| [core_tools_T008](tasks/core_tools_T008-read-locate-keyword-preview.md) | `READY_FOR_REVIEW` | read locate preview |
| [core_tools_T009](tasks/core_tools_T009-terminal-cwd-workspace-bound.md) | `DONE` | terminal cwd bound |
| [core_tools_T010](tasks/core_tools_T010-terminal-timeout-bounds.md) | `DONE` | terminal timeout bounds |
| [core_tools_T011](tasks/core_tools_T011-selector-create-file-prefers-edit.md) | `READY_FOR_REVIEW` | selector create-file policy |
| [core_tools_T012](tasks/core_tools_T012-read-fallback-dispatch-demotion.md) | `DONE` | read fallback demotion |
| [core_tools_T013](tasks/core_tools_T013-read-slice-non-primary-intent.md) | `DONE` | read slice exposure |
| [core_tools_T014](tasks/core_tools_T014-web-search-normalized-results-and-provider-errors.md) | `DONE` | web search normalized results |
| [core_tools_T015](tasks/core_tools_T015-terminal-execute-command-action-profile.md) | `DONE` | terminal action profile |
| [core_tools_T016](tasks/core_tools_T016-edit-action-profiles.md) | `DONE` | edit action profiles |
| [core_tools_T017](tasks/core_tools_T017-web-search-artifact-sensitive-field-scrubbing.md) | `READY_FOR_REVIEW` | artifact sensitive field scrubbing |
| [core_tools_T018](tasks/core_tools_T018-observability-trace-debug-panel-contract.md) | `DONE` | trace debug panel contract |
| [core_tools_T019](tasks/core_tools_T019-workspace-mutation-boundary-retention.md) | `DONE` | mutation boundary retention |

## Codebase Understanding Task Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [code_T001](tasks/code_T001-codebase-understanding-consensus-doc-integration.md) | `READY_FOR_REVIEW` | 外部 `CARD-01` 已本地化；目标共识文档已进入 `docs/tooling-runtime/`，等待评审 |
| [code_T002](tasks/code_T002-codebase-engine-benchmark.md) | `DONE` | 外部 `CARD-02` 已本地化；真实仓库 benchmark 文档已进入 `docs/tooling-runtime/`，评审已通过 |
| [code_T003](tasks/code_T003-codegraph-managed-mcp-spike.md) | `DONE` | 外部 `CARD-03` 已本地化；Managed MCP spike 设计文档已进入 `docs/tooling-runtime/`，并已完成当前 docs-only 任务包 |
| [code_T004](tasks/code_T004-codebase-engine-abstraction.md) | `DONE` | 外部 `CARD-04` 已本地化；抽象层设计文档已进入 `docs/tooling-runtime/`，并按 2026-07-08 项目 owner 明确决定标记完成 |
| [code_T006](tasks/code_T006-codegraph-benchmark-spike.md) | `DONE` | 本地 CodeGraph benchmark spike 已执行；输出已进入 `docs/project-control/reviews/codegraph-benchmark-spike.md`，未接入 runtime |
| [code_T007](tasks/code_T007-codegraph-wrapper-contract.md) | `READY_FOR_REVIEW` | 新增 CodeGraph wrapper 合同文档，明确 Planner 只见 `codebase_explore`，CodeGraph 原生命令只允许留在 wrapper 内部，当前为 docs-only |
| [code_T008](tasks/code_T008-codegraph-managed-mcp-runtime-implementation-plan.md) | `DONE` | 新增 CodeGraph Managed MCP runtime implementation plan，固定托管进程、Windows 边界、telemetry、Trace、Evidence、失败降级和状态机；当前为 docs-only，已可作为后续实现约束 |
| [code_T009](tasks/code_T009-codegraph-managed-mcp-runtime-spike.md) | `DONE` | 已完成最小 managed runtime spike 审查并回填任务卡；当前已补 MCP initialized 合同：`initialize` 成功后会先发 `notifications/initialized`，随后才允许 `health / query / explore / affected`，仍不暴露 Planner、不接 Evidence、不改 Agent Graph，真实 `.codegraph/` repo 污染风险仍待后续任务验证 |
| [code_T010](tasks/code_T010-codebase-explore-wrapper-runtime.md) | `DONE` | 已完成最小 wrapper runtime：scope inference、include/exclude、internal command selection、结果裁剪、candidate 归一化和 fallback signal 已落地；当前仍不暴露 Planner，不接 Evidence，不执行 `read_file_slice` verification |
| [code_T011](tasks/code_T011-codegraph-verification-bridge.md) | `DONE` | 已完成最小 verification bridge：`followUpReads`、原文核验、mismatch 记录和 verified evidence input 适配已落地；当前仍不暴露 Planner，不改 Generate，不接现有 Evidence 主实现 |
| [code_T012](tasks/code_T012-codegraph-trace-diagnostics.md) | `DONE` | 已完成最小 trace / diagnostics：explore 与 verification trace 已补 capability/provider/runtimeShape/workspaceHash/scope/query/trimming/fallback/verification count/status/duration/telemetry 等摘要字段；当前仍不暴露 Planner，不放宽 Evidence gate |
| [code_T013](tasks/code_T013-codegraph-controlled-planner-exposure.md) | `DONE` | 已完成受控 Planner 暴露：`codebase_explore` 现在默认关闭、flag 开启才注册，Planner 仍走 Normalize / Policy / ToolNode，且只有 verified chunk 才能进入 Retrieval Evidence |
| [code_T014](tasks/code_T014-codegraph-real-provider-smoke.md) | `BLOCKED` | 已把真实 provider smoke 的任务卡、review、smoke report、JSON 与原始输出完整落盘；真实 `codegraph 1.3.0` 在 `telemetry = verified_off` 下 detect / start / health 均为 ready，4 条 query 中 3 条产出 verified candidate；但第一次真实 smoke 在 repo 根目录新增 `.codegraph/`，且 flow query 当前 raw output 虽有源码块、wrapper 统计仍是 `0 verified`，按任务边界必须保持 blocked |
| [code_T015](tasks/code_T015-codegraph-external-index-root-repo-pollution-control.md) | `READY_FOR_REVIEW` | 已确认 `CodeGraph 1.3.0` 不支持可靠 external index root；managed CodeGraph 现已在 detect/start/health 之前阻断 repo pollution risk，clean temp repo 与已有 repo-root `.codegraph/` 场景均有原始 smoke 证据 |
| [code_T016](tasks/code_T016-codegraph-studio-desktop-ux-polish.md) | `DONE` | `CodeGraph Studio` 前端工作台已完成 owner 视角可用性、参考图对齐与 blocked-safe 引导；不改 server blocked-safe 逻辑，不解禁真实 provider，不碰 Planner 主链 |
| [code_T016-Fix](tasks/code_T016-fix-codegraph-studio-merge-blockers.md) | `DONE` | 已完成 `CodeGraph Studio` 合并阻断修复：`App Data Root` 后端强校验已补，`Raw Debug` 已恢复默认折叠，相关 service / route / desktop tests 已更新通过；真实 provider 仍 blocked |
| [code_T017](tasks/code_T017-codegraph-microapp-controlled-capability-wiring.md) | `DONE` | 已完成受控 capability wiring：`CodeGraph Studio` 配置、owner 显式授权、Harness reconcile 和 `codebase_explore` verification 路径已接通；默认仍不启用，真实 provider 仍 blocked |

## Codebase Understanding Review Index

| File | Role | Notes |
| --- | --- | --- |
| [codebase-understanding-docs-review-index.md](reviews/codebase-understanding-docs-review-index.md) | `review` | 外部 `CARD-05` 本地化；四张文档施工卡现已齐备，可用于总审查 |
| [code_T010-codebase-explore-wrapper-runtime-review.md](reviews/code_T010-codebase-explore-wrapper-runtime-review.md) | `review` | 最小 wrapper runtime 审查：已落实 scope、裁剪、降级和候选合同，但仍未接 Planner / Evidence / verification |
| [code_T011-codegraph-verification-bridge-review.md](reviews/code_T011-codegraph-verification-bridge-review.md) | `review` | 最小 verification bridge 审查：已落实 followUpReads、原文核验、mismatch 记录和 verified input 适配，但仍未接 Planner / Generate / Evidence 主线 |
| [code_T012-codegraph-trace-diagnostics-review.md](reviews/code_T012-codegraph-trace-diagnostics-review.md) | `review` | 最小 trace / diagnostics 审查：已落实 capability/provider/runtimeShape/workspaceHash/scope/query/trimming/fallback/verification count 等摘要字段，但仍未接前台 trace UI |
| [code_T013-codegraph-controlled-planner-exposure-review.md](reviews/code_T013-codegraph-controlled-planner-exposure-review.md) | `review` | 受控 Planner 暴露审查：已落实 feature flag、受控 schema、verified-only Evidence 和 provider/fallback 诚实降级，但仍未做大范围 rollout |
| [code_T014-codegraph-real-provider-smoke-review.md](reviews/code_T014-codegraph-real-provider-smoke-review.md) | `review` | 真实 provider smoke 审查：真实 Windows/npm shim 与标准 MCP 兼容层已成立，但 repo-root `.codegraph/` 污染风险已被真实运行触发，因此当前结论必须 blocked |
| [code_T014-codegraph-real-provider-smoke-report.md](reviews/code_T014-codegraph-real-provider-smoke-report.md) | `smoke-report` | 真实 provider smoke 证据总表：记录 `codegraph 1.3.0`、`verified_off`、ready 状态、4 条 query 统计、flow query 质量缺口、repo pollution 与原始输出链接 |

## Harness / Remediation Index

| Task | Ledger State | Notes |
| --- | --- | --- |
| [harness_context_T001](tasks/harness_context_T001-context-read-plan-dsl.md) | `DONE` | Context Read Plan DSL MVP |
| [harness_context_T002](tasks/harness_context_T002-context-read-bench.md) | `DONE` | Context / Read bench |
| [T-001](tasks/T-001-policy-deny.md) | `DONE` | policy deny |
| [T-002](tasks/T-002-toolnode-no-fallback.md) | `DONE` | toolNode no fallback |
| [T-003](tasks/T-003-terminal-command-safety.md) | `DONE` | terminal command safety |
| [T-004](tasks/T-004-approval-invocation-level.md) | `DONE` | approval invocation level |
| [T-005](tasks/T-005-capability-tool-separation.md) | `DONE` | capability / tool separation |
| [T-006](tasks/T-006-harness-schema-and-boundary.md) | `DONE` | Harness schema / boundary |
| [T-007](tasks/T-007-intent-shortcut-demotion.md) | `DONE` | intent shortcut demotion |
| [T-008](tasks/T-008-evidence-chain-completion.md) | `DONE` | evidence chain completion |
| [T-009](tasks/T-009-test-report-json-consolidation.md) | `PROPOSED` | test report JSON consolidation |
| [T-010](tasks/T-010-harness-candidate-ordering.md) | `DONE` | Harness candidate ordering |
| [T-011](tasks/T-011-sandbox-contract-direct-bench.md) | `READY_FOR_REVIEW` | sandbox contract direct bench |
| [T-012](tasks/T-012-l1-workspace-sandbox-runner.md) | `DONE` | L1 workspace sandbox runner |
| [T-013](tasks/T-013-sandbox-artifact-output-contract.md) | `DONE` | sandbox artifact/output contract |
| [T-014](tasks/T-014-cross-layer-diagnostics-closure.md) | `DONE` | cross-layer diagnostics closure（dedicated regression + evidence/generate fix） |
| [T-DeepAgents-01](tasks/T-DeepAgents-01-deepagents-js-spike.md) | `READY_FOR_REVIEW` | deepagents 独立集成验证已完成，结论是“有条件通过”，不进入现有 Harness 主线 |
| [T-DeepAgents-02](tasks/T-DeepAgents-02-selector-middleware-baseline.md) | `READY_FOR_REVIEW` | baseline 已整改为诚实口径：middleware wiring 通过，real selector baseline 在当前环境 `SKIPPED`，selector quality `NOT PROVEN`，不进入现有 Harness 主线 |
| [browser_attached_T001](tasks/browser_attached_T001-harness-capability-integration.md) | `READY_FOR_REVIEW` | Attached Browser Harness integration；代码与自动验证已提交，真实 Chrome 主链证据待补 |
| [browser_attached_T002](tasks/browser_attached_T002-tool-workbench-capability-grouping.md) | `READY_FOR_REVIEW` | Tool Workbench 已按 capability ownership 拆分 `Computer Use 3` 与 `触界 4`；domain 仍为 runtime governance 分类 |

## Technical Debt Index

| Debt ID | Status | Summary | Evidence |
| --- | --- | --- | --- |
| `TD-AGENT-02` | `OPEN` | AgentGraph 最终回答阶段未可靠消费结构化工具结果；当前不修改 AgentGraph 主链 | [TD-AGENT-02](decisions/TD-AGENT-02-tool-result-answer-context-gap.md) |
| `TD-AGENT-03` | `OPEN` | Agent 附件解析结果未进入 Planner；xlsx 中文 Sheet 名和有效范围输出也存在缺口 | [TD-AGENT-03](decisions/TD-AGENT-03-agent-file-context-not-reaching-planner.md) |

## Non-Ledger Evidence Files

这些文件可以继续存在，但不是项目台账：

| File | Role |
| --- | --- |
| [agent-workboard.md](agent-workboard.md) | Phase-1 remediation historical workboard / evidence source |
| [agent-nodes-workboard.md](agent-nodes-workboard.md) | Agent node historical workboard / evidence source; contains known state conflicts |
| [agent-nodes-V1.5 终审.md](phase-conclusions/agent-nodes-V1.5%20终审.md) | Phase conclusion / final review summary |
| [agent-phase-1-2-archive-decision.md](phase-conclusions/agent-phase-1-2-archive-decision.md) | Phase 1 completed archive and Phase 2 partial superseded archive decision |
| [agent-nodes-V1.5 全新线程复测.md](testEvidence/agent-nodes-V1.5%20全新线程复测.md) | Test evidence / fresh-thread smoke record |
| `testEvidence/` | Test evidence folder |
| `phase-conclusions/` | Stage conclusion folder |
| `reviews/` | Review inputs only |
| `decisions/` | Accepted decisions only |
| `archive/` | Historical snapshots only |

## Ledger Maintenance Rules

- 更新任务卡状态时，必须同步更新本文件。
- 任务实际状态以任务卡 `task_state` 为准；本文件只做汇总、索引和冲突提示。
- 本文件不得把任务卡中的 `TODO / READY_FOR_REVIEW / DONE / BLOCKED` 改写成另一个实际状态。
- 任务卡缺少 `task_state` 时，本文件必须标记为 `TASK_CARD_STATE_MISSING`，并把修复任务卡元数据列为下一步。
- 本文件不得记录长篇过程；长证据放任务卡或 smoke report，本文件只链接。
- `DONE` 必须有任务卡或 smoke / verification 证据。
- `READY_FOR_REVIEW` 表示等待 owner / reviewer 接受，不得口头升级为 DONE。
- 旧 workboard 与任务卡冲突时，以任务卡为准；不直接改旧 workboard，先在本文件记录冲突，再单独开清理任务。
- 不允许再新增第二个项目总台账。
