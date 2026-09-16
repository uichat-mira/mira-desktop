---
status: current
owner: model-settings
last_verified: 2026-07-06
layer: project-control
module: ProjectControl
feature: ModelSettingsWorkboard
doc_type: workboard
canonical: true
related:
  - docs/architecture/model-settings-roadmap.md
  - docs/project-control/tasks/modelset_T001-role-expansion.md
  - docs/project-control/tasks/modelset_T002-image-provider-adapters.md
  - docs/project-control/tasks/modelset_T003-google-and-custom-openai-providers.md
  - docs/project-control/tasks/modelset_T004-model-settings-ui-refinement.md
---

# Model Settings Workboard

模型设置专项台账。

本页只记录 `modelset_` 任务包，不替代项目总 ledger。

## Naming Rule

- 任务编号格式：`modelset_T001`、`modelset_T002`。
- 一张任务卡只处理一个阶段的明确边界。
- 不允许把角色扩展、生图 adapter、自定义服务商、前端大改混在一张任务卡里。

## Workboard

| ID | Topic | Current Judgment | Status | Task Card |
| --- | --- | --- | --- | --- |
| `modelset_T001` | Role expansion for `agentTask` and `imageGeneration` | 已完成角色定义扩展，现有服务商模型可绑定为 AgentTask / ImageGeneration，且旧库启动会补齐新角色默认配置 | `DONE` | [modelset_T001-role-expansion.md](D:/workspace/rag-demo/docs/project-control/tasks/modelset_T001-role-expansion.md) |
| `modelset_T002` | Image provider adapters for OpenAI Images and ComfyUI | 在 `imageGeneration` 角色存在后接入真实生图 adapter；不做自定义服务商 CRUD | `TODO` | [modelset_T002-image-provider-adapters.md](D:/workspace/rag-demo/docs/project-control/tasks/modelset_T002-image-provider-adapters.md) |
| `modelset_T003` | Google provider and custom OpenAI-compatible provider instances | 已引入 template / connection instance 分层，默认角色绑定优先使用 connection id，且旧 providerCode 数据有兼容迁移路径 | `DONE` | [modelset_T003-google-and-custom-openai-providers.md](D:/workspace/rag-demo/docs/project-control/tasks/modelset_T003-google-and-custom-openai-providers.md) |
| `modelset_T004` | Model settings frontend refinement | 已完成模型设置 UI 分区：默认角色模型按业务分组展示，服务商连接弹窗拆分为连接信息、能力、同步模型和默认角色绑定，并区分内置 / 自定义服务商 | `DONE` | [modelset_T004-model-settings-ui-refinement.md](D:/workspace/rag-demo/docs/project-control/tasks/modelset_T004-model-settings-ui-refinement.md) |

## Current Ground Truth

- 当前模型角色已扩展为 `llm / embedding / rerank / task / agentTask / evaluation / imageGeneration`。
- 默认角色绑定主流程优先使用 `providerConnectionId`，旧 `providerCode` 仅保留兼容迁移语义。
- 服务商已区分 template 与 connection instance，可表达同协议多实例服务商。
- `agentTask` 已独立于 `task`，前端与后端都按独立角色处理。
- `imageGeneration` 已独立于 chat adapter，前端参数展示也不再与 chat 参数混排。

## Execution Rule

默认顺序：

```text
T001 -> T002 -> T003 -> T004
```

`T003` 是架构风险最高任务，启动前必须确认迁移方案和兼容策略。
