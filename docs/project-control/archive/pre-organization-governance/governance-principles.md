---
status: current
owner: project-owner
last_verified: 2026-07-05
layer: project-control
module: ProjectControl
feature: GovernancePrinciples
doc_type: current-contract
canonical: true
related:
  - AGENTS.md
  - docs/project-control/README.md
  - docs/project-control/agent-workboard.md
  - docs/project-control/agent-nodes-workboard.md
---

# Project Governance Principles

这份文件定义本项目的交付治理总则，重点防止两类失真：

- 测试很多，但用户主链路跑不通。
- 为了让验证通过，在代码或测试里写死环境、路径、配置或默认值。

本文件适用于所有高风险任务，尤其是 AgentGraph、Harness、工具执行、审批、文件写入、运行时配置、打包和主链路 UI。

## External Basis

这些规则参考了几类行业通用做法：

- Martin Fowler / Thoughtworks 的 Test Pyramid：测试需要覆盖不同粒度，单元测试不能替代集成、端到端和验收测试。
  - https://martinfowler.com/articles/practical-test-pyramid.html
- Twelve-Factor App 的 Config 原则：配置应和代码分离，环境差异不应写成代码常量。
  - https://12factor.net/config
- GitHub protected branch / required status checks：自动检查和评审是合并门禁，但门禁必须绑定真实检查来源和明确规则。
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- NIST SSDF SP 800-218：安全软件开发需要把安全实践、验证和缺陷根因处理纳入开发生命周期。
  - https://csrc.nist.gov/pubs/sp/800/218/final

本项目不照搬任何外部流程。外部资料只提供原则，本文件定义本项目的执行规则。

## Core Rule

任务完成不等于测试通过。

任务完成必须同时满足：

- 代码改动符合任务卡边界。
- 所有验收标准都有证据。
- 必要的单元、合同、黑盒主链路验证已完成。
- 没有未声明的环境注入、路径写死、mock 默认值或静默 fallback。
- 未完成项和风险被写明。

如果主链路没有真实跑通，不允许把任务标记为 `DONE`。

## Test Evidence Levels

交付报告必须按三层说明验证结果。

### Unit

Unit 验证函数、节点或小模块的局部行为。

Unit 通过只能证明局部逻辑符合预期，不能证明用户主链路可用。

### Contract

Contract 验证跨模块协议，例如：

- `AgentRun -> AgentGraph -> Harness -> AgentRun`
- `pendingToolCall -> policy -> toolNode`
- `approval -> resume`
- `tool / retrieval -> evidence -> generate / evaluate`
- renderer API -> backend route

Contract 通过只能证明协议边界成立，不能证明前台用户场景可用。

### Black-Box Smoke

Black-box smoke 验证真实用户入口和真实运行时行为。

Agent 主链任务至少要覆盖：

- 新线程或明确指定的历史线程。
- 真实 workspace root。
- 真实 Agent 开关。
- 真实用户输入。
- 可见 execution trace。
- 最终回答。
- 刷新或重新进入后的状态一致性。

没有 black-box smoke 的 Agent 主链任务，只能标记为 `READY_FOR_REVIEW` 或更低状态，不能标记为 `DONE`，除非任务卡明确说明本任务不涉及主链路。

## Environment And Configuration Rules

严禁在生产代码、主链测试、验证脚本里写死本地环境以制造通过结果。

禁止项包括：

- 写死本机路径，例如 `D:\...`、`C:\Users\...`，除非该路径只出现在文档示例或明确的测试 fixture。
- 写死 provider、model、workspace、backend host、backend port、token、用户 id。
- 在生产路径里加入只为测试通过服务的默认 env。
- 在 catch 或 fallback 中悄悄切换到 mock、默认 workspace、默认模型或默认工具。
- 用测试专用环境变量改变真实主链语义，却不在任务卡和交付报告里声明。

允许项：

- 测试 fixture 中的固定路径，但必须位于测试临时目录或 repo 内测试资源。
- 明确命名的 `DEBUG` / test-only 开关，但不得默认影响生产路径。
- `runtime.config.cjs`、`.env.example`、任务卡中声明过的配置入口。

每次交付必须列出：

- 本次依赖的 env。
- 本次新增或修改的 env。
- 本次是否使用 mock。
- 本次 black-box smoke 使用的 workspace root。
- 本次是否存在 hardcoded path/env，若存在必须解释为什么只影响测试或文档。

## Evidence Matrix

每次实现交付必须提供证据矩阵。

```text
| Acceptance Criterion | Evidence | File / Command / Manual Step | Result |
| --- | --- | --- | --- |
| ... | ... | ... | passed / failed / not run |
```

规则：

- 没有证据的验收项不能打勾。
- 只写“已验证”不算证据。
- 只写“测试通过”不算主链证据。
- 手测必须写步骤、输入、观察到的 trace / UI / 输出。
- 未运行的验证必须写原因和风险。

## Main-Path Verification Rules

涉及 AgentGraph 或工具执行的任务，交付前必须回答这些问题：

- 用户入口是什么？
- 产品运行真相在哪里？
- 工具执行真相在哪里？
- 审批对象和执行对象如何绑定？
- 结果写回哪里？
- evidence 如何进入最终回答？
- 刷新或恢复后状态是否一致？
- 哪些字段只是 UI / trace / diagnostics，不能驱动执行？

Agent 当前主链的默认真相边界：

- `AgentRun` 是产品运行真相。
- `pendingToolCall` 是 Agent 到工具执行的冻结调用对象。
- Harness invocation 是工具执行真相。
- evidence 是最终回答的事实输入。
- execution trace 是展示和审计入口，不是事实本身。
- `selectedToolId` 只能用于 UI、trace、diagnostics 或兼容读取，不能驱动真实执行。

任何任务如果改变上述边界，必须先建立 architecture-level 风险说明并获得项目 owner 确认。

## Review Gate Rules

任务进入 `READY_FOR_REVIEW` 前必须满足：

- 任务卡存在。
- 允许改动和禁止改动已声明。
- diff summary 已提交。
- unit / contract / smoke 三层验证状态已分别说明。
- env / hardcoded path / mock 使用情况已说明。
- 未完成项和风险已说明。

任务进入 `DONE` 前必须满足：

- 项目 owner 或指定 reviewer 接受证据。
- 所有 acceptance criteria 有证据。
- black-box smoke 已通过，或任务卡明确豁免。
- 没有发现未声明 hardcode、mock、默认 fallback 或环境注入。
- workboard 状态与任务卡状态一致。

## Stop-The-Line Conditions

出现以下任一情况，暂停同一主链上的新功能开发，先做审计任务：

- 测试通过但真实主链路跑不通。
- 发现未声明 hardcoded env / path / provider / model / workspace。
- 发现生产路径里存在只为验证通过服务的 mock 或默认 fallback。
- 审批、文件写入、终端命令、外部发送等高风险动作的真实执行对象无法从 trace 和 run state 中还原。
- 任务卡显示完成，但代码、测试或前台 smoke 证据无法对应。
- 同一缺陷连续两轮修复后仍未定位到 verified code path。

审计任务必须输出：

- 真实失败入口。
- 已确认事实。
- 涉及代码路径。
- 测试为什么没有发现。
- 环境和配置来源。
- 需要删除或隔离的 hardcode / fallback / mock。
- 下一步最小任务卡。

审计完成前，不得继续堆叠新功能。

## Task Card Requirements

高风险任务卡必须包含：

```text
Target:
Problem Layer: architecture / business / UI / test / docs
Allowed Changes:
Forbidden Changes:
Acceptance Criteria:
Required Verification:
Black-Box Smoke:
Environment Contract:
Mock / Fixture Policy:
Non-Goals:
Evidence Requirements:
```

如果任务卡没有 `Black-Box Smoke` 或 `Environment Contract`，不得开始 AgentGraph / Harness / runtime 相关实现。

## AI And Contractor Rules

AI 或外部执行者必须遵守：

- 不允许没读代码就评价实现状态。
- 不允许把推测写成事实。
- 不允许用“测试通过”替代主链路验证。
- 不允许偷偷加 hardcode、mock 默认值、fallback 或兼容分支。
- 不允许扩大任务范围后再用新问题解释原任务未完成。
- 不允许把单个节点完成说成整个 AgentGraph 完成。

交付报告必须明确写：

- 已验证。
- 未验证。
- 失败或阻塞。
- 代码证据。
- 命令证据。
- 手测证据。
- 风险和下一步。

## Owner Review Checklist

项目 owner 评审时只需要抓这些问题：

- 用户场景是否真实跑通？
- 这次验证有没有走真实入口？
- 是否使用了未声明环境变量、路径或 mock？
- 失败状态是否诚实展示，而不是被普通回答掩盖？
- 审批、执行、结果是否能从 run state 和 trace 中还原？
- 测试证据是否覆盖 unit、contract、black-box smoke 三层？
- 文档状态是否和代码证据一致？

如果任一答案不清楚，任务不得进入 `DONE`。

