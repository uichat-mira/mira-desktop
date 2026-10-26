// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppNavigationRail } from "./AppNavigationRail";

vi.mock("@/app/providers/AuthProvider", () => ({
  useAuth: () => ({
    session: { user: { username: "tester" } },
    logout: vi.fn(),
  }),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "app.navigation.primary": "主导航",
        "app.navigation.home": "主页",
        "app.navigation.remoteAccess": "远程连接",
        "app.navigation.cloudAccount": "云账号",
        "app.navigation.dashboard": "工作台",
        "app.navigation.projects": "知识与评测",
        "app.navigation.knowledgeBase": "知识库",
        "app.navigation.evaluation": "评测中心",
        "app.navigation.extensions": "扩展",
        "app.navigation.capabilities": "能力",
        "app.navigation.connectors": "连接器",
        "app.navigation.skills": "技能",
        "app.navigation.forge": "淬行",
        "app.navigation.settings": "设置",
        "app.navigation.help": "帮助",
        "app.navigation.about": "关于",
        "app.navigation.development": "开发",
        "app.sidebar.logout": "退出登录",
      })[key] ?? key,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderRail(path = "/chat") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppNavigationRail />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("AppNavigationRail extensions menu", () => {
  it("opens Extensions with Capabilities, Connectors, and Skills entries", async () => {
    renderRail();

    await userEvent.click(screen.getByRole("button", { name: "扩展" }));

    expect(screen.getByRole("menuitem", { name: "能力" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "连接器" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "技能" })).toBeInTheDocument();
  });

  it.each([
    ["远程连接", "远程连接", "/remote-access"],
    ["远程连接", "云账号", "/cloud-account"],
    ["扩展", "能力", "/extensions/capabilities"],
    ["扩展", "连接器", "/extensions/connectors"],
    ["扩展", "技能", "/extensions/skills"],
    ["知识与评测", "知识库", "/knowledge-base"],
    ["知识与评测", "评测中心", "/evaluation/center"],
    ["帮助", "关于", "/about"],
    ["帮助", "开发", "/development/logs"],
    ["tester", "设置", "/settings/general"],
  ])("routes %s → %s to %s", async (trigger, item, expectedPath) => {
    renderRail();

    await userEvent.click(screen.getByRole("button", { name: trigger }));
    await userEvent.click(screen.getByRole("menuitem", { name: item }));

    expect(screen.getByTestId("location")).toHaveTextContent(expectedPath);
  });
});

describe("AppNavigationRail remote access menu", () => {
  it("opens the phone menu without navigating away", async () => {
    renderRail();
    await userEvent.click(screen.getByRole("button", { name: "远程连接" }));

    expect(screen.getByRole("menuitem", { name: "远程连接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "云账号" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "远程连接" })).toHaveFocus();
  });

  it.each(["/remote-access", "/cloud-account"])("highlights the phone entry at %s", (path) => {
    renderRail(path);
    expect(screen.getByRole("button", { name: "远程连接" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "设置" })).not.toHaveAttribute("aria-current");
  });
});
