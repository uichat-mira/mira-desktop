# MiraDocs create_site 固定脚手架（@uichat-mira/docs 0.1.1）

本模板是 `create_site` 的版本化施工输入，不是参考文章。

执行时只替换标记为 `{{...}}` 的参数。不要读取 npm README、`node_modules` 类型声明或搜索网络来重新推导同一套文件。模板版本与 `@uichat-mira/docs` 版本绑定；升级依赖时必须新增版本化模板或显式更新本文件及测试。

## 1. 固定文件清单

```text
package.json
tsconfig.json
index.html
vite.config.ts
mira-docs.config.ts
src/main.tsx
content/docs/getting-started.md        # contentMode 包含 docs
content/blogs/welcome.md                # contentMode 包含 blog
README.md
.gitignore
.github/workflows/pages.yml             # deployment = github_pages
package-lock.json                       # npm install 后生成并随源码写入远程
```

只生成当前 `contentMode` 需要的内容入口。不得把 `node_modules`、`dist`、本地缓存或 staging 元数据写入远程。

## 2. 参数

```text
{{targetMode}}        local / new_github_repo / existing_github_repo
{{deployment}}        none / github_pages
{{packageName}}       kebab-case npm 包名
{{siteName}}          站点显示名称
{{description}}       站点描述
{{contentMode}}       docs / blog / docs_and_blog
{{currentDate}}       YYYY-MM-DD
{{owner}}             GitHub owner，仅 GitHub 模式
{{repository}}        GitHub repository name，仅 GitHub 模式
{{defaultBranch}}     workflow 监听分支，仅 deployment = github_pages
{{siteUrl}}           GitHub Pages URL 草案，仅 deployment = github_pages
```

参数规则：

- `targetMode = local` 时，不要求也不得虚构 `owner`、`repository`、`defaultBranch` 或 `siteUrl`；配置文件省略 `siteUrl` 与 `github`，不生成 Pages workflow。
- GitHub 项目站：`siteUrl = https://<owner>.github.io/<repository>/`。
- GitHub 用户或组织根站：当 `repository = <owner>.github.io` 时，`siteUrl = https://<owner>.github.io/`，不得重复追加仓库名。
- `siteUrl` 只是施工草案；配置 Pages 后必须以远程回读 URL 为准。

## 3. package.json

```json
{
  "name": "{{packageName}}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@uichat-mira/docs": "0.1.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.18.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.4",
    "typescript": "^5.9.3",
    "vite": "^7.2.2"
  }
}
```

## 4. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client", "node"]
  },
  "include": ["src", "vite.config.ts", "mira-docs.config.ts"]
}
```

## 5. index.html

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{siteName}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## 6. vite.config.ts

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveGithubPagesBase } from "@uichat-mira/docs";
import { miraDocs } from "@uichat-mira/docs/vite";
import config from "./mira-docs.config";

const base = resolveGithubPagesBase(process.env.GITHUB_REPOSITORY);

export default defineConfig({
  base,
  plugins: [
    react(),
    miraDocs({
      contentDir: "content",
      config,
      staticRoutes: true,
    }),
  ],
});
```

不要手写 `/<repository>/` base；使用 `resolveGithubPagesBase`，本地构建时保持 `/`，GitHub Actions 中根据 `GITHUB_REPOSITORY` 解析仓库子路径。

## 7. mira-docs.config.ts

根据启用的内容入口保留对应 navigation 项。

### GitHub 模式

```ts
import { defineMiraDocsConfig } from "@uichat-mira/docs";

export default defineMiraDocsConfig({
  title: "{{siteName}}",
  description: "{{description}}",
  siteUrl: "{{siteUrl}}",
  github: "https://github.com/{{owner}}/{{repository}}",
  navigation: [
    { label: "文档", href: "/docs/getting-started" },
    { label: "博客", href: "/blogs/welcome" }
  ],
  footer: "{{siteName}} · Powered by MiraDocs.",
});
```

### 本地模式

`targetMode = local` 时使用本地变体，省略 GitHub 专属字段：

```ts
import { defineMiraDocsConfig } from "@uichat-mira/docs";

export default defineMiraDocsConfig({
  title: "{{siteName}}",
  description: "{{description}}",
  navigation: [
    { label: "文档", href: "/docs/getting-started" },
    { label: "博客", href: "/blogs/welcome" }
  ],
  footer: "{{siteName}} · Powered by MiraDocs.",
});
```

## 8. src/main.tsx

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { MiraDocsApp, type MiraDoc } from "@uichat-mira/docs";
import "@uichat-mira/docs/styles.css";
import docs from "virtual:mira-docs/content";
import config from "../mira-docs.config";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MiraDocsApp
      config={config}
      docs={docs as MiraDoc[]}
      basePath={import.meta.env.BASE_URL}
    />
  </React.StrictMode>,
);
```

## 9. content/docs/getting-started.md

```md
---
title: "开始使用"
description: "{{siteName}} 的示例文档入口。"
---

# 开始使用

这是一个 MiraDocs 示例文档，用于验证内容发现、静态路由与构建结果。

## 下一步

请用真实内容替换本页，或继续发布新的 Markdown 文档。
```

## 10. content/blogs/welcome.md

```md
---
title: "欢迎来到 {{siteName}}"
description: "{{siteName}} 的示例博客文章。"
date: {{currentDate}}
category: "示例"
tags: ["MiraDocs", "开始"]
---

# 欢迎来到 {{siteName}}

这是用于验证博客入口和静态页面生成的示例文章，不代表用户的正式内容。

## 站点已经具备

- Markdown 内容发现
- 静态页面生成
- Sitemap 与 robots.txt
- GitHub Pages 部署工作流（仅 `deployment = github_pages` 时保留）
```

## 11. .gitignore

```gitignore
node_modules/
dist/
.vite/
*.log
.DS_Store
```

## 12. README.md

### deployment = github_pages

````md
# {{siteName}}

基于 `@uichat-mira/docs@0.1.1`、Vite 与 React 构建。

## 本地运行

```bash
npm ci
npm run dev
```

## 验证

```bash
npm run typecheck
npm run build
```

## 部署

推送到 `{{defaultBranch}}` 后，`.github/workflows/pages.yml` 构建 `dist` 并部署到 GitHub Pages。
````

### deployment = none

````md
# {{siteName}}

基于 `@uichat-mira/docs@0.1.1`、Vite 与 React 构建。

## 本地运行

```bash
npm ci
npm run dev
```

## 验证

```bash
npm run typecheck
npm run build
```

## 部署

当前未配置自动部署。需要上线时再添加 GitHub Pages 或其他部署方式。
````

## 13. .github/workflows/pages.yml

仅在 `deployment = github_pages` 时生成。`{{defaultBranch}}` 必须来自仓库回读结果，不得猜测为 `main`。

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches:
      - {{defaultBranch}}
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci --no-audit --no-fund

      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build

      - name: Configure Pages
        uses: actions/configure-pages@v5
        with:
          enablement: true

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

默认远程写入目标应为回读得到的默认分支，使 workflow 在写入后直接触发。用户或仓库策略明确要求 PR 时，只能先交付 PR 与构建验证；Pages 部署要等合并到 `{{defaultBranch}}` 后再继续，不得把未触发的 workflow 宣称为成功。

## 14. 固定本地命令

在 exact staging 根目录执行，不拆成探索性命令：

```text
npm install --no-audit --no-fund
npm run typecheck
npm run build
```

`npm install` 成功后必须确认生成 `package-lock.json`。构建验证只检查已知输出：

```text
dist/index.html
dist/404.html
dist/sitemap.xml
dist/robots.txt
```

内容页数量按 `contentMode` 验证。已知目录清单优先使用 `list`，按路径模式找输出使用 `glob`，不要为反复 `dir` / `ls` 申请 Terminal 审批。

## 15. 禁止临场探索

以下行为不属于正常 create_site 阶段：

```text
读取 npm README 来推导 MiraDocsApp
搜索 node_modules 的 .d.ts 来猜 API
多次创建不同入口文件试错
多次改写 vite.config.ts 试 base path
临时搜索或自由生成 Pages workflow
重复安装依赖、重复 typecheck、重复 build
```

模板落盘后如果固定命令失败，允许根据错误证据修复当前失败层；不得从头重新研究整个脚手架。
