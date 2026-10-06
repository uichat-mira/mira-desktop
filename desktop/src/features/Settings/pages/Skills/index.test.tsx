// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillCatalogItem, SkillDetail, SkillFileDescriptor } from "@/shared/api/skills";
import SkillsSettings from "./index";

const api = vi.hoisted(() => ({
  deleteSkill: vi.fn(),
  getSkillCatalog: vi.fn(),
  getSkillDetail: vi.fn(),
  getSkillFileContent: vi.fn(),
  importSkillMarkdown: vi.fn(),
  installSkillRuntime: vi.fn(),
  updateSkill: vi.fn(),
}));

const metadataTranslations: Record<string, string> = {
  "settings.skills.metadata.labels.executionContext": "执行模式",
  "settings.skills.metadata.labels.executionAgent": "执行智能体",
  "settings.skills.metadata.labels.allowedTools": "可用工具",
  "settings.skills.metadata.labels.workspaceBound": "工作区范围",
  "settings.skills.metadata.values.executionContext.fork": "独立执行",
  "settings.skills.metadata.values.executionAgent.subAgent": "子智能体",
  "settings.skills.metadata.values.workspaceBound.true": "仅当前工作区",
  "settings.skills.metadata.values.tools.read": "读取文件",
  "settings.skills.metadata.values.tools.terminalSession": "终端",
};

vi.mock("@/shared/api/skills", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      metadataTranslations[key] ?? options?.defaultValue ?? key,
  }),
}));

const createSkill = (
  status: SkillCatalogItem["runtime"]["status"],
): SkillCatalogItem => ({
  id: "xlsx",
  version: "1.0.0",
  name: "Spreadsheet Skill",
  source: "UIChat Mira",
  category: "办公效率",
  description: "Create and edit spreadsheets.",
  origin: "built-in",
  featured: true,
  runtimeRequirements: ["wenshu-office@1"],
  runtime: {
    requirements: ["wenshu-office@1"],
    status,
  },
});

const createDetail = (
  status: SkillCatalogItem["runtime"]["status"],
  files: SkillFileDescriptor[] = [],
): SkillDetail => ({
  ...createSkill(status),
  files,
});

const openDetail = async () => {
  const user = userEvent.setup();
  render(<SkillsSettings />);
  await user.click(await screen.findByRole("button", { name: /Spreadsheet Skill/ }));
  await screen.findByRole("button", { name: "关闭" });
  return user;
};

describe("SkillsSettings detail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not show use or uninstall actions for an available skill", async () => {
    const skill = createSkill("available");
    api.getSkillCatalog.mockResolvedValue({ skills: [skill] });
    api.getSkillDetail.mockResolvedValue(createDetail("available"));

    await openDetail();

    expect(screen.queryByRole("button", { name: "去使用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安装" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "卸载" })).not.toBeInTheDocument();
  });

  it("installs a missing runtime and hides the action after success", async () => {
    const missingSkill = createSkill("not-installed");
    const installedDetail = createDetail("available");
    api.getSkillCatalog
      .mockResolvedValueOnce({ skills: [missingSkill] })
      .mockResolvedValueOnce({ skills: [createSkill("available")] });
    api.getSkillDetail.mockResolvedValue(createDetail("not-installed"));
    api.installSkillRuntime.mockResolvedValue(installedDetail);

    const user = await openDetail();
    await user.click(screen.getByRole("button", { name: "安装" }));

    await waitFor(() => expect(api.installSkillRuntime).toHaveBeenCalledWith("xlsx"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "安装" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "去使用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "卸载" })).not.toBeInTheDocument();
  });

  it("localizes known Skill metadata and preserves unknown fields", async () => {
    const skill = createSkill("available");
    const entry: SkillFileDescriptor = {
      path: "SKILL.md",
      name: "SKILL.md",
      kind: "entry",
      extension: ".md",
      mimeType: "text/markdown",
      size: 256,
      previewable: true,
      contentAvailable: true,
      declaredOnly: false,
    };
    api.getSkillCatalog.mockResolvedValue({ skills: [skill] });
    api.getSkillDetail.mockResolvedValue(createDetail("available", [entry]));
    api.getSkillFileContent.mockResolvedValue({
      path: "SKILL.md",
      mimeType: "text/markdown",
      size: 256,
      truncated: false,
      content: [
        "---",
        "execution.context: fork",
        "execution.agent: subAgent",
        "execution.allowedTools: read, terminal",
        "execution.workspaceBound: true",
        "customField: keep-me",
        "---",
        "# Instructions",
      ].join("\n"),
    });

    await openDetail();

    expect(await screen.findByText("执行模式")).toBeInTheDocument();
    expect(screen.getByText("独立执行")).toBeInTheDocument();
    expect(screen.getByText("执行智能体")).toBeInTheDocument();
    expect(screen.getByText("子智能体")).toBeInTheDocument();
    expect(screen.getByText("可用工具")).toBeInTheDocument();
    expect(screen.getByText("读取文件、终端")).toBeInTheDocument();
    expect(screen.getByText("工作区范围")).toBeInTheDocument();
    expect(screen.getByText("仅当前工作区")).toBeInTheDocument();
    expect(screen.getByText("customField")).toBeInTheDocument();
    expect(screen.getByText("keep-me")).toBeInTheDocument();
    expect(screen.queryByText("execution.context")).not.toBeInTheDocument();
    expect(screen.queryByText("execution.allowedTools")).not.toBeInTheDocument();
  });
});
