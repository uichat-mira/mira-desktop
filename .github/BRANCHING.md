# Mira GitHub 分支规范

## 分支职责

| 分支 | 用途 | 允许进入方式 |
| --- | --- | --- |
| `prod` | 生产发布分支，只保存已经验证可发布的版本 | 仅允许 `test` 或紧急 `hotfix/*` 通过 Pull Request 合入 |
| `test` | 测试、验收、发布候选分支 | 仅允许 `dev` 或紧急 `hotfix/*` 通过 Pull Request 合入 |
| `dev` | 日常集成分支，汇总已完成的功能开发 | 接收功能、修复、重构等工作分支的 Pull Request |
| `feature/*` | 新功能开发分支，从 `dev` 创建 | 完成后 Pull Request 到 `dev` |
| `fix/*` | 普通缺陷修复分支，从 `dev` 创建 | 完成后 Pull Request 到 `dev` |
| `hotfix/*` | 生产紧急修复分支，从 `prod` 创建 | 先 Pull Request 到 `prod`，随后同步到 `test` 和 `dev` |

标准流转：

```text
feature/* → dev → test → prod
```

禁止跳级：普通功能不得直接进入 `test` 或 `prod`。

## 分支命名

统一使用小写英文、数字、点、短横线或下划线：

```text
feature/github-dashboard
fix/cdp-send-confirmation
refactor/agent-planner
perf/rag-index
chore/github-branch-governance
```

## Pull Request 要求

### 合入 `dev`

- 必须来自工作分支，不直接向 `dev` 推送开发提交。
- 描述变更目标、影响范围、验证结果和潜在风险。
- CI 必须通过。
- 合并前处理完未解决的审查意见。

### `dev` 合入 `test`

- 作为一次明确的测试候选提升。
- 写明本次包含的功能、修复和已知问题。
- 不在 `test` 上继续开发功能；测试发现的问题回到 `fix/*` 修复。

### `test` 合入 `prod`

- 必须完成验收与发布检查。
- 必须提供发布说明、风险说明和回滚方案。
- `prod` 禁止直接推送、强制推送和删除。

## `prod` 推荐保护规则

在 GitHub Rulesets 或 Branch protection rule 中为 `prod` 启用：

- Require a pull request before merging
- Require at least 1 approval
- Dismiss stale approvals when new commits are pushed
- Require conversation resolution before merging
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Block force pushes
- Restrict deletions
- Do not allow bypassing the above settings（管理员也遵守）

允许的 PR 来源：`test`、`hotfix/*`。

## `main` 处理

`main` 视为旧分支，不再承担日常开发或生产发布职责。完成 `prod` 保护规则配置并确认发布流程稳定后，再决定将默认分支切换为 `dev` 或 `prod`；切换前不要删除 `main`。
