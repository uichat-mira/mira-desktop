// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountSettings from "../index";

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

describe("DSK-005 Cloud Account settings", () => {
  it("fails closed in a non-native shell without prompting for a password or local JWT", () => {
    render(<AccountSettings />);
    expect(screen.getByText(/此构建尚不支持原生 Cloud OAuth/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /系统浏览器登录/ })).not.toBeInTheDocument();
  });

  it("starts OAuth using only explicitly selected scopes", async () => {
    const signIn = vi.fn().mockResolvedValue({ ...empty, status: "authorizing" });
    const signOut = vi.fn().mockResolvedValue(empty);
    const status = vi.fn().mockResolvedValue(empty);
    const subscribe = vi.fn().mockReturnValue(() => {});
    window.cloudAccount = { signIn, signOut, status, subscribe };
    render(<AccountSettings />);
    await screen.findByText("当前未登录云账号");
    fireEvent.click(screen.getByLabelText("读取会话"));
    fireEvent.click(screen.getByRole("button", { name: /使用系统浏览器登录云账号/ }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(["threads:read"]));
    expect(signIn.mock.calls[0][0]).not.toContain("tools:invoke");
    expect(subscribe).toHaveBeenCalled();
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
      status, signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(empty),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<AccountSettings />);
    expect(await screen.findByText("cloud-owner")).toBeInTheDocument();
    expect(screen.getByText("读取会话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /使用系统浏览器登录云账号/ })).not.toBeInTheDocument();
  });
});
