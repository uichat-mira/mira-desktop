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
        "app.navigation.dashboard": "工作台",
        "app.navigation.projects": "知识与评测",
        "app.navigation.knowledgeBase": "知识库",
        "app.navigation.evaluation": "评测中心",
        "app.navigation.extensions": "扩展",
        "app.navigation.tools": "工具",
        "app.navigation.mcp": "MCP",
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
  it("opens Extensions with Tools, MCP, and Skills entries", async () => {
    renderRail();

    await userEvent.click(screen.getByRole("button", { name: "扩展" }));

    expect(screen.getByRole("menuitem", { name: "工具" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "技能" })).toBeInTheDocument();
  });

  it("routes the Tools entry to the new Extensions surface", async () => {
    renderRail();

    await userEvent.click(screen.getByRole("button", { name: "扩展" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "工具" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/extensions/tools");
  });
});
