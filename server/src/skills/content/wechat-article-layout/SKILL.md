---
id: wechat-article-layout
displayName: 微信公众号文章排版
description: "把 URL、上传文件、工作区 Markdown 或粘贴正文排成微信公众号可直接粘贴的 HTML。支持终端暗黑、清爽简约、杂志暖调、学术规整；未指定风格时先确认。"
version: 0.1.0
category: content
visibility: public
source: Mira
status: review
execution.context: fork
execution.agent: subAgent
execution.allowedTools: read, terminal
execution.workspaceBound: true
---

# 公众号文章排版

核心资源：

- `skill://wechat-article-layout/scripts/build_wechat_html.py`
- `skill://wechat-article-layout/references/dark-mode-mapping.md`

## 0. 确认风格

用户未指定时，返回 `needs_input`，只问一次：

> 请选择排版风格：终端暗黑、清爽简约、杂志暖调、学术规整。

接受自然中文并映射为脚本参数：

- 终端/暗黑/代码风 → `terminal-dark`
- 清爽/简约/白底 → `minimal-light`
- 杂志/暖调/暖色 → `magazine-warm`
- 学术/规整/蓝色 → `academic-blue`

请求中已说明风格时直接执行；不要要求用户输入英文枚举。用户要求自定义风格时，可修改脚本 `PRESETS`，但必须遵守文末红线。

## 1. 准备输入

按以下优先级取文章：

1. 用户明确指定的工作区文件：直接使用原路径。
2. 本轮上传文件：使用 Agent 目标中提供的工作区相对路径。
3. 用户粘贴正文：原样写入临时 `.md`。
4. URL：用现有 `curl` 抓取；失败则说明缺口，不安装抓取器。

不要改写原文。标题、来源缺失时可留空，不追问。

引用块可用首行标记：

- `[!system]` / `[!accent]`：强调色
- `[!warn]` / `[!red]`：警告色
- 无标记：默认引用色

## 2. 生成 HTML

用 `skill_read_resource` 读取脚本。脚本会自动物化到工作区，结果返回 `workspacePath`。

输出文件固定为工作区根目录的 `article-wechat.html`，直接执行：

```text
python <workspacePath> --input <article.md> --output article-wechat.html --style <style> --title <title> --source <source>
```

禁止把脚本源码拼进 `terminal.command`，也不要再次复制或重写脚本。Windows 可回退 `py -3`。不得运行 `pip`、`conda` 或创建虚拟环境；脚本只用 `argparse`、`os`、`re`。没有 Python 时返回 capability 缺口。

## 3. 处理图片

生成器会把 `![alt](url)` 转成单行占位，并在结果中返回图片列表。

- 用现有 `curl` 下载到输出目录旁的 `images/`。
- 检查文件非空且不是 HTML 错误页。
- 下载失败不阻断正文 HTML；交付时列出失败项。
- 告诉用户在占位行处上传图片后删除该行。

不得引入 Pillow、requests 等依赖。

## 4. 验证

至少确认：

1. `article-wechat.html` 存在且非空；
2. 标题或正文关键文本存在；
3. 不含 `<script>`；
4. 图片占位数与结果一致；
5. 标题、引用、列表未因缺少空行而吞并。

系统已有 Chrome/Chromium 时可截图检查；没有则跳过，不安装。没有真实文件 Evidence 不得宣称完成。

## 5. 交付

提供：

- `article-wechat.html`；
- 已下载图片；
- 失败图片清单（如有）；
- 操作说明：浏览器打开 HTML → `Ctrl+A` → `Ctrl+C` → 公众号编辑器 `Ctrl+V`；
- 提醒标题、作者、封面需在公众号后台填写。

## 深色模式

只有新增或调整配色时才读取 `dark-mode-mapping.md`。普通排版不要加载。

## 抗剥离红线

1. 只用 `section / p / span / strong / img`。
2. 最外层套无样式空 `section`。
3. 背景色写到每个元素，不依赖继承。
4. 纵向间距用 padding，不用 margin。
5. 左右内距下沉到顶层元素。
6. 保留 `margin:0 -16px;padding:0` 出血骨架。
7. 圆角等装饰允许被剥离。
8. 首尾保留 `height:32px` 背景间隔条。
