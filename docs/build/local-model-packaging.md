# Local Model Packaging

Status: Implemented
Owner: build
Last verified: 2026-06-29
Layer: packaged-resource
Module: Build
Feature: LocalModelPackaging
Doc Type: design
Related:
  - README.md
  - ../architecture/context-budget-runtime.md
  - ../../scripts/prepare-desktop-artifacts.js
  - ../../scripts/build-dist.js

## 单点真相范围

这页定义本地 embedding / rerank 模型在 Electron release 中的资源打包、运行时定位和首次解压策略。

它主要回答：

- 默认模型资源怎么进入安装包
- Electron 分别放在哪里
- backend 如何在开发态和生产态解析模型路径
- 首次启动如何解压、校验和标记 ready
- 哪些 runtime 是默认内置，哪些只能做可选下载

模型选型与评测结果见：

- `../architecture/context-budget-runtime.md`

## 当前产品结论

默认体验：

```text
开箱即用 embedding 检索
rerank 是高级检索质量开关
默认运行时使用 onnxruntime-web / WASM
```

默认内置：

- embedding：`Xenova/multilingual-e5-small`
- runtime：`onnxruntime-web` / WASM
- rerank：不默认内置

可选能力：

- 轻量 rerank 包：20M-30M 级 cross-encoder，按需下载
- native runtime 包：`onnxruntime-node CPU`，只作为性能增强包
- CUDA / DirectML / 多平台 native binaries 不进入默认安装包

## 资源目录设计

### 构建输入

开发和 CI 阶段先把原始模型放在 `LOCAL_MODEL_RAW_ROOT` 指向的持久目录：

```text
<LOCAL_MODEL_RAW_ROOT>/
  embedding/multilingual-e5-small/
    config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    sentencepiece.bpe.model
    onnx/model_quantized.onnx
  rerank/ms-marco-MiniLM-L-6-v2/
    config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    vocab.txt
    onnx/model_quantized.onnx
```

约束：

- `LOCAL_MODEL_RAW_ROOT` 是模型源目录，不能指向 `.artifacts/`。
- `.artifacts/` 会被构建流程清理，不能作为 backend runtime 默认资源目录。
- `scripts/prepare-local-model-packs.mjs` 只从 `LOCAL_MODEL_RAW_ROOT` 读取模型文件，不会把 manifest 或归档产物写回模型源目录。
- backend runtime 必须通过显式环境变量或桌面壳层注入路径获取模型目录。
- 开发态 backend 允许 `LOCAL_MODEL_RAW_ROOT` 只有原始模型目录而没有 `manifest.json`；runtime 会按约定目录结构现场合成开发态 manifest。

构建 staging 固定在：

```text
.artifacts/model-packs/raw/
  manifest.json
  embedding/multilingual-e5-small/
  rerank/ms-marco-MiniLM-L-6-v2/   # 可选

.artifacts/model-packs/dist/
  embedding-multilingual-e5-small-v1.tar.br
  manifest.json
```

### Release 资源

默认 embedding 应先压缩成模型包，再进入 release resources：

```text
resources/model-packs/
  embedding-multilingual-e5-small-v1.tar.br
  manifest.json

resources/model-runtime/onnxruntime-web/
  ort-wasm-simd-threaded.wasm
  ort-wasm-simd-threaded.mjs
  ...
```

运行时不要直接从压缩包读取模型。首次启动或模型缺失时，应解压到用户数据目录：

```text
userData/models/
  embedding/multilingual-e5-small/
    model_quantized.onnx
    tokenizer.json
    tokenizer_config.json
    config.json
    .ready
  rerank/
```

## 打包流程

### GitHub Actions

当前 release 走 `.github/workflows/build-desktop.yml`：

- Electron：Windows runner 执行 `node scripts/build-dist.js win`
- 最终只上传 Electron 安装程序及其 `.blockmap`；不会上传 `win-unpacked` 或其他目录细节

因此 GitHub 构建环境必须被视为干净 checkout：

- 不能依赖开发机已有的 `.artifacts/model-packs/raw`。
- 不能把 `.artifacts` 作为 Actions cache 的最终语义位置。
- 模型资源必须在 CI 内通过明确步骤准备出来，再进入 Electron staging。

推荐 CI 流程：

```text
checkout
  -> pnpm install
  -> restore model cache
  -> prepare local model sources
       output: .local-models/raw
  -> package Electron
       copy staged model resources into release resources
  -> cleanup .artifacts
```

其中 `.local-models/raw` 是本次 CI job 的模型源缓存。真正进入产物的是：

```text
Electron:
  resources/model-packs
  resources/model-runtime
```

模型下载建议独立成脚本：

```text
scripts/prepare-local-model-packs.mjs
```

职责：

- 下载或校验 `Xenova/multilingual-e5-small`。
- 可选下载或校验 `Xenova/ms-marco-MiniLM-L-6-v2`。
- 生成 `manifest.json`。
- 生成 checksum。
- 支持 CI cache 命中后只校验、不重复下载。
- 不把模型目录提交进 git。

当前实现：

```bash
pnpm prepare:local-model-packs
pnpm archive:local-model-packs
```

本地构建默认不联网。`prepare` 只会读取 `LOCAL_MODEL_RAW_ROOT` 中已存在的模型源文件，并复制到 `.artifacts/model-packs/raw`，同时在 staging 目录生成 `manifest.json`。

`archive` 从 `.artifacts/model-packs/raw` 读取 staging 文件，生成 `.artifacts/model-packs/dist/*.tar.br` 和打包 manifest。

如果本地目录缺文件，它会报错，不会自动去 Hugging Face 拉取。

开发态请把自己的 `.env` 配成：

```text
LOCAL_MODEL_RAW_ROOT=<你的本地模型目录>
LOCAL_ONNX_WASM_ROOT=<onnxruntime-web/dist 目录>
```

`.env.example` 已给出可参考的默认路径写法。

本地脚本和 runtime 都优先读取 `.env` 里的变量，不再把 `.artifacts` 当成开发态默认路径。
如果没配这些变量，本地脚本和 runtime 会直接报错，不回退 `.artifacts/`。

`LOCAL_MODEL_RAW_ROOT` 是长期模型源目录，不会被打包清理。打包脚本会从这个目录复制到 `.artifacts/model-packs/raw`，再压缩成 `.artifacts/model-packs/dist`。

不要把 `LOCAL_MODEL_RAW_ROOT` 配成 `.artifacts/` 下的路径。

`scripts/prepare-desktop-artifacts.js` 会在检测到以下任一条件时自动执行：

```bash
pnpm prepare:local-model-packs
pnpm archive:local-model-packs
```

- `LOCAL_MODEL_RAW_ROOT` 已设置
- `LOCAL_MODEL_ALLOW_NETWORK=1`
- `CI=true`

CI 构建阶段才允许显式打开联网：

```bash
LOCAL_MODEL_ALLOW_NETWORK=1 pnpm prepare:local-model-packs
```

它在构建阶段请求 Hugging Face `resolve` URL，默认下载：

```text
Xenova/multilingual-e5-small
```

如需把 rerank 也放进本次构建输入，设置：

```bash
LOCAL_MODEL_INCLUDE_RERANK=1 pnpm prepare:local-model-packs
```

私有模型或更高下载限额可通过 GitHub secret 注入：

```text
HF_TOKEN
```

GitHub Actions cache key 应包含：

```text
model-pack schema version
model source ids
expected file list
download script hash
```

不要只用 `pnpm-lock.yaml` 作为模型 cache key；依赖版本变化和模型资源变化不是同一件事。

如果你要手工准备模型文件，先下载到：

```text
<LOCAL_MODEL_RAW_ROOT>/
  embedding/multilingual-e5-small/
  rerank/ms-marco-MiniLM-L-6-v2/   # 可选
```

来源分别是：

- `Xenova/multilingual-e5-small`
- `Xenova/ms-marco-MiniLM-L-6-v2`

当前 workflow 已在 Electron job 中执行：

```text
Cache local model packs
Prepare local model packs
```

cache 目录为：

```text
.local-models/raw
```

这只是 CI job 内部缓存，不是 runtime 语义路径。

### Electron

Electron 构建应在 artifact 准备阶段复制模型资源：

- 入口候选：
  - `scripts/prepare-desktop-artifacts.js`
  - `scripts/build-dist.js`

目标位置：

```text
.artifacts/electron-app/
  model-packs/
    embedding-multilingual-e5-small-v1.tar.br
    manifest.json
  model-runtime/
    onnxruntime-web/
```

最终进入：

```text
resources/model-packs/
resources/model-runtime/
```

约束：

- 模型包不要放进 `asar`。
- WASM runtime 文件不要放进 renderer dist。
- backend 通过 Electron main 注入的 `LOCAL_MODEL_RESOURCE_ROOT`、`LOCAL_MODEL_USER_DATA_DIR`、`LOCAL_ONNX_WASM_ROOT` 定位。
- 生产态只打包 `tar.br + manifest`，不复制 raw 模型目录。


## Runtime Resolver

backend 侧资源解析模块集中处理模型资源路径，避免路径散落：

```text
server/src/services/local-model-runtime/resource-resolver.ts
```

职责：

- 接收显式注入的开发态模型路径，不在 backend 内部默认指向 `.artifacts`
- Electron 生产态读取 `resources/model-packs` 和 `resources/model-runtime`
- 解压模型包到 userData
- 校验 manifest checksum
- 写入 `.ready`
- 返回可给 `onnxruntime-web` 和 tokenizer 使用的普通文件路径

环境变量：

```text
LOCAL_MODEL_RAW_ROOT
LOCAL_ONNX_WASM_ROOT
LOCAL_MODEL_USER_DATA_DIR
LOCAL_MODEL_RESOURCE_ROOT
```

开发态可用环境变量覆盖；生产态由桌面壳层注入。

开发态 `localModelRuntime` 要求显式设置：

```text
LOCAL_MODEL_RAW_ROOT
LOCAL_ONNX_WASM_ROOT
```

如果未设置，runtime 会直接报错，不会兜底读取 `.artifacts`。`scripts/smoke-local-model-runtime.mjs` 和 `scripts/eval-local-model-runtime.mjs` 也只读取 `LOCAL_MODEL_RAW_ROOT`。

开发态优先顺序：

```text
1. 如果 LOCAL_MODEL_RAW_ROOT/manifest.json 存在，直接读取它
2. 如果只有 LOCAL_MODEL_RAW_ROOT 下的原始模型目录，runtime 现场合成 manifest
3. 生产态才读取 LOCAL_MODEL_RESOURCE_ROOT 下的打包 manifest + tar.br
```

生产态由 Electron 注入：

```text
LOCAL_MODEL_RESOURCE_ROOT=<resources>/model-packs
LOCAL_MODEL_USER_DATA_DIR=<app user data dir>
LOCAL_ONNX_WASM_ROOT=<resources>/model-runtime/onnxruntime-web
```

## 首启解压流程

```text
start backend
  -> resolve resource root
  -> read manifest
  -> check userData/models/<model>/.ready
  -> if missing:
       extract tar.br
       verify file sha256
       write .ready
  -> return local model path
```

失败策略：

- 默认 embedding 缺失：禁用本地语义检索，UI 显示模型资源缺失。
- reranker 缺失：降级到标准检索，不报错。
- checksum 失败：删除未完成目录，提示重新安装或重新下载模型包。

## 压缩策略

当前使用：

```text
model directory -> tar.br
```

Node 运行时解压：

- `node:zlib` 解 Brotli
- 内置 tar reader 解 tar 包

备选：

- `.zip` + `extract-zip` / `yauzl`
- zstd / 7z 暂不作为第一版默认 runtime 解压方案

2026-06-29 本地验证：

- embedding raw：约 134MB
- embedding `tar.br`：`81,285,741` bytes，约 77.5MB

注意：

- 已量化 ONNX 再压缩收益有限，通常只有 5%-20%。
- 更有效的顺序是先量化，再归档压缩。

## 验证项

本地运行：

```bash
pnpm smoke:local-model-runtime
pnpm eval:local-model-runtime
```

Electron release 验证：

```bash
pnpm package:electron:win
```

需要额外检查：

- release resources 中存在 `model-packs`
- release resources 中存在 `model-runtime/onnxruntime-web`
- 首启后 userData 中存在解压后的模型目录和 `.ready`
- 本地 embedding 可输出 384 维向量
- reranker 未安装时标准检索不报错

Tauri release 验证：

```bash
pnpm package:tauri:win
```

需要额外检查：

- `tauri/resources/model-packs`
- `tauri/resources/model-runtime`
- sidecar backend 能解析 resource dir
- 生产态不访问 Hugging Face

## 后续改进

- [ ] UI 增加模型资源状态：可用、缺失、解压中、校验失败。
- [ ] Electron packaged smoke test。
