# Computer Use 前台使用说明

Computer Use Studio 现在是 Managed Browser 运行时的管理面：查看运行时状态、检测到的受管 Chromium / 系统浏览器、当前可执行文件，并安装或重新安装受管运行时。网页任务本身统一由主 Agent / Generic Child 的 `browser` 能力与原子 Browser Tool 路径执行；手动调试会话已退役。

## 能力

- 查看 Managed Browser 运行时状态与当前浏览器环境
- 检测受管 Chromium 与系统浏览器
- 安装 / 重新安装受管浏览器运行时
- 展示当前可执行文件路径
- 网页交互由 Agent 的原子 Browser Tool 完成（browser_navigate / browser_snapshot / browser_click / browser_fill / browser_wait_for / browser_assert 等）

## 环境配置

1. 确认浏览器运行时状态为“运行时已就绪”。优先使用 Managed Chromium。
2. 如未安装，点击“下载浏览器运行时”。
3. 运行时就绪是在对话中让 Agent 执行网页任务的前提。

## 使用方法

1. 在本页确认运行时状态与可执行文件路径。
2. 在对话中让 Agent 打开目标网页并完成任务。
3. 写入类原子 Browser Tool 会进入现有审批流程；批准后继续执行。
4. 在对话链路的执行证据中查看 observation、审批与结果。

## 边界

当前能力面向受控浏览器网页操作，不包含宿主桌面控制、凭据托管、浏览器插件接管或 CAPTCHA 绕过。
