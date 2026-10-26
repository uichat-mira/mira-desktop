// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloudAccountPage from "../index";

const empty = {
  status: "signed_out" as const,
  account: null,
  hostId: null,
  scopes: [],
  expiresAt: null,
  permissionsConfigured: false,
  message: "",
};

afterEach(() => {
  delete window.cloudAccount;
  vi.restoreAllMocks();
});

describe("DSK-005 Cloud Account page", () => {
  it("fails closed in a non-native shell without prompting for a password or local JWT", () => {
    render(<CloudAccountPage />);
    expect(screen.getByText(/此构建尚不支持原生 Cloud OAuth/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /系统浏览器登录/ })).not.toBeInTheDocument();
  });

  it("starts OAuth using only explicitly selected scopes", async () => {
    const signIn = vi.fn().mockResolvedValue({ ...empty, status: "authorizing" });
    const signOut = vi.fn().mockResolvedValue(empty);
    const status = vi.fn().mockResolvedValue(empty);
    const subscribe = vi.fn().mockReturnValue(() => {});
    window.cloudAccount = { signIn, cancelSignIn: vi.fn(), retryHostSetup: vi.fn(),
      resetLocalCredentials: vi.fn(), signOut, status, subscribe };
    render(<CloudAccountPage />);
    await screen.findByText("当前未登录云账号");
    fireEvent.click(screen.getByLabelText("读取会话"));
    fireEvent.click(screen.getByRole("button", { name: /使用系统浏览器登录云账号/ }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(["threads:read"]));
    expect(signIn.mock.calls[0][0]).not.toContain("tools:invoke");
    expect(subscribe).toHaveBeenCalled();
  });

  it("provides a cancel action during browser authorization and returns to sign-in", async () => {
    const signIn = vi.fn().mockResolvedValue({ ...empty, status: "authorizing" });
    const cancelSignIn = vi.fn().mockResolvedValue(empty);
    window.cloudAccount = {
      status: vi.fn().mockResolvedValue(empty),
      signIn, cancelSignIn, retryHostSetup: vi.fn(), resetLocalCredentials: vi.fn(),
      signOut: vi.fn().mockResolvedValue(empty),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<CloudAccountPage />);
    await screen.findByText("当前未登录云账号");
    fireEvent.click(screen.getByRole("button", { name: /使用系统浏览器登录云账号/ }));
    fireEvent.click(await screen.findByRole("button", { name: "取消本次授权" }));
    await waitFor(() => expect(cancelSignIn).toHaveBeenCalledOnce());
    expect(await screen.findByText("当前未登录云账号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /使用系统浏览器登录云账号/ })).toBeEnabled();
  });

  it("retries incomplete Host setup without restarting the browser OAuth flow", async () => {
    const setupFailed = {
      ...empty, status: "setup_failed" as const,
      account: { id: "cloud-a", username: "cloud-owner" },
      message: "Host 权限未完成",
    };
    const retryHostSetup = vi.fn().mockResolvedValue({
      ...setupFailed, status: "signed_in", hostId: "host-1",
      scopes: ["threads:read"], permissionsConfigured: true,
    });
    const signIn = vi.fn();
    window.cloudAccount = {
      status: vi.fn().mockResolvedValue(setupFailed), signIn,
      cancelSignIn: vi.fn(), retryHostSetup, resetLocalCredentials: vi.fn(),
      signOut: vi.fn(), subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<CloudAccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重试 Host 权限设置" }));
    await waitFor(() => expect(retryHostSetup).toHaveBeenCalledOnce());
    expect(await screen.findByText("已保存的手机访问权限")).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("offers explicit recovery for unreadable Cloud credentials", async () => {
    const resetLocalCredentials = vi.fn().mockResolvedValue(empty);
    window.cloudAccount = {
      status: vi.fn().mockResolvedValue({
        ...empty, status: "unavailable",
        canResetCredentials: true,
        message: "本机加密 Cloud 凭据无法读取",
      }),
      signIn: vi.fn(), cancelSignIn: vi.fn(), retryHostSetup: vi.fn(),
      resetLocalCredentials, signOut: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<CloudAccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "重置本机 Cloud 凭据" }));
    await waitFor(() => expect(resetLocalCredentials).toHaveBeenCalledOnce());
    expect(await screen.findByText("当前未登录云账号")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /使用系统浏览器登录云账号/ })).toBeEnabled();
  });

  it("clears prior user's selected scopes before a second Cloud sign-in", async () => {
    let notify: ((state: Awaited<ReturnType<NonNullable<Window["cloudAccount"]>["status"]>>) => void) | undefined;
    const signIn = vi.fn().mockResolvedValue({ ...empty, status: "authorizing" });
    const signOut = vi.fn().mockResolvedValue(empty);
    window.cloudAccount = {
      status: vi.fn().mockResolvedValue(empty), signIn,
      cancelSignIn: vi.fn(), retryHostSetup: vi.fn(), resetLocalCredentials: vi.fn(),
      signOut, subscribe: vi.fn().mockImplementation((listener) => {
        notify = listener;
        return () => {};
      }),
    };
    render(<CloudAccountPage />);
    await screen.findByText("当前未登录云账号");
    fireEvent.click(screen.getByLabelText("控制工具"));
    notify?.({ ...empty, status: "signed_in",
      account: { id: "user-a", username: "owner-a" },
      hostId: "host-a", permissionsConfigured: true,
      scopes: ["tools:control"] });
    fireEvent.click(await screen.findByRole("button", { name: "退出云账号" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole("button", { name: /使用系统浏览器登录云账号/ }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith([]));
  });

  it("shows existing cloud account without reusing local credentials", async () => {
    const status = vi.fn().mockResolvedValue({
      ...empty,
      status: "signed_in",
      account: { id: "cloud-a", username: "cloud-owner" },
      hostId: "host-1",
      scopes: ["threads:read"],
      permissionsConfigured: true,
    });
    window.cloudAccount = {
      status, signIn: vi.fn(), cancelSignIn: vi.fn(), retryHostSetup: vi.fn(),
      resetLocalCredentials: vi.fn(), signOut: vi.fn().mockResolvedValue(empty),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<CloudAccountPage />);
    expect(await screen.findByText("cloud-owner")).toBeInTheDocument();
    expect(screen.getByText("读取会话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /使用系统浏览器登录云账号/ })).not.toBeInTheDocument();
  });
});
