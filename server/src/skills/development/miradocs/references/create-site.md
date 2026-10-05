# 创建 MiraDocs 站点

用于 `create_site` 操作。

## 1. 参数合同

### 阻塞参数

| 参数 | 说明 | 缺失处理 |
| --- | --- | --- |
| `site.name` | 站点显示名称 | 询问 |
| `target.mode` | `local` / `new_github_repo` / `existing_github_repo` | 询问 |
| `target.localPath` | 本地创建位置，仅 local 模式需要 | 询问，或使用用户已明确的当前项目 Workspace |
| `target.repository` | `owner/repo`，GitHub 模式需要 | 询问 |
| `repository.visibility` | 新建仓库的 `public` / `private` | 询问，不默认公开 |
| `existingRepo.writePolicy` | 已有非空仓库是否允许修改 | 读取后展示影响并取得明确确认 |

GitHub 模式不要求用户提供 staging 路径。staging 是 Mira 管理的执行现场，不是产品参数，也不能被当作目标站点地址。

### 可推断参数

| 参数 | 推断方式 |
| --- | --- |
| `contentMode` | “博客”→ `blog`；“文档站”→ `docs`；未说明→ `docs_and_blog` |
| `appearancePreset` | “个人博客”→ `personal_blog`；“技术文档”→ `docs`；未说明→ `minimal` |
| `description` | 根据站点名和用户目标生成短草案 |
| `deployment` | GitHub 目标默认 `github_pages`；本地目标默认 `none`；明确“先不部署 / 只生成源码 / 只搭项目 / 先在本地看看 / 暂时不要上线”→ `none` |

### 稳定默认值

```yaml
contentMode: docs_and_blog
appearancePreset: minimal
local:
  deployment: none
github:
  deployment: github_pages
customDomain: null
logo: null
accentColor: default
author: null
```

GitHub `create_site` 默认包含 GitHub Pages 部署；创建仓库本身仍不等于部署成功，必须完成 workflow、Actions 和 Pages 回读。只有用户明确要求暂不上线时，GitHub 目标才停在源码与本地构建交付。

### 可延后参数

```text
Logo
自定义主色
自定义域名
作者主页
评论系统
统计代码
社交链接
```

这些参数不得阻塞站点初始化。

## 2. 询问方式

信息不足时，一次询问一组关联参数：

```text
先给我三项：网站名、创建位置（本地 / 新 GitHub 仓库 / 已有仓库），以及风格（默认简洁 / 技术文档 / 个人博客）。
```

新 GitHub 仓库仍缺可见性时，再单独问：

```text
这个新仓库要公开还是私有？
```

不要继续追问 Logo、域名、作者链接等非阻塞配置，也不要让用户选择 Mira 内部 staging 目录。

GitHub 目标的施工草案必须明确显示：

```text
部署：GitHub Pages（默认）
```

用户可直接改为“暂不部署”，不得悄悄把 GitHub 建站降级为只生成源码。

## 3. Workspace 与目标位置检查

### 3.1 本地目录

本地模式直接使用用户明确的 `target.localPath`，或用户已经明确指定为目标项目的当前 Workspace。

写入前确认：

- 目标路径是否存在且是目录；
- 是否为空；
- 当前 Workspace 是否就是目标目录；
- 是否存在需要保留的文件；
- 依赖与运行环境是否可用。

非空目录不得直接覆盖。先列出影响文件并询问用户是新建子目录、合并还是取消。

目录不存在时，不得通过 Workspace getter 或 environment snapshot 隐式创建。只有用户明确要求创建该本地目标并通过对应审批后，才允许创建。

### 3.2 GitHub staging

GitHub 模式需要本地安装、类型检查和静态构建，因此必须建立独立受管 staging：

```text
<workspaceRoot>/.mira/staging/miradocs/<owner>/<repo>/<taskKey>/
```

规则：

- 不直接使用 `<workspaceRoot>` 作为站点目录；
- 不把 `Mira BASE` 当成站点名或仓库名；
- `taskKey` 首次生成后写入 SubAgent checkpoint / working state；
- 恢复时复用 exact staging path，不创建第二个现场；
- 不同仓库和并发任务不得共享目录；
- staging 路径进入 trace 和最终交付；
- 失败时保留现场，不自动清空；
- staging 清理是后续显式生命周期动作。

默认 `Mira BASE` 只提供 Harness workspace root。默认物理目录由桌面 launcher 在 backend 启动前创建；MiraDocs Skill 不负责补建全局默认目录。

如果当前没有有效 Workspace 或 `terminal_session` 不可用，则本地验证能力缺失。必须返回 capability gap，不能只写远程文件后宣称站点已经完成。

## 4. GitHub 目标检查

### 4.1 新 GitHub 仓库

创建前确认：

- owner；
- repository name；
- public / private；
- 是否已经存在同名仓库；
- 用户是否明确要求暂不部署。

使用现有 GitHub 领域工具执行：

```text
github_repository.create
→ 使用 owner / name / visibility 创建仓库
→ 回读 repository id、fullName、defaultBranch、visibility、htmlUrl

github_repository.ensure_installation_access
→ 确认新仓库是否已授权给 Mira
→ 未授权时返回 GitHub App installation 设置入口和明确用户动作
→ 用户授权后重新检查
```

`create` 不使用 `repository` 参数；创建仓库、授权检查、写文件、Actions 和启用部署是不同 invocation，各自按现有审批合同执行。不得因为仓库已创建就假设 installation 已授权。

### 4.2 已有 GitHub 仓库

先读取：

- 默认分支；
- 仓库是否为空；
- 当前框架和构建脚本；
- 是否已有 MiraDocs 配置；
- 是否有未合并 PR 或活跃施工分支；
- 当前部署工作流和 Pages 状态；
- 可能被覆盖或冲突的文件。

读取后给出初始化、迁移或保持现状的草案，不直接覆盖。

已有仓库进入本地 staging 时，应从当前远程事实初始化或同步；不得只凭上一轮摘要假设 staging 与远程一致。

远程写入遵循用户明确要求或仓库既有策略。允许直接写默认分支；只有用户要求或仓库策略要求时才创建施工分支 / PR。无论采用哪种写入方式，都必须回读远程文件和 commit。

## 5. 站点施工草案

参数足够后使用：

```text
网站名：Tomz Lab
位置：新建 dangjingtao/tomz-lab
仓库可见性：私有
内容：文档 + 博客
风格：默认简洁
部署：GitHub Pages（默认）
自定义域名：暂不配置
```

用户可以直接纠正不对的项。只有草案中的阻塞参数仍缺失时才继续追问。

内部 staging 不需要作为用户选择项，但施工开始后必须在 trace / checkpoint 中记录，并在交付中给出可核验路径。

完整模板：

```text
skill://miradocs/templates/site-draft.md
```

## 6. 确定性执行阶段

GitHub `create_site` 必须先读取：

```text
skill://miradocs/templates/create-site-v0.1.1.md
```

该模板已经固定 `@uichat-mira/docs@0.1.1` 的站点文件、Vite 接入和 Pages workflow。不得通过 npm README、网络搜索或 `node_modules` 类型声明重新研究同一套 API。

### 6.1 阶段账本

使用现有 SubAgent checkpoint / working state 记录，不增加新状态机或修改 Runtime：

```text
operation: create_site
targetMode
repository
repositoryDefaultBranch
stagingPath
deployment
currentStage
completedStages
remoteCommitSha
actionsRunId
pagesUrl
```

阶段顺序固定：

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

约束：

- 审批恢复后先回读 checkpoint、staging 和可能变化的远程事实；
- 只执行第一个未完成阶段；
- 已有成功证据的阶段不得重跑；
- 当前阶段失败时只诊断和修复当前失败层；
- `deployment: none` 时，跳过 `render_pages_workflow`、`verify_actions`、`configure_pages`、`verify_pages`，并在交付中标为 `not_run`；
- 只读目录清单使用 `list`，按路径模式找文件使用 `glob`，打开已知文件使用 `read`；不得为反复 `dir` / `ls` / `cat` 制造 Terminal 审批；
- Terminal 只承担模板落盘、安装、类型检查和构建，不通过 Terminal 研究第三方包或拼装远程发布策略。

### 6.2 固定本地命令

在 exact staging 根目录执行：

```text
npm install --no-audit --no-fund
npm run typecheck
npm run build
```

安装成功后确认 `package-lock.json` 已生成。远程源码清单包含 lockfile，但排除：

```text
node_modules
dist
.vite
本地缓存
staging 元数据
```

### 6.3 本地站点顺序

```text
确认阻塞参数
→ 读取目标目录
→ 展示施工草案
→ 读取固定脚手架
→ 写入最小可运行站点
→ 安装依赖
→ 类型检查
→ 静态构建
→ 验证首页和启用的内容入口
→ 交付路径和剩余项
```

### 6.4 新 GitHub 站点顺序

```text
确认阻塞参数
→ 检查同名仓库
→ 展示施工草案（默认 GitHub Pages）
→ github_repository.create
→ 回读新仓库
→ github_repository.ensure_installation_access
→ inspect_target
→ prepare_staging
→ render_scaffold
→ install_dependencies
→ typecheck
→ build
→ render_pages_workflow
→ write_remote 并回读文件 / commit
→ verify_actions
→ configure_pages(mode=workflow)
→ verify_pages
→ deliver
```

PR 不是默认必需阶段。用户明确要求或仓库策略要求 PR 时，在 `write_remote` 后创建 / 更新 PR，并继续验证相应 Actions；不得因此改变前面固定本地阶段。

### 6.5 已有 GitHub 站点顺序

```text
确认目标仓库
→ inspect_target：读取当前事实和冲突
→ 展示施工草案及影响
→ prepare_staging：从远程当前事实初始化 exact staging
→ render_scaffold：只生成缺失或已确认可修改的最小文件
→ install_dependencies
→ typecheck
→ build
→ render_pages_workflow
→ write_remote 并回读
→ verify_actions
→ configure_pages(mode=workflow)
→ verify_pages
→ deliver
```

顺序允许根据实际 API 限制调整仓库创建与 staging 准备的先后，但以下事实不能跳过：

- installation 已检查；
- exact staging path 已记录；
- 版本化脚手架已读取；
- 本地验证完成或明确失败；
- 远程写入已回读；
- 默认 Pages 模式下 workflow、Actions、Pages 与 URL 分别验证。

## 7. 最小可运行站点

至少包含：

```text
MiraDocs 配置
首页
文档示例或文档入口（contentMode 包含 docs 时）
博客示例或博客入口（contentMode 包含 blog 时）
开发命令
类型检查命令
构建命令
静态产物输出配置
README 中的本地启动说明
GitHub Pages workflow（deployment = github_pages）
```

固定文件内容见：

```text
skill://miradocs/templates/create-site-v0.1.1.md
```

示例内容必须明确标记为示例，不得伪装成用户真实内容。

风格预设只应决定必要的布局、字体层级、间距和基础主题，不在 V1 引入复杂主题编辑器。

## 8. GitHub Pages 部署

GitHub 目标默认 `deployment: github_pages`：

```text
读取 repository.defaultBranch
→ 从固定模板生成 .github/workflows/pages.yml
→ workflow push 分支使用回读的 defaultBranch
→ 写入源码、package-lock.json 与 workflow
→ 回读远程文件和 commit
→ github_actions 检查 workflow run / job / step
→ github_repository.get_pages
→ github_repository.configure_pages(mode=workflow)
→ github_repository.get_pages 回读最终状态与 URL
```

Pages workflow 固定使用：

```text
actions/checkout@v4
actions/setup-node@v4
npm ci
npm run typecheck
npm run build
actions/configure-pages@v5
actions/upload-pages-artifact@v4 (path: dist)
actions/deploy-pages@v4
```

规则：

- `deployment: none`：只创建并验证项目，不写 workflow、不配置 Pages，交付时 Actions / Pages 标记 `not_run`；
- 自定义域名仅在用户明确提出时处理；
- Pages 配置与仓库创建、文件写入分开审批；
- workflow 模式不传 branch/path；
- workflow 必须监听回读得到的默认分支，不得固定猜测 `main`；
- 没有 Actions 成功和 Pages URL 回读证据时，不得说“网站已上线”或“建站完成”；
- Actions 仍在运行时保持 `working` 或明确等待，不重复写 workflow；
- Actions 失败时读取失败 run、job、step，只修复对应失败层。

## 9. 失败与恢复

每一步完成后记录可回读事实，不使用只存在于对话里的“已经做过”作为恢复依据。

### 仓库已创建，但 installation 未授权

```text
completed: github_repository.create
blocked: github_repository.ensure_installation_access
not_run: staging / files / build / workflow / Actions / Pages
```

返回仓库 `fullName`、`htmlUrl` 和 GitHub App installation 操作入口。用户完成授权后，先重新调用 `ensure_installation_access`；不得再次调用 `create`。

### staging 已创建，但本地验证失败

保留 exact staging path，明确失败在依赖安装、TypeScript、内容解析还是静态构建。workflow、Actions 与 Pages 必须保持 `not_run`。修复时从失败层继续，不重新初始化仓库或创建第二个 staging。

### 远程文件已写入，但本地验证失败

保留远程 commit 和 staging。重新读取远程状态后修复同一目标；不得重复创建仓库或重新执行已经成功的安装阶段。

### Actions 失败

保留当前 commit 和 workflow run。先读取最新 run、job、step 和必要日志，只修复失败层；不得通过重写整套脚手架或创建重复 PR 逃避失败。

### Pages 配置失败

先调用 `github_repository.get_pages` 读取当前状态，再决定是否重试 `configure_pages`。仓库、站点文件、workflow 和 Actions 已经完成时，不因 Pages 失败而重复写入或回滚正确内容。

## 10. 完成标准

只有同时满足以下条件，才能说站点已创建：

- 站点文件已写入本地目标位置，或 GitHub 模式的 staging 与远程目标；
- GitHub 模式的 exact staging path 已进入 checkpoint / trace；
- 新 GitHub 仓库已完成创建回读和 installation 授权检查；
- 已读取 `skill://miradocs/templates/create-site-v0.1.1.md`，没有以探索 npm README / 类型声明替代固定模板；
- 依赖安装结果明确；
- 类型检查结果明确；
- 静态构建结果明确；
- 首页和启用的内容入口可被发现；
- 远程文件与 commit 已回读；
- `deployment: github_pages` 时，workflow 已回读、Actions 已成功、Pages 已配置为 workflow、最终 URL 与 HTTPS 状态已回读；
- `deployment: none` 时，workflow / Actions / Pages 明确标记为 `not_run`，且没有声称站点上线；
- 用户能看到本地路径或 staging、仓库、commit、可选 PR、Actions run 和部署地址；
- 每个阶段的 `completed`、`blocked`、`failed` 或 `not_run` 状态明确；
- 失败步骤和剩余配置被明确列出；
- checkpoint 恢复没有重复执行已经完成的安装、类型检查、构建或远程写入。

不能仅凭模板文件已生成、仓库已创建、一次 GitHub 写入成功或 Pages 请求已发送宣布建站完成。