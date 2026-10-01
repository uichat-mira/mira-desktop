# UIChat Mira

UIChat Mira is a local-first desktop workspace for chat, knowledge, tools, and docs.

It is built to help you:

- work with models, roles, knowledge, MCP, and tools inside one desktop app
- keep the project docs readable for both humans and AI
- keep the whole project aligned around one local runtime

## Entry Points

- `docs/README.md`
- `docs/VAULT_HOME.md`
- `docs/WIKI_SYSTEM_SCHEMA.md`
- `docs/architecture/README.md`
- `docs/uchat.md`

## Project Layout

```text
root/
  desktop/          # React renderer
  electron/         # Electron main/preload and shell package
  server/           # Fastify backend source and build script
  packages/         # Shared workspace packages
  scripts/          # Build and packaging helpers
  docs/             # Central project documentation
  tauri/            # Tauri app sources and config
  .artifacts/       # Temporary shared build artifacts (ignored)
  release/          # packaged desktop release outputs
  runtime.config.cjs
```

## Runtime

- React + Vite renderer
- Electron / Tauri shell
- Fastify backend
- Host and port come from `runtime.config.cjs`

## Development

```bash
pnpm install
pnpm dev:electron:win
pnpm dev:electron:mac
pnpm smoke:electron:chat:mac
pnpm smoke:terminal:mac
pnpm dev:tauri:win
pnpm check
pnpm check:no-db-in-index
pnpm clean:artifacts
```

`dev:electron:mac` 当前用于 Apple Silicon Electron Core 开发态验证，不构建仅支持 Windows 的 Native Messaging Host。启动前会为 npm 下载的 `Electron.app` 准备本机 ad-hoc 开发签名，并恢复 node-pty macOS `spawn-helper` 的执行位；这些动作只用于本地开发，macOS 正式包仍需 Developer ID、公证及独立 payload 验证。正式打包目前未支持，当前进度见 `docs/platform/macos-implementation-phases.md`。

`smoke:electron:chat:mac` 使用隔离数据库、Workspace、附件目录和动态端口启动真实 Electron，验证登录、Chat Composer、普通附件选择、鉴权上传、落盘与退出清理。`smoke:terminal:mac` 验证带中文和空格的 Workspace、临时 POSIX 命令、持久 PTY 续跑及进程清理。

## Branch Flow

`.github/workflows/branch-policy.yml` enforces the repository promotion path:

```text
feat/* | feature/* | fix/* | hotfix/* | refactor/* | perf/* | docs/* | test/* | chore/* -> dev
dev -> test
test -> prod
hotfix/* -> test or prod
```

`prod` is the GitHub default branch, but normal development still enters through `dev` and promotes through `test` before `prod`.

## Packaging

- `docs/build/README.md`

```bash
pnpm package:electron:win
pnpm package:tauri:win
```

## Local Model Packs

本地构建默认不联网拉 Hugging Face。

开发时请在自己的 `.env` 里配置：

```text
LOCAL_MODEL_RAW_ROOT=<你的本地模型目录>
LOCAL_ONNX_WASM_ROOT=<onnxruntime-web/dist 目录>
```

`.env.example` 里有一组可直接参考的路径示例。

模型文件下载来源：

- `Xenova/multilingual-e5-small`
- `Xenova/ms-marco-MiniLM-L-6-v2`（可选）

你把下载好的文件放到 `LOCAL_MODEL_RAW_ROOT` 指向的目录下，再运行：

```bash
pnpm prepare:local-model-packs
```

如果本地目录已存在，它只会校验并生成 `manifest.json`。
本地没有这两个环境变量就直接报错，不会回退到 `.artifacts/`。
CI 构建阶段才允许设置 `LOCAL_MODEL_ALLOW_NETWORK=1` 自动下载。

## Bundled Piper Runtime

Piper 微应用默认内置 Windows 运行时。

用户侧只需要提供自己的 `.onnx` 语音包文件和同目录 `.onnx.json`，不需要单独安装 `piper.exe`。

构建脚本会自动准备：

```bash
pnpm prepare:piper-runtime
```

默认行为：

- 从固定版本的官方 Piper Windows 包下载运行时
- 缓存到 `.local-runtimes/piper/`
- staging 到 `.artifacts/micro-apps/tts/piper/`
- 只随 `TTS` 微应用自己的资源目录入包

当前支持边界：

- 当前内置 `Piper` 运行时稳定支持 `phoneme_type=espeak` 的语音包
- `phoneme_type=pinyin` 的中文语音包当前不在稳定支持范围内
- 这是一条已确认的运行时兼容性技术债，详见：
  - `docs/microapp/tts-studio-runtime-notes.md`
  - `docs/developments/defect-log.md`

## Health Checks

```bash
curl http://<backend-host>:<backend-port>/health
curl http://<backend-host>:<backend-port>/db/health
```
