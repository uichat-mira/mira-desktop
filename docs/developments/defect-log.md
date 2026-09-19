# 缺陷台账（Defect Log）

Status: Current
Owner: bugfix
Last verified: 2026-06-26
Layer: raw-source
Module: Develoments
Feature: DefectTracking
Doc Type: implementation-notes
Canonical: true
Related:
  - README.md
  - ../knowledge-system/AI_READING_SCOPE.md

## 目的

记录当前已经确认的问题、影响范围、临时状态与下一步排查方向。

## 2026-06-27

## 2026-07-10

### TTS Studio 内置 Piper runtime 不兼容 `phoneme_type=pinyin` 中文包

- Layer: runtime / microapp / TTS / bundled Piper
- Status: Confirmed
- Severity: Medium for Piper provider stability

现象：

- `TTS Studio` 中切到 `Piper`
- 更换部分中文语音包后保存可通过，但点击合成会失败
- 典型错误为：
  - `"[piper] [error] \"ai\" is not a single codepoint (ids=30,)"`

已确认边界：

- 这不是 `onnx` 路径填写错误
- 这不是 provider 启用状态错误
- 这不是页面表单问题
- 这不是单纯因为测试文本里含英文
- 这是当前内置 `Piper runtime` 与部分中文语音包类型不兼容

当前判断：

- 当前项目内置 `Piper` 为 Windows `2023.11.14-2`
- 当前链路稳定支持：
  - `phoneme_type=espeak`
- 当前链路不稳定或不支持：
  - `phoneme_type=pinyin`
- 已确认可用示例：
  - `zh_CN-huayan-medium`
- 已确认不兼容示例：
  - `zh_CN-xiao_ya-medium`

影响：

- 当前版本不能把 `Piper` 路线描述成“稳定支持所有中英文语音包”
- 用户容易误把问题判断成模型路径、测试文案或前端配置错误
- 如果不明确支持边界，后续会重复在 UI 层和表单层误修

已完成进展：

- 已把 `Piper` 运行时改成 `TTS` 微应用私有资源目录
- 已把开发态路径解析收敛到工作区根目录
- 已补 provider 启用态修正
- 已在保存链路增加 `phoneme_type` 校验，当前只接受 `espeak`
- 已单独补运行时说明文档：
  - [tts-studio-runtime-notes.md](../microapp/tts-studio-runtime-notes.md)
- 已正式登记技术债决策：
  - [TD-TTS-01 Piper Phoneme Compatibility Gap](../project-control/decisions/TD-TTS-01-piper-phoneme-compatibility-gap.md)
  - [TD-TTS-02 TTS 音频持久化可见性缺口](../project-control/decisions/TD-TTS-02-audio-persistence-visibility-gap.md)

下一步：

- 如果产品只要求当前版本稳定，继续明确 `Piper` 只支持 `espeak` 包
- 如果产品要求 `Piper` 稳定覆盖更多中文包，需要单独处理运行时兼容能力，不要继续在 UI 层修补

### Micro Apps 设置页知识库卡片消失

- Layer: backend / microapp registry / persistence compatibility
- Status: Confirmed
- Severity: Medium for Settings / Micro Apps visibility

现象：

- `Settings / Micro Apps` 页面仍然请求 `knowledge_query`
- 但已有“知识库”微应用卡片可能不显示
- 页面会出现已有 studio 卡片和“还没有可用微应用”提示并存的异常感知

已确认边界：

- 这不是前端接口改成了两套协议
- 这不是知识库微应用被产品移除
- 这不是 Planner 或 Agent Runtime 主链问题
- 这是旧 `micro_app_definitions` 记录缺少新字段后的兼容问题

当前判断：

- 同一接口 `/integrations/micro-apps?type=knowledge_query` 仍在使用
- 旧 `knowledge_query` 记录可能缺少：
  - `supportedAccessPoints`
  - `bindingSchema`
  - `runtimeKey`
- 列表接口会按 `wecom.smart_robot` 访问点过滤
- 因此旧记录会被后端静默过滤，前端拿到的列表为空

影响：

- owner 会误以为知识库微应用被删掉
- 微应用定义字段以后继续扩展时，可能再出现同类“接口成功但卡片消失”的隐性回归

已完成进展：

- 已在 `microAppsRepository.initialize()` 增加对已知 seed 类型的最小回填
- 已补仓库测试和路由测试，覆盖旧 `knowledge_query` 定义恢复显示
- 已单独登记技术债：
  - [TD-T016-01 MicroAPP Definition Reconcile Gap](../project-control/decisions/TD-T016-01-microapp-definition-reconcile-gap.md)

下一步：

- 评估是否需要把 `micro_app_definitions` 升级为显式 schema migration
- 给微应用定义字段演进补一组旧库样本回归，而不是只靠 seed 回填
- 在债务关闭前，不要把“接口返回 200”当作“微应用定义完整可见”的证据

### Chat Agent `terminal_session` 启动失败

- Layer: runtime / harness / terminal capability
- Status: Confirmed
- Severity: High for Agent local-tool scenarios

现象：

- 在普通聊天中启用 `Agent`
- 模型选择 `terminal_session` 后
- execution trace 显示 tool 节点失败
- 错误为：`spawn powershell.exe ENOENT`

已确认边界：

- 这不是 RAG 问题
- 这不是 Role / Summary 注入问题
- 这不是模型正文生成问题
- 这不是 `del 222.txt` 之类具体命令语法问题
- 这是 terminal capability 在启动 shell 进程时失败

当前判断：

- 终端 runtime 依赖 `powershell.exe`
- 当前运行环境里该可执行文件没有被正确解析
- 可能是 PATH 丢失、shell 路径硬编码不稳，或 capability runtime 没按当前平台做稳健解析

影响：

- Agent 已经能看到并选择内置 terminal 能力
- 但 terminal 类任务无法真正执行
- 用户会在 timeline 中直接看到 tool fail

已完成进展：

- Agent / chat tool-loop 主链已接通
- built-in tool surface 已对 Agent 放开
- external MCP 仍未暴露给 Agent
- 小上下文模型在 Agent 工具判定阶段的历史裁剪已加入

下一步：

- 检查 `terminal_session` runtime 的 shell 解析策略
- 明确 Windows 下是否允许：
  - 直接解析绝对 PowerShell 路径
  - 在 `powershell.exe` 不可用时切换到 `pwsh.exe`
  - 或通过统一 shell resolver 收口
- 修复后补 capability 级单测和 chat 侧回归验证

### 生图尺寸未持久化到服务商配置

- Layer: image generation / provider configuration persistence
- Status: Confirmed technical debt
- Severity: Medium for image generation configuration reuse

现象：

- 生图界面可以选择输出尺寸；
- 但选择结果没有稳定写入对应服务商配置；
- 刷新页面、重新进入或聊天链路复用服务商配置时，尺寸可能恢复为默认值或丢失。

边界：

- 这是生图服务商配置持久化问题；
- 不属于 T003 聊天媒体 UI 阻断；
- 不修改已完成的 T001/T002/T003 行为作为临时规避。

下一步：

- 核对尺寸字段在生图表单、Provider 保存接口、数据库配置和读取回填链路中的字段名与归属；
- 补 Provider 配置保存/刷新回填测试；
- 补聊天侧复用当前服务商尺寸配置的回归测试；
- 单独建立修复任务后再关闭本技术债。

## 2026-09-08

### macOS 下 Computer Use 浏览器会话创建失败（表现为 "Playwright 调用不起来"）

- Layer: runtime / microapp / computer-use / managed browser
- Status: Confirmed
- Severity: High for macOS computer-use browser scenarios

现象：

- macOS 上创建 Computer Use 浏览器会话失败
- 错误为 `browserType.launch: Failed to launch: Error: spawn .../managed/chromium-152.0.7948.0/chrome-win64/chrome.exe EACCES`
- 用户感知为 Playwright 无法调用

已确认边界：

- 这不是 Playwright 模块加载问题：`playwright-core@1.61.1` 按 `server/src/microapps/computer-use/executor/playwright.ts` 的加载路径在 macOS 上可正常解析并取得 `chromium.launch`
- 这不是 Electron / preload / IPC 边界问题
- 这是 computer-use 浏览器运行时层的平台缺口，共三处：
  - `DEFAULT_MANAGED_CHROMIUM_CONFIG` 只固定了 win64 的 chrome-for-testing 包
  - `createDefaultSystemBrowserPaths()` 只探测 Windows 的 chrome.exe / msedge.exe
  - `inspectManagedRuntime()` 不校验记录与当前平台可执行文件相对路径的一致性
- 本机 `server/.artifacts/computer-use/runtime/managed/` 存在 2026-08-29 安装的 win64 托管包，`chrome.exe` 实测为 `PE32+ executable (GUI) x86-64, for MS Windows`，通过现有元数据校验被判 ready，但 macOS 无法执行
- Playwright 自带 Chromium 同样不可用：本机缓存只有 1148/1234 版本，当前 `playwright-core@1.61.1` 需要 1228（备用路径，与本缺陷无直接因果关系）

影响：

- macOS 上 Computer Use 浏览器会话、browser tools、Debugger 浏览器闭环全部不可用
- 即使清掉错误的托管安装，系统浏览器探测也找不到本机已安装的 `/Applications/Google Chrome.app`
- Windows 行为不受影响

已完成进展：

- 已定位运行时层三处平台缺口并完成最小复现（模块加载正常、托管启动 EACCES、自带 Chromium 版本不匹配）
- 已登记修复任务卡：[microapp_T123](../project-control/tasks/microapp_T123-computer-use-browser-runtime-platformization.md)
- 已登记运行时合同变更决策：[TD-T118-01](../project-control/decisions/TD-T118-01-computer-use-browser-runtime-platform-gap.md)
- T123 已实施并通过验证：托管 Chromium 配置按平台分发（win64 / mac-arm64，mac sha256 来自真实下载计算）、darwin 系统浏览器探测、托管元数据平台一致性校验、macOS 解压权限恢复；定向测试 16 项通过，`darwin-arm64` 实机以 playwright-core 真实启动托管 Chrome for Testing 152.0.7948.0 与系统 Chrome 均成功
- 本机错误安装的 win64 托管运行时已清理（`server/.artifacts/computer-use/runtime/managed/`）

下一步：

- Windows 侧未实机复测，仅合同级回归（配置值与探测路径不变 + 测试覆盖）；Windows 实机复测在下一轮 Windows 任务包中顺带完成
- darwin x64 / linux 托管包配置保持显式缺失（按 TD-T118-01），出现平台需求时再立项
