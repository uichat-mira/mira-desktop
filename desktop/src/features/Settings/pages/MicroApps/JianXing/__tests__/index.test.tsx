// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import JianXingPage from "../index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "settings.microApps.jianXing.page.title": "触界",
      "settings.microApps.jianXing.page.description": "连接当前 Chrome，在本机使用见行操作网页，或通过剪藏采集内容。",
      "settings.microApps.jianXing.page.guide": "使用指南",
      "settings.microApps.jianXing.tabs.jianxing": "见行",
      "settings.microApps.jianXing.tabs.clipper": "剪藏",
      "settings.microApps.jianXing.modes.look": "看",
      "settings.microApps.jianXing.fields.parameters": "参数",
      "settings.microApps.jianXing.fields.parametersHint": "先读取页面，再使用快照中的稳定引用执行操作。",
      "settings.microApps.jianXing.result.title": "页面结果",
      "settings.microApps.jianXing.connection.chrome": "Chrome 连接",
      "settings.microApps.jianXing.connection.nativeInstalled": "Native 已安装",
      "settings.microApps.jianXing.connection.extensionConnected": "扩展已连接",
      "settings.microApps.jianXing.connection.waitingExtension": "等待扩展",
      "settings.microApps.jianXing.connection.disconnected": "未连接",
      "settings.microApps.jianXing.connection.download": "下载插件",
      "settings.microApps.jianXing.connection.nativeUnavailable": "Native 不可用",
      "settings.microApps.jianXing.connection.authorize": "浏览器扩展授权",
      "settings.microApps.jianXing.auth.title": "浏览器扩展授权",
      "settings.microApps.jianXing.fields.operation": "操作方式",
      "settings.microApps.jianXing.fields.observe": "观察页面",
      "settings.microApps.jianXing.result.clear": "清空",
      "settings.microApps.jianXing.guide.title": "触界使用指南",
      "settings.microApps.jianXing.guide.close": "关闭使用指南",
      "settings.microApps.jianXing.guide.footerClose": "关闭",
      "settings.microApps.jianXing.auth.close": "关闭",
      "settings.microApps.jianXing.auth.generate": "生成授权码",
      "settings.microApps.jianXing.auth.copy": "复制",
      "settings.microApps.jianXing.guide.intro": "完成扩展、Native 和授权配置后，连接状态会自动同步到这里。",
      "settings.microApps.jianXing.guide.nativeTitle": "注册 Native Messaging",
      "settings.microApps.jianXing.guide.nativeBody": "在本页点击“安装 Native”或“修复 Native”。",
      "settings.microApps.jianXing.clipper.title": "URL 剪藏规则",
      "settings.microApps.jianXing.clipper.help": "URL 剪藏规则说明",
      "settings.microApps.jianXing.clipper.refresh": "刷新规则",
      "settings.microApps.jianXing.clipper.add": "新增规则",
      "settings.microApps.jianXing.rulesDrawer.addTitle": "新增 URL 剪藏规则",
      "settings.microApps.jianXing.rulesDrawer.editTitle": "编辑 URL 剪藏规则",
      "settings.microApps.jianXing.rulesDrawer.alias": "网站别名（可选）",
      "settings.microApps.jianXing.rulesDrawer.includeRegion": "正文区域",
      "settings.microApps.jianXing.rulesDrawer.selectInclude": "选择正文区域",
      "settings.microApps.jianXing.rulesDrawer.addExclude": "添加排除区域",
      "settings.microApps.jianXing.rulesDrawer.urlPattern": "URL 匹配规则",
      "settings.microApps.jianXing.rulesDrawer.matchHelp": "多个规则命中同一页面时，扩展使用约束最具体的一条。",
      "settings.microApps.jianXing.rules.alias": "别名",
      "settings.microApps.jianXing.rules.unnamed": "未命名",
      "settings.microApps.jianXing.rules.urlPattern": "网址匹配",
      "settings.microApps.jianXing.rules.regex": "正则",
      "settings.microApps.jianXing.rules.wildcard": "通配",
      "settings.microApps.jianXing.rules.content": "正文",
      "settings.microApps.jianXing.rules.images": "图片",
      "settings.microApps.jianXing.rules.status": "状态",
      "settings.microApps.jianXing.rules.actions": "操作",
      "settings.microApps.jianXing.rules.edit": "编辑规则",
      "settings.microApps.jianXing.rules.editAria": "编辑 JavBus 影片库 规则",
    }[key] || key),
  }),
}));

vi.mock("@/shared/api/webbridge", () => ({
  WebBridgeRequestError: class WebBridgeRequestError extends Error {},
  WebBridgeClient: class WebBridgeClient {
    onStatus(listener: (status: unknown) => void) {
      listener({ status: "connected", extensionConnected: true });
      return () => {};
    }

    close() {}

    requestClipRules() {
      return Promise.resolve({
        "wildcard:https://javbus.com/*": {
          alias: "JavBus 影片库",
          urlPattern: "https://javbus.com/*",
          urlPatternMode: "wildcard",
          enabled: true,
          includeSelector: "article",
          excludeSelectors: [],
          imagePolicy: { minWidth: 100, minHeight: 100, maxCount: 20 },
        },
      });
    }
  },
}));

vi.mock("@/shared/lib/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/request")>()),
  post: vi.fn(),
}));

vi.mock("@/shared/platform/desktopRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/platform/desktopRuntime")>()),
  downloadBrowserExtension: vi.fn(),
  getNativeMessagingHostStatus: vi.fn().mockResolvedValue({ status: "installed", installed: true }),
  installNativeMessagingHost: vi.fn(),
  uninstallNativeMessagingHost: vi.fn(),
}));

describe("JianXingPage", () => {
  it("disables extension download when the desktop runtime reports Native Messaging unsupported", async () => {
    const { getNativeMessagingHostStatus } = await import("@/shared/platform/desktopRuntime");
    vi.mocked(getNativeMessagingHostStatus).mockResolvedValueOnce({
      status: "unsupported",
      installed: false,
      reason: "Native Messaging 当前仅支持 Windows",
    });

    render(<JianXingPage />);

    expect(await screen.findByText("Native 不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载插件" })).toBeDisabled();
  });

  it("keeps connection controls above the JianXing and clipper tabs", async () => {
    render(<JianXingPage />);

    expect(screen.getByRole("heading", { name: "触界" })).toBeInTheDocument();
    expect(screen.getByText("Chrome 连接")).toBeInTheDocument();
    expect(await screen.findByText("Native 已安装")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "见行" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "剪藏" })).toBeInTheDocument();
    expect(screen.getByText("看 · 参数")).toBeInTheDocument();
    expect(screen.getByText("页面结果")).toBeInTheDocument();
  });

  it("opens and closes the usage guide from the page header", async () => {
    render(<JianXingPage />);

    await userEvent.click(screen.getByRole("button", { name: "使用指南" }));
    expect(screen.getByRole("heading", { name: "触界使用指南" })).toBeInTheDocument();
    expect(screen.getByText("注册 Native Messaging")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "触界使用指南" })).not.toBeInTheDocument());
  });

  it("shows active clipping content without exposing JianXing tools", async () => {
    render(<JianXingPage />);

    await userEvent.click(screen.getByRole("tab", { name: "剪藏" }));

    expect(screen.getByText("URL 剪藏规则")).toBeInTheDocument();
    expect(screen.getByLabelText("URL 剪藏规则说明")).toBeInTheDocument();
    expect(screen.queryByText(/只对已配置的网站生效/)).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "别名" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "网址匹配" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "正文" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新规则" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增规则" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "新增规则" }));

    expect(screen.getByText("新增 URL 剪藏规则")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择正文区域" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加排除区域" })).toBeInTheDocument();
    expect(screen.getByLabelText("URL 匹配规则")).toBeInTheDocument();
    expect(screen.getByText(/多个规则命中同一页面时/)).toBeInTheDocument();
    expect(screen.queryByText("看 · 参数")).not.toBeInTheDocument();
    expect(screen.queryByText("页面结果")).not.toBeInTheDocument();
  });

  it("edits a configured site from the explicit list action and keeps its alias visible", async () => {
    render(<JianXingPage />);

    await userEvent.click(screen.getByRole("tab", { name: "剪藏" }));
    expect(await screen.findByText("JavBus 影片库")).toBeInTheDocument();
    expect(screen.getByText("https://javbus.com/*")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑 JavBus 影片库 规则" }));
    expect(screen.getByText("编辑 URL 剪藏规则")).toBeInTheDocument();
    expect(screen.getByLabelText("网站别名（可选）")).toHaveValue("JavBus 影片库");
  });

  it("keeps copying the authorization code inline without opening an authorization page", async () => {
    const { post } = await import("@/shared/lib/request");
    vi.mocked(post).mockResolvedValueOnce({ code: "one-time-code" } as never);
    const postMessage = vi.spyOn(window, "postMessage");

    render(<JianXingPage />);
    await userEvent.click(screen.getByRole("button", { name: "浏览器扩展授权" }));
    await userEvent.click(screen.getByRole("button", { name: "生成授权码" }));

    const code = await screen.findByText("one-time-code");
    expect(code.parentElement).toContainElement(
      screen.getByRole("button", { name: "复制" }),
    );
    expect(screen.queryByRole("button", { name: "打开授权页" })).not.toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
