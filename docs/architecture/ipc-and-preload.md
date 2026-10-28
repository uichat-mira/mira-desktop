# IPC 与 Preload 指南

Status: Current
Owner: runtime
Last verified: 2026-06-25
Layer: raw-source
Module: Develoments
Feature: NativeBridge
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - ../platform/tauri.md

## 单点真相范围

这页文档统一说明：

- renderer 与 native capability 的边界
- preload 当前暴露的最小契约
- 什么情况下该用 IPC，什么情况下该直接走 backend HTTP

相关概念：

- [[CONCEPT_RUNTIME]]
- [[CONCEPT_PLATFORM]]
- [[AREA_MAP_RUNTIME]]

## 基本原则

renderer 代码是不受信任的。native 能力和 runtime 配置应通过 preload 暴露，而不是直接在 renderer 开 Node API。

当前项目使用 HTTP 访问 backend API。IPC 只保留给桌面 / native 能力，以及少量 runtime 信息暴露。

renderer 应通过单一适配层读取 host / runtime 细节，而不是在业务代码里直接分支判断 `window.desktopApi`、Tauri 全局变量或 `file:` URL。

## 当前 preload 契约

当前 Electron preload 暴露的核心 runtime 信息包括：

- `platform`
- `isPackaged`
- `backendUrl`

Electron 直接暴露 Node 平台值，Windows 为 `win32`、macOS 为
`darwin`。Tauri 当前仍只实现 Windows 的 `win32` 合同；后续接入
macOS 时应把 Rust 的 `macos` 映射为 `darwin`，renderer 不应感知
Rust 平台字符串。

这类信息用于让 renderer 判断当前运行上下文，但不应把更多业务逻辑堆回 preload。

### Native Messaging 状态

触界的 Native Messaging Host 是本机集成能力，由桌面壳层检查，不由 renderer 推测或缓存：

- Electron IPC：`desktop:get-native-host-status`
- Tauri command：`get_native_messaging_host_status`
- renderer 统一通过 `desktopRuntime.getNativeMessagingHostStatus()` 调用

返回状态为 `installed`、`not_installed`、`repair_needed` 或 `unsupported`。检查会验证 Chrome 注册表、Native manifest、Host exe 和同目录 `host.mjs`；页面进入、安装和解除注册后都重新读取该状态。

## DSK-005 Cloud Account native boundary

Electron main process exclusively owns the Mira Cloud OAuth 2.0 Authorization
Code + PKCE transaction and the OS-encrypted Cloud Session record. The
renderer only receives redacted status and the user-selected Remote V1 scope
labels; it never receives a bearer token, authorization code or PKCE verifier.
The local Desktop JWT, user database, workspace ownership, Provider/MCP keys,
Remote V1 Tailscale pairing and cloud account remain separate.

- Native callback: `mira-desktop://oauth/callback`, registered by the packaged
  Electron app and checked for exact URI, one pending state, and single use.
- Native Electron IPC: `cloud-account:status`, `cloud-account:login`,
  `cloud-account:cancel-login`, `cloud-account:retry-host`,
  `cloud-account:reset-credentials`, `cloud-account:logout`; preload
  exposes only the narrow `window.cloudAccount` wrapper and redacted
  subscription. Host-setup retry uses the existing encrypted Cloud Session
  and the original encrypted scope selection; server-side Host policy remains
  authoritative. A broken encrypted local record can be reset **only by an
  explicit user action**, which cannot claim remote session revocation.
- Cloud Auth source: `https://cloud-auth.tomzlab.cn`; credentials must never
  be written to React storage, the backend SQLite database, or logs.
- Cloud Auth requests use Electron's Chromium network stack (`net.fetch`),
  not Node/undici `fetch`; certificate verification stays enabled with
  platform defaults. **Historical diagnosis (Electron 31 / Chromium 126 /
  Node 20):** the then-current edge reset Node TLS 1.3 ClientHellos before an
  HTTP response, while Chromium could negotiate the required hybrid key exchange.
  This observation explains the original transport choice, not the current TLS
  capability of Electron 45 / Node 24 or the edge configuration. Validate any
  renewed handshake failure against the actual installed versions and endpoint.
- Desktop sign-in requests the external system browser, exchanges the OAuth code,
  registers its installation as a Cloud Desktop Host, and sets the owner's initial
  Host scope ceiling. No hosted Relay ticket or Tool execution authority is
  derived from this alone.
- The OS secret store must be available; plaintext fallbacks are forbidden. If
  Cloud is unreachable, the local Desktop account and its other transports remain
  usable. Cloud credential revocation is not reported as confirmed if the server
  could not be contacted.
- Tauri remains a separately implemented shell and must fail visibly rather than
  storing tokens in WebView storage as an implicit fallback.
- Manual packaged-app callback smoke remains required on Windows/macOS before
  claiming native end-to-end acceptance.

## 什么时候该走 HTTP

这些场景优先走 backend HTTP：

- 业务 API
- 健康检查
- 模型配置
- 线程、消息、知识库、评测等产品能力

一句话说：只要本质上是 backend route，就不该包装成 IPC。

## 什么时候该走 IPC / preload

这些场景才适合走 IPC 或 preload：

- 原生窗口能力
- 本地文件 / shell / 桌面集成
- runtime 环境信息暴露
- 不适合直接暴露给 renderer 的 native capability

## 当前禁止事项

- renderer 直接访问 Node API
- 在业务组件里散落读取 `window.desktopApi`
- 用 IPC 包一层普通 HTTP 路由
- 把 host / port 常量写死在前端代码里

## 相关文档

- `README.md`
- `api-response-spec.md`
- `model-config-api.md`
