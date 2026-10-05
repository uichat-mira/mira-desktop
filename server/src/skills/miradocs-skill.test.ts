import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extendedRepositorySchema } from "../mcp/tools/github-repository-extended.tool.js";
import { SkillLoader } from "./context/loader.js";
import { SkillMatcher } from "./context/matcher.js";
import { SkillContextProvider } from "./context/provider.js";
import { SkillRegistry, SkillScanner } from "./context/scanner.js";
import type { SkillManifest } from "./context/types.js";

const skillsRoot = path.dirname(fileURLToPath(import.meta.url));

const MIRADOCS_ALLOWED_TOOLS = [
  "list",
  "glob",
  "grep",
  "read",
  "terminal_session",
  "github_repository",
  "github_pull_request",
  "github_actions",
];

const loadMiraDocsManifest = async () => {
  const manifests = await new SkillScanner().scan([skillsRoot]);
  const manifest = manifests.find((candidate) => candidate.id === "miradocs");
  expect(manifest).toBeDefined();
  return manifest!;
};

const operationNames = (schema: Record<string, unknown>) =>
  ((schema.oneOf ?? []) as Array<Record<string, unknown>>).map((variant) => {
    const properties = variant.properties as Record<string, Record<string, unknown>>;
    return (properties.operation.enum as string[])[0];
  });

const loadResourceContent = async (
  loader: SkillLoader,
  manifest: SkillManifest,
  uri: string,
) => {
  const resources = await loader.listResources(manifest);
  const resource = resources.find((candidate) => candidate.uri === uri);
  expect(resource).toBeDefined();
  return (await loader.loadResource({ manifest, resource: resource! })).content;
};

describe("MiraDocs canonical Skill", () => {
  it("discovers one public Skill for site creation, content publishing, and maintenance", async () => {
    const manifest = await loadMiraDocsManifest();

    expect(manifest).toMatchObject({
      id: "miradocs",
      name: "MiraDocs 建站与内容发布",
      version: "0.1.0",
      source: "Mira Lab",
      category: "工程研发",
      execution: {
        context: "fork",
        agent: "miradocs",
        allowedTools: MIRADOCS_ALLOWED_TOOLS,
        runtimeBindings: [],
      },
    });
    expect(manifest.description).toContain("创建 MiraDocs 站点");
    expect(manifest.description).toContain("发布博客或文档");
    expect(manifest.description).toContain("维护已有站点");
    expect(manifest.entry.replaceAll("\\", "/")).toContain(
      "/skills/development/miradocs/SKILL.md",
    );
  });

  it("projects the maximum fork allowlist into SkillContext", async () => {
    const manifest = await loadMiraDocsManifest();
    const registry = new SkillRegistry({
      scan: async () => [manifest],
    } as SkillScanner);
    const provider = new SkillContextProvider(registry);

    const context = await provider.prepare({
      query: "帮我建一个 MiraDocs 文档站",
      messages: [],
    });

    expect(context?.primary?.execution).toEqual({
      context: "fork",
      agent: "miradocs",
      allowedTools: MIRADOCS_ALLOWED_TOOLS,
      runtimeBindings: [],
    });
    expect(context?.instruction).toContain(
      "primary.execution.allowedTools is the maximum tool allowlist for fork execution",
    );
    expect(context?.instruction).toContain(
      "absence of an unused optional tool must not block execution",
    );
  });

  it("loads only the three workflow references plus the shared draft, versioned scaffold, and examples", async () => {
    const manifest = await loadMiraDocsManifest();
    const loader = new SkillLoader();
    const content = await loader.loadContent(manifest);
    const resources = await loader.listResources(manifest);

    expect(content.body).toContain("一个 Skill，三个操作");
    expect(content.body).toContain("它不是 Tool，不注册能力");
    expect(content.body).toContain("V1 只做创建站点、发布博客或文档、维护已有站点");
    expect(content.body).toContain("不加入项目、里程碑、任务、决策或风险产品模型");
    expect(content.body).toContain("不修改 Main Agent、Planner、Agent Graph、Harness 审批或 C contract");
    expect(content.body).toContain("execution.allowedTools");
    expect(content.body).toContain("不是每次任务都必须具备的工具清单");
    expect(content.body).toContain("本地文件施工统一由 `terminal_session` 承担");
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "skill://miradocs/examples/conversations.md",
      "skill://miradocs/references/create-site.md",
      "skill://miradocs/references/maintain-site.md",
      "skill://miradocs/references/publish-content.md",
      "skill://miradocs/templates/create-site-v0.1.1.md",
      "skill://miradocs/templates/site-draft.md",
    ]);
  });

  it("keeps the three disclosed workflows consistent with the primary Skill", async () => {
    const manifest = await loadMiraDocsManifest();
    const loader = new SkillLoader();
    const content = await loader.loadContent(manifest);
    const createSite = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/references/create-site.md",
    );
    const publishContent = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/references/publish-content.md",
    );
    const maintainSite = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/references/maintain-site.md",
    );
    const conversations = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/examples/conversations.md",
    );
    const deliveryTemplate = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/templates/site-draft.md",
    );
    const createSiteScaffold = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/templates/create-site-v0.1.1.md",
    );

    expect(content.body).toContain("恢复任务时先回读 checkpoint");
    expect(createSite).toContain("github_repository.create");
    expect(createSite).toContain("不得再次调用 `create`");
    expect(createSite).toContain("Pages 必须保持 `not_run`");
    expect(publishContent).toContain("不要要求用户填写完整 frontmatter 表单");
    expect(publishContent).toContain("同名文件、标题或路由冲突时先说明冲突，不直接覆盖");
    expect(publishContent).toContain("不新建重复 PR");
    expect(publishContent).toContain("不能再次创建同名文件");
    expect(maintainSite).toContain("github_repository.get_pages");
    expect(maintainSite).toContain("github_repository.configure_pages");
    expect(maintainSite).toContain("不创建重复施工分支或重复 PR");
    expect(maintainSite).toContain("只重试未完成的 `configure_pages`");
    expect(conversations).toContain("不会重复创建仓库");
    expect(conversations).toContain("不重新创建仓库、重写内容、重新安装或重新构建");
    expect(deliveryTemplate).toContain("completed");
    expect(deliveryTemplate).toContain("blocked");
    expect(deliveryTemplate).toContain("failed");
    expect(deliveryTemplate).toContain("not_run");
    expect(deliveryTemplate).toContain("恢复入口必须指向第一个未完成阶段");
    expect(createSiteScaffold).toContain("@uichat-mira/docs\": \"0.1.1");
    expect(createSiteScaffold).toContain("resolveGithubPagesBase");
    expect(createSiteScaffold).toContain("actions/configure-pages@v5");
    expect(createSiteScaffold).toContain("actions/upload-pages-artifact@v4");
    expect(createSiteScaffold).toContain("actions/deploy-pages@v4");
    expect(createSiteScaffold).toContain("targetMode = local");
    expect(createSiteScaffold).toContain("省略 `siteUrl` 与 `github`");
    expect(createSiteScaffold).toContain("repository = <owner>.github.io");
    expect(createSiteScaffold).toContain("### deployment = none");
    expect(createSiteScaffold).toContain("````md");
  });

  it("makes GitHub Pages the create-site default and fixes the execution stages", async () => {
    const manifest = await loadMiraDocsManifest();
    const loader = new SkillLoader();
    const content = await loader.loadContent(manifest);
    const createSite = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/references/create-site.md",
    );
    const conversations = await loadResourceContent(
      loader,
      manifest,
      "skill://miradocs/examples/conversations.md",
    );

    expect(content.body).toContain("github.deployment: github_pages");
    expect(content.body).toContain("local.deployment: none");
    expect(content.body).toContain("允许直接写默认分支");
    expect(content.body).toContain("inspect_target");
    expect(content.body).toContain("verify_pages");
    expect(createSite).toContain("GitHub 目标默认 `github_pages`");
    expect(createSite).toContain("只执行第一个未完成阶段");
    expect(createSite).toContain("不得通过 npm README");
    expect(createSite).toContain("PR 不是默认必需阶段");
    expect(conversations).toContain("部署：GitHub Pages（默认）");
    expect(conversations).toContain("先不部署");
    expect(conversations).toContain("Actions 与 GitHub Pages 将标记为 not_run");
  });

  it("binds the GitHub site workflow to the repository capabilities available on dev", async () => {
    const manifest = await loadMiraDocsManifest();
    const content = await new SkillLoader().loadContent(manifest);
    const operations = operationNames(
      extendedRepositorySchema as unknown as Record<string, unknown>,
    );

    for (const operation of [
      "create",
      "ensure_installation_access",
      "get_pages",
      "configure_pages",
    ]) {
      expect(operations).toContain(operation);
      expect(content.body).toContain(`github_repository.${operation}`);
    }

    expect(content.body).toContain("已经真实暴露的能力，不应被 Skill 人为回避");
    expect(content.body).toContain("新仓库创建后必须检查 installation 授权");
    expect(content.body).toContain("Pages 配置后必须回读最终状态和 URL");
  });

  it("matches MiraDocs product names and the three user operations", async () => {
    const manifest = await loadMiraDocsManifest();
    const matcher = new SkillMatcher();

    expect(
      matcher.match({
        query: "帮我建一个 MiraDocs 文档站",
        messages: [],
        manifests: [manifest],
      }).primary,
    ).toMatchObject({
      skillId: "miradocs",
      source: "exact",
      score: 0.97,
    });

    expect(
      matcher.match({
        query: "把这篇文章发成博客",
        messages: [],
        manifests: [manifest],
      }).primary,
    ).toMatchObject({
      skillId: "miradocs",
      source: "exact",
      score: 0.88,
    });

    expect(
      matcher.match({
        query: "这个文档站构建失败了，帮我诊断修复",
        messages: [],
        manifests: [manifest],
      }).primary,
    ).toMatchObject({
      skillId: "miradocs",
      source: "exact",
      score: 0.84,
    });

    expect(
      matcher.match({
        query: "帮我建个网站",
        messages: [],
        manifests: [manifest],
      }).primary,
    ).toMatchObject({
      skillId: "miradocs",
      source: "semantic",
      score: 0.68,
    });
  });

  it("does not restore the removed project-management productization intent", async () => {
    const manifest = await loadMiraDocsManifest();
    const matcher = new SkillMatcher();

    expect(
      matcher.match({
        query: "把项目内容模型、里程碑和决策做成文档站产品",
        messages: [],
        manifests: [manifest],
      }),
    ).toEqual({ primary: null, secondary: [] });
  });
});
