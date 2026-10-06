---
id: miradocs
displayName: MiraDocs 建站与内容发布
description: "帮助用户创建 MiraDocs 站点、发布博客或文档，并维护已有站点。"
version: 0.1.0
category: development
visibility: public
source: Mira
status: review
execution.context: fork
execution.agent: miradocs
execution.allowedTools: list, glob, grep, read, terminal, github_repository, github_pull_request, github_actions
---

# MiraDocs Skill V1

这是 MiraDocs 的 canonical Base Skill。

它只回答一件事：用户想创建、发布或维护 MiraDocs 站点时，Mira 应该收集哪些信息、怎样施工、怎样验证结果。

它不是 Tool，不注册能力，不扩大 `state.toolExposure`，也不重新实现 GitHub API。实际读取、写入、构建和远程操作仍由当前 Harness 已暴露的能力完成。

# 一个 Skill，三个操作

```text
create_site
  创建一个新的 MiraDocs 站点

publish_content
  发布或更新博客、文档

maintain_site
  修改、诊断、升级或迁移已有站点
```

三个操作共享同一个站点目标、仓库上下文、审批、构建和交付格式，因此不拆成三个 Skill。

用户不需要选择菜单。根据自然语言判断当前操作：

```text
“帮我建一个文档站”
→ create_site

“把这篇文章发成博客”
→ publish_content

“把首页标题改成 Tomz Lab”
→ maintain_site
```

确实无法判断时，只问：

```text
你是要创建新站，还是修改已有站点？
```

# 对话原则

## 1. 参数分四类

```text
blocking
  缺失后无法安全施工，必须询问

inferable
  可从用户表达、当前会话、文件或仓库推断

defaultable
  可采用稳定默认值，并在施工草案中展示

deferred
  不阻塞当前任务，后续随时补充
```

禁止把 Logo、主色、域名、统计、评论和社交链接逐项盘问用户。

## 2. 一次询问一组关联信息

建站信息不足时，一次收集：

```text
网站名
创建位置：本地 / 新 GitHub 仓库 / 已有仓库
风格：默认简洁 / 技术文档 / 个人博客
```

不要把它拆成十轮问答。

## 3. 施工前展示草案

参数足够后，先给用户一份短而具体的草案：

```text
网站名：Tomz Lab
位置：新建 dangjingtao/tomz-lab
内容：文档 + 博客
风格：默认简洁
部署：GitHub Pages（GitHub 目标默认）
```

草案用于纠正参数，不替代 Harness、GitHub 或其他执行能力的审批合同。

## 4. 不重复询问

用户已明确的网站名、路径、仓库、内容类型、风格和部署方式不得再次询问。

同一任务的自然续轮继承最近明确的目标站点。例如建站后用户说“再把这篇文章发上去”，继续使用刚创建的站点；这属于 Base Skill task-context continuation，不创建 SkillInstance 或新状态机。

已有站点的真实配置必须重新从当前文件和远程状态读取，不能让会话记忆覆盖仓库事实。

# 操作路由

## A. 创建站点

适用于：

```text
帮我建一个 MiraDocs 站
做一个个人博客
给这个仓库初始化文档站
先在本地搭起来看看
```

按需读取：

```text
skill://miradocs/references/create-site.md
skill://miradocs/templates/create-site-v0.1.1.md
skill://miradocs/templates/site-draft.md
skill://miradocs/examples/conversations.md
```

稳定默认：

```yaml
contentMode: docs_and_blog
appearancePreset: minimal
local.deployment: none
github.deployment: github_pages
```

GitHub 目标默认完成 GitHub Pages 建站。只有用户明确表达“先不部署”“只生成源码”“只搭项目”“先在本地看看”或“暂时不要上线”时，GitHub 目标才使用 `deployment: none`。本地目标仍默认 `deployment: none`。

新 GitHub 仓库的公开或私有不可默认，必须询问。已有非空仓库必须先读取并展示影响，不能直接覆盖。

新 GitHub 站点在能力真实暴露时使用：

```text
github_repository.create
github_repository.ensure_installation_access
github_repository.get_pages
github_repository.configure_pages
```

仓库创建、installation 检查、文件写入、Actions 和 Pages 是不同 invocation。每个远程写入仍须走现有审批和回读合同。PR 只在用户明确要求或仓库既有交付策略要求时使用。

### create_site 的确定性施工约束

`create_site` 不允许临场研究 MiraDocs API、npm README、`node_modules` 类型声明或 GitHub Pages workflow 写法。必须读取版本化模板 `skill://miradocs/templates/create-site-v0.1.1.md`，并按 `references/create-site.md` 中的固定阶段执行。

固定阶段为：

```text
inspect_target
→ prepare_staging
→ render_scaffold
→ install_dependencies
→ typecheck
→ build
→ render_pages_workflow
→ write_remote
→ verify_actions
→ configure_pages
→ verify_pages
→ deliver
```

每次审批恢复后，先读取已有 checkpoint / working state 和远程事实，只执行第一个未完成阶段。已完成的安装、类型检查、构建和远程写入不得重复。`deployment: none` 时从 `write_remote` 直接进入 `deliver`，并把 Actions / Pages 标为 `not_run`。

## B. 发布博客或文档

适用于：

```text
把这篇文章发成博客
把这个 Markdown 放到文档站
帮我写一篇更新说明并发布
把现有文档改一下重新上线
```

博客和文档是同一个发布操作，不拆 Skill。

按需读取：

```text
skill://miradocs/references/publish-content.md
skill://miradocs/examples/conversations.md
```

目标站点、内容来源和内容类型是关键参数。标题、摘要、slug、日期、分类和作者优先从正文、用户表达与现有站点约定推断；不要让用户填写完整 frontmatter 表单。

## C. 维护已有站点

适用于：

```text
改站点名称、描述、主题或导航
修改、下线或删除内容
修复内容未发现、链接失效、构建或部署失败
升级 MiraDocs
迁移已有内容
配置 GitHub Pages 或域名
```

按需读取：

```text
skill://miradocs/references/maintain-site.md
skill://miradocs/examples/conversations.md
```

维护前先读取当前状态。删除内容、更换永久链接、覆盖已有文件、修改部署工作流、替换域名和批量迁移属于破坏性操作，必须展示精确对象与影响。

# 执行边界

MiraDocs Skill 负责：

```text
识别三个操作
归一化参数
判断何时追问
生成施工草案
规定执行顺序
规定完成标准
```

实际执行复用现有能力：

| 任务 | 能力 |
| --- | --- |
| 查看已知目录 | `list` |
| 按路径模式定位站点或文件 | `glob` |
| 按正文定位配置或内容 | `grep` |
| 打开已知文件与 Skill 参考资源 | `read` |
| 本地写入、修改、删除、重命名、安装、检查、构建和预览 | `terminal` |
| GitHub 仓库、installation、分支、远程文件和 Pages | `github_repository` |
| 创建或维护 PR | `github_pull_request` |
| 检查或操作 CI / workflow | `github_actions` |

`execution.allowedTools` 是 fork 执行的最大工具边界，不是每次任务都必须具备的工具清单。每个操作只校验当前步骤真正需要的工具；未被当前步骤使用的可选工具不可成为阻塞条件。

## 按操作取用

```text
create_site / local
→ list + glob + read + terminal

create_site / github
→ github_repository：仓库、installation、远程文件和 Pages
→ terminal：受管本地 staging、模板落盘、依赖安装、类型检查和静态构建
→ github_actions：默认 GitHub Pages 建站的 workflow / run / job 验证
→ 用户要求 PR 或仓库策略要求 PR 时再取 github_pull_request

publish_content / local
→ read + terminal

publish_content / github
→ github_repository：读取和写入远程内容
→ terminal：需要本地内容发现、构建或路由验证时使用受管 staging
→ 需要 PR 时再取 github_pull_request
→ 需要上线验证时再取 github_actions

maintain_site / local
→ list / glob / grep / read
→ 需要实际修改、诊断或构建时取 terminal

maintain_site / github
→ github_repository
→ 需要本地复现、修改或构建时取 terminal 与受管 staging
→ 只在 PR、CI 或部署步骤分别取 github_pull_request / github_actions
```

GitHub 模式的“本地验证”不能只靠 GitHub Tool，也不能在默认 Workspace 根目录直接铺开项目文件。

# Workspace 与 staging 合同

## 1. 本地目标

本地模式使用用户明确的 `target.localPath`，或用户已经明确指定为目标项目的当前 Workspace。写入前必须检查目标是否存在、是否为空以及可能覆盖的文件。

## 2. GitHub 目标

GitHub 模式需要一个独立的本地施工现场，用于：

```text
生成 / 拉取站点文件
安装依赖
类型检查
静态构建
路由与内容入口验证
```

默认使用当前 Harness workspace root 下的受管目录：

```text
<workspaceRoot>/.mira/staging/miradocs/<owner>/<repo>/<taskKey>/
```

规则：

- 不能把 `<workspaceRoot>` 本身当作站点根目录；
- `taskKey` 首次创建后必须保存在 checkpoint / working state，恢复时复用；
- 不同仓库或并发任务不能共享施工目录；
- staging 路径必须进入 trace 和最终交付；
- 失败后保留现场并从失败步骤继续；
- 未完成交付前不得自动清空现场；
- 清理 staging 是显式生命周期动作，不得掩盖失败证据。

如果没有有效 Workspace 或 `terminal` 未进入当前步骤的真实 ToolExposure，则本地验证能力缺失。此时不得声称站点已经完成构建；按 completion criteria 返回 capability 缺口。

## 3. 默认空间

默认数据库 Workspace 名为 `Mira BASE`，绑定桌面宿主提供的默认物理目录。`Mira BASE` 只是逻辑名称，不是站点目录名。

默认目录的创建由 Electron / Tauri launcher 在 backend 启动前完成；MiraDocs Skill 不负责通过一次 Terminal 调用“补建”全局默认目录，也不能让通用 Workspace snapshot 隐式创建自定义路径。

详细合同见：`docs/chat/workspace.md`。

# 本地文件施工

本地文件施工统一由 `terminal` 承担，不要求 Skill 感知 `write_file`、`replace_block`、`delete_path`、`move_path` 或兼容层 `edit_file` 等实现细节。具体命令仍走终端审批、Workspace 边界和执行回读。

Skill 命中不代表工具已经进入本轮 ToolExposure。Planner 只能使用当前真实暴露并通过 Policy 的能力。当前环境已经真实暴露的能力，不应被 Skill 人为回避；当前步骤需要时应实际调用。

# 交付格式

每次施工后尽量返回：

```text
目标站点
本次变更
本地目标路径或 staging 路径
远程写入位置
验证结果
可访问地址
commit / PR / CI / 部署状态
未完成项或需要用户决定的事项
```

不得用底层 JSON 代替用户可理解的结果。

# 失败与恢复

每个已完成的远程动作和本地验证结果都是可回读 checkpoint。后续步骤失败时，不撤销已经正确完成的仓库、分支、文件或 PR，也不重复执行不可幂等动作。

```text
仓库创建成功，但 installation 未授权
→ 返回已创建仓库的名称与地址
→ 停止后续仓库写入
→ 用户授权后先重新读取仓库和 installation 状态
→ 从 ensure_installation_access 继续，禁止再次 create

staging 已创建，但本地安装或构建失败
→ 保留 exact staging path
→ 返回失败命令、错误层和可核验路径
→ 不配置 Pages，不声称站点可发布
→ 修复后从失败验证层继续

站点文件已写入远程，但本地验证失败
→ 保留远程 checkpoint 和 staging
→ 不重复写入已完成文件
→ 修复并重新验证后再继续 Actions / Pages

Actions 失败
→ 保留当前 commit 和 workflow run
→ 读取失败 run、job、step 和必要日志
→ 只修复失败层，不重复前面的安装、构建或仓库初始化

内容已完成，但 Pages 配置失败
→ 保留仓库、内容和 commit
→ 先调用 get_pages 回读当前远程事实
→ 只重试未完成的 Pages 配置
→ 不重复写内容或重新创建仓库
```

交付时把每一步标成：`completed`、`blocked`、`failed` 或 `not_run`。恢复前必须重新读取远程状态和 staging 事实，不能只依赖上一轮摘要。

# Hard Rules

1. V1 只做创建站点、发布博客或文档、维护已有站点。
2. 不加入项目、里程碑、任务、决策或风险产品模型。
3. 不把一个 Skill 拆成三个 Skill，也不要求用户先选菜单。
4. 不注册新 Tool，不扩大 ToolExposure，不复制 GitHub API。
5. 不修改 Main Agent、Planner、Agent Graph、Harness 审批或 C contract。
6. 修改前读取当前事实；写入后回读文件与相关构建、路由、CI 或部署结果。
7. 远程写入遵循用户明确要求或仓库既有策略；允许直接写默认分支，PR 不是 create_site 的强制完成条件。
8. GitHub `create_site` 默认 `deployment: github_pages`；本地目标及用户明确要求暂不上线时使用 `deployment: none`。
9. 新 GitHub 仓库可见性必须询问，不默认公开。
10. 已有非空仓库未经读取和明确确认不得覆盖。
11. 不覆盖同名内容，不擅自改变已有 slug、永久链接、作者、日期或用户正文语气。
12. 未验证的步骤必须标记为缺口，不得冒充成功。
13. 当前环境已暴露且用户目标需要的 GitHub 能力应实际调用，不得用“V1 暂不做”替代能力执行。
14. 新仓库创建后必须检查 installation 授权；Pages 配置后必须回读最终状态和 URL。
15. 恢复任务时先回读 checkpoint，禁止重复创建仓库、重复发布同一内容或重复执行已完成的远程写入。
16. fork 执行不得调用 `execution.allowedTools` 之外的工具；只在当前步骤关键工具缺失时报告 capability 缺口，不得因未使用的可选工具缺失而阻塞。
17. GitHub 模式需要本地验证时必须使用独立 staging，不得直接污染 Workspace 根目录。
18. 不得让 Workspace getter、environment snapshot 或 Skill 通过隐藏 mkdir 复活缺失的自定义目录。
19. `create_site` 必须使用 Skill 内置的版本化脚手架和 Pages workflow，不得通过反复探索第三方文档临场拼装。
20. 审批恢复后只推进第一个未完成阶段，不得重新执行已经有回读证据的阶段。

# Completion Criteria

任务只有在以下条件满足时才算完成：

- 当前操作和目标站点明确；
- 阻塞参数已收齐，默认值与推断值已向用户展示；
- 施工前读取了目标位置、仓库或现有站点事实；
- GitHub 模式已记录 exact staging path；
- 写入通过现有审批路径完成；
- 修改后的本地或远程文件已回读；
- 新 GitHub 仓库已回读创建结果并检查 installation 授权；
- 依赖安装、类型检查、静态构建及必要路由验证结果明确；
- GitHub `create_site` 使用 `deployment: github_pages` 时，workflow 文件、远程 commit、Actions 成功状态、Pages workflow 模式、最终 URL 和 HTTPS 状态均已回读；
- `deployment: none` 时，Actions 与 Pages 必须明确标记为 `not_run`，不得声称站点已上线；
- 用户获得路径、地址、分支、commit、PR 或远程状态等可核验证据；
- 失败步骤、剩余配置和需要人工决定的事项被清楚列出；
- 恢复执行没有重复已完成的不可幂等动作；
- 没有越过 V1 范围或重写现有 Agent 与工具合同。