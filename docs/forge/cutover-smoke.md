---
status: current
owner: forge / integration
last_verified: 2026-09-06
layer: runtime
module: Forge
feature: CutoverAcceptance
doc_type: verification-guide
canonical: true
related:
  - FORGE_CURRENT_CONTRACT.md
  - ../project-control/tasks/forge_T010-end-to-end-cutover-and-legacy-retirement.md
---

# Forge / 淬行 Cutover Smoke

这份文档只负责 T010 的最终迁移验收，不是新的功能设计。

自动验证与真实产品观察必须分开记录：

- repository / staged-runtime gates 可以自动执行；
- real Builder -> Main Thread product loop 必须在真实 Mira Desktop + 本机 provider 环境观察，不能用 fake adapter、mock 或旧 `mira-forge` 结果替代。

## A. Repository Cutover Gate

根仓执行：

```bash
pnpm check
```

其中 `check:forge-cutover` 必须验证：

- `server/src/forge/**`、`desktop/src/features/forge/**`、`desktop/src/shared/api/forge/**` 仍存在；
- 上述集成 runtime surface 内没有第二个 `package.json` / lockfile / pnpm workspace / Vite root；
- 没有 legacy `:47831`、`MIRA_FORGE_STATE_FILE`、`.mira-forge` runtime marker；
- 根仓没有嵌入一个新的 `mira-forge/` standalone source tree。

这道 gate 不扫描历史文档，因为历史文档必须允许准确记录旧端口和旧仓事实。

## B. Staged Server Runtime Gate

Windows staged runtime workflow 必须执行：

```bash
pnpm internal:build:server
pnpm prepare:terminal-runtime
node scripts/smoke-staged-server-runtime.mjs
```

除现有 native runtime smoke 外，staged `server.cjs` 必须同时满足：

- 包含 `/forge/meta`；
- 包含 Mira Server-owned Forge initialization；
- 不包含 `47831`；
- 不包含 `MIRA_FORGE_STATE_FILE`；
- 不包含 `.mira-forge`。

这证明生产 server bundle 使用 Mira 自己的 Forge domain，而不是依赖 standalone Forge control plane。

## Current Automated Evidence

For `uichat-mira@1ed6bbe33072ef5be42e973d5929e273a2450568`:

- `Build Desktop Apps` run `34031409151` / `Check dev` job `101481484853`: PASS.
  - root `pnpm check` executed;
  - `check:forge-cutover` printed its PASS line;
  - workspace typecheck completed.
- `Windows Native Runtime Smoke` run `34031409141` / job `101481484803`: PASS.
  - `Staged server Forge cutover smoke passed.`
  - `Staged server native runtime smoke passed.`

This evidence is current for the integrated code commit above. Full Electron packaging and real provider observations remain separate acceptance items.

## C. Real Product Loop

使用当前 Mira Desktop 的 **淬行** 页面。标准 UI 或 Terminal View 均可，但必须走同一个 current Forge API/runtime。

### 1. Project / Task truth

1. Register 或选择一个真实本地 project。
2. 确认 Repository Task Source 指向真实 Ledger + Task Directory。
3. 在 Main Thread 中读取任务来源。
4. 选择并打开一张真实 Task Card。
5. 记录：
   - Project ID / root；
   - Task ID；
   - Task Card ref；
   - integration branch。

PASS 条件：UI 中的 Task identity 可以追溯到 repository Task Card，Forge runtime 没有复制出第二份 requirements truth。

### 2. Main Thread

1. 发送一条与当前 Task Card 相关的 Main Thread 消息。
2. 记录 Main Thread ID 与 adapter。
3. 确认 Main Thread 是 discussion / inspection / planning surface，不替 Builder 修改项目文件。

### 3. Explicit Builder Dispatch

1. 从当前 Task 显式打开 Dispatch。
2. 选择真实可用 Builder。
3. 提交 Dispatch。
4. 记录：
   - Batch ID；
   - Dispatch ID；
   - Session ID；
   - Builder adapter；
   - source Main Thread ID。

PASS 条件：

- dispatch 绑定当前 project / task / taskRef；
- source Main Thread 与 project 一致；
- 没有自动 fallback 到其他 Builder；
- 同一时刻没有第二个 active Builder dispatch。

### 4. Runtime observation

Builder 运行时观察 Runtime Summary / Inspector：

- active provider / Builder；
- current Task；
- Dispatch / Session identity；
- start / duration 或等价真实时间信息；
- runtime events。

页面 refresh 后再次检查同一 Dispatch / Session。

PASS 条件：refresh 不制造新的 dispatch/handoff，不丢失 durable runtime truth。

### 5. Builder terminal -> reviewing

等待真实 Builder 终止。

成功施工路径必须观察：

```text
dispatch = completed
session = completed
runtime task = reviewing
```

不得把 Builder process success 显示为 Repository PASS / `review_passed`。

若 Builder 失败，则必须看到结构化 failed/interrupted truth，而不是用 result prose 推断成功。

### 6. Builder Result Handoff

打开绑定的 Main Thread。

PASS 条件：

- 出现当前 Dispatch 对应的一条 readable `builder_result`；
- identity 能对应 project / batch / task / dispatch / session；
- result/error bounded；
- refresh 后不追加第二条同 Dispatch handoff。

### 7. Next Main Thread turn

在 builder_result 出现后，再发一条 Main Thread 消息，例如要求：

> 根据刚刚 Builder 的真实结果，总结本任务发生了什么、当前 runtime 状态是什么，以及下一步是否可以进入 Review。不要只复述任务卡。

PASS 条件：

- provider 回答实际使用刚到达的 Builder Result Handoff；
- 明确区分 result prose 与 authoritative runtime state；
- 不把同一 Builder result 永久重复注入后续所有 turns。

## D. Cancel / Interrupted Observation

另选一张可以安全中断的真实任务：

1. 显式 Dispatch；
2. 等待进入 starting/running；
3. 执行 Cancel；
4. 检查 Dispatch / Session / Runtime Task / Event；
5. 检查相关 Main Thread result handoff。

预期：

```text
dispatch = cancelled
runtime task = interrupted
event = dispatch.cancelled
builder_result = exactly one logical handoff
```

若无 live process ownership，Cancel 必须明确失败，不能伪造已取消。

## E. Restart Reconstruction

对一个正在运行的测试 Dispatch：

1. 记录 Dispatch / Session / Task identity；
2. 正常重启 Mira Server；
3. 重新打开淬行；
4. 检查 startup reconcile 后状态。

预期：

- lost process supervision 不假装恢复；
- active Dispatch -> `interrupted`；
- active Session -> disconnected / terminal equivalent；
- building Task -> `interrupted`；
- durable event 保留；
- related Main Thread handoff 逻辑上只出现一次。

## F. Packaged Desktop

T010 目标平台为当前 Windows desktop release。

至少完成一次当前 HEAD 的 packaging build：

```bash
pnpm package:electron:win
```

若本轮同时要求 Tauri release，则另跑：

```bash
pnpm package:tauri:win
```

包内 backend 必须仍是：

```text
resources/node-runtime/node.exe
resources/server/server.cjs
```

启动后的 Forge 请求必须命中同一个 Mira backend runtime，不允许依赖独立 Forge server。

## Evidence Record

最终 T010 Evidence 至少记录：

```text
date:
uichat-mira commit:
desktop/package target:
pnpm check:
staged server smoke:
package build:

project:
task:
taskRef:
mainThreadId / adapter:
batchId:
dispatchId:
sessionId / externalSessionId:
builder:

runtime during execution:
terminal dispatch state:
terminal session state:
terminal runtime task state:
builder_result logical count:
next Main Thread turn used handoff:

cancel dispatch evidence:
restart reconcile evidence:

legacy :47831 dependency:
standalone Forge package/install:
result: PASS | FAIL | NOT OBSERVED
```

没有真实观察到的项目必须写 `NOT OBSERVED`，不能由自动测试或旧仓历史结论代填。
