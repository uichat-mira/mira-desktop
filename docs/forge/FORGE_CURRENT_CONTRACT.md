---
status: current
owner: forge / architecture
last_verified: 2026-09-05
freshness_audited: 2026-09-16
layer: runtime
module: Forge
feature: IntegrationContract
doc_type: current-contract
canonical: true
---

# Forge Current Contract

Normative scope: Mira integration
Source baseline: `dangjingtao/mira-forge@6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0`

> 2026-09-16 freshness / authority audit 只核对 Organization 迁移后的 source-of-truth 边界，并未对本页每一项 Forge Runtime 事实重新做技术验收。因此 `last_verified` 保留 2026-09-05；本次 audit 不把编辑日期冒充 Runtime revalidation。

## 1. Authority Order

必须先区分 **Mira Organization 工程治理真相** 与 **Forge domain Task Source**，两者不是同一个概念。

Mira Organization 中：

1. 当前技术现实由实际代码、配置、测试和 Runtime 证据决定；
2. GitHub Issue 持有一个工程 work item 的合同与结果；
3. GitHub Project `Status` 只持有 `Todo / In Progress / Done` 管理位置；
4. Organization Issue Fields 持有 Priority、Effort、日期等结构化规划元数据；
5. Organization policy / SOP 由 `uichat-mira/.github` 持有；
6. PR / Review / CI 是实现与验证证据，不自动成为 Issue acceptance。

Forge integration 的技术事实按以下顺序阅读：

1. 当前 Mira `server/src/forge/**`、相关配置、测试与可观察 Runtime；
2. 本页已核验的 Forge integration contract；
3. `docs/task-source-contract.md`、当前 Forge 架构文档与注册项目实际使用的 Task Source adapter；
4. 固定源基线、T015-T018 Task Card、旧 `docs/workbench/00-work-ledger.md` 等迁移证据；
5. 其他历史说明。

T015-T018 与旧 work ledger 可以继续证明迁移时期的设计输入、实现状态和验收证据，但**不再拥有 `uichat-mira/mira-desktop` 当前工程 work-item contract / outcome**。`docs/v2-plan.md` 也不是当前施工合同。

## 2. Single Repository / Single Dependency System

Forge 必须并入 `uichat-mira`。

迁移后：

- 不存在 Forge 独立 package；
- 不存在 Forge 独立 lockfile；
- 不存在 Forge 独立 pnpm workspace；
- 不存在第二套 Vite/Web build；
- Forge Server Core 使用 Mira Server 现有 toolchain 和依赖体系。

不得为了迁移 Forge 暗中提高整个 Mira 的 Node 最低版本。

## 3. Mira Server Owns Forge Runtime

Forge 是 Mira Backend 一级 domain，目标实现位于 `server/src/forge/**`。

Mira Server 负责：

- runtime initialization；
- runtime shutdown；
- persistence lifecycle；
- provider-owned process/resource cleanup；
- startup reconcile；
- API route registration。

不得保留 `127.0.0.1:47831` 的第二独立 control-plane 作为产品依赖，也不得用 sidecar/child server 继续承载 Forge Core。

## 4. Forge Project Task Source And Runtime Truth Must Stay Separate

### Forge Project Task Source

Forge 可以为一个已注册 project 读取 repository-native Task Source，例如 Ledger / Task Card。它们是 **Forge domain 的项目输入协议**：用来提供 task identity、依赖、可执行范围与显式写回目标。

当目标项目是 `uichat-mira/mira-desktop` 时，这些 repository-native Ledger / Card **不替代** Mira Organization 的 GitHub work-item governance：GitHub Issue 仍持有当前工程 work-item contract / outcome，Project `Status` 仍只是管理位置。

Forge 只通过 Task Source contract 读取或显式写回其被授权管理的 domain task source，不从任意 prose 猜状态、依赖或 Task ID。

### Forge Runtime Truth

Forge runtime 只保存执行引用和运行证据。

至少包括：

- Project
- Batch / Runtime Task
- Dispatch
- Session
- Review
- Runtime Event
- Main Thread
- Main Thread Event
- Builder Result Handoff

不得把完整 Task Card 正文复制到 Forge durable state 形成第二 Requirements DB。

Builder process success 不得直接更新 GitHub Issue outcome，也不得把 repository-native Task Source 自动推成 REVIEW / PASS。任何外部 work-item / task-source 写回都必须遵守其 owning contract 和显式 authority。

## 5. Main Thread Is Not Builder

Main Thread 的职责是：

- project discussion；
- repository/task inspection；
- planning；
- explicit Task Card create/update；
- explicit dispatch handoff。

Main Thread 必须保持 provider-neutral contract。

固定源基线支持：

- `opencode`
- `codex-desktop`
- `codex` CLI fallback

PiAgent 不在当前 Main Thread provider contract 中。

Main Thread 不获得 project file write 权限来替代 Builder；provider 报告 file change 在 read-only Main Thread 中属于合同违规。

## 6. Dispatch Is Explicit

创建 Task Card 或产生 Handoff 不等于自动施工。

Dispatch 必须是显式动作，并绑定 authoritative identity：

- project
- batch/runtime task
- repository task reference
- builder adapter
- session
- optional source Main Thread

当前阶段保持全局单 active Builder dispatch。

禁止因为存在多个 Builder adapter 就并行修改同一 unmanaged working tree。

禁止自动 fallback 到另一个 Builder。

## 7. Builder Contract

当前产品级 Builder choices：

- OpenCode
- PiAgent
- Codex

provider-specific executable/session/event 逻辑必须留在 adapters 后面。

Forge Core 拥有 durable dispatch/session/runtime evidence，不依赖 provider process 长期存活。

正常完成、失败、取消、restart interruption 都必须形成结构化终态。

成功 Builder completion 的 runtime 语义是 `reviewing`，不是 `review_passed`。

## 8. Restart / Supervision Truth

live process handle 只属于当前 Mira Server 进程。

Mira/Forge restart 后：

- 不假装恢复已经丢失的 process supervision；
- leftover active dispatch / main-thread turn 必须 reconcile 为 interrupted/error；
- durable facts 保留；
- late terminal callback 不得覆盖已 terminal 的 dispatch。

## 9. Review Is SHA-Bound

Review 必须绑定 concrete task SHA。

一个 PASS review 只有在下面条件成立时才 actionable：

```text
reviewedSha == requestedSha == task.currentSha
```

task current SHA 改变后，旧 PASS review 必须保留历史但失效/stale。

普通 generic task status mutation 不能伪造：

- `review_passed`
- `integrated`
- `reviewedSha`
- `reviewRound`

Integration 是独立受 guard 的动作。

## 10. Builder Result Handoff

terminal Builder result 必须能回到显式相关的 Main Thread。

Handoff 必须：

- 绑定 project/batch/task/dispatch/session identity；
- 以 dispatch identity 幂等；
- 携带 authoritative dispatch/session/task state；
- 可携带 bounded `resultText` / `error`；
- 不把 Builder prose 当成成功真相；
- 不重复在每次 polling / refresh 中追加；
- 不注入 Builder 完整 conversation history。

固定源基线的可验证大小语义必须原样保留，不在 T001 擅自改成新的 byte-budget 合同：

- handoff `resultText`：先执行 JavaScript `String.trim()`，再以 `String.slice(0, 16_384)` 截断；
- handoff `error`：先执行 JavaScript `String.trim()`，再以 `String.slice(0, 4_096)` 截断；
- 上述上限按 JavaScript UTF-16 code unit 计数，不是 UTF-8 byte 数；
- 超限行为是截断后持久化 / 投影，不是拒绝整个 handoff；
- API、持久化、Main Thread 注入和测试必须引用同一 observable semantics；
- 若后续要改成 UTF-8 byte 上限或其他编码口径，必须另行修改合同并取得 owner 决策，不能在迁移中暗改。

下一次 Main Thread turn 可以消费上次用户 turn 之后到达的 bounded Builder results，但不能把同一 result 永久重复注入。

## 11. Task Source Contract

当某个已注册 project 选择 repository-native Task Source adapter 时，该 domain contract 至少包含：

- 一个 Work Ledger；
- 每个 Task 恰好一张 Task Card；
- unique Task ID；
- realpath 后必须留在 registered project root。

读取是 side-effect free。

create/update 必须显式。

Ledger/Card drift 只允许 warning；不得静默修复。

旧项目的有限语法兼容可以保留，但不能降低 Task identity 唯一性要求。

这段描述的是 **Forge 对被注册 project 的 Task Source 输入协议**，不是要求 Mira Organization 用 repository-local Ledger/Card 管理工程工作项。Mira 自身的工程 work-item contract / outcome 继续属于 GitHub Issue。

## 12. Desktop Product Boundary

对外名：淬行。
内部工程名：Forge / `forge`。

外部 UI 必须使用 Mira Desktop：

- existing shared UI；
- existing tokens；
- existing renderer/backend request contract；
- owner 提供的 OpenDesign 设计输入。

不迁移旧 Forge 独立 React/Vite 应用作为第二前端。

旧仿 TUI 的交互经验可以作为 expert/debug 参考，但只能落在同一 Desktop 工程、同一 API、同一依赖体系内。

当前目标分支已有 `desktop/src/features/forge/**` UI 壳；它是已有实现事实，不是 domain contract，不得据此改变 Runtime/Review/Task Truth。

## 13. Non-Goals During Integration

当前迁移不得顺手加入：

- Agent V2；
- DAG scheduler；
- concurrent Builder execution；
- worktree scheduler；
- automatic Reviewer loop；
- auto Push / Merge / Deploy；
- generic sub-agent rewrite；
- MCP marketplace expansion；
- 第二套持久化真相源。

## 14. Fixed-Source Migration Evidence

旧 Forge 固定源基线 work ledger 曾记录：

| Task | State |
| --- | --- |
| T015 Main Thread Runtime | PASS |
| T016 Builder Thread Adapters | PASS |
| T017 Compact Mira Web UI | PASS |
| T018 Live Runtime Surface | REVIEW |

这些状态保留为**迁移时期的 source evidence**，用于解释固定源基线在当时已经验证到哪里；它们不拥有 Mira Organization 当前 GitHub work-item 状态或结果。

T018 的代码与自动验证在固定源基线中已经存在，但当时最终 real Builder observational smoke 未完成。Mira 集成的真实产品链仍应根据当前代码、当前 work-item contract 和当前证据独立判断，不能把旧 ledger 的 PASS / REVIEW 当作新的 acceptance。

## 15. Stop Conditions

后续施工遇到以下情况必须停止并报告 owner：

- 固定源基线与本合同出现会改变迁移方向的真实冲突；
- 需要把 Mira 整体 Node 下限提高到 Forge 旧要求；
- 找不到稳定的 Mira backend data-root 而需要擅自选 `process.cwd()`；
- 需要保留独立 Forge server 才能继续；
- OpenDesign 与真实 Forge domain semantics 冲突；
- 需要放宽 Review / Dispatch / Task Source 安全边界才能“跑通”。

不得通过 fallback、mock default 或第二套 runtime 偷偷绕过这些冲突。
