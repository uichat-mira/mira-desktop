---
status: current
owner: runtime / integrations / desktop
last_verified: 2026-07-30
verified_against: dev@5543dda35787f710075e1fb8cafa735c00dff273
layer: wiki
module: MicroAPP
feature: MicroAppRuntime
doc_type: current-snapshot
canonical: true
related:
  - CURRENT_PRODUCT_TRUTH.md
  - TOOL_CURRENT_TRUTH.md
  - microapp/README.md
  - microapp/office-runtime-task-contract.md
  - microapp/wenshu-skill-runtime.md
  - microapp/tts-studio-runtime-notes.md
  - microapp/github-capability-design.md
  - integrations/third-party-integration-architecture.md
---

# UIChat Mira MicroApp 当前真相

> 这页记录 `dev` 当前真实存在的 MicroApp 产品入口、严格运行时定义、独立 Studio、Integration binding、Tool / Skill 接入和成熟度。它不把同一个页面里的所有入口假装成同一种 Runtime。

## 1. 结论先说

Mira 当前同时使用了两个范围不同的“微应用”概念。

### 产品层：MicroApps Hub

设置页中的“微应用”是一个产品能力中心。它汇集：

- 企业集成 MicroAPP；
- 独立 Studio；
- 本地领域 Runtime；
- Skill 工作台；
- MCP / Tool 集成；
- 外部连接与授权入口。

它回答的是：

> 用户可以从哪里配置、调试或进入一项相对独立的能力。

### Runtime 层：`MicroAppDefinition`

`server/src/microapps/runtime.ts` 中的严格 MicroApp Runtime 是企业集成域的一套可绑定业务工作流协议：

```text
Integration Capability / AccessPoint
  -> MicroApp binding
  -> MicroAppDefinition
  -> invoke(...)
  -> reply / no_reply / error
```

它回答的是：

> 一个外部 AccessPoint 收到标准化请求后，应该调用哪条业务工作流。

这两层不能互相替代。

```text
MicroApps product hub
!= MicroAppDefinition registry
!= Studio HTTP routes
!= Harness Tool registry
!= Skill Runtime
```

## 2. 五个必须分别证明的层级

看到一个“微应用”时，必须分别判断：

1. **产品入口**：设置页是否有可进入页面；
2. **共享定义**：是否存在持久化 definition、runtime key 和 binding schema；
3. **领域 Runtime**：后端是否有真实 service、任务、Artifact 和失败语义；
4. **Integration invoke**：是否能被外部 AccessPoint 通过统一 MicroApp Runtime 调用；
5. **Agent access**：是否通过 Tool 或 Skill 明确进入 Agent，而不是只因为页面或 definition 存在。

因此：

```text
有卡片
!= 有 Runtime

有 definition
!= invoke 可用

有 HTTP route
!= 可绑定外部 AccessPoint

有 Studio
!= 已接入 Agent

进入 Agent
!= 可绕过 Policy / Approval
```

## 3. 严格 MicroApp Registry

当前 `MicroAppType` 只有七种：

```text
knowledge_query
news_hub
image_generation
computer_use
tts
codegraph
evolving_knowledge
```

每个 `MicroAppDefinition` 至少声明：

- `type`；
- `label`；
- `supportedAccessPoints`；
- `runtimeKey`；
- `bindingSchema`；
- `invoke(...)`。

数据库会为七种 definition 建立 seed，但 seed 的 `enabled=true` 只表示定义启用，不表示对应领域 Runtime、外部连接或 Agent access 已经 ready。

## 4. 当前唯一真实的 Integration MicroAPP

### `knowledge_query`

当前只有 `knowledge_query` 完成了统一 Integration invoke：

```text
WeCom smart robot
  -> Integration Instance
  -> wecom.smart_robot AccessPoint
  -> MicroApp binding
  -> knowledge_query
  -> thirdPartyRagAdapter.answer(...)
  -> text reply
```

当前边界：

- 只支持 `wecom.smart_robot`；
- binding 配置 `knowledgeBaseId`；
- 空问题返回 `no_reply`；
- 正常问题进入本地知识库 / RAG 链路；
- 返回单条稳定文本；
- 当前不把多轮 Agent、任意 Tool 或 Skill 自动带入机器人入口。

Integration API 当前也只公开 `knowledge_query` 的列表、启停、AccessPoint binding 和配置。

## 5. Registered Studio definitions

另外六个 definition 当前承担的是共享注册、桌面入口标识和稳定 runtime key。它们的 `MicroAppDefinition.invoke()` 会明确返回 Studio-only 或 not implemented，而真实能力运行在各自的领域 service 和 HTTP routes 中。

| Definition | 产品 / Runtime 当前事实 | Integration invoke |
| --- | --- | --- |
| `news_hub` | 有来源配置、抓取、TTL、去重、本地持久化、列表与搜索；可通过 `news_search` 进入 Harness | 未实现 |
| `image_generation` | 有 Provider 配置、持久任务、实时进度、Artifact、OpenAI-compatible 与 ComfyUI Studio | 未实现 |
| `computer_use` | 有 managed browser runtime、持久任务与 Evidence、模型执行器、审批和 Browser tools | 未实现 |
| `tts` | 有 Windows、Piper、GPT-SoVITS、API Provider、参考音频与合成 Artifact | 未实现 |
| `codegraph` | 有 CodeGraph Studio；Agent 通过 `codebase_explore` wrapper 使用受控能力 | 不承接外部调用 |
| `evolving_knowledge` | 有可选 service 与桌面 Studio，仍处于实验和演进阶段 | 不承接外部调用 |

这不是说六项能力“没有实现”，而是说：

> 它们的真实领域 Runtime 已经存在，但尚未统一接入企业集成 MicroApp invocation contract。

## 6. 独立 Studio / 服务成熟度

### Image Generation Studio

当前已经成立：

- 桌面调试入口；
- 生图任务创建与持久化；
- queued / running / succeeded / failed 状态；
- WebSocket 实时进度；
- 本地 Artifact 保存与内容读取；
- OpenAI-compatible 图片 Provider adapter；
- ComfyUI connection、flow、workflow mapping 和本地执行；
- 当前 ComfyUI 冒烟指引。

当前没有自动成立：

- 外部 AccessPoint 调用；
- Chat 自动生图；
- 通用 Agent 工具暴露；
- 任意 Provider 已验证兼容；
- 生产级队列、计费或资产管理。

### Computer Use Studio

当前已经成立：

- managed browser runtime 解析与安装（配置按平台分发：win32 → win64 包、darwin/arm64 → mac-arm64 包；其余平台显式无托管配置，不得伪装支持）；
- darwin 系统浏览器探测（`/Applications` 下的 Chrome / Edge）；
- Browser session 与结构化 browser tools；
- 持久任务、计划、Evidence 和 Artifact；
- `ComputerUseModelExecutor`；
- 高风险动作审批；
- 调试器与桌面 Studio；
- Agent 可按真实 availability 使用 Managed Browser tools。

当前边界：

- 核心执行面是受控浏览器，不是宿主桌面任意遥控；
- 浏览器 Runtime 未安装时不能伪装 ready；托管记录与本平台布局不一致时判无效（不得返回 ready-managed）；
- darwin x64 / linux 没有托管包配置，只能依赖系统浏览器，`installManagedRuntime` 会明确报错；
- Studio task 与 Main Agent tool execution 是相邻但不同的执行入口；
- `computer_use` definition 的统一 external invoke 仍未实现。

### TTS Studio

当前已经成立：

- Windows 内置语音；
- bundled Piper runtime；
- GPT-SoVITS Gradio bridge；
- OpenAI / OpenAI-compatible speech；
- 火山 openspeech 适配；
- voice catalog、provider config、reference audio、synthesis job 和输出 Artifact。

当前边界：

- Provider 配置存在不等于模型已验证可合成；
- Piper 并非兼容所有中文 voice pack；
- GPT-SoVITS 当前依赖用户已启动的本地上游；
- `tts` definition 不承接外部 AccessPoint invocation。

### News Hub

当前已经成立：

- 多来源配置与拉取；
- TTL、来源状态、去重和本地持久化；
- overview、refresh 和查询；
- `news_search` 读取本地 News Hub 缓存。

当前边界：

- `news_search` 不等于实时公网 `web_search`；
- 页面刷新和纯读取 Tool 的语义必须分开；
- `news_hub` definition 不承接外部 AccessPoint invocation。

### CodeGraph Studio

当前已经成立：

- Provider / runtime 配置和状态；
- 受控 Managed CodeGraph runtime；
- Harness 中的单一公共入口 `codebase_explore`；
- workspace source verification；
- provider 不可用时的结构化降级。

当前边界：

- Studio readiness 不等于 Agent E2E 成功；
- 原生命令不暴露给 Main Planner；
- `codegraph` definition 不承接外部 MicroApp invocation。

### 智识进化库

当前存在 service、数据库和桌面 Studio，但仍属于实验能力：

- 有真实产品与后端入口；
- 不等于已经形成稳定知识产品合同；
- 不承接外部 AccessPoint invocation；
- 不自动进入 Agent ToolExposure。

## 7. 产品中心中不属于 strict registry 的能力

以下入口出现在 MicroApps Hub，但不是当前七种 `MicroAppDefinition`：

### Mail Center

- 有多账号 SMTP / IMAP 配置；
- 密码加密存储；
- SMTP 诊断；
- IMAP 同步和本地缓存；
- 邮件列表与详情；
- Agent 通过独立 `mail_query` 能力受控读取。

Mail Center 是领域服务和产品入口，不需要为了进入 Agent 而伪装成 Integration MicroAPP。

### 文枢 / Office Suite

- 有 Office Studio；
- 有 `office-runtime.v1` 任务合同；
- DOCX / XLSX / PPTX / PDF 由 Skill-owned execution 和 private Runtime 使用；
- 不把 Office 原子操作扩散到 Main Planner 全局工具面。

文枢当前更准确的身份是：

```text
Product Studio
+ Domain Runtime
+ Skill-private Runtime
```

而不是七种 Integration MicroApp definition 之一。

### GitHub

- 微应用页面负责 Device Flow、installation、仓库授权范围和连接状态；
- Agent 能力由四个领域工具提供：`github_repository / github_issue / github_pull_request / github_actions`；
- GitHub 页面本身不是 Harness Tool，也不是 Integration MicroAPP。

### 问策 / External Expert

- 有 External Expert service、WebBridge 和 Provider adapter；
- 可连接用户已登录网页并发送咨询；
- 外部专家只提供建议，Mira 决定是否继续执行；
- 页面 ready 不等于 Provider 独立握手已经完成；
- Agent 通过独立工具能力使用它，不依赖 `MicroAppDefinition` registry。

### Notion

当前是部分实现：

- 连接配置、Token 校验、状态和部分 AccessPoint 资源能力已经存在；
- 完整 Agent Tool 投影、Policy / Evidence、知识库同步和前端完整管理仍未全部完成；
- 不能因为入口卡片存在就宣传为完整 Notion Agent。

## 8. Integration 子模型

企业集成继续使用：

```text
Platform
  -> Instance
    -> AccessPoint / Capability
      -> MicroApp Binding
        -> MicroAppDefinition.invoke(...)
```

当前事实：

- Provider 层目前只有 WeCom 标为 implemented；
- `wecom.smart_robot` 是当前可绑定业务工作流的真实 AccessPoint；
- 一个 Capability 当前只有一条 MicroApp binding；
- definition 与 binding 都必须 enabled；
- AccessPoint 类型必须出现在 `supportedAccessPoints`；
- binding config 属于具体接入点，不写回 definition 本体。

这套模型不能直接套到 Image Studio、TTS Studio、文枢或 GitHub 页面上。

## 9. 与 Tool / MCP / Skill 的边界

### Tool

Tool 是 Agent 能执行的 concrete action。一个 Studio 或 MicroApp 只有在独立注册成 Tool、满足 availability 并进入 Tool Exposure 后，Main Planner 才能调用。

### MCP

MCP 是能力发现和调用协议。MicroApp 可以消费或提供 MCP 相关能力，但页面存在、MCP connected 和 Agent Access 是不同事实。

### Skill

Skill 是领域知识与执行 Profile。文枢通过 Skill-owned SubAgent / private Runtime 工作，不需要把 Office Runtime 注册成全局 MicroApp invoke 或一排 Harness tools。

### Integration MicroAPP

Integration MicroAPP 接收标准化外部消息，运行绑定工作流并返回平台可消费回复。当前只有 `knowledge_query` 完成这一闭环。

## 10. 当前不变量

1. MicroApps Hub 不等于统一 Runtime registry；
2. definition seed 不等于 Runtime ready；
3. Studio route 不等于 external AccessPoint invocation；
4. 产品入口不等于 Agent access；
5. Agent access 必须来自明确 Tool 或 Skill contract；
6. Integration binding 不扩大 Main Planner ToolExposure；
7. private Runtime 不能绕过 Parent approval、workspace 和 audit；
8. 每项能力必须独立说明入口、Runtime、外部调用、Agent 接入和验证状态；
9. 旧 POC 不能覆盖已经落地的代码；
10. 真实 service 也不能被包装成已经生产成熟。

## 11. 当前文档阅读顺序

```text
current code + repeatable tests
  -> MICROAPP_CURRENT_TRUTH
  -> microapp/README
  -> concrete current contract / runtime notes / smoke guide
  -> project-control task / review / test evidence
  -> proposal / POC / historical archive
```

当前关键参考：

- `microapp/office-runtime-task-contract.md`；
- `microapp/wenshu-skill-runtime.md`；
- `microapp/tts-studio-runtime-notes.md`；
- `microapp/gpt-sovits-microapp-poc.md`；
- `microapp/image-generation-comfyui-smoke-guide.md`；
- `microapp/computer-use-frontend-manual-smoke-guide.md`；
- `microapp/github-capability-design.md`；
- `microapp/external-expert-bridge-design.md`；
- `microapp/notion-microapp-functional-design.md`。

## 12. 本轮不做

本轮只校正文档真相，不修改：

- MicroApp Runtime；
- Studio routes；
- Integration schema；
- Agent / Harness；
- Skill binding；
- 前端信息架构；
- 任何具体微应用功能。

后续若要统一产品术语或 Runtime abstraction，必须作为独立架构决策处理，不能靠改文档暗中完成。