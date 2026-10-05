import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SkillLoader } from "./context/loader.js";
import { SkillContextProvider } from "./context/provider.js";
import { SkillRegistry, SkillScanner } from "./context/scanner.js";

const skillsRoot = path.dirname(fileURLToPath(import.meta.url));

const loadManifest = async () => {
  const manifests = await new SkillScanner().scan([skillsRoot]);
  const manifest = manifests.find(
    (candidate) => candidate.id === "wechat-article-layout",
  );
  expect(manifest).toBeDefined();
  return manifest!;
};

describe("WeChat article layout Skill", () => {
  it("discovers as a built-in fork Skill using the governed terminal", async () => {
    const manifest = await loadManifest();

    expect(manifest).toMatchObject({
      id: "wechat-article-layout",
      name: "微信公众号文章排版",
      version: "0.1.0",
      source: "Mira Lab",
      origin: "built-in",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: ["read", "terminal_session"],
        runtimeBindings: [],
        workspaceBound: true,
      },
    });
  });

  it("ships the generator and dark-mode reference as progressively disclosed resources", async () => {
    const manifest = await loadManifest();
    const loader = new SkillLoader();
    const resources = await loader.listResources(manifest);

    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "skill://wechat-article-layout/references/dark-mode-mapping.md",
      "skill://wechat-article-layout/scripts/build_wechat_html.py",
    ]);
  });

  it("keeps the agent instructions concise and operational", async () => {
    const manifest = await loadManifest();
    const registry = new SkillRegistry({
      scan: async () => [manifest],
    } as SkillScanner);
    const provider = new SkillContextProvider(registry);
    const context = await provider.prepare({
      query: "$wechat-article-layout 帮我把这篇文章排成公众号可粘贴 HTML",
      messages: [
        {
          role: "user",
          content: "$wechat-article-layout 帮我把这篇文章排成公众号可粘贴 HTML",
        },
      ],
    });
    const body = context?.primary?.body ?? "";

    expect(context?.primary?.id).toBe("wechat-article-layout");
    expect(body.length).toBeLessThan(3_000);
    expect(body).toContain(
      "请选择排版风格：终端暗黑、清爽简约、杂志暖调、学术规整",
    );
    expect(body).toContain("杂志/暖调/暖色 → `magazine-warm`");
    expect(body).toContain("不要要求用户输入英文枚举");
    expect(body).toContain("本轮上传文件");
    expect(body).toContain("skill_read_resource");
    expect(body).toContain("workspacePath");
    expect(body).toContain("--output article-wechat.html");
    expect(body).toContain("禁止把脚本源码拼进 `terminal_session.command`");
    expect(body).toContain("没有真实文件 Evidence 不得宣称完成");
    expect(body).not.toContain("原样写到");
    expect(body).not.toContain("不注册专用 Runtime");
    expect(body).not.toContain("Harness");
  });

  it("uses only Python standard-library imports", async () => {
    const manifest = await loadManifest();
    const loader = new SkillLoader();
    const resources = await loader.listResources(manifest);
    const scriptResource = resources.find(
      (resource) => resource.uri.endsWith("/scripts/build_wechat_html.py"),
    );
    expect(scriptResource).toBeDefined();

    const script = await loader.loadResource({
      manifest,
      resource: scriptResource!,
    });
    const imports = [...script.content.matchAll(/^import\s+([a-zA-Z0-9_]+)/gm)].map(
      (match) => match[1],
    );

    expect(imports).toEqual(["argparse", "os", "re"]);
    expect(script.content).not.toMatch(/\b(?:requests|bs4|PIL|markdown|mistune)\b/);
    expect(script.content).not.toContain("pip install");
  });
});
