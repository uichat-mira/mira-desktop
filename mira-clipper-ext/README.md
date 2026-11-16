# 触界

> 当前 Native Messaging Host 的生产运行时说明
>
> - 用户不需要安装 Deno，也不需要安装 Node.js。
> - 安装包携带一个很小的 `MiraWebBridgeHost.exe` launcher，Chrome 直接启动这个 exe。
> - launcher 再启动 Mira 安装包自带的 `node.exe host.mjs`，生产用户不需要安装 Deno 或 Node.js。
> - Deno 不参与当前 Native Host 构建；构建机使用 GCC 编译 launcher。

This directory contains the Vanilla JS browser collector for the Evolving Knowledge micro-app. The extension performs basic page extraction and sends captures directly to UIChat Mira; it does not start a backend or run Python/Node services.

触界是一个纯 Vanilla JS Chrome 扩展：连接浏览器与 UIChat Mira，包含 Agent 浏览器操作“见行”和用户主动采集“剪藏”两项能力。

扩展不启动后端、不运行 Python 或 Node 服务，也不负责数据库写入。浏览器操作由本地 Mira 应用协调，剪藏数据入库和 AI 整理由 UIChat Mira 负责。

## 目录结构

```
.
├── DESIGN.md                   # 历史系统设计参考
├── EXTENSION_DESIGN.md         # 扩展设计
└── extension/                  # Chrome 扩展（Vanilla JS，零构建）
│   ├── manifest.json
│   ├── background.js
│   ├── content/
│   │   └── content.js
│   ├── popup/
│   │   ├── popup.html             # Chrome Side Panel 页面
│   │   ├── popup.css
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js
│   ├── lib/
│   │   └── authorization-code.js
│   └── icons/
│       └── README.md
```

## 快速开始

从项目根目录启动 Electron 开发环境时，根启动脚本会先准备 Native Host，再生成开发版扩展包。单独运行扩展目录的开发命令也会准备 Native Host：

```bash
pnpm --dir mira-clipper-ext dev
```

开发命令在 Native Host 已被 Chrome 占用时会复用现有 exe，不会阻塞整个开发环境启动；发布构建使用严格的 `npm run native:build`，仍会在 exe 被占用时直接报错，避免发布包带入旧 launcher。

### 加载 Chrome 扩展

Chrome → `chrome://extensions/` → 打开"开发者模式" → "加载已解压的扩展程序" → 选择本项目根目录 `mira-clipper-ext/`。

不要加载 `extension/` 子目录。开发时只加载 `mira-clipper-ext/` 根目录；根目录 manifest 携带开发公钥，因此未打包扩展固定使用开发 ID `omdcdmcedejkenmjmkepgpinnehhmfkj`。Native Host 注册清单同时允许开发 ID 和打包 CRX ID，不能混用其他目录或旧扩展实例。

### 连接方式

触界生产连接固定使用 **Native Messaging**。扩展调用 `chrome.runtime.connectNative()`，Chrome 启动 Mira 安装的 `MiraWebBridgeHost.exe`，Host 再通过本机 IPC 连接 Mira。

连接状态分为两层：`native_ready` 表示 Chrome 已连接 Native Host；随后 Host 通过本机 IPC 向 Mira 重新同步。backend 返回 `hello_ack` 后，Mira 才登记扩展会话并同步工具和能力。Mira 短暂重启或 IPC 重连不应让 Chrome 误判 Native Host 已断开。

WebSocket 实现仍保留在代码中，作为内部开发和兼容通道，但不再出现在 Mira、触界侧栏或扩展设置中，用户不能选择或切换到该通道。

Native Messaging 的安装由 Mira 桌面端完成。桌面端会把 Host 和 manifest 写入用户目录，并注册 Chrome Native Messaging 注册表项。升级 Mira 或切换扩展 ID 后，需要重启 Mira，并在触界设置中执行一次“修复 Native”，让注册清单刷新。未安装、扩展 ID 不匹配或版本不匹配时，扩展不会静默切换到另一种连接方式，而是显示明确错误。

### Side Panel 与连接生命周期

点击触界工具栏图标会打开 Chrome 右侧 Side Panel。侧栏包含“见行”和“剪藏”两个分区：见行显示当前页面、连接状态和 AI 浏览器操作；剪藏保留用户主动编辑和保存流程。连接由触界扩展的 Service Worker 主动维护，不由 Mira 桌面端打开 `chrome-extension://` 页面唤醒。Mira 页面中的“连接”按钮只连接本地 WebBridge UI 通道，并显示扩展是否已经在线。

### 授权入口

触界扩展点击工具栏图标后打开 Chrome 右侧侧栏。未授权时直接在侧栏粘贴 Mira 生成的一次性授权码；侧栏从授权码解出 backend URL，换取访问令牌并保存到扩展存储，然后通知 Service Worker 连接。授权成功后回到 Mira 点击“连接”即可开始烟测。授权失效时侧栏回到授权状态，不创建新的授权标签页。

- 扩展安装、Chrome 启动或授权码更新时，Service Worker 自行建立连接。
- Native Messaging 由扩展调用 `chrome.runtime.connectNative()` 启动；Native Port 断开后，扩展使用指数退避重新连接。
- Native Host 连接 Mira 失败时保持 Native Port，并通过本机 IPC 使用有界指数退避重连；Chrome Port 断开时 Host 才退出。
- Service Worker 和 Side Panel 会主动识别已到期的 JWT，收到 `AUTH_REQUIRED` 时也会立即清理令牌并停止重连；用户在扩展授权入口重新授权。
- 每次见行浏览器操作、剪藏规则读取/保存和区域选择前，扩展都会再次确认 JWT 存在且未过期，并确认 Mira 已完成 WebBridge 同步；缺少或过期 JWT 会打开侧栏授权入口，Mira 未启动或尚未同步时拒绝操作并提示先启动 Mira。
- backend 会在 WebBridge 握手后的每条消息上重新验证连接携带的 JWT；长连接不会因为首次 `hello` 成功就永久拥有操作资格。令牌失效时 backend 会发送 `AUTH_REQUIRED` 并关闭该连接。
- 用户主动剪藏仍只通过触界侧栏、快捷键或右键菜单触发，不属于 WebBridge 工具。

### Native Host 构建现状

开发机执行：

```bash
npm run native:build
```

该命令调用 `scripts/build-native-host.mjs`，使用 GCC 编译小型 launcher，生成：

```text
dist/native/MiraWebBridgeHost.exe
```

这一步要求构建机安装可用的 Windows C 编译器。它只影响构建机，不代表生产用户需要安装 Deno 或 Node.js。

当前 Native Host 的链路是：

```text
Chrome 扩展
  -> Native Messaging
  -> MiraWebBridgeHost.exe
  -> Mira 本机 IPC 命名管道
  -> UIChat Mira
```

Native Messaging 使用 stdin/stdout 传输带 4 字节长度前缀的 JSON；诊断信息只能写入 stderr，不能写入 stdout，否则会破坏 Chrome 的消息 framing。

### 生产发布边界

生产安装包应包含以下内容：

- Chrome 扩展资源（发布文件名为 `Chujie.crx`）
- `MiraWebBridgeHost.exe`
- Native Messaging manifest
- Mira 自带的运行时和安装/修复逻辑

生产用户不应被要求准备 Deno、Node.js、固定后端端口或手工注册表配置。后端地址和凭证由 Mira 的授权流程及运行时配置提供，Native Host 不硬编码端口。

注册时 Mira 将 manifest 写入用户目录，但 manifest 的 `path` 直接指向安装包内的 launcher；因此不需要让用户下载或复制 exe。升级 Mira 后重新点击“修复 Native”即可更新 manifest 指向新的安装包路径。

### 运行测试

```bash
npm test
npm run check
```

## 核心原则

- **浏览器内基础清洗，洞见后端统一入库**
- 扩展零构建，只有 Vanilla JS
- 扩展不启动服务，不包含后端运行时
- 只向配置的本地 UIChat Mira 地址发送数据

## URL 剪藏规则

触界支持按完整 URL 模式保存剪藏规则，规则保存在 Chrome 的 `chrome.storage.sync` 中，不会进入 WebBridge 工具面，也不会改变用户主动剪藏的触发方式。

- 每条规则必须填写 URL 通配符或正则，匹配完整的 `location.href`，因此可以按路径、查询参数或 hash 区分同一网站的页面。通配符模式支持 `*`（任意长度）和 `?`（一个字符）；也可以切换到正则模式。
- 域名级旧规则已废弃，不会再参与匹配；读取或保存规则时扩展会将其从同步存储移除。
- 同一页面命中多条规则时，扩展会遍历全部候选，以 URL 模式的字面约束强度和模式长度选出最具体的一条。更具体的停用规则会作为明确例外，使该范围回到默认提取。
- 用户在 Mira 的“剪藏”tab 中点击“选择正文区域”或“添加排除区域”，然后直接在 Chrome 页面上高亮、扩大到上一级、确认或取消。
- 页面点选完成后，Mira 显示区域标签、文字预览、元素数量和图片数量；用户不输入也不会看到 CSS 选择器。
- 规则还可以设置该 URL 范围专属的图片最小尺寸和数量上限，并可启用、停用或删除。
- 图片数量上限由该规则的 `imagePolicy.maxCount` 决定，默认及最大值均为 50。保存时扩展在当前页面的登录态中读取图片，并以最多 3 个并发请求上传为本地附件；单张图片上限为 8 MB。
- 图片无法读取、超过单张上限或上传失败时，其他图片仍会继续保存。失败图片会记录在本次剪藏元数据中，且不会以可能失效的远程链接写入正文。
- 未配置、停用、内部定位失效或正文区域不存在时，剪藏回退到现有默认正文提取器。
- 触界侧栏会显示当前命中规则的别名；规则管理统一位于 Mira 的“剪藏”tab。

规则内部仍保存页面定位信息，用于扩展再次访问该网站时找到对应区域。该字段不是用户配置接口：

```json
{
  "regex:^https://example\\.com/articles/\\d+$": {
    "alias": "文章详情页",
    "urlPattern": "^https://example\\.com/articles/\\d+$",
    "urlPatternMode": "regex",
    "enabled": true,
    "includeSelector": "article",
    "includeRegion": {
      "tag": "article",
      "text": "文章正文开头的可读预览",
      "elementCount": 42,
      "imageCount": 3
    },
    "excludeSelectors": [".comments", ".recommendations"],
    "imagePolicy": {
      "minWidth": 100,
      "minHeight": 100,
      "maxCount": 20
    }
  }
}
```

## 文档索引

- [系统设计](DESIGN.md) — 架构、数据模型、Text2SQL 场景
- [扩展设计](EXTENSION_DESIGN.md) — manifest、Side Panel UI、通信协议
