// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExternalLink from "../ExternalLink";

const messageInfo = vi.fn();
const messageError = vi.fn();
const openExternalUrl = vi.fn();
const copyTextToClipboard = vi.fn();
const modalConfirm = vi.fn();
const getDesktopRuntime = vi.fn(() => ({
  hostKind: "browser",
  platform: "browser",
  isPackaged: false,
  backendUrl: "",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getDesktopRuntime: () => getDesktopRuntime(),
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

vi.mock("@/shared/lib/clipboard", () => ({
  copyTextToClipboard: (text: string) => copyTextToClipboard(text),
}));

vi.mock("../Message", () => ({
  message: {
    info: (...args: unknown[]) => messageInfo(...args),
    error: (...args: unknown[]) => messageError(...args),
  },
}));

vi.mock("../Modal", () => ({
  Modal: {
    confirm: (options: unknown) => modalConfirm(options),
  },
}));

describe("ExternalLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the URL through the shared platform helper", async () => {
    const user = userEvent.setup();
    openExternalUrl.mockResolvedValue(undefined);

    render(<ExternalLink href="https://example.com">Docs</ExternalLink>);
    await user.click(screen.getByRole("link", { name: "Docs" }));

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
    expect(copyTextToClipboard).not.toHaveBeenCalled();
  });

  it("shows a confirmation dialog before opening when requested", async () => {
    const user = userEvent.setup();
    openExternalUrl.mockResolvedValue(undefined);

    render(
      <ExternalLink href="https://example.com" confirmBeforeOpen>
        Docs
      </ExternalLink>,
    );
    await user.click(screen.getByRole("link", { name: "Docs" }));

    expect(modalConfirm).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).not.toHaveBeenCalled();

    const options = modalConfirm.mock.calls[0]?.[0] as {
      title: string;
      description: string;
      onConfirm: () => Promise<void>;
    };

    expect(options.title).toBe("ui.externalLink.confirm.title");
    expect(options.description).toBe("ui.externalLink.confirm.description");

    await options.onConfirm();

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("falls back to copying the URL when open fails", async () => {
    const user = userEvent.setup();
    openExternalUrl.mockRejectedValue(new Error("blocked"));
    copyTextToClipboard.mockResolvedValue(true);

    render(<ExternalLink href="https://example.com">Docs</ExternalLink>);
    await user.click(screen.getByRole("link", { name: "Docs" }));

    expect(copyTextToClipboard).toHaveBeenCalledWith("https://example.com");
    expect(messageInfo).toHaveBeenCalledWith("ui.externalLink.openFailedCopied");
  });

  it("uses copy-only behavior for configured Electron host", async () => {
    const user = userEvent.setup();
    getDesktopRuntime.mockReturnValue({
      hostKind: "electron",
      platform: "darwin",
      isPackaged: true,
      backendUrl: "",
    });
    copyTextToClipboard.mockResolvedValue(true);

    render(
      <ExternalLink href="https://example.com" copyOnlyHosts={["electron"]}>
        Docs
      </ExternalLink>,
    );
    await user.click(screen.getByRole("link", { name: "Docs" }));

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(copyTextToClipboard).toHaveBeenCalledWith("https://example.com");
    expect(messageInfo).toHaveBeenCalledWith("ui.externalLink.copyOnlySuccess");
  });

  it("shows an error when fallback copy also fails", async () => {
    const user = userEvent.setup();
    openExternalUrl.mockRejectedValue(new Error("blocked"));
    copyTextToClipboard.mockResolvedValue(false);

    render(<ExternalLink href="https://example.com">Docs</ExternalLink>);
    await user.click(screen.getByRole("link", { name: "Docs" }));

    expect(messageError).toHaveBeenCalledWith("ui.externalLink.copyFailed");
  });
});
