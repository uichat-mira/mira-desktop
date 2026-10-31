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

describe("AppNavigationRail knowledge base entry", () => {
  it("no longer exposes the knowledge and evaluation entry", () => {
    renderRail("/knowledge-base");

    expect(screen.queryByRole("button", { name: "知识与评测" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "知识库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "评测中心" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/knowledge-base");
  });
});

describe("AppNavigationRail active highlight", () => {
  it("highlights the active entry with the theme color and the same icon weight as hover", () => {
    renderRail("/extensions/capabilities");

    const extensions = screen.getByRole("button", { name: "扩展" });
    const inactiveHelp = screen.getByRole("button", { name: "帮助" });

    expect(extensions).toHaveAttribute("aria-current", "page");
    expect(extensions.className).toContain("bg-primary/10");
    expect(extensions.className).toContain("text-primary");
    expect(extensions.className).not.toContain("text-text-primary");
    expect(extensions.querySelector("svg")).toHaveAttribute("stroke-width", "1.8");
    expect(inactiveHelp.querySelector("svg")).toHaveAttribute("stroke-width", "1.8");
  });

  it("applies the theme color highlight to the active rail link", () => {
    renderRail("/chat");

    const railHomeLink = screen.getAllByRole("link", { name: "主页" })[1];

    expect(railHomeLink).toHaveAttribute("aria-current", "page");
    expect(railHomeLink.className).toContain("bg-primary/10");
    expect(railHomeLink.className).toContain("text-primary");
    expect(railHomeLink.querySelector("svg")).toHaveAttribute("stroke-width", "1.8");
  });
});

describe("AppNavigationRail brand mark", () => {
  it("shows the product logo instead of the previous letter monogram", () => {
    renderRail();

    const [brandLink] = screen.getAllByRole("link", { name: "主页" });
    const logo = brandLink.querySelector("img");

    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("src")).toContain("uichat-logo-icon");
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(brandLink).not.toHaveTextContent("M");
  });
});

describe("AppNavigationRail remote access menu", () => {
  it("opens the phone menu without navigating away", async () => {
    renderRail();
    await userEvent.click(screen.getByRole("button", { name: "远程连接" }));

    expect(screen.getByRole("menuitem", { name: "远程连接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "云账号" })).toBeInTheDocument();
    const [firstItem, secondItem] = screen.getAllByRole("menuitem");
    expect(firstItem).toHaveTextContent("云账号");
    expect(secondItem).toHaveTextContent("远程连接");
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
