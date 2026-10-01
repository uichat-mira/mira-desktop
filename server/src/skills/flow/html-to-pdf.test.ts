import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareHtmlForVivliostyle,
  resolveVivliostyleCliExecutable,
  resolveVivliostyleSpawnInvocation,
} from "./html-to-pdf.js";

describe("prepareHtmlForVivliostyle", () => {
  it("uses named pages and margin boxes without retaining fixed header elements", () => {
    const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>林女士 · 生育力综合评估报告</title></head>
<body>
  <div class="print-header"><span>圆姐聊女性全周期服务</span><span>林女士 · 专属评估报告</span></div>
  <div class="print-footer"><span>本报告用于健康教育与就诊准备。</span><span>Mira 服务团队</span></div>
  <main class="report">
    <header class="cover"><h1>林女士 · 生育力综合评估报告</h1></header>
    <section class="section"><h2>服务团队先看结论</h2><p>保留正文内容。</p></section>
  </main>
</body>
</html>`;

    const result = prepareHtmlForVivliostyle(html);

    expect(result).toContain('id="mira-vivliostyle-print"');
    expect(result).toContain("@page mira-cover");
    expect(result).toContain("@page mira-report");
    expect(result).toContain('content: "圆姐聊女性全周期服务"');
    expect(result).toContain('content: "林女士 · 专属评估报告"');
    expect(result).toContain('content: "本报告用于健康教育与就诊准备。"');
    expect(result).toContain('content: "第 " counter(page) " 页"');
    expect(result).toContain("page: mira-cover");
    expect(result).toContain("page: mira-report");
    expect(result).not.toContain('class="print-header"');
    expect(result).not.toContain('class="print-footer"');
    expect(result).toContain("保留正文内容。");
  });
});

// Vivliostyle resolution here is specified against the Windows packaged
// layout (.local-runtimes / .artifacts plus .cmd shims). On POSIX hosts the
// same Windows paths cannot resolve, so this suite is Windows-only.
describe.skipIf(process.platform !== "win32")("Vivliostyle Windows runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves the pinned .local-runtimes command before staged artifacts", () => {
    const projectRoot = String.raw`C:\workspace with spaces\rag-demo`;
    const localCli = path.win32.join(
      projectRoot,
      ".local-runtimes",
      "vivliostyle",
      "11.1.0",
      "node_modules",
      ".bin",
      "vivliostyle.cmd",
    );
    const stagedCli = path.win32.join(
      projectRoot,
      ".artifacts",
      "vivliostyle-runtime",
      "node_modules",
      ".bin",
      "vivliostyle.cmd",
    );

    vi.stubEnv("MIRA_VIVLIOSTYLE_CLI_PATH", "");
    vi.spyOn(process, "cwd").mockReturnValue(
      path.win32.join(projectRoot, "server"),
    );
    vi.spyOn(fs, "existsSync").mockImplementation(
      (candidate) => candidate === localCli || candidate === stagedCli,
    );

    const resolved = resolveVivliostyleCliExecutable();

    expect(resolved).toBe(localCli);
  });

  it("passes paths with spaces as separate cmd.exe arguments without a shell", () => {
    const cliPath = String.raw`C:\Program Files\UIChat Mira\vivliostyle.cmd`;
    const browserPath = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
    const htmlPath = String.raw`C:\Temp Files\report source.html`;
    const outputPath = String.raw`C:\Users\Tester\AppData\Local\UIChat Mira\report output.pdf`;
    const args = [
      "build",
      htmlPath,
      "--output",
      outputPath,
      "--executable-browser",
      browserPath,
      "--log-level",
      "silent",
      "--no-vite-config-file",
    ];

    const invocation = resolveVivliostyleSpawnInvocation({
      cliPath,
      args,
      platform: "win32",
      comSpec: String.raw`C:\Windows\System32\cmd.exe`,
    });

    expect(invocation).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      args: ["/d", "/c", "call", cliPath, ...args],
      shell: false,
    });
    expect(invocation.args).toContain(browserPath);
    expect(invocation.args).toContain(htmlPath);
    expect(invocation.args).toContain(outputPath);
    expect(invocation.args).not.toContain(args.join(" "));
  });
});
