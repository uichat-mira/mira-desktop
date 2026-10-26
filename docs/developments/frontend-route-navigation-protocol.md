# 前端路由与导航协议

Status: Current
Owner: frontend
Last verified: 2026-07-02
Layer: current-contract
Module: Developments
Feature: FrontendRouteNavigation
Doc Type: current-contract
Canonical: true
Related:
  - README.md
  - ../architecture/README.md
  - request-wrapper.md
  - ../../desktop/src/app/router.tsx
  - ../../desktop/src/app/routes/settingsRoutes.tsx
  - ../../desktop/src/app/layouts/BaseLayout/layoutShared.tsx

## 这页解决什么问题

这页统一定义前端路由、设置侧边栏导航、深层子页高亮和分组来源的协议。

它的目标不是介绍 React Router 用法，而是明确：

- 哪些文件持有路由真相
- 哪些字段决定导航入口是否出现在侧边栏
- 哪些字段决定导航分组、排序和高亮
- 深层子页应该如何归属于顶层导航入口
- 新增或调整设置页时，哪些文件必须一起更新

这份协议主要针对 `desktop/` 前端。

## 当前扫描结论

截至 2026-07-02，前端路由结构的事实如下：

1. 全局路由入口在 `desktop/src/app/router.tsx`
2. 当前顶层认证内路由只有三条主线：
   - `/`
   - `/chat`
   - `/settings`
3. 设置页子路由真相集中在 `desktop/src/app/routes/settingsRoutes.tsx`
4. 设置侧边栏入口已经复用 `settingsRoutes.tsx` 中的 `nav` 元数据生成
5. 但设置侧边栏的“分组规则”仍硬编码在 `desktop/src/app/layouts/BaseLayout/layoutShared.tsx`

也就是说，当前系统已经完成了一半收口：

- “有哪些设置页”基本来自 route tree
- “这些设置页属于哪个侧边栏分组、按什么顺序展示”还没有正式协议

这就是本协议要收口的问题。

## 当前前端路由总览

### 顶层路由

当前顶层 Hash Router 结构如下：

| 路径 | 说明 | 真相文件 |
| --- | --- | --- |
| `/` | 认证后首页 | `desktop/src/app/router.tsx` |
| `/chat` | 聊天工作区 | `desktop/src/app/router.tsx` |
| `/settings` | 设置工作区壳层 | `desktop/src/app/router.tsx` |
| `/cloud-account` | 独立云账号页面，从手机图标菜单进入 | `desktop/src/app/routes/standaloneRoutes.tsx` |
| `/login` | 游客态登录页 | `desktop/src/app/router.tsx` |

### 设置工作区路由

当前 `settingsRoutes.tsx` 中已存在这些设置页路径：

| 路径 | 是否侧边栏入口 | 备注 |
| --- | --- | --- |
| `/settings/general` | 是 | 顶层入口 |
| `/settings/model-setting` | 是 | 顶层入口 |
| `/settings/knowledge-base` | 是 | 顶层入口，下面还有深层页 |
| `/settings/knowledge-base/add` | 否 | 深层页 |
| `/settings/knowledge-base/detail` | 否 | 深层页 |
| `/settings/roles` | 是 | 顶层入口 |
| `/settings/evaluation/center` | 是 | 顶层入口 |
| `/settings/evaluation/center/new` | 否 | 深层页 |
| `/settings/development` | 是 | 顶层入口，下面还有深层页 |
| `/settings/development/logs` | 否 | 深层页 |
| `/settings/development/database` | 否 | 深层页 |
| `/settings/development/client-tests` | 否 | 深层页 |
| `/settings/development/server-tests` | 否 | 深层页 |
| `/settings/development/docs` | 否 | 深层页 |
| `/settings/development/api-docs` | 否 | 深层页 |
| `/settings/development/base-information` | 否 | 深层页 |
| `/settings/mcp` | 是 | 顶层入口 |
| `/settings/integrations` | 是 | 顶层入口 |
| `/settings/tools` | 是 | 顶层入口 |
| `/settings/about` | 是 | 顶层入口 |

### 手机图标菜单（2026-10-26）

手机图标复用知识库入口的 `DropdownMenu` 交互，包含“远程连接”（`/remote-access`）和“云账号”（`/cloud-account`）。任一页面激活时，手机图标高亮，菜单对应项目显示选中状态。

云账号页面及测试位于 `desktop/src/features/CloudAccount/`，使用应用级 `AppPageLayout` 和 `StandaloneWorkspace`。设置导航及 `/settings/account` 路由已移除，原 `Settings/pages/Account/` 目录不再保留。此迁移只改变前端入口和页面归属，不改变云账号登录、权限或连接协议。

## 协议目标

前端路由与导航协议必须满足下面几条：

1. 路由真相只有一份
2. 设置侧边栏入口真相只有一份
3. 设置分组和排序不允许继续写死在 layout 组件里
4. 深层子页必须能稳定归属于一个顶层导航入口
5. 新增设置页时，默认行为必须可预测
6. 测试必须覆盖“路由存在”“导航存在”“深层子页不会误暴露”

## 正式协议

### 1. 全局路由真相

- 顶层工作区路由真相统一在 `desktop/src/app/router.tsx`
- 某个工作区内部的子路由真相应集中在对应 route 模块
- 当前设置工作区的子路由真相统一在 `desktop/src/app/routes/settingsRoutes.tsx`

禁止做法：

- 在布局组件里再维护第二套路由路径常量
- 在页面组件里直接拼一套“隐式路由注册表”
- 用多个平行列表同时声明“页面存在”和“导航存在”

### 2. 设置导航入口真相

设置侧边栏只允许消费 `settingsRoutes.tsx` 里声明了 `nav` 的节点。

规则如下：

- 有 `nav`：该 route 节点是一个“导航入口”
- 没有 `nav`：该 route 节点只是路由节点，不自动进入侧边栏

因此：

- `development` 是导航入口
- `development/logs` 不是导航入口
- `knowledge-base` 是导航入口
- `knowledge-base/detail` 不是导航入口

### 3. 设置导航元数据协议

`SettingsRouteNavMeta` 应承载的职责不再只限于文案和图标。

正式字段协议如下：

```ts
type SettingsNavGroup =
  | "general"
  | "basic"
  | "knowledge"
  | "app"
  | "other";

type SettingsNavMatchMode = "exact" | "prefix";

type SettingsRouteNavMeta = {
  labelKey: string;
  icon: LucideIcon;
  group: SettingsNavGroup;
  order: number;
  match?: SettingsNavMatchMode;
};
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `labelKey` | 侧边栏显示文案的 i18n key |
| `icon` | 侧边栏图标 |
| `group` | 导航分组归属 |
| `order` | 分组内排序值，越小越靠前 |
| `match` | 当前路由命中策略；默认应按 `exact` 处理，深层页归属型入口使用 `prefix` |

### 4. 设置导航分组协议

设置侧边栏分组标题不是路由树的一部分，而是导航展示协议的一部分。

当前允许的正式分组只有：

| group | 标题 key | 当前语义 |
| --- | --- | --- |
| `general` | 无独立分组标题 | 顶部单独入口 |
| `basic` | `settings.navigation.basicConfig` | 基础配置 |
| `knowledge` | `settings.navigation.knowledgeGroup` | 知识与评测 |
| `app` | `settings.navigation.appGroup` | 应用 |
| `other` | `settings.navigation.otherGroup` | 其他 |

约束：

- `group` 是协议字段，不再通过 `item.to === "/settings/xxx"` 这类路径判断推导
- layout 组件只负责按 group 渲染，不负责决定某个入口属于哪个 group
- 分组标题文案统一由 i18n 提供

### 5. 深层子页归属协议

深层子页可以没有 `nav`，但必须能归属于一个顶层导航入口。

这里要区分两类页面：

#### 5.1 独立入口页

例如：

- `/settings/mcp`
- `/settings/tools`
- `/settings/about`

这些路径本身就是侧边栏入口，通常使用 `match: "exact"`。

#### 5.2 归属型入口页

例如：

- `/settings/development`
- `/settings/knowledge-base`
- `/settings/evaluation/center`

这些入口下面还会挂深层子页，因此顶层入口应使用 `match: "prefix"`。

示例：

- 当前路径是 `/settings/development/logs`
- 侧边栏仍高亮 `/settings/development`

再例如：

- 当前路径是 `/settings/knowledge-base/detail`
- 侧边栏仍高亮 `/settings/knowledge-base`

### 6. 侧边栏高亮协议

设置侧边栏不能只依赖 `NavLink` 默认的“完全命中”行为。

原因是：

- 有些入口需要只在完全命中时高亮
- 有些入口需要在深层子页命中时也保持高亮

正式规则：

- `match: "exact"`：只在 `pathname === to` 时高亮
- `match: "prefix"`：在 `pathname === to` 或 `pathname.startsWith(to + "/")` 时高亮

对于带 query 的页面，高亮判断只看 `pathname`，不看 `search`。

因此：

- `/settings/knowledge-base?knowledgeBaseId=...` 仍归属 `/settings/knowledge-base`
- 不要把 query 参数作为导航高亮判定真相

### 7. route tree 组织协议

设置 route tree 可以继续使用嵌套 children，但要遵守下面的结构边界：

- 路由层负责真实页面层级
- `nav` 负责导航入口元数据
- 不要把“分组节点”伪装成真正的 route 节点

允许：

- `development` 作为真实路由节点，下面挂 `logs`、`database` 等 children

不建议当前阶段引入：

- 纯粹为了侧边栏分组而制造的假 route 节点
- 让 router 同时承担“路由层”和“视觉分组层”的双重树结构

### 8. 设置导航构建协议

设置导航项应通过 route tree 派生，不应由 layout 手工维护第二份映射。

正式流程应是：

1. `settingsRouteTree` 定义 route 与 nav meta
2. `buildSettingsRouteObjects()` 产出 React Router `RouteObject[]`
3. `buildSettingsNavigationItems()` 只提取有 `nav` 的入口节点
4. `SettingsNavigation` 按 `group`、`order`、`match` 渲染

这意味着：

- `settingsRoutes.tsx` 是设置工作区的路由与导航入口真相
- `layoutShared.tsx` 只做展示逻辑，不再持有路径硬编码分桶

## 对当前实现的约束结论

### 当前符合协议的部分

- `desktop/src/app/router.tsx` 已集中声明顶层路由
- `desktop/src/app/routes/settingsRoutes.tsx` 已集中声明设置子路由
- 设置侧边栏入口已由 route tree 派生
- 深层开发页当前不会误进入侧边栏

### 当前不符合协议的部分

`desktop/src/app/layouts/BaseLayout/layoutShared.tsx` 里仍存在按路径硬编码分组的逻辑，例如：

- `item.to === "/settings/model-setting"`
- `item.to === "/settings/tools"`
- `item.to === "/settings/mcp"`

这层硬编码应逐步删除，并迁移到 `SettingsRouteNavMeta.group` 与 `order`。

## 新增或修改设置页时的必做清单

当新增、移动或重命名设置页时，必须检查以下项目：

1. `settingsRouteTree` 是否新增或调整了对应 route
2. 是否需要成为侧边栏入口
3. 若需要成为入口，是否补齐：
   - `labelKey`
   - `icon`
   - `group`
   - `order`
   - `match`
4. 若只是深层页，是否明确不应暴露在侧边栏
5. i18n 文案是否同步
6. route/nav 相关测试是否同步

## 测试协议

下面三类测试是必需的：

### 1. route tree 测试

验证某条页面路径确实存在于 route objects 中。

例如：

- `mcp` route 存在
- `integrations` route 存在
- `development/logs` route 存在

### 2. navigation item 测试

验证某条入口会出现在侧边栏导航项中。

例如：

- `/settings/mcp` 出现在 navigation items
- `/settings/development` 出现在 navigation items

### 3. hidden child route 测试

验证深层子页不会被误暴露为单独导航入口。

例如：

- `/settings/development/logs` 不能单独出现在 settings sidebar
- `/settings/knowledge-base/detail` 不能单独出现在 settings sidebar

## 迁移建议

建议按下面的顺序推进，不要混着改：

1. 给 `SettingsRouteNavMeta` 增加 `group`、`order`、`match`
2. 给所有当前有 `nav` 的设置入口补齐元数据
3. 让 `useSettingsNavigationItems()` 返回完整导航协议字段
4. 把 `layoutShared.tsx` 中的路径硬编码分组删除
5. 改为通用分组渲染
6. 补 route/nav/highlight 测试

## 明确禁止

- 不允许继续在 sidebar layout 里按路径字符串手写分组规则
- 不允许为导航分组再维护一份独立 schema 作为第二真相
- 不允许把 query 参数当成导航归属真相
- 不允许把深层子页默认暴露成新的侧边栏入口
- 不允许在新增设置页时只加 route 不补 nav 协议判断

## 一句话总结

前端设置导航的正式口径应是：

“路由层级由 route tree 表达，导航入口由 `nav` 元数据声明，分组/排序/高亮都从 `nav` 协议字段派生，layout 不再持有路径硬编码真相。”
