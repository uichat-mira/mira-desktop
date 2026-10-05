# DOCX Skill 当前实现

Status: Current
Owner: chat / runtime / microapp
Last verified: 2026-07-23
Layer: raw-source
Module: SKILL
Feature: DocxSkill
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - skill-runtime-design.md
  - ../microapp/office-runtime-task-contract.md

## Purpose

这页记录 Mira 当前已经落地的第一份 Kimi-style Skill package：`docx`。

它不是把 Office SDK 原子操作直接暴露给 Agent，而是：

```text
用户 DOCX 目标
  -> docx Skill 路由/质量语义
  -> 唯一 state.toolExposure
  -> public Read surface / office_document
  -> WenShu Office Runtime
  -> DOCX artifact
```

## Package

源码：

```text
server/src/skills/docx/
  SKILL.md
  references/office-runtime-reference.md
```

`SKILL.md` 采用轻量 Skill package 结构：

- frontmatter：name / description
- Routing：根据已有 DOCX、纯内容源、新建文档选择路线
- Execution：描述高层执行能力
- Hard Rules：定义不可绕过的边界
- Quality Standard：定义完成门槛

Mira 没有复制任何第三方私有 Skill 实现；这份内容只描述 Mira 自己的 WenShu Runtime 和 Agent/Harness 合同。

## Runtime activation

`server/src/skills/registry.ts` 当前提供轻量 semantic resolver。

当最近任务语义明确属于 Word / DOCX 创建、审阅、批注或修订时：

1. 激活 `docx` semantic context；
2. 在 Harness 已注册能力中确保以下公开能力进入唯一 `toolExposure`：
   - `read_discover`
   - `read_open`
   - `office_document`
3. 不重新暴露 `read_locate` / `read_extract` 等当前 Harness 内部 Read primitive；
4. 把 DOCX Skill 的路由、硬规则和完成标准注入 `office_document` 的 Planner-visible metadata；
5. Planner 仍只从现有 `toolExposure` 选择 `use_tool`；
6. Normalize / Policy / approval / ToolNode / Evidence 合同不变。

这里没有新增 `use_skill` Planner action，也没有第二套 Agent Loop。

## Task-level Office capability

Agent 写能力只有一个高层入口：

```text
office_document
```

当前支持：

### Create

- 生成 `.docx`
- title
- semantic paragraph styles：title / heading1 / heading2 / heading3 / body
- bold
- simple tables
- workspace-relative output path

### Review

- 输入已有 `.docx`
- exact visible-text anchor
- Word native comment
- Track Changes replacement（tracked deletion + tracked insertion）
- 默认输出新副本
- 禁止覆盖源文件

## Current limitation

当前 review 定位仍是保守实现：

- 只修改可安全定位的 simple Word text run；
- complex run / field / unsupported structure 会拒绝 lossy rewrite；
- 不声明支持任意复杂 DOCX 的无损编辑。

Skill 的规则要求遇到该边界时停止强行写入，并明确报告限制或换更安全的目标。

## Completion rule

DOCX Skill 不把一次写工具成功等同于整个任务完成。

Create / Review 后应通过现有公开 Read 路径重新打开产物，确认：

- 产物存在；
- 文件可读；
- 请求内容或审阅变更存在；
- Review 的原文件未被覆盖。

只有这些完成条件被 Evidence 覆盖后，Planner 才应该 answer。

## Code Anchors

- `server/src/skills/docx/SKILL.md`
- `server/src/skills/docx/references/office-runtime-reference.md`
- `server/src/skills/registry.ts`
- `server/src/mcp/tools/office-document.tool.ts`
- `server/src/agent/nodes/prepare-context.ts`
- `server/src/microapps/office-suite/contract.ts`
- `server/src/microapps/office-suite/runtime.ts`
- `server/src/microapps/office-suite/create.ts`
