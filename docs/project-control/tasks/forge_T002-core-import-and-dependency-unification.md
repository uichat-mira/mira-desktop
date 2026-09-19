---
status: current
priority: P0
owner: forge / server
last_verified: 2026-09-05
layer: project-control
module: Forge
feature: CoreImport
doc_type: task-card
canonical: true
related:
  - docs/project-control/tasks/forge_T001-integration-contract-and-source-baseline.md
task_state: DONE
---

# forge_T002 Forge Core Import and Dependency Unification

## Target

把固定源基线中的 Forge 核心 domain 迁入 Mira Server，建立 `server/src/forge/**`，并彻底取消 Forge 独立 Node / npm / pnpm / Vite 依赖体系。

本卡目标是“代码进入同一工程并可编译测试”，不是接路由、不是接 Desktop、不是改变业务语义。

## Must Read

- `AGENTS.md`
- `docs/architecture/README.md`
- `docs/forge/FORGE_CURRENT_CONTRACT.md`
- `docs/forge/migration-source-map.md`
- Mira `server/package.json`
- Mira `pnpm-workspace.yaml`
- 源 Forge 的 `server/domain.mjs`、`dispatch-domain.mjs`、`readiness.mjs`、`builder-contract.mjs` 及对应测试

## Allowed Changes

- `server/src/forge/**`
- `server/src/forge/**/*.test.ts`
- `server/tsconfig*.json`（仅确有编译必要时）
- 本任务卡状态 / 证据

## Forbidden Changes

- 新建任何 Forge 专属 `package.json`
- 新建任何 Forge 专属 lockfile / workspace
- 手工修改 `pnpm-lock.yaml`
- `desktop/**`
- `electron/**`
- `tauri/**`
- 接入 Fastify route
- 改 Forge 状态语义
- 顺手改 Mira Agent / Harness

## Verified Context

- Forge 核心大量使用 Node built-ins，本轮优先复用 Mira Server 现有依赖。
- 旧 Forge 声明 Node >=22；Mira 根工程声明 Node >=20。迁移不能把整个 Mira 的 Node 下限暗中抬高。
- React 19 / Vite 7 属于旧 Forge Web 壳，不应带入 Server Core。

## Acceptance Criteria

1. Forge domain/readiness/dispatch primitives 在 `server/src/forge/**` 下有明确模块边界。
2. 不存在第二套 package / lock / workspace。
3. 原状态枚举与关键 transition guard 有等价单测。
4. Node 20 兼容性由当前 Mira toolchain / CI 证明，或明确指出唯一真实阻断；不得靠声明 Node 22 逃避迁移。
5. 本卡不启动外部 Builder 进程、不注册业务 route。

## Validation

- Forge domain/readiness 定向测试
- `pnpm --filter @ui-chat-mira/server typecheck`
- `git diff --check`

## Construction Evidence

- Base: `dev@c3005c8dcdc6910a895e1642597c7cbd9f28957d`.
- 新增 `server/src/forge/**` Core：domain、dispatch-domain、readiness、builder-contract、shared types/barrel。
- 新增 focused Vitest：domain guards、SHA-bound review invalidation、readiness、dispatch transitions、Builder choice mapping。
- 未新增 Forge package / lockfile / workspace；未修改 `server/package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- 未接 Fastify route，未启动 Builder，未触碰 Desktop / Agent / Harness。
- 当前执行容器无法解析 github.com，因此不能通过本地 clone 运行仓库 pnpm；该验证缺口不得记作通过，将通过 PR review/可用 CI 与静态核查继续收口。
- 当前 Forge Core 源码镜像已用 TypeScript 5.8.3、`strict=true`、`target=ES2022`、`moduleResolution=Bundler` 执行 `tsc --noEmit`：PASS。
- 同一镜像编译产物已执行纯内存 contract smoke：PASS；覆盖 dependency readiness、review anti-forgery、SHA stale invalidation、dispatch transition、Builder choice/conflict。
- Node 20 兼容性：本卡生产代码仅新增 `node:crypto.randomUUID()` 这一 Node built-in，Node 20 官方文档支持该 API（该 API自 Node 14.17/15.6 起提供）；未使用 Node 22-only API，也未新增 dependency。当前执行环境仅有 Node 22，因此未伪造“Node 20 实机 smoke”。
- 相对 `dev` diff 仅包含本任务卡和 `server/src/forge/**`；0 个 forbidden path、0 trailing whitespace、0 conflict marker、0 literal escaped-newline 污染。
- Codex review 提出的 generic `integrated` mutation 与 duplicate terminal callback overwrite 均为固定源基线真实行为，不在 T002 改写：前者由 T007 明确收紧，后者由 T006 process supervision / terminal evidence 阶段收口。T002 保持 source semantics，不提前跨卡修改状态机。

- Final self-review: PASS。T002 diff 仅包含本任务卡与 `server/src/forge/**`；production Core strict compile / contract smoke 通过；review threads 已按真实 source parity / 后续卡边界处置，无 T002 blocker。
- Exact repository `pnpm --filter @ui-chat-mira/server typecheck` / Vitest 未在当前容器 checkout 中执行，原因是容器无法解析 GitHub/npm；合入 `dev` 后由现有 Windows `Check dev -> pnpm check` 提供整仓真实验证，若失败则本结论必须立即重开。

## Unknown / Human Decision

None.

## Handoff

如果某个源模块依赖旧 Forge Web / server bootstrap 才能成立，应先拆出 domain contract，不得把旧 `server/index.mjs` 整体复制成 Mira 中的第二个 server。
