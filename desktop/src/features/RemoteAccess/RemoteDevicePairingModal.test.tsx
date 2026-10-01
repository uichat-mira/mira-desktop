// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RemoteDevicePairingModal from "./RemoteDevicePairingModal";

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "zh-CN" },
  }),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, title }: { value: string; title: string }) => (
    <svg title={title} data-value={value} />
  ),
}));

vi.mock("@/shared/api/remoteAccess", () => ({
  createRemotePairingChallenge: apiMocks.create,
  getRemotePairingChallenge: apiMocks.get,
  approveRemotePairingClaim: apiMocks.approve,
  rejectRemotePairingClaim: apiMocks.reject,
}));

vi.mock("@/shared/ui/Modal", () => ({
  ModalShell: ({
    open,
    children,
    title,
  }: {
    open: boolean;
    children: React.ReactNode;
    title: React.ReactNode;
  }) => (open ? <div role="dialog" aria-label={String(title)}>{children}</div> : null),
}));

const claimedChallenge = {
  challengeId: "challenge-1",
  status: "claimed" as const,
  hostUrl: "https://mira.example.ts.net",
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-01T00:05:00.000Z",
  code: "ABCD2345",
  pairingUri:
    "mira://pair?host=https%3A%2F%2Fmira.example.ts.net&challenge=challenge-1&code=ABCD2345&version=1",
  claim: {
    claimId: "claim-1",
    deviceName: "K70",
    platform: "android",
    transport: "relay" as const,
    publicKeyFingerprint: "0123456789abcdef",
    requestedScopes: ["threads:read", "messages:read"] as const,
    claimedAt: "2026-08-01T00:01:00.000Z",
  },
  approvedScopes: [],
  deviceId: null,
};

beforeEach(() => {
  apiMocks.create.mockReset();
  apiMocks.get.mockReset();
  apiMocks.approve.mockReset();
  apiMocks.reject.mockReset();
  apiMocks.create.mockResolvedValue(claimedChallenge);
  apiMocks.get.mockResolvedValue(claimedChallenge);
  apiMocks.approve.mockResolvedValue({
    ...claimedChallenge,
    status: "approved",
    approvedScopes: ["threads:read", "messages:read"],
    deviceId: "device-1",
  });
});

describe("RemoteDevicePairingModal", () => {
  it("shows the pairing QR and claimed device request", async () => {
    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={() => void 0}
      />,
    );

    expect(await screen.findByTitle("使用 Mira Mobile 扫描")).toBeInTheDocument();
    expect(screen.getByTitle("使用 Mira Mobile 扫描")).toHaveAttribute(
      "data-value",
      claimedChallenge.pairingUri,
    );
    expect(screen.getByText("K70 · android")).toBeInTheDocument();
    expect(screen.getByText("申请通道: Mira Relay")).toBeInTheDocument();
    expect(screen.getByText(/0123456789abcdef/)).toBeInTheDocument();
    expect(screen.getByText("读取会话")).toBeInTheDocument();
    expect(screen.getByText("读取消息")).toBeInTheDocument();
    expect(screen.getByText(claimedChallenge.pairingUri)).toBeInTheDocument();
    expect(screen.queryByText("ABCD2345")).not.toBeInTheDocument();
    expect(apiMocks.create).toHaveBeenCalledTimes(1);
  });

  it("renders and approves the new remote tool scopes", async () => {
    const toolChallenge = {
      ...claimedChallenge,
      claim: {
        ...claimedChallenge.claim,
        requestedScopes: [
          "tools:read",
          "tools:invoke",
          "tools:approve",
          "tools:control",
        ] as const,
      },
    };
    apiMocks.create.mockResolvedValueOnce(toolChallenge);
    apiMocks.get.mockResolvedValue(toolChallenge);

    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={() => void 0}
      />,
    );

    expect(await screen.findByText("查看远程工具")).toBeInTheDocument();
    expect(screen.getByText("调用远程工具")).toBeInTheDocument();
    expect(screen.getByText("审批远程工具")).toBeInTheDocument();
    expect(screen.getByText("取消远程工具")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "批准设备" }));

    await waitFor(() => {
      expect(apiMocks.approve).toHaveBeenCalledWith("claim-1", [
        "tools:read",
        "tools:invoke",
        "tools:approve",
        "tools:control",
      ]);
    });
  });

  it("requires explicit desktop approval and forwards only requested scopes", async () => {
    const onPaired = vi.fn();
    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={onPaired}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "批准设备" }),
    );

    await waitFor(() => {
      expect(apiMocks.approve).toHaveBeenCalledWith("claim-1", [
        "threads:read",
        "messages:read",
      ]);
      expect(onPaired).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("设备已批准，等待手机领取凭证")).toBeInTheDocument();
  });

  it("allows desktop users to reduce requested scopes before approval", async () => {
    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={() => void 0}
      />,
    );

    await userEvent.click(await screen.findByRole("checkbox", { name: "读取消息" }));
    await userEvent.click(screen.getByRole("button", { name: "批准设备" }));

    await waitFor(() => {
      expect(apiMocks.approve).toHaveBeenCalledWith("claim-1", [
        "threads:read",
      ]);
    });
  });

  it("requires at least one selected scope before approval", async () => {
    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={() => void 0}
      />,
    );

    await userEvent.click(await screen.findByRole("checkbox", { name: "读取会话" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "读取消息" }));

    expect(screen.getByText("至少保留一项权限才能批准设备。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准设备" })).toBeDisabled();
    expect(apiMocks.approve).not.toHaveBeenCalled();
  });

  it("shows the create error when the pairing challenge cannot be created", async () => {
    apiMocks.create.mockRejectedValueOnce(new Error("pairing unavailable"));

    render(
      <RemoteDevicePairingModal
        open
        onClose={() => void 0}
        onPaired={() => void 0}
      />,
    );

    expect(await screen.findByText("pairing unavailable")).toBeInTheDocument();
    expect(screen.queryByText(claimedChallenge.pairingUri)).not.toBeInTheDocument();
  });
});
