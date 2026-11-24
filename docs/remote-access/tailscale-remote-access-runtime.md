# Tailscale 远程连接运行时设计

> 状态：首个可执行版本
> 目标分支：`feature/tailscale-remote-access-runtime`
> 基线：`dev`
>
> 本页只记录 Direct（Tailscale）运行时。Transport 选择和配对合同以
> Mobile `dev` canonical 文档为准：
> `uichat-mira-mobile@dev:docs/remote-access/remote-connection-canonical-v1.md`
>（同步日期：2026-08-26）。

## 1. 目标

Direct Transport 通过同一 Tailnet 访问运行在桌面端的 Mira Host。Tailscale 负责私网可达与节点身份基础，Mira 继续负责应用登录、会话权限、工具审批和设备撤销。

该功能不是通用远程桌面，也不通过 Funnel 暴露公网。

```text
uichat-mira-mobile
        │
        │ Tailnet / MagicDNS / HTTPS
        ▼
Tailscale Serve
        │
        │ localhost reverse proxy
        ▼
Mira Host
        ├── HTTP API
        ├── WebSocket / SSE
        ├── App authentication
        └── Agent approval and evidence
```

## 1.1 Desktop 登录模式（DSK-018）

Desktop 的远程访问模式与 Mira Cloud 账号互斥，唯一权威来源是 Electron Main
持有的原生 Cloud Session 生命周期，而不是 Relay 连接状态、renderer 开关或
本地持久化标记：

| 原生状态 | Direct 模式 | 行为 |
| --- | --- | --- |
| `signed_out` / `rejected` | 允许 | 创建配对挑战、领取/批准、已配对设备请求 |
| `signed_in` | 禁止 | 远程访问由 Mira Cloud 提供；Mira 暂停自己拥有的 Serve 暴露 |
| `restoring`（`checking` / `authorizing` / Cloud 暂时不可达但保留会话） | 禁止 | 等待权威结论，界面显示确认中 |
| `unknown`（未完成恢复、凭据不可读或没有 native IPC） | 禁止 | 失败关闭，界面显示状态未知 |

- 只有明确确认的 `signed_out` 才会放行 Direct。网络中断、Relay 断开或 Host
  未完成配置都不会被解释成退出登录。
- 已配对的 Direct 设备记录与设备凭据不会被删除；登录期间的请求在认证入口
  返回 `403`，退出登录后无需重新配对即可恢复使用。
- 登录期间重启 Desktop 时，恢复完成前一律按 `unknown` 处理，避免启动窗口内
  把“尚未确认”当成已退出。
- 同一规则在运行时强制执行：配对挑战/领取/审批/轮询与已配对设备业务请求都会
  被拒绝，旧 URL 即使仍可达也不会绕过认证入口。本地 Desktop JWT 与官方 Cloud
  一次授权路径不受影响。
- Mira 只关闭自己独占管理的 Tailscale Serve 入口；不关闭系统 Tailscale、
  不修改其他 Serve/Funnel 配置，也不从 Mira 模式推断整机 VPN 状态。确认退出后
  若用户此前已启用 Mira Serve，会尝试恢复该入口。
- Mobile 0.4.0 A2 边界：该互斥只约束“同一台 Desktop 上的 Direct 远程访问模式”。
  Mobile 自身登录 Mira Cloud 与使用另一台已退出 Cloud 的 Desktop 的 Direct 服务
  不互斥；本文件不改变 Mobile 账号语义，也不新增 Mobile 端开关。
- 已知限制：登录发生时已经建立的 Direct 长连接（例如进行中的 Chat SSE 或工具
  SSE）不会被强制中断；新的请求与配对准入会被拒绝。若需要强制终止现有流，
  需要另一项跨运行时改动。

## 2. 首版范围

首版必须形成以下真实闭环：

1. 检测本机是否安装并登录 Tailscale。
2. 从 `tailscale status --json` 自动读取设备名、MagicDNS 名称、Tailnet 与 Tailscale IP。
3. 检测当前 Tailscale Serve 配置，不通过字符串拼接伪造访问地址。
4. 启用时使用 Tailscale Serve 将 Mira Host 的 localhost 端口发布到 Tailnet。
5. 禁用时仅撤销由 Mira 独占管理的 Serve 入口，不重置或覆盖用户已有的其他 Serve 配置。
6. 从最终 HTTPS 地址请求 `/health`，给出可访问或不可访问的验证结果。
7. 持久化“是否启用”配置；切换网络、重启页面后可恢复当前状态。
8. 展示诊断信息与已配对设备入口；设备认证协议由 mobile 与 Host 的后续契约完成。

## 3. 明确不做

- 不启用 Tailscale Funnel。
- 不把 ADB、Mira 后端端口或任意调试端口裸露到公网。
- 不自动修改 Tailnet ACL / Grants。
- 不把“同处一个 Tailnet”视为已经通过 Mira 应用认证。
- 不在检测失败时根据输入框拼出一个看似可用的 URL。
- 不使用 `tailscale serve reset`，避免清理用户已有的 Serve 配置。

## 4. 状态机

运行时状态由真实检测结果产生：

| 状态 | 含义 | 用户动作 |
| --- | --- | --- |
| `not_installed` | 找不到 Tailscale CLI | 安装 Tailscale |
| `needs_login` | CLI 存在，但尚未加入 Tailnet | 登录 Tailscale |
| `connecting` | 后端状态正在切换或节点尚未在线 | 稍后重新检查 |
| `connected` | Tailnet 已连接，远程入口未启用 | 保存并启用 |
| `serve_conflict` | 已存在非 Mira 独占管理的 Serve 配置 | 人工处理冲突，不自动覆盖 |
| `serve_not_configured` | 配置要求启用，但 Serve 尚未生效 | 重新保存或查看诊断 |
| `unreachable` | Serve 已配置，但远程健康检查失败 | 检查 Host、证书与策略 |
| `ready` | Tailnet、Serve 与 `/health` 均正常 | 手机可连接 |
| `error` | 其他不可归类错误 | 查看诊断信息 |

界面不应把所有失败都压成一枚“未连接”。

## 5. Serve 管理策略

Mira 只管理一个明确的 localhost 目标：

```text
http://127.0.0.1:<Mira Host port>
```

启用前先读取：

```bash
tailscale serve status --json
```

规则：

- 当前没有有效 Serve 配置：允许创建。
- 当前配置只包含 Mira Host 目标：视为 Mira 独占管理，可幂等启用或安全关闭。
- 当前配置包含其他目标，或同时包含 Mira 与其他目标：返回 `serve_conflict`，拒绝覆盖或关闭。
- `{ "TCP": {}, "Web": {}, "AllowFunnel": false }` 一类结构性空对象不视为有效配置。

启用命令：

```bash
tailscale serve --bg --yes --https=<serve port> 127.0.0.1:<Mira Host port>
```

禁用命令仅在当前配置确认由 Mira 独占管理时执行：

```bash
tailscale serve --https=<serve port> off
```

若未来需要与用户已有的根路径 Serve 共存，应改为独立 Tailscale Service 或经过验证的专用监听端口；在完成该契约前不得静默接管现有配置。

## 6. 安全边界

网络层与应用层必须分开：

- **Tailscale**：节点加入 Tailnet、MagicDNS、TLS、ACL / Grants。
- **Mira**：账号认证、设备凭证、会话范围、工具审批、撤销与审计。

首版远程入口仍复用现有 Mira Bearer 认证。后续 mobile 配对应签发独立设备凭证，而不是复制桌面端登录 Token。

危险操作仍由 Harness 审批。手机只提供审批入口，不能绕过 exact invocation、checkpoint 或 Evidence。

## 7. API 契约

### 获取状态

```http
GET /general-settings/tailscale-remote-access
```

返回：持久化配置、运行时状态、自动识别的 DNS / IP、访问地址、Serve 状态、诊断信息、已登记设备，以及非机密的 `cloudRemoteAccess` 投影（`mode` 与 `directAllowed`）。只有 `mode: "signed_out"` 时 `directAllowed` 为 `true`。

### 主动检查

```http
POST /general-settings/tailscale-remote-access/check
```

重新执行 CLI 检测与远程 `/health` 请求。

### 启用或禁用

```http
PUT /general-settings/tailscale-remote-access
Content-Type: application/json

{ "enabled": true }
```

服务端先执行安全检查与 Serve 变更，成功后持久化；失败时不把界面状态伪装成已启用。

### 撤销设备

```http
DELETE /general-settings/tailscale-remote-access/devices/:id
```

设备表与真实设备凭证校验将在 mobile 配对协议实现时接通。首版仅建立可撤销的数据契约，不生成虚假的配对码。

## 8. UI 行为

- 设备名、Tailnet 与访问地址均来自运行时，只读展示。
- “启用远程连接”先修改草稿，点击“保存设置”才触发系统变更。
- “检查连接”必须调用后端，不允许本地延迟后自行显示成功。
- 保存和检查期间禁用重复操作。
- 后端错误原样转为可读提示；Serve 冲突需要明确告诉用户 Mira 没有覆盖现有配置。
- 已配对设备为空时展示真实空状态，不生成示例设备。

## 9. 后续 mobile 配对契约

该部分不在本次首版中伪实现，但接口设计必须为它保留边界：

1. 桌面端生成短时、单次使用的配对挑战。
2. mobile 在 Tailnet 内提交挑战与自身公钥。
3. 桌面端明确确认设备名称和权限。
4. Host 签发可独立撤销的设备凭证。
5. 每次连接记录设备 ID、最近活动与权限范围。
6. 撤销后正在进行的连接应失效，不能只删除 UI 列表。

## 10. 验收标准

- 未安装 Tailscale 时显示 `not_installed`，页面不崩溃。
- 已登录时自动显示真实 DNS 名称和 Tailscale IP。
- 存在非 Mira 或混合 Serve 配置时，启用与禁用操作都失败，原配置不被修改。
- 启用成功后重载页面仍显示启用，且 `/health` 检查成功时状态为 `ready`。
- 禁用只撤销确认由 Mira 独占管理的 Serve 入口。
- 所有系统命令均使用参数数组执行，不拼接 shell 字符串。
- 前后端均有覆盖状态解析、冲突保护、保存和错误展示的测试。
