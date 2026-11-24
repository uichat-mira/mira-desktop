# Desktop Remote Access Product Config

Status: Current
Supersedes: legacy self-hosted Relay product config
Related: `relay-transport-v1.md`, `tailscale-remote-access-runtime.md`, `cloud-relay-ticket-ipc-v0.md`

> DSK-017 retired the Desktop's legacy paired/self-hosted Relay on
> **2026-11-24**. Pairing is **Tailscale Direct only**. The official Mira Cloud
> Relay remains an independent account/ticket/Host Grant path and is not
> configured from this page.

## 用户入口

远程连接的产品入口统一位于：

```text
设置 -> 远程连接
```

界面保持最小：

```text
Tailscale                          [开关]

已配对设备
```

该页面不再提供 Mira Relay 开关、默认/自定义 Relay 地址或 Relay 连接状态。

## Tailscale Direct

用户只配置：

- 是否启用 Tailscale 远程入口。

Desktop 通过 Tailscale Serve 发布本机 Host，并且只绑定本机回环地址。设备名、
MagicDNS、Serve 冲突检查与 `/health` 验证仍由 Tailscale runtime 负责。

配对挑战只有在 Tailscale Direct 状态为 `ready` 且存在访问地址时才能创建。
二维码只包含 Direct 字段：

```text
host
challenge
code
version=1
```

不再存在 Relay-only 配对，也不在二维码或配对响应中携带 `relay`、`relayId`
或 `relayToken`。

## 官方 Mira Cloud Relay

官方 Cloud Relay 不属于本页面的用户配置：

- 由已验证的 Mira Cloud 账户和原生 Host ticket 自动激活；
- 使用自己的 Host Grant 与共享 Relay frame 引擎；
- 不读取 Desktop 旧 Relay 的 relay ID、host token 或 client token；
- 失败时 fail closed，不回退到旧 Relay 或 Tailscale。

详见 `cloud-relay-ticket-ipc-v0.md` 与 `relay-transport-v1.md`。

## 已退役的旧 Relay

以下行为已删除，且不会通过兼容层恢复：

- 旧的 `remote_relay_settings` 持久化配置与加密 token；
- `/remote/admin/relay/config` 与 `/remote/admin/relay/status`；
- `UI_CHAT_REMOTE_RELAY_*` 与 `UI_CHAT_REMOTE_RELAY_DEFAULT_URL` 配置入口；
- 旧 Host/Client static token 准入与握手分支；
- 旧 Relay-only pairing challenge。

升级时会通过幂等迁移删除 `remote_relay_settings` 表，避免旧的启用配置或
token 在启动后继续产生网络 I/O 或被重新生成。Tailscale Direct 设备身份、
Cloud 账户/Host Grant 与无关数据不受影响。
