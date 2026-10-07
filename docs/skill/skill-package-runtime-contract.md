# Skill Package / Runtime Pack 合同

Status: Current
Owner: chat / runtime / desktop
Last verified: 2026-07-23
Layer: raw-source
Module: SKILL
Feature: SkillPackageDistribution
Doc Type: current-contract
Canonical: false
Related:
  - ./README.md
  - ./skill-context-design.md
  - ./skill-runtime-design.md
  - ../microapp/wenshu-skill-runtime.md

## Purpose

本合同定义 **Skill Package** 与 **可选 Runtime Pack** 的当前分发 / 安装边界。

上位定义以 `README.md` / `skill-context-design.md` 为真相源：

> **Skill 本体 = 渐进式披露的动态上下文能力包。**

Stateful Skill Runtime 是可选高级层，不是 Skill Package 成为 Skill 的门槛。

---

## 四层必须分开

```text
Skill Package
  Manifest / SKILL.md / Resources
  ↓ 被发现、匹配、动态披露

SkillContext
  当前任务的领域策略上下文
  ↓

Domain Execution Capability
  Tool / MCP / Script / Runtime
  ↓

Optional Stateful Skill Runtime
  SkillInstance / State / Reducer / Lifecycle
```

不要把这四层混成一个对象。

---

## Skill Package

Skill Package 是 Skill 的发现、展示和分发单位，可以包含：

- `SKILL.md`
- references
- templates
- examples
- scripts metadata
- version
- source / license metadata
- runtime dependency declaration

安装 / 内置一个 Skill Package 后，它可以被 `SkillScanner / SkillRegistry` 发现，并参与 `SkillMatcher`。

命中后可以动态注入基础 `SkillContext`。

但 Package 本身：

- 不拥有 Tool 权限；
- 不自动执行 Script；
- 不自动安装所有 Runtime；
- 不自动创建 SkillInstance；
- 不拥有第二 Agent Loop。

---

## Runtime Pack

Runtime Pack 是可选安装的本地执行依赖集合。

例如文枢：

```text
wenshu-office
```

安装 Runtime Pack：

- 可以使某些 Domain Runtime 从 unavailable 变成 available；
- 可以改变 **environment capability eligibility**，由 Harness 独立 reconciliation 决定预声明 Tool 是否注册；
- 不等于 SkillContext 被激活；
- 不创建 SkillInstance；
- 不新增 `use_skill` action；
- 不因为某个 Skill 命中而直接 push Tool 进 `state.toolExposure`；
- 不拥有 approval / sandbox / trace 权力。

因此四个状态必须分离：

```text
Skill Package installed / bundled
SkillContext active for current task
Runtime Pack available
Harness execution capability eligible
```

它们不是同一个布尔值。

---

## 安装模型

V1 使用按需安装：

```text
用户打开 Skill 详情
  ↓
点击「去使用」
  ↓
检查 runtimePack
  ├─ 已安装 -> 进入对应 MicroAPP
  └─ 未安装 -> 下载/安装 -> 校验 -> 标记 installed -> 进入 MicroAPP
```

安装状态至少区分：

```text
not-installed
installing
installed
broken / repair-needed
```

安装失败不得把半成品目录标记为 installed。

---

## 文件与 Python 边界

文枢 `wenshu-office` Runtime Pack：

- 复用 Mira 系统开发小套件 Python 作为解释器；
- 不打包第二套 Python；
- 不把第三方依赖安装进用户全局 Python；
- 依赖安装到 Mira 自己管理的 runtime-pack 目录；
- WenShu Python 子进程通过受管 `PYTHONPATH` 使用该目录；
- 安装使用 staging 目录，校验成功后再替换正式版本目录。

### 统一 WenShu Python invocation contract

所有 Python-backed WenShu Domain Runtime 都必须通过 backend 内部 launcher 执行：

```text
Skill operation input
  → runtime = wenshu-office
  → registered script id
  → runWenshuPython
  → selected system development Python
  → managed Runtime Pack PYTHONPATH
  → bundled script/runtime
  → deterministic result
```

Skill 或 Agent 只可以提交 runtime、受控 script id、操作参数和 workspace 输入输出路径。不得提交 Python executable、shell command、`PYTHONPATH`、`python -m`、`pip install` 或 `conda install`。

当前受控脚本入口包括：

```text
pdf/pdf_create_runtime.py
pdf/pdf_runtime.py
pptx/pptx_runtime.py
xlsx/xlsx_runtime.py
xlsx/xlsx_finalize.py
xlsx/xlsx_tools.py
```

`terminal_session` 不是 WenShu Python launcher，也不得被 Skill 用来替代 launcher。DOCX 当前使用 Node/OOXML Domain Runtime，不依赖该 Python Pack。

默认目录概念：

```text
<Mira runtime-packs>/
  wenshu-office/
    <version>/
      manifest.json
      site-packages/
```

具体根目录允许由 `MIRA_RUNTIME_PACKS_DIR` 覆盖。

`manifest.json` 只在 staging 依赖通过模块校验后写入，因此 Harness 可以使用“manifest + site-packages 存在”作为低成本 readiness marker；完整健康检查仍由异步 module probe 负责。

---

## WenShu V1 Packages

当前四个 Skill：

```text
docx -> bundled, no Python Runtime Pack required
xlsx -> runtimePack: wenshu-office
pdf  -> runtimePack: wenshu-office
pptx -> runtimePack: wenshu-office
```

XLSX / PDF / PPTX 共享一个 Runtime Pack，避免 Python / Pillow / lxml 等公共依赖重复下载。

DOCX 主要使用现有 Node / OOXML Domain Runtime，不要求为了其它三个 Python Skill 强制安装 Python Pack。

---

## 与 SkillContext 的关系

Skill Package 被发现后，可以参与基础 Skill Context 流程：

```text
Manifest
  ↓
SkillMatcher
  ↓ primary
SKILL.md
  ↓
SkillContext
  ↓
currentTaskFrame / Planner context
```

这条链 **不要求 Stateful Skill Runtime**。

但是：

```text
Skill match
≠ Tool available
```

例如：

```text
用户：合并几个 PDF
→ pdf Skill 可以被匹配并注入 SKILL.md
→ 如果 wenshu-office 尚未安装
→ SkillContext 必须知道正确方法，但真实 PDF Runtime 仍然 unavailable
```

系统不能因为 Skill 命中就伪造执行能力。

---

## 与 Harness 的关系

基础 SkillContext 可以接入 Agent，但不拥有 Harness 工具面。

当前两条独立链：

```text
Runtime Pack / environment readiness
  ↓
Harness capability reconciliation
  ↓
Harness eligible capabilities
  ↓ matcher / Policy
state.toolExposure

SkillScanner / Registry / Matcher / Loader
  ↓
SkillContext
  ↓
currentTaskFrame / Planner context
```

文枢当前规则：

```text
docx runtime built-in
  -> office_document 可作为正常 Harness capability

wenshu-office verified ready
  -> office_pdf / office_spreadsheet / office_presentation
     才进入 Harness capability registry

wenshu-office unavailable
  -> 上述三个 capability 从 registry 撤出
```

必须注意：

- **Skill 命中不参与 Tool 注册决策**；
- SkillContext 不 push 新 Tool 进 `state.toolExposure`；
- Runtime Pack readiness 只改变环境真实可用性，不绕过 capability matcher / Policy / Approval / Sandbox；
- 安装完成后，下一次上下文准备可通过环境 reconciliation 看到新能力，不需要创建 SkillInstance；
- Runtime Pack 被移除后，同一 reconciliation 会撤掉对应可选 capability。

如果后续 Stateful Skill Runtime 需要 stage-specific tool constraints，则逻辑仍是：

```text
Harness eligible tools
  ∩ active Stateful Skill allowedToolIds
  ∩ Policy / environment
  -> state.toolExposure
```

只能收窄，不能扩大。

---

## 与 MicroAPP 的关系

```text
Skills 页面
  -> 展示 Skill Package / 安装状态
  -> 去使用触发可选 Runtime Pack 安装
  -> 安装成功进入文枢 MicroAPP

文枢 MicroAPP
  -> Domain Runtime / debug / verification surface
```

MicroAPP 不自动等于 Skill。

SkillContext 也不要求必须经过 MicroAPP 才能工作。

---

## Current Implementation Anchors

Skill Context：

- `server/src/skills/context/scanner.ts`
- `server/src/skills/context/matcher.ts`
- `server/src/skills/context/loader.ts`
- `server/src/skills/context/index.ts`
- `server/src/agent/nodes/prepare-context.ts`

Package / Runtime Pack：

- `server/src/skills/registry.ts`
- `server/src/microapps/office-suite/capability-pack.ts`
- `server/src/microapps/office-suite/runtime-pack-paths.ts`
- `server/src/routes/microapps/office-suite/capability-pack.ts`
- `server/tools/wenshu/requirements.txt`
- `desktop/src/features/Skills/`

Harness execution eligibility：

- `server/src/harness/wenshu-office-capability.ts`
- `server/src/harness/runtime.ts`
- `server/src/agent/nodes/prepare-context.ts`

当前基础 `SkillScanner / SkillRegistry / SkillMatcher / SkillLoader / SkillContext` 已按 `skill-context-design.md` 落地首版，并以 DOCX / XLSX / PDF / PPTX 作为 V1 验证对象。

Stateful Skill Runtime 仍是可选后续层，当前不视为基础 Skill V1 的未完成项。

---

## Hard Rules

1. Skill Package 是真正的 Skill 分发单位，但安装 Package 不等于当前任务已激活 SkillContext。
2. Runtime Pack 是执行依赖，不是 Skill 本体。
3. Runtime Pack 安装不创建 SkillInstance。
4. SkillContext 命中不得注册 Tool 或扩大 `state.toolExposure`。
5. Runtime Pack readiness 可以改变预声明执行能力的环境 eligibility，但必须由 Harness 独立 reconciliation 完成，并继续服从 matcher / Policy / Approval / Sandbox。
6. 基础 SkillContext 可以在没有 Stateful Skill Runtime 的情况下工作。
7. 未安装 Runtime 时，Skill 可以被发现 / 匹配，但真实执行能力必须诚实 unavailable。
8. 第三方 Python 依赖不污染用户全局 Python。
9. 安装失败不留下 installed 真值。
10. Stateful Skill Runtime 是可选高级层。
11. 上位真相源为 `README.md`、`skill-context-design.md` 和 `skill-runtime-design.md` 各自负责的边界。
