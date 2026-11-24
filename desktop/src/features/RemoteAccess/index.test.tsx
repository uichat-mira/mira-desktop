// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RemoteAccessSettings from "./index";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  check: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
}));

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "zh-CN" },
    t: (key: string) => key,
  }),
}));

vi.mock("@/shared/api/generalSettings", () => ({
  getTailscaleRemoteAccess: apiMocks.get,
  checkTailscaleRemoteAccess: apiMocks.check,
  updateTailscaleRemoteAccess: apiMocks.update,
  revokeTailscaleRemoteDevice: apiMocks.revoke,
}));

vi.mock("@/shared/api/remoteAccess", () => ({
  createRemotePairingChallenge: vi.fn(),
  getRemotePairingChallenge: vi.fn(),
  approveRemotePairingClaim: vi.fn(),
  rejectRemotePairingClaim: vi.fn(),
}));

vi.mock("@/shared/ui/Message", () => ({
  message: messageMocks,
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getApiBaseUrl: vi.fn(() => "http://localhost"),
  openExternalUrl: vi.fn(),
}));

const connectedSnapshot = {
  config: {
    enabled: false,
    servePort: 443,
    updatedAt: null,
  },
  runtime: {
    state: "connected" as const,
    installed: true,
    backendState: "Running",
    version: "1.90.0",
    deviceName: "studio-pc",
    dnsName: "studio-pc.real-tailnet.ts.net",
    tailnetName: "real-tailnet",
    tailnetDomain: "real-tailnet.ts.net",
    tailscaleIps: ["100.64.0.10"],
    serveConfigured: false,
    serveManagedByMira: false,
    accessUrl: "https://studio-pc.real-tailnet.ts.net",
    healthOk: null,
    checkedAt: "2026-08-01T00:00:00.000Z",
    error: null,
  },
  pairedDevices: [],
};

const readySnapshot = {
  ...connectedSnapshot,
  config: {
    ...connectedSnapshot.config,
    enabled: true,
    updatedAt: "2026-08-01T00:01:00.000Z",
  },
  runtime: {
    ...connectedSnapshot.runtime,
    state: "ready" as const,
    serveConfigured: true,
    serveManagedByMira: true,
    healthOk: true,
  },
};

beforeEach(() => {
  apiMocks.get.mockReset();
  apiMocks.check.mockReset();
  apiMocks.update.mockReset();
  apiMocks.revoke.mockReset();
  messageMocks.success.mockReset();
  messageMocks.error.mockReset();

  apiMocks.get.mockResolvedValue(connectedSnapshot);
  apiMocks.check.mockResolvedValue(connectedSnapshot);
  apiMocks.update.mockResolvedValue(readySnapshot);
});

describe("RemoteAccessSettings", () => {
  it("shows only Tailscale remote access without legacy Relay controls", async () => {
    render(<RemoteAccessSettings />);

    expect(await screen.findByText("Tailscale")).toBeInTheDocument();
    expect(screen.getByText("远程连接")).toBeInTheDocument();
    expect(screen.queryByText("Mira Relay")).not.toBeInTheDocument();
    expect(screen.queryByText("默认服务")).not.toBeInTheDocument();
    expect(screen.queryByText("自定义地址")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("https://relay.example.com"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Mira Relay" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("已连接")).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledTimes(1);
  });

  it("keeps pairing disabled until Tailscale Direct is ready", async () => {
    render(<RemoteAccessSettings />);

    await screen.findByText("Tailscale");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "配对新设备" })).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "配对新设备" }),
    ).toHaveAttribute("title", "请先让 Tailscale 远程访问就绪");
  });

  it("allows pairing when Tailscale Direct is ready", async () => {
    apiMocks.get.mockResolvedValue(readySnapshot);
    render(<RemoteAccessSettings />);

    await screen.findByText("Tailscale");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "配对新设备" })).toBeEnabled(),
    );
    expect(
      screen.getByRole("button", { name: "配对新设备" }),
    ).not.toHaveAttribute("title");
  });

  it("keeps runtime-discovered device configuration inside diagnostics", async () => {
    render(<RemoteAccessSettings />);

    await screen.findByText("Tailscale");
    expect(screen.queryByDisplayValue("studio-pc")).not.toBeInTheDocument();
    expect(screen.queryByText("设备配置")).not.toBeInTheDocument();
    expect(screen.queryByText("访问边界")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "诊断" }));

    expect(await screen.findByDisplayValue("studio-pc")).toBeDisabled();
    expect(screen.getByDisplayValue("real-tailnet.ts.net")).toBeDisabled();
    expect(
      screen.getByText("https://studio-pc.real-tailnet.ts.net"),
    ).toBeInTheDocument();
    expect(screen.getByText("暂无已配对设备")).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledTimes(1);
  });

  it("checks the backend and saves an enabled Tailscale draft", async () => {
    render(<RemoteAccessSettings />);

    await screen.findByText("Tailscale");

    await userEvent.click(
      screen.getByRole("switch", { name: "启用 Tailscale" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "诊断" }));
    await waitFor(() => expect(apiMocks.check).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiMocks.update).toHaveBeenCalledWith(true));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("诊断信息")).toBeInTheDocument();
    expect(screen.getByText("1.90.0")).toHaveClass("break-words");
    expect(screen.getByText("1.90.0")).not.toHaveClass("break-all");

    await waitFor(() => {
      expect(messageMocks.success).toHaveBeenCalledWith("Tailscale 设置已保存");
    });
    expect(await screen.findByText("可访问")).toBeInTheDocument();
  });

  it("keeps Tailscale help explicit", async () => {
    render(<RemoteAccessSettings />);
    await screen.findByText("Tailscale");

    await userEvent.click(
      screen.getByRole("button", { name: "Tailscale 帮助" }),
    );

    expect(
      screen.getByText(
        "Mira 只发布本机 Host 到私有 Tailnet，不启用 Funnel，也不会覆盖已有的其他 Serve 配置。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("继续使用 Mira 认证")).toBeInTheDocument();
  });
});
