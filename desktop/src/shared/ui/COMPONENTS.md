# 共享 UI 组件说明

> 目录：`desktop/src/shared/ui`
>
> 所有组件默认遵循语义化 token、浅/深色兼容、轻量交互反馈和可访问性优先的原则。

## 目录

- `Button`
- `Alert`
- `Result`
- `AvatarPicker`
- `Badge`
- `Card`
- `SectionCard`
- `CodeBlock`
- `CoverageReportPanel`
- `CompactAudioPlayer`
- `CollapsiblePanel`
- `Drawer`
- `ExternalLink`
- `ErrorBoundary`
- `Divider`
- `DropdownMenu`
- `ExpandableSection`
- `FileIcon`
- `FileListItem`
- `FileUploadDropzone`
- `FullPageStatus`
- `ImagePreviewOverlay`
- `IconButton`
- `Input`
- `Message`
- `MarkdownEditor`
- `Markdown / Long-form Content`
- `Modal`
- `NavItem`
- `NavigationCardTabs`
- `SearchSelectModal`
- `Skeleton`
- `Select`
- `SegmentedTabs`
- `StatusIndicator`
- `StepIndicator`
- `StreamingTextRenderer`
- `Switch`
- `TabCard`
- `Table`
- `Tooltip`
- `TerminalPanel`
- `TextArea`
- `WelcomePanel`

## 设计约束

> 重要约束：
>
> - 默认风格必须保持紧凑，慎用大圆角、厚阴影和大面积卡片堆叠
> - 业务页不要直接发明 `rounded-2xl`、`rounded-3xl` 这类大圆角默认值
> - 圆角分层统一使用：`rounded-ui-control`、`rounded-ui-panel`、`rounded-ui-overlay`、`rounded-ui-hero`

- 优先使用语义 token，例如 `bg-surface-primary`、`text-text-secondary`、`border-border`
- 共享组件内不直接依赖 `gray-*`、`slate-*`、`blue-*` 作为主视觉方案
- 需要主色层级时，优先使用 `primary-1` 到 `primary-9`
- `pampas-*` 与 `cloudy-*` 属于扩展氛围色阶，不替代 `surface-*`、`text-*`、`border`
- 可交互组件必须保留 `focus-visible`
- 所有组件都应天然兼容浅色 / 深色主题与主题预设切换
- 组件默认服务于“低噪音、高可读、可回看”的 AI 工作流，不做炫技型视觉
- 共享组件优先承接页面重复样式，不鼓励在业务页反复手写同类 `className`
- 复杂业务页优先抽离可复用组件，减少页面级样式重复和视觉漂移
- 卡片和大圆角要慎用，默认风格应相对紧凑，靠留白、字号和层级建立结构
- 圆角分层建议统一使用：控制 `rounded-ui-control`、内容面板 `rounded-ui-panel`、浮层 `rounded-ui-overlay`、英雄/欢迎区 `rounded-ui-hero`
- 业务页不要再直接发明新的大圆角值，除非确有独立视觉理由并经过评审

## 色彩体系速记

当前共享组件依赖的主要 token 分类如下：

| 分类 | 典型 token | 主要用途 |
| --- | --- | --- |
| 品牌主色 | `primary`、`primary-hover`、`primary-1~9` | 主操作、焦点、选中、轻强调 |
| 结构层级 | `surface-primary`、`surface-soft`、`surface-secondary`、`surface-elevated`、`border` | 页面、轻微区隔、卡片、浮层、描边 |
| 文本图标 | `text-*`、`icon-*` | 文本与图标层级 |
| 扩展氛围 | `pampas-*`、`cloudy-*` | 柔和承托、边框灰阶、欢迎区 |
| 状态反馈 | `success`、`warning`、`danger`、`info` 及其 `*-soft` / `*-border` / `*-text` | 校验、结果、风险反馈 |

共享组件默认配色规则：

- 主体容器优先 `surface-*`
- 轻微区隔的分区底色使用 `surface-soft`；默认暖中性浅色值为 `#F5F0E8`
- 正文与标题优先 `text-*`
- 边框统一优先 `border`
- 焦点和选中优先 `primary`
- 状态色只做结果反馈，不做主结构色
- 状态容器优先使用 `*-soft + *-border + *-text`，纯 `success/warning/danger/info` 主要留给点、图标和强调值

共享组件默认排版规则：

- 正文优先清楚和稳定，不追求纤细或花哨字形
- 长文本、说明、日志、JSON、代码各自使用稳定字体角色
- 当组件内同时出现标题、正文、辅助说明时，优先靠字号、字重、留白建层，不靠颜色堆层

## Button

用于主操作、次操作和危险操作。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | - | 按钮内容 |
| `variant` | `"primary" \| "secondary" \| "outline" \| "ghost" \| "success-ghost" \| "info-ghost" \| "danger" \| "danger-ghost" \| "link"` | `"secondary"` | 视觉变体 |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "small" \| "medium" \| "large"` | `"md"` | 尺寸，兼容旧写法 |
| `disabled` | `boolean` | `false` | 禁用态 |

### 色彩约束

- `primary`：`bg-primary text-white hover:bg-primary-hover`
- `secondary`：`bg-surface-primary border-border text-text-primary`
- `outline`：透明底，仅保留 `border + text`
- `ghost`：适合轻次级操作，默认 `text-text-secondary`
- `success-ghost`：轻成功操作，使用 `success-soft + success-text`
- `info-ghost`：轻信息操作，使用 `info-soft + info-text`
- `danger`：仅用于危险确认和不可逆操作
- `danger-ghost`：危险幽灵按钮，默认只用于破坏性次级操作
- `link`：只用于行内文本动作，不承担主要 CTA，不再额外做按钮壳

## Alert

用于页面内的状态提示、校验结果、风险说明和可回看的系统反馈。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `variant` | `"info" \| "success" \| "warning" \| "danger"` | `"info"` | 状态语义 |
| `title` | `React.ReactNode` | - | 提示标题 |
| `children` | `React.ReactNode` | - | 提示正文 |
| `icon` | `React.ReactNode` | 内置图标 | 自定义图标，传 `null` 可隐藏 |
| `action` | `React.ReactNode` | - | 右侧轻量操作 |
| `onClose` | `() => void` | - | 提供后显示关闭按钮 |
| `closeAriaLabel` | `string` | `"Close alert"` | 关闭按钮可访问名称 |

### 色彩约束

- `info`：`border-info-border bg-info-soft text-info-text`
- `success`：`border-success-border bg-success-soft text-success-text`
- `warning`：`border-warning-border bg-warning-soft text-warning-text`
- `danger`：`border-danger-border bg-danger-soft text-danger-text`

### 使用建议

- 用于页面内稳定存在的提示；短暂浮层反馈继续使用 `Message`
- 状态色只表达语义反馈，不替代页面主结构色
- 标题与正文仍使用 `text-*` 建立阅读层级，避免整块文字过度染色
- 操作区域建议放轻量按钮或链接，不承载复杂表单

## Result

用于承载页面结果区域，支持空结果提示和透明内容列表。组件默认使用 `min-h-0 flex-1`，适合放在固定工具栏或吸顶筛选器之后填充剩余空间。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `"empty" \| "content"` | `"empty"` | 结果类型；`empty` 显示空态，`content` 直接承载 children |
| `variant` | `"info" \| "success" \| "warning" \| "danger"` | `"info"` | 空结果提示的语义状态 |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 空态的垂直留白、图标徽标和文字尺寸 |
| `title` | `React.ReactNode` | - | 空结果标题 |
| `description` | `React.ReactNode` | - | 空结果说明 |
| `icon` | `React.ReactNode` | 信息图标 | 空结果图标 |
| `action` | `React.ReactNode` | - | 空结果操作 |
| `children` | `React.ReactNode` | - | 有结果时直接承载内容，不额外包裹卡片 |
| `className` | `string` | `""` | 结果区域样式 |

### 使用建议

- 有结果时传入透明列表或工作区内容，避免卡片套卡片
- 无结果时使用 `title` 与 `description`，空态采用无边框居中布局，状态颜色只表达结果语义
- 放在吸顶工具栏之后时，保留 `min-h-0 flex-1`，让结果区填满剩余空间

## AvatarPicker

用于选择系统内置头像，适合“当前值预览 + 打开弹窗挑选”的设置场景。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `value` | `string \| null` | - | 当前选中头像 id |
| `options` | `AvatarPickerOption[]` | - | 可选头像列表，支持直接传服务端图片 URL |
| `onChange` | `(option) => void` | - | 确认选择后的回调 |
| `onClear` | `() => void` | - | 清空头像回调 |
| `label` | `React.ReactNode` | - | 字段标题 |
| `hint` | `React.ReactNode` | - | 字段说明 |
| `title` | `React.ReactNode` | 内置文案 | 弹窗标题 |
| `placeholder` | `React.ReactNode` | 内置文案 | 未选择时的占位文本 |
| `disabled` | `boolean` | `false` | 禁用态 |
| `allowClear` | `boolean` | `false` | 是否显示清空动作 |
| `emptyText` | `React.ReactNode` | 内置文案 | 搜索结果为空时的文案 |
| `searchPlaceholder` | `string` | 内置文案 | 搜索框占位文案 |

### 使用建议

- 组件本身只消费头像元数据，不感知具体页面业务
- `options[].src` 直接传服务端地址即可，不要求本地静态资源
- 适合内置头像选择，不承担上传、裁剪和自定义图片编辑

## ExpandableSection

用于页面内的“更多 / 收起”折叠块，适合承载默认隐藏的辅助说明、示例或附加反馈。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | - | 折叠内容 |
| `collapsedLabel` | `React.ReactNode` | `"More"` | 收起态触发文案 |
| `expandedLabel` | `React.ReactNode` | `"Collapse"` | 展开态触发文案 |
| `defaultExpanded` | `boolean` | `false` | 初始是否展开 |
| `contentClassName` | `string` | `""` | 内容容器样式 |
| `triggerClassName` | `string` | `""` | 触发按钮样式 |

### 使用建议

- 默认用于承载次级信息，不要把主要表单或关键校验藏进折叠区
- 触发文案优先保持简洁，例如“更多 / 收起”“查看示例 / 收起示例”
- 内容区样式通过 `contentClassName` 传入，避免组件内部写死业务间距

## CollapsiblePanel

用于“摘要在上，详情折叠”的信息块，适合工具列表、执行详情、检查结果等需要默认收起的次级内容。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `React.ReactNode` | - | 面板标题 |
| `meta` | `React.ReactNode` | - | 标题下方的辅助信息 |
| `children` | `React.ReactNode` | - | 展开后的详情内容 |
| `defaultExpanded` | `boolean` | `false` | 初始是否展开 |
| `className` | `string` | `""` | 外层容器样式 |
| `headerClassName` | `string` | `""` | 头部按钮样式 |
| `contentClassName` | `string` | `""` | 详情内容样式 |

### 使用建议

- 适合把“数量摘要 + 明细列表”收在一个面板里
- 标题区域应承担主要摘要，不要只放“展开/收起”
- 详情默认用于次级信息，避免把关键主操作藏进去

## Badge

用于轻量状态、来源、计数和上下文标签。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `variant` | `"neutral" \| "primary" \| "success" \| "warning" \| "danger" \| "muted"` | `"neutral"` | 通用视觉变体 |
| `size` | `"sm" \| "md"` | `"sm"` | 胶囊尺寸 |
| `outline` | `boolean` | `false` | 是否使用透明底描边样式 |

### 使用建议

- 只承接通用胶囊视觉，不承接复杂业务状态机
- 业务语义很强的状态徽章仍放业务域组件中
- 不要在业务页继续手写大批 `rounded-full + px + text-xs + bg-*`

## IconButton

用于工具栏、行内操作和图标触发器。

### 约束

- 必须提供 `ariaLabel`
- 默认保持轻量，不承担主操作角色
- 尺寸统一跟随按钮体系：`xs / sm / md / lg`
- 视觉统一通过 `styleType` 和 `tone` 组合，而不是业务页自己拼 `className`
- 默认使用 `ghost + default`，危险图标操作使用 `ghost + danger` 或 `outline + danger`

## ErrorBoundary

用于捕获渲染树中的未处理异常，并提供简洁的恢复界面。

### 当前行为

- 渲染错误时展示全页级兜底界面
- 提供 `重试` 与 `刷新应用` 两个恢复操作
- 保留错误详情折叠区，方便本地排查
- 视觉上遵循低噪音卡片式反馈，不抢主任务焦点

### 色彩建议

- 结构仍以 `surface-*`、`border` 为主
- 错误相关强调可用 `danger/5`、`danger/20`、`text-danger`
- 不使用大面积纯红底

## Card

用于信息分组、摘要展示和轻量配置面板。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `variant` | `"default" \| "subtle" \| "dashed" \| "ghost"` | `"default"` | 默认面板、浅底分组、虚线空态、无壳容器 |
| `padding` | `"none" \| "sm" \| "md" \| "lg"` | `"md"` | 统一内边距尺度 |
| `interactive` | `boolean` | `false` | 是否启用轻 hover 提示 |

### 使用建议

- 信息卡片优先使用 `label + value + description`
- 复杂区域优先使用 `children`
- 仅在确实可点击时增加明显 hover
- 优先使用 `bg-surface-primary border-border shadow-shadow-sm`
- 不要为了分区而无意义增加卡片层
- 尽量控制圆角和阴影的存在感，默认保持紧凑
- 页面里的浅底信息块、虚线空态、无壳占位优先通过 `variant` 表达，不要重复手写同类容器 class

## SectionCard

用于设置页和信息页的单层分组面板，统一提供标题栏、可选图标/元信息、内容区和分隔行，避免在 `Card` 内再嵌套带圆角与边框的列表容器。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `React.ReactNode` | - | 标题栏主标题 |
| `icon` | `React.ReactNode` | - | 标题前的可选图标 |
| `meta` | `React.ReactNode` | - | 标题后的徽标或辅助信息 |
| `action` | `React.ReactNode` | - | 标题栏右侧的紧凑操作 |
| `divided` | `boolean` | `false` | 是否在直属内容项之间显示分隔线 |
| `contentClassName` | `string` | `""` | 内容区布局和内边距样式 |

`SectionCardRow` 用于直属配置行，支持 `div` 与 `button` 两种元素。按钮行自带键盘焦点样式，但 hover 语义由使用方按实际交互补充。

### 使用建议

- 同一信息组只保留 `SectionCard` 的一层边框、圆角和背景
- 列表内容优先使用 `divided + SectionCardRow`，不要在内容区再添加 `rounded-ui-panel + border`
- 表单内容可通过 `contentClassName="p-4"` 提供统一留白，不要求拆成行
- `meta` 适合平台、状态或版本徽标，不承载主要操作
- `action` 仅放置与整个分组相关的紧凑操作，优先使用小尺寸按钮或图标按钮

## Drawer

用于从页面右侧滑出展示详情，适合表格行详情、运行记录复盘和保持当前列表上下文的查看场景。

### 使用建议

- 优先用于只读详情，不承担主流程的长表单编辑
- 抽屉内容应按“摘要 -> 配置 -> 明细 -> 日志”分区组织
- 保持关闭动作明确，避免在抽屉内堆叠过多主操作
- 抽屉主体优先 `bg-surface-primary`，避免过强颜色干扰主列表
- 共享组件只负责遮罩、滑入、滚动锁和头尾壳层；业务内容仍留在 feature 内

## AccessPointPreviewDrawer

用于展示外部接入点的统一只读预览。业务适配器负责返回统一的 `AccessPointPreview` 数据，组件不读取任何具体 Provider 的字段。

### 统一内容

- 资源名称、资源类型和来源
- 权限范围与资源元数据
- 表格字段和示例数据，或文档正文摘要
- 可选的原站打开操作

### 使用约定

- 仅接收 `document`、`table`、`collection` 三类资源类型
- 加载和错误状态由组件统一呈现
- Notion、飞书、Google Drive、Sheets、Airtable 等适配器不得把 Provider 原始响应直接传入组件

## FileIcon

根据文件扩展名展示统一图标。

### 当前映射

- `PDF` -> 红色文档图标
- `XLS/XLSX` -> 绿色表格图标
- 其他类型 -> 蓝色通用文档图标

### 备注

- 文件图标允许保留类型识别色，但不要把这种文件色扩散为页面主视觉体系

## FileListItem

用于上传流程中的文件条目展示。

### 内容

- 文件图标
- 文件名
- 扩展名 / 大小
- 删除操作

### 扩展能力

- `active`：用于高亮当前选中的文件
- `onClick`：用于切换预览目标或进入文件详情

### 色彩建议

- 选中态优先 `primary` 弱底或 `surface-secondary`
- 删除操作仅按钮或图标使用危险语义，不把整行染成危险色

## FileUploadDropzone

用于上传区，支持点击选择与拖拽。

### Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `onSelectFiles` | `(files: FileList \| null) => void` | 文件选中回调 |
| `helperText` | `React.ReactNode` | 辅助说明 |
| `accept` | `string` | 接收文件类型 |
| `maxCount` | `number` | 最大文件数 |

### 交互与色彩

- 默认以 `surface-secondary` 作为承托，hover 可回到 `surface-primary`
- 拖拽激活可用 `primary/10` 或更清晰的 `border-primary/30`
- disabled 时降低对比度，不显示可点击暗示

## FullPageStatus

用于整页级轻状态，例如空态、加载说明或权限提示。

### 色彩建议

- 默认使用中性面
- 警告和错误状态优先通过图标、标题和按钮表达，不用整页高饱和色

## ImagePreviewOverlay

用于图片点击后的遮罩预览和滚轮缩放。

### 使用建议

- 共享组件负责遮罩、居中预览、滚轮缩放和 `Esc` 关闭
- 业务页只保留图片来源和开关状态，不再重复写浮层预览逻辑
- 适合单张图片查看，不承担相册、分页和复杂工具栏

## Input

用于表单输入，包括文本、数字、多行文本与选择器。

### 通用 Props

- `labelHelp`：可选说明文本，会在 label 旁以 Tooltip 问号图标展示；用于避免业务页手写重复 label 和说明图标
- `compact`：紧凑输入样式，适合工具栏、筛选器和窄布局
- `autoFocus`：挂载后自动聚焦输入框
- `ariaLabel`：没有可见 label 时的可访问名称
- `onBlur`：输入框失去焦点时的回调

### 色彩约束

- 默认 `bg-surface-primary border-border text-text-primary`
- placeholder 使用 `text-text-tertiary`
- focus 使用 `border-primary + ring-primary/20`
- disabled 回退到 `surface-secondary` 和 `text-text-tertiary`
- error 文案与错误描边使用 `danger`

## Slider

用于有明确最小值、最大值和步长的数值调节。

### Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `label` | `string` | 字段标题 |
| `value` | `number` | 当前值 |
| `onChange` | `(value: number) => void` | 值变化回调 |
| `min` | `number` | 最小值 |
| `max` | `number` | 最大值 |
| `step` | `number` | 步长 |
| `labelHelp` | `string` | label 旁 Tooltip 说明 |
| `valueFormatter` | `(value: number) => string` | 右侧数值展示格式化 |
| `compact` | `boolean` | 紧凑滑块样式 |
| `ariaLabel` | `string` | 无 label 时的可访问名称 |

### 交互与色彩

- 轨道默认是 4px 细线，未选中段用 `border` 中性色，已选区段用 `primary`
- 滑块圆点使用 `primary`，带浅色内描边和一层细外描边，贴近 Claude 风格的紧凑控件
- hover 会轻微放大，focus-visible 会出现 `primary` 弱环
- 适合语速、阈值、温度、比例类字段，不适合无界长数字

## CompactAudioPlayer

用于单行紧凑音频预览，包含播放按钮、进度条、时间、音量弹层。

### Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `src` | `string` | 音频地址 |
| `title` | `string` | 主标题 |
| `subtitle` | `string` | 次级说明 |
| `statusMessage` | `string` | 播放器下方的状态说明，例如加载中或当前没有可播放音频 |
| `disabled` | `boolean` | 禁用播放、进度和音量交互，但保留播放器外观 |
| `tone` | `"light" \| "dark"` | Claude 风格浅色 / 深色皮肤 |
| `className` | `string` | 外层自定义样式 |

### 交互与色彩

- 播放按钮使用 Claude 风格珊瑚色圆形实底，尺寸保持紧凑
- 浅色皮肤默认使用暖米色卡片底，深色皮肤使用近黑底，均保留大圆角
- 进度条复用同一套紧凑 range 视觉，但轨道颜色会随浅深皮肤切换
- 时间使用 `mono` 小字号，减少视觉噪音
- 音量按钮点击展开竖向滑块，双击支持静音/恢复

## TextArea

用于多行文本输入，例如描述、备注、Prompt、长说明。

### 约束

- 默认跟随 `Input` 的基础语义和状态色
- 默认高度保持紧凑，不要做成大面积表单块
- 适合较短多行描述时使用，长文编辑再考虑更专业的编辑器
- 业务页若需要频繁复用，优先继续收敛到该组件，而不是复制 `textarea` 的 class

## Select

共享选择器，基于 Radix Select 原语封装。

### 当前能力

- 保持 `label`、`value`、`onChange`、`options`、`disabled`、`error`、`compact` 轻量 API
- `labelHelp` 可在 label 右侧显示问号 Tooltip，用于字段格式说明或边界提示
- `endAction` 可在选择框右侧挂一个轻量操作按钮，例如删除当前选项；默认不启用，不影响旧调用
- 统一接管键盘导航、焦点管理、类型搜索与无障碍语义
- 下拉面板通过 portal 渲染到顶层，避免在弹窗、抽屉和滚动容器中被裁切
- 下拉浮层默认使用更高层级，避免被弹窗、抽屉和聊天悬浮区遮挡
- 为兼容业务层空字符串值，组件内部会对 option value 做编码映射；外部仍保持原始字符串 API
- 即使当前 value 尚未出现在异步加载的 options 中，Radix 根节点也保持受控，避免加载完成时产生 uncontrolled/controlled 切换警告
- 触发器对长文本保持单行截断；下拉面板至少与触发器等宽，并可按选项内容扩展到当前可用视口宽度，避免窄触发器裁切完整选项

### 色彩约束

- Trigger：`bg-surface-primary border-border text-text-primary`
- Placeholder：`text-text-tertiary`
- Focus：`focus:border-primary focus:ring-primary/20`
- Content：`bg-surface-elevated border-border`
- Content radius：默认控制在 `10px` 左右，避免过圆的业务浮层
- Item highlighted：`bg-primary/10`
- Item checked：`bg-primary/10 text-primary`

## Message

全局 Toast 提示。

### API

```tsx
import { message } from "@/shared/ui/Message";

message.success("保存成功");
message.error("保存失败，请重试");
message.warning("请检查输入内容");
message.info("已复制到剪贴板");
message.loading("提交中...");
message.destroy();
```

### 色彩建议

- 成功 / 警告 / 错误 / 信息都以语义色为核心
- 避免让 toast 背景过重，优先保持可读和轻量
- loading 和异常提示优先转成用户可理解文案，不直接暴露底层 key 或技术性英文
- 需要浅底状态块时，优先：
  - 成功：`bg-success-soft border-success-border text-success-text`
  - 警告：`bg-warning-soft border-warning-border text-warning-text`
  - 错误：`bg-danger-soft border-danger-border text-danger-text`
  - 信息：`bg-info-soft border-info-border text-info-text`

### 内容建议

- toast 文案优先一句话说清结果
- 不把日志、堆栈、原始错误 key 直接塞进全局提示
- AI 中间过程提示默认弱化，避免反复打断阅读

## Markdown / Long-form Content

用于聊天长回复、知识说明、评测结果摘要、工具调用结果说明等文档型内容。

### MarkdownText

- `features="full"`（默认）启用代码、Mermaid 与 KaTeX；LaTeX 支持 `$...$` 行内公式和 `$$...$$` 块级公式。
- `features="basic"` 不加载上述可选解析插件，适合只需要基础 Markdown 的内容。
- KaTeX 样式由组件统一引入，业务组件不要重复加载或自行拼装公式 HTML。

## StreamingTextRenderer

用于把持续增长的完整文本转换为按帧追赶的可见文本，不自行添加 DOM 容器，也不绑定 Markdown、聊天状态或传输协议。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `text` | `string` | - | 调用方持有的完整文本 |
| `isStreaming` | `boolean` | `false` | 是否启用按帧追赶；关闭时立即显示完整文本 |
| `children` | `(visibleText: string) => ReactNode` | - | 使用当前可见文本完成实际渲染 |

### 行为约束

- 第一批流式文本立即显示一个短前缀；如果首批就是整段答案，其余内容仍进入显示节奏控制
- 使用中文区域的 Unicode 字素边界，不能截断 emoji 或组合字符
- 积压量越大，每帧追赶越多；不得使用固定的缓慢打字机速度
- 传输结束后继续完成已有显示队列；文本发生非追加替换或用户启用减少动态效果时，立即显示完整文本
- 组件只控制显示前缀，不得接管 canonical message、持久化内容或 SSE 分片
- Markdown 等具体内容渲染器由 `children` 注入，避免在共享组件中耦合聊天业务

## MarkdownEditor

用于需要所见即所得 Markdown 编辑的配置场景，例如角色字段、长说明与可复用提示词块。

### 使用建议

- 共享组件内部封装 Milkdown / Crepe，业务页不要直接散落编辑器初始化逻辑
- 主界面只展示摘要，长文本编辑优先放入抽屉或弹窗
- 编辑器外层容器仍需沿用 `surface-*`、`border`、`rounded-ui-panel` 体系，避免跳出当前产品视觉

### 设计目标

- 读起来像结构清楚的文档，而不是一大块聊天气泡
- 标题、段落、列表、引用、代码块、表格层级必须稳定
- 长文本优先提升阅读连续性，而不是增加容器装饰

### 约束

- 正文优先 `15px ~ 16px` 与较舒展行高
- 标题不宜过重，避免压迫
- 引用、来源、备注使用弱边框和轻底，不做醒目警告色
- 代码块、日志、JSON 与正文明确区分，但仍保持安静基调
- 复杂结果优先“摘要 -> 正文 -> 来源/附件 -> 过程细节”的顺序

## CodeBlock

用于代码、日志片段、JSON、命令输出等等宽内容块。

### 使用建议

- 通用代码或日志块优先复用该组件，不要在页面里重复写 `font-mono + border + bg`
- `tone="terminal"` 只用于更像终端的深色输出块

## SegmentedTabs

用于少量并列视图切换，尤其是工作台里的“日志 / 结果”这类胶囊 tab。

### 使用建议

- 只适合 2 到 4 个轻量选项
- 优先用于局部视图切换，不替代主导航
- 业务页不要再手写 `p-1 + rounded + active` 那套胶囊切换结构

## TabCard

用于“胶囊 tabs + 右侧辅助说明 + 同卡片内容区”这类工作台型结构。

### 使用建议

- 适合日志/结果、配置/预览、摘要/明细这类 2 到 4 个局部视图切换
- 头部和内容区属于同一张卡片，不要再在业务页手写 `tabs + 分隔线 + 内容壳`
- tabs 继续复用 `SegmentedTabs`，`TabCard` 负责统一头部承托与内容区壳层
- 右上角辅助说明通过 `headerAside` 传入，保持弱信息层级

## NavigationCardTabs

用于页面顶部的页签导航场景，适合少量入口之间的切换，强调标签本身的压边感和当前选中态。

内部基于 `@radix-ui/react-tabs` 实现键盘导航和可访问性，对外继续保持受控式轻量 API。

### 使用建议

- 适合 2 到 5 个入口，不适合复杂表单或长内容
- 只负责页签切换，不承担内容区和主 CTA
- 组件本身只输出 tab strip，不再额外包 badge、内容壳或卡片外层
- tab 选中态优先通过顶部强调线、底边遮盖和轻阴影表达
- 如果页面需要无背景的选中态，可传入 `activeTabStyle="plain"`；默认样式保持不变
- 页面本身是工作台时继续优先用 `TabCard`；页面职责是“需要页签切换”时，用这个组件更合适
- 方向键切换、焦点管理和语义属性由组件内统一处理，业务页无需重复补 tab a11y 结构

## TerminalPanel

用于模拟终端、运行日志、命令输出和过程回放面板。

### 使用建议

- 优先用于“标题 / 元信息 / 滚动输出 / footer”结构稳定的终端块
- 业务页不要再重复拼装同类终端外壳、头部和滚动区
- `variant="default"` 保留轻边框、圆角和终端壳层，适合独立日志面板
- `variant="plain"` 去掉外边框、圆角和外层壳，适合嵌入 `TabCard` 或其他已经提供容器结构的区域

## WelcomePanel

用于欢迎页、空态页或起始引导区的大块英雄视觉包装。

### 使用建议

- 共享组件负责外层容器、进入/退出动效和文案区域版式
- 业务页只传入图片层、徽标、标题和说明，不再重复写整套欢迎区骨架
- 适合承载单块欢迎视觉，不要继续向里塞复杂交互和业务状态机

## Composer Pattern

用于线程底部输入区及其附件、工具、发送、停止等动作。

### 约束

- Composer 是 AI 工作流主舞台，优先保证输入焦点和阅读延续
- 默认不做过薄输入框
- 发送按钮清楚但克制，不做强营销感
- 运行中的停止按钮与发送按钮尺寸应接近，避免布局跳变
- 附件、知识库、工具入口都属于二级动作，应弱于输入内容本身
- 底部悬浮外壳可以有轻模糊和渐变承托，但不能抢消息区视觉

## Execution Trace / AI Runtime Block

用于展示计划、执行轨迹、RAG 过程、工具调用、运行中状态和细节展开。

### 约束

- 默认优先紧凑行和单行摘要，不优先厚重卡片
- 中间态以中性面、轻边框、清楚文案表达，不滥用警告色
- 详情默认折叠或抽屉展开，避免把主阅读区压碎
- 结果、错误、可重试动作要分清，但不制造额外焦虑
- 裸 JSON 只在确有调试价值时显示，并应放在二级层

## Modal

用于承载确认、设置和说明类弹窗。

### Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `width` | `number \| string` | 弹窗宽度，支持像素或 CSS 尺寸值 |
| `height` | `number \| string` | 显式固定高度；不传时按内容自适应 |
| `maxHeight` | `number \| string` | 最大高度，默认限制在视口内 |

### 设计约束

- 默认用于短任务，不承载过长整页内容
- Header / Footer 固定，Body 滚动
- 主操作不超过一个
- 默认优先内容自适应，仅在复杂表单或长内容场景下再显式传入 `height / maxHeight`
- 涉及删除、清空、不可逆等二次确认，优先使用 `Modal.confirm(...)`
- `Modal.confirm` 适合紧凑确认，不要在业务页再手写同类危险 footer
- 确认失败时应保留弹窗并展示错误信息，不要关闭后再额外弹一次信息

### 色彩建议

- 主体内容优先 `surface-primary`
- 遮罩和弹层都应克制，避免强黑压迫感

## SearchSelectModal

用于“打开后自行请求数据、支持搜索、选择单个目标”的通用弹窗。

### 设计约束

- 通过 `url` 自行请求数据，避免业务层重复写 fetch + 搜索 + 选择外壳
- 通过 `normalizeItems` 把外部响应收敛成共享 item 结构
- 顶部搜索框固定，结果列表区域独立滚动
- `onCheck` 返回 `true` 时关闭弹窗，返回 `false` 时保持打开
- 默认使用紧凑宽度，适合选择器，不做重型管理面板
- 默认保持更紧凑的 modal 壳层和列表密度，避免大圆角卡片和过松边距
- 条目优先单行摘要 + 轻量元信息，描述过长时应被截断，而不是把卡片撑高
- 视觉壳层与数据逻辑分离，当前样式层由 `SearchSelectModalChrome` 承接，便于单独替换弹窗外观而不改搜索流程

## Skeleton

用于加载中的结构占位，适合列表、面板、表单和摘要块的轻量骨架屏。

### 当前能力

- 基础块：`<Skeleton />`
- 多行文本：`<Skeleton.Text />`
- 圆形占位：`<Skeleton.Circle />`
- 卡片占位：`<Skeleton.Card />`

### 使用建议

- 优先表达结构，不模拟过多装饰细节
- 默认使用 `surface-secondary` 做占位层，不额外引入灰阶色表
- 适合替代页面里重复手写的 `animate-pulse + rounded + bg-*`
- 列表或面板加载优先先搭结构节奏，再决定是否需要头像、meta 等细节

## NavItem

用于侧边导航、次级列表导航和轻量菜单项。

### 色彩建议

- 非激活态优先 `text-text-secondary`
- hover 使用 `surface-secondary` 或 `pampas-*` 弱底
- 激活态使用 `bg-surface-soft text-text-primary`；默认暖中性浅色背景为 `#F5F0E8`
- 需要更强品牌指示时可以额外使用主色指示条，不建议整块高饱和主色填充

## StatusIndicator

用于展示轻量状态点。

### 支持状态

- `running`
- `stopped`
- `unknown`

### 色彩约束

- 点色可分别使用 `success`、`danger`、`warning`
- 周围 ring 优先使用对应 `*-border`
- 弱底状态块优先使用对应 `*-soft`

## StepIndicator

用于多步骤页面顶部的流程指示。

### Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `currentStep` | `number` | 当前步骤 |
| `steps` | `{ step: number; label: string }[]` | 步骤列表 |

### 色彩建议

- 当前步骤优先 `primary`
- 已完成步骤可使用 `primary/10 + text-primary`
- 未到达步骤使用 `surface-secondary` 或 `text-tertiary`

## Switch

用于布尔开关。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `checked` | `boolean` | - | 当前开关状态 |
| `onChange` | `() => void` | - | 点击回调 |
| `disabled` | `boolean` | `false` | 禁用态 |
| `ariaLabel` | `string` | - | 无障碍标签，推荐传入 |

### 使用建议

- 用于启停、布尔配置、列表行内状态切换
- 不承担带文案的主操作，通常与 Tooltip 或标签搭配
- 打开态使用 `primary`，关闭态使用 `surface-secondary + border`，保证浅色模式下滑轨仍然可辨识

## CoverageReportPanel

用于展示客户端或服务端的测试结果和覆盖率文件摘要。

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `src` | `string` | - | 覆盖率报告地址 |
| `resultSrc` | `string` | - | 测试结果报告地址 |
| `loadingFallback` | `React.ReactNode` | - | 调用页可传入单一页面级骨架屏，替代组件默认加载卡片 |

### 使用约束

- 业务页面需要统一页面级加载态时，优先通过 `loadingFallback` 注入，不在组件外再叠加第二个骨架屏
- 文件摘要必须复用共享 `Table`，保留统一的粘性表头、横向滚动和列样式

## Table

轻量表格容器，适合简单数据行展示。

### 当前能力

- 支持紧凑密度 `compact`
- 支持空态占位 `emptyState`
- 支持粘性表头和首列
- 支持通过 `getRowProps` 注入行级交互，例如双击进入详情
- 支持内建选择列 `rowSelection`，启用后 checkbox 列会自动固定在最左侧
- 支持通过列 `meta` 配置固定宽度、左侧固定列和按需截断 tooltip
- 表格横向滚动时自动显示左右边缘阴影，提示还有隐藏列

### 设计约束

- 用边框和留白建立结构
- 默认采用开发报告表格的紧凑基线：表头和数据行使用 `px-3 py-2`、`text-xs`
- 表头弱化，不做厚重报表风格
- 行使用轻量底部分隔，hover 仅做轻提示
- 当列总宽度超过容器时，允许整表横向滚动，不强行压缩列内容
- 多个左侧固定列并存时，必须按列宽累积计算 `left` 偏移，避免 selection 列和首列相互覆盖

### 色彩建议

- 表格主体优先 `bg-surface-primary`
- 默认容器使用 `rounded-ui-control + border-border/70`，保持轻边框和小圆角
- 行 hover 优先 `bg-surface-secondary/40`
- Sticky 列继续使用 `surface-*`，不要额外换一套灰色体系
- 表头分隔线应落在 `th` 的底边，避免 sticky 表头时边线丢失
- 表体行使用 `border-b border-border/70`，最后一行不保留底边

### 列级配置

- `meta.width`: 固定列宽，适合文件名、状态等需要稳定布局的列
- `meta.sticky: "left"`: 左侧固定列，优先用于主标识列
- `meta.ellipsisTooltip: true`: 单行省略并在真正溢出时显示 Tooltip，不溢出时不显示

### 行选择

- `rowSelection.selectedRowIds`: 当前选中行 id 列表
- `rowSelection.onSelectedRowIdsChange`: 选中变化回调
- `rowSelection.getRowId`: 从业务行数据提取稳定 id
- `rowSelection.ariaLabel`: 每行 checkbox 的无障碍文案
- `rowSelection.selectAllAriaLabel`: 表头全选 checkbox 的无障碍文案

## Tooltip

用于承载补充说明、路径、状态原因等次级信息。

### 当前实现

- 基于 `react-tooltip` 做统一封装
- 保持 `text` 与 `placement` 的轻量 API
- 默认限制最大宽度，并允许长文本换行
- 适合图标按钮、截断文案和状态补充说明

### 设计约束

- 默认用于短说明，不替代主文案
- 长文本允许换行，避免超出视口
- 优先作为图标、截断文案或状态点的补充说明
- 不在 Tooltip 中承载主操作
- 浮层优先 `surface-elevated + border-border`

## DropdownMenu

用于轻量菜单、工具入口菜单和带二级子菜单的操作浮层。

### 当前能力

- 基于 Radix Dropdown Menu 原语封装
- 支持 portal 渲染，避免被滚动容器、底部悬浮输入区和抽屉裁切
- 支持点击外部关闭、Esc 关闭、键盘导航和子菜单
- 支持通过 `side` 指定弹出方向（默认 `bottom`，可设 `right` 等），适配侧边栏等竖直排列的触发器
- 支持前导图标、尾部说明文本和选中勾选态
- 支持 `selected` 常驻选中态（用于标记菜单项对应当前路由），与交互高亮态并存

### 使用建议

- 适合工具菜单、附件菜单、知识库二级菜单
- 菜单项文案优先短句，补充信息放 `trailingText` 或 `title`
- 竖直排列的侧边栏触发器（如导航栏图标）建议用 `side="right"`，避免菜单向下盖住主内容区
- 子菜单只用于一层渐进披露，不要在业务里堆三层以上
- 需要指示"当前所在页面"时使用 `selected`（常驻背景），`checked`（右侧勾选）用于多选或开关语义

## ExternalLink

用于统一处理外部链接打开行为，避免业务页直接写裸 `<a>` 并各自判断 Electron、Tauri 或浏览器差异。

### 当前能力

- 默认优先调用共享平台层的 `openExternalUrl`
- 可按运行载体切换到 `copy-only` 降级行为
- 打开失败时自动回退到“复制 URL + 提示”
- 支持在打开前弹出免责确认，适合外部文档、邮件正文链接等场景
- 保留原生链接语义，仍然以 `<a>` 输出

### 使用建议

- 业务页中的外部文档、官网、帮助中心链接优先复用这个组件
- 当某个载体不允许直接打开外链时，通过 `copyOnlyHosts` 声明降级策略，不要在业务页重复判断
- 当链接会离开当前应用上下文时，通过 `confirmBeforeOpen` 统一补上确认提示，不要在业务页重复拼接免责文案
- 失败提示和复制逻辑由共享层统一处理，避免页面各写一套 toast 文案
- 菜单承载动作，不要把长说明塞进菜单内容里

## Chat-specific UI

`uchat` 当前主聊天 UI 位于：

- `desktop/src/features/chat/components/UChatThread.tsx`
- `desktop/src/features/chat/components/UChatThreadListSidebar.tsx`
- `desktop/src/shared/uchat/ui/*`

这些组件依赖当前线程状态和 RAG 观测数据，不再视为共享 UI 组件。

其中：

- `UChatThread` / `UChatThreadListSidebar` 依赖 `shared/uchat` runtime
- `shared/uchat/ui/*` 是当前共享的 uchat 展示组件层
- legacy `components/Thread/*` 已从当前桌面主实现中移除

### Chat 设计 token

UChat 的排版与密度已从组件中的任意值抽到 `styles.css` 的 `--chat-*` CSS token，并由 `tailwind.config.cjs` 暴露为 `text-chat-*`、`leading-chat-*`、`p/m/gap-chat-*`、`h/w-chat-*` 与 `rounded-chat-bubble` 等语义类。

当前 token 覆盖：

- 用户与助手正文的字号、行高
- Markdown 段落行高、标题字号与行高、块/标题/列表间距
- 消息行和气泡内边距、气泡圆角
- 助手头像尺寸、顶部偏移和消息内容间距
- 消息操作按钮尺寸、顶部偏移、按钮间距和左侧缩进
- 执行轨迹字号、行高、顶部与底部间距

当前使用紧凑密度预设：消息正文 `14px`，Markdown 段落行高 `24px`，消息行、气泡、头像、操作栏和轨迹间距同步缩小。后续调整继续只修改 `--chat-*` token，并按 `ui-design-guidelines-tailwind.md` 的 Chat / Thread 回归范围验证；不要在 UChat 组件内重新引入局部任意值。

## 更新说明

当修改或新增共享组件时，请同时更新：

- `desktop/src/shared/ui/COMPONENTS.md`
- `desktop/src/shared/ui/ui-design-guidelines-tailwind.md`
