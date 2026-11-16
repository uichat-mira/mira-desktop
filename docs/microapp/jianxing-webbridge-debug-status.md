# 触界 WebBridge 调试状态

Status: Current debugging record
Owner: browser-extension / runtime
Last verified: 2026-07-21
Layer: raw-source
Module: 触界 / WebBridge
Doc Type: debugging-status
Canonical: true

## 这页记录什么

这页记录触界当前在本地调试环境中的真实状态，供继续排查和评审使用。

这不是最终设计，也不是“已完成”说明。文档把已经观察到的事实、当前仍然不稳定的行为、未完成的能力和后续验证条件分开记录。

## 结论摘要

当前不能把浏览器连接称为完成：

- WebSocket 曾经完成过真实握手，但连接稳定性仍未达到验收标准。
- Native Messaging 的 Host framing、backend 鉴权失败路径和 launcher stdio 转发已经有可重复的本地 smoke 验证，但真实 Chrome `connectNative()` 用户流程仍未完成验收。
- 应用页面自身可以连接 `/webbridge`，但这不等于扩展已经连接。
- 扩展授权成功只代表授权码换取 token 成功，不代表扩展已经完成 WebSocket 或 Native Messaging 握手。
- 当前本地开发加载应使用 `mira-clipper-ext/` 根目录；`extension/` 子目录也有一份 manifest，但它会产生不同的扩展 ID，不能直接视为同一个运行实例。

## 本轮现场复核（2026-07-21）

本轮只复核了 Native 连接链路，没有把 WebSocket 的历史结果当作 Native 结果：

- 当前 Chrome 使用的 Default Profile 的 `Preferences` 中没有扩展注册项，扩展数量为 `0`，没有发现开发扩展 ID `omdcdmcedejkenmjmkepgpinnehhmfkj`。
- 当前系统没有运行中的 `MiraWebBridgeHost.exe`。
- Chrome Native Messaging 注册表项存在，manifest 指向 `D:\uichat-mira\mira-clipper-ext\dist\native\MiraWebBridgeHost.exe`，Host exe 和 `host.mjs` 文件均存在。
- 因此本轮没有观察到 `chrome.runtime.connectNative()` 被执行，也没有观察到 Native Host 启动、扩展 `hello`、backend 扩展会话登记或 UI 收到 `extension_connected`。
- 应用页面能连接 backend，只能证明 UI WebBridge 客户端存在；当前“等待扩展”与上述现场证据一致。

这意味着当前状态是“Native Host 已注册但 Native 未连接”，不是“Native 已接通”。上述 Profile 检查只代表当前 Chrome 选中的 Profile；如果用户实际加载扩展的是另一个 Chrome Profile，需要在那个 Profile 中重复检查。

## 连接拓扑

### WebSocket

```text
触界扩展 Service Worker
  └─ WebSocket /webbridge
       └─ Mira Fastify backend
            └─ 应用页面 WebBridgeClient
```

扩展和应用页面是两个独立的 WebSocket 客户端。扩展先发送 `hello`，后端返回 `hello_ack`；应用页面也需要独立发送自己的 `hello`。应用页面显示 `connected`，只能说明应用页面这一侧的 socket 已建立，仍需查看 `extensionConnected` 才能确认扩展在线。

### Native Messaging

```text
触界扩展 Service Worker
  └─ chrome.runtime.connectNative()
       └─ MiraWebBridgeHost.exe
            └─ host.mjs
                 └─ 本机命名管道 / Unix socket
                      └─ Mira Fastify backend 的 WebBridge 路由
```

Native Messaging 的 stdio 消息使用 Chrome 规定的 framing：4 字节消息长度，后接 UTF-8 JSON。Native Host 只连接本机 IPC；Mira backend 在同一应用进程内处理该连接并完成 `/webbridge` 的扩展会话登记。

Host 的当前状态边界：

- `native_ready` 只表示 Chrome 扩展与 Native Host 的 Port 已就绪；它不等待 Mira backend 注册完成。
- Host 通过本机命名管道（Windows）或 Unix socket（其他平台）接入 Mira。backend 暂时不可用时，Host 保持 Native Port，并使用有界指数退避重连本机 IPC。
- `mira_connecting` 仅表示 Host 正在同步 Mira backend。扩展侧栏仍显示 Native Host 已连接，不把它误报为 Native 正在连接。
- `hello_ack` 完成 backend 的扩展会话注册、工具和能力同步；它不决定 Native Host 是否存活。
- 扩展在 Service Worker 和 Side Panel 启动时会主动识别已到期的 JWT；backend 返回 `AUTH_REQUIRED` 时，Host 转发原始错误和一次 `auth_required` 状态。两种情况都会停止本机 IPC 重连、清理 token，并让 Side Panel 回到授权状态。
- 浏览器操作的执行资格同时要求扩展本地 JWT 有效，以及 Native Host 已连接并完成 Mira `hello_ack` 同步。缺少或过期 JWT 时进入授权入口；Mira 未启动或仍在同步时拒绝执行，但不删除仍有效的 JWT。
- backend 不只在 `hello` 校验 JWT。连接建立后收到的每条 WebBridge 消息都会重新验证原始 JWT；令牌过期后返回 `AUTH_REQUIRED`、通知客户端并关闭连接。
- 开发加载必须使用 `mira-clipper-ext/` 根目录。该 manifest 固定开发扩展 ID；`extension/` 子目录是打包源，单独加载会产生不同身份，Native Host 不会接受它。
- backend URL 无效时，Host 返回 framing 完整的错误状态，不进入重连循环。
- Chrome stdin 结束时，Host 才结束进程；Host 不通过 stdout 输出诊断日志。

## 当前配置来源

- backend host / port 的运行时来源是 `runtime.config.cjs`。
- 扩展不应在代码中固定 backend 端口。
- 授权码包含后端端口；扩展通过授权码解出 backend URL，再请求 `/oauth/token`。
- token 保存在扩展的 `chrome.storage.local`。
- backend URL 和连接方式保存在扩展的 `chrome.storage.sync`。
- 当前协议版本是 `1`。

## 已验证事实

### 应用端

- 本地 backend health 可访问。
- 应用页面可以连接 backend 的 `/webbridge`。
- 应用页面在扩展未上线时显示“等待扩展”，这是当前预期的可见状态。

### 扩展目录

当前仓库存在两种可被 Chrome 识别的加载目录：

| 加载目录 | Service Worker 路径 | 当前观察到的扩展 ID | 当前用途 |
| --- | --- | --- | --- |
| `mira-clipper-ext/` | `extension/background.js` | `omdcdmcedejkenmjmkepgpinnehhmfkj` | 当前本地开发加载目录，manifest 携带开发公钥 |
| `mira-clipper-ext/extension/` | `background.js` | 未固定，取决于加载方式和签名 | 打包源，不应作为当前开发扩展加载目录 |

这两个目录不是同一个 Chrome 扩展实例。Chrome 会根据 manifest 和目录内容分别加载它们。

### WebSocket

- 已在隔离 Chrome 配置中加载仓库根目录扩展。
- 使用本地有效登录 token 和授权后的 backend URL 写入扩展存储后，曾观察到扩展 Service Worker 的 WebSocket 状态为 `ready: true`。
- 该结果证明 WebSocket 协议链路在特定运行条件下可以完成握手。
- 该结果不证明连接可以长期保持，也不证明真实用户当前环境不会进入“等待扩展”。

### Native Messaging

- 直接运行 `host.mjs` 并发送合法 Native Messaging hello 后，历史上曾收到 `native_ready`，并可通过本机 IPC 收到 backend 返回的 `hello_ack`。
- 通过 `MiraWebBridgeHost.exe` 启动时，历史上曾出现没有收到 Native 返回帧的情况。
- 本轮真实 Chrome 现场没有启动 Host 进程，因此无法用本轮结果判断 launcher、Native framing 或本机 IPC 是否仍有问题。
- 当前 Native 仍未完成真实 Chrome 用户流程验收。

### 自动化检查

最近一次扩展侧检查结果：

- `npm run check`：通过。
- 扩展和 Native Host 契约测试：38 项通过。
- Side Panel / content script E2E：以当前测试输出为准。
- 使用本地 backend 的无效 token smoke：收到 `AUTH_REQUIRED` response 和一次 `auth_required` 状态，未观察到重复鉴权通知。
- 使用临时编译 launcher 的 framing smoke：`MiraWebBridgeHost.exe -> host.mjs` 能转发错误状态帧。
- 这些测试覆盖脚本语法、manifest、Side Panel、content script 和部分协议契约。
- 这些测试不等价于真实 Chrome 中的长期 WebSocket 稳定性，也不等价于 Native Messaging 安装、注册、启动和升级验收。

## 当前问题

### WebSocket 稳定性未达标

现象：

- 扩展有时可以完成握手，有时在应用页面显示“等待扩展”。
- 页面刷新、授权变化、切换连接方式、Service Worker 重新加载后，连接状态需要继续观察。
- 应用页面 socket 已连接时，扩展 socket 仍可能没有上线。

待满足的稳定性标准：

- 授权成功后一次完成连接，不依赖用户重复点击。
- 同一用户只保留一个有效扩展连接。
- WebSocket 断开后能重连，但不能产生连接风暴或重复 backend client。
- Service Worker 被 Chrome 暂停和恢复后能重新建立连接。
- 页面刷新、标签页切换和应用页面刷新不影响扩展主连接。
- token 过期时明确进入授权状态，不持续重连失效 token。
- 应用页面能持续收到 `extension_connected` / `extension_disconnected` 状态。

### Native Messaging 仍未完成真实验收

当前尚未完成以下闭环：

- Chrome 扩展调用 `connectNative()` 的真实用户流程。
- Chrome 启动安装目录中的 Native Host，并完成真实 `native_ready`、本机 IPC 同步和 `hello_ack` 验收。
- Native Host 正确继承 Chrome 的 stdin/stdout/stderr，并在真实 Chrome 流程下完成验证。
- Native Port 断开后 Host 退出且不会遗留旧进程的真实 Chrome 验收。
- Mira 升级后 Native manifest、launcher、host script 和扩展 ID 仍然匹配。
- 开发解压扩展、dev CRX、prod CRX 的 Native 注册边界清晰且可重复验证。

### 待 Mira 解决的疑问

以下不是已经确认的根因，而是需要 Mira 根据架构和实际运行环境确认的问题：

1. **为什么当前 Chrome Profile 没有扩展实例？**
   - Electron 的下载或授权流程是否只生成了 CRX/ZIP，却没有让用户明确加载解压目录？
   - 用户加载扩展后，是否加载到了另一个 Chrome Profile，导致 Electron 检查的 Profile 与用户测试的 Profile 不一致？
   - “加载 `D:\uichat-mira\mira-clipper-ext`”是否仍是当前推荐路径，还是应该由 Mira 提供明确的安装/更新入口？

2. **Native Host 的启动责任是否已经设计清楚？**
   - 当前实现要求扩展 Service Worker 执行 `chrome.runtime.connectNative()`；Electron 的“连接”按钮不能直接调用 Chrome 扩展 API。产品上是否应该取消这个按钮，改为显示“等待扩展连接”及具体诊断？
   - 授权成功后，扩展是否一定会通知 Service Worker 重连，并在重连后自动启动 Native Host？
   - 如果扩展已加载但 `connectNative()` 失败，真实的 `chrome.runtime.lastError` 是否能在侧栏和 Mira 页面可见？

3. **Native manifest 的开发边界是否需要调整？**
   - 当前 manifest 允许开发 ID `omdcdmcedejkenmjmkepgpinnehhmfkj` 和生产 CRX ID `dfmdfjipkdhegdgojlhkmlehnanljppg`。这是否与 Mira 当前实际加载的扩展签名一致？
   - 是否存在旧注册项、旧扩展 ID 或旧 Mira 用户目录，使得“Native 已安装”检查通过，但 Chrome 实际找不到当前扩展对应的 Host？

4. **界面状态是否需要拆成三层？**
   - `应用 UI ↔ backend`
   - `Chrome 扩展 ↔ Native Host`
   - `Native Host ↔ Mira backend`
   当前 UI 的“连接中/等待扩展”是否应分别显示这三层，而不是用一个 `connected` 状态承载全部含义？

在没有完成以下事实观测前，不应把 Native 标记为已完成：Host 进程启动、扩展发送 hello、backend 登记 extension client、UI 收到 `extension_connected`。

## 参考信息，不是已确认原因

下面的信息来自当前代码、真实运行观察和 Chrome 官方文档，只作为下一轮验证的参考，不在本页把它们写成已经确认的根因：

1. Chrome 官方 Native Messaging 文档要求 Windows Native Host 使用标准输入输出传输二进制 framing，并特别提醒文本模式可能破坏消息格式。
2. 当前 launcher 使用 C `CreateProcess` 启动 `host.mjs`，需要继续验证子进程标准句柄的继承方式。
3. 当前 Native manifest 的 `allowed_origins` 是固定扩展 ID；解压目录和不同签名 CRX 的扩展 ID 需要继续统一验证。
4. Chrome MV3 Service Worker 存在暂停和恢复生命周期，连接状态机需要在真实 Chrome 长时间运行中验证。
5. Native Host 由 `connectNative()` 启动并由 Port 生命周期管理，Host 退出、断开和重复启动需要增加进程级观测。

官方参考：[Chrome 原生消息传递](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。

## 推荐验证顺序

按下面顺序验证，避免把两套传输机制的结果混在一起：

1. 只加载 `D:\uichat-mira\mira-clipper-ext` 根目录扩展。
2. 完成授权后记录扩展 Side Panel、Service Worker 和 Mira 页面三处状态。
3. 保持同一个授权 token，验证应用页面刷新、扩展重新加载、Chrome 放置一段时间后的重连行为。
4. 清理旧 Native Host 进程后，再单独选择 Native Messaging。
5. 查看 Chrome 扩展错误、Native Host 进程树、Native manifest 的 `allowed_origins` 和 backend WebSocket client 数量。
6. 最后分别验证 dev CRX、prod CRX 和解压扩展，不把其中一种 ID 的结果套用到另一种。

## Native 完成验收条件

Native 只有同时满足以下条件，才能标记为完成：

- Chrome `connectNative()` 能稳定收到 Native Host 返回的 `native_ready`；Mira 本机 IPC 恢复时无需重建 Native Port，并能随后收到 `hello_ack`。
- backend 能看到一条对应扩展 client，且没有重复 client 持续增长。
- 切换 Native / WebSocket 后旧通道会关闭，新的通道只建立一次。
- Native Host 断开时进程可以退出，不遗留旧 launcher 或 Node 子进程。
- 授权过期后进入可见授权状态，重新授权后能恢复连接。
- Mira 升级后点击“修复 Native”即可更新 Host 注册，不需要用户手工编辑注册表。
- 解压开发目录和发布 CRX 的 ID / Native 注册规则已经写入构建和安装检查。

## 相关代码

- `mira-clipper-ext/manifest.json`
- `mira-clipper-ext/extension/manifest.json`
- `mira-clipper-ext/extension/background.js`
- `mira-clipper-ext/extension/auth/authorize.js`
- `mira-clipper-ext/native-host/host.mjs`
- `mira-clipper-ext/native-host/launcher.c`
- `server/src/routes/webbridge.ts`
- `desktop/src/shared/api/webbridge.ts`
- `electron/main.cjs`
