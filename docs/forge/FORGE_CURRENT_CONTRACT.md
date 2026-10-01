---
status: current
owner: forge / architecture
last_verified: 2026-09-05
freshness_audited: 2026-09-19
layer: runtime
module: Forge
feature: IntegrationContract
doc_type: current-contract
canonical: true
---

# Forge Current Contract

Normative scope: Mira integration
Source baseline: `dangjingtao/mira-forge@6557b9ff552c4be3d3d1be2da0b24bb6d1344ed0`

## 1. Authority Order

先区分 Mira Organization 工程治理与 Forge domain Task Source：

1. Mira 当前工程 work-item contract / outcome 由 GitHub Issue 持有；
2. 固定源基线代码、T015-T018 与旧 work ledger 只作为 Forge 迁移历史和 fixed-source evidence；
3. registered project 若显式选择 repository-native Task Source，相关 Ledger / Task Card 只作为该 Forge domain 的输入合同；
4. Forge runtime state 只描述执行，不拥有 Mira Organization 的 Issue / Project 状态。

`docs/v2-plan.md` 与旧 work ledger 都不是当前 Mira 工程治理权威。

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

## 4. Two Truths Must Stay Separate

### Project Task Source

Mira Organization 的工程任务真相由 GitHub Issue / Project 分层持有。

Forge 注册项目可以通过 Task Source contract 读取 repository-native Ledger / Task Card，但它们只在该项目显式选择对应 adapter 时作为 Forge domain 输入，不得重新成为 Mira Desktop 的工程管理总台账。

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

Builder process success 不得直接更新 Repository Task 为 REVIEW / PASS。

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

Repository-native Task Source 至少包含：

- 一个 Work Ledger；
- 每个 Task 恰好一张 Task Card；
- unique Task ID；
- realpath 后必须留在 registered project root。

读取是 side-effect free。

create/update 必须显式。

Ledger/Card drift 只允许 warning；不得静默修复。

旧项目的有限语法兼容可以保留，但不能降低 Task identity 唯一性要求。

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

## 14. Current Source Acceptance State

固定源基线 work ledger：

| Task | State |
| --- | --- |
| T015 Main Thread Runtime | PASS |
| T016 Builder Thread Adapters | PASS |
| T017 Compact Mira Web UI | PASS |
| T018 Live Runtime Surface | REVIEW |

T018 的代码与自动验证已存在，但最终 real Builder observational smoke 未完成。Mira 迁移必须重新验收真实产品链，不能继承一个不存在的 PASS。

## 15. Stop Conditions

后续施工遇到以下情况必须停止并报告 owner：

- 固定源基线与本合同出现会改变迁移方向的真实冲突；
- 需要把 Mira 整体 Node 下限提高到 Forge 旧要求；
- 找不到稳定的 Mira backend data-root 而需要擅自选 `process.cwd()`；
- 需要保留独立 Forge server 才能继续；
- OpenDesign 与真实 Forge domain semantics 冲突；
- 需要放宽 Review / Dispatch / Task Source 安全边界才能“跑通”。

不得通过 fallback、mock default 或第二套 runtime 偷偷绕过这些冲突。
