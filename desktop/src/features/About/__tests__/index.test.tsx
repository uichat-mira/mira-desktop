// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import About from "../index";

const runtimeMock = vi.hoisted(() => ({
  hostKind: "electron" as "browser" | "electron" | "tauri",
  platform: "win32",
  isPackaged: true,
  backendUrl: "http://127.0.0.1:8787",
}));

const modalShowMock = vi.hoisted(() => vi.fn());

const mockAppMeta = {
  name: "ui-chat-mira",
  version: "0.7.1",
  displayName: "UIChat Mira",
  author: "Tomz Dang",
  description: "Test app",
  repositoryUrl: "",
  homepageUrl: "",
  links: [],
  git: {
    branch: "codex/about-test",
    versions: [],
  },
};

const getAppMetaMock = vi.fn(async () => mockAppMeta);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.returnObjects && key === "settings.about.brand.paragraphs") {
        return ["Paragraph one", "Paragraph two"];
      }
      return key;
    },
  }),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  isDesktopShell: (runtime: { hostKind: string }) =>
    runtime.hostKind !== "browser",
  getDesktopRuntime: () => runtimeMock,
  getApiBaseUrl: () => "http://127.0.0.1:8787",
  openExternalUrl: vi.fn(),
}));

vi.mock("@/shared/ui/Modal", () => ({
  Modal: {
    show: modalShowMock,
    close: vi.fn(),
  },
}));

vi.mock("@/shared/api/system", () => ({
  getAppMeta: () => getAppMetaMock(),
}));

vi.mock("../../General/DevelopmentEnvironmentSuiteCard", () => ({
  default: () => (
    <div data-testid="development-environment-suite">开发环境套件</div>
  ),
}));

describe("About", () => {
  beforeEach(() => {
    runtimeMock.hostKind = "electron";
    runtimeMock.platform = "win32";
    runtimeMock.isPackaged = true;
    getAppMetaMock.mockClear();
    modalShowMock.mockClear();
  });

  it("renders app meta from API in desktop shell", async () => {
    render(<About />);

    await waitFor(() => {
      expect(screen.getByText("UIChat Mira")).toBeInTheDocument();
      expect(
        screen.getByText("v0.7.1 · Windows · Electron"),
      ).toBeInTheDocument();
    });
    expect(getAppMetaMock).toHaveBeenCalledTimes(1);
  });

  it("renders the current Tauri host and operating system beside the version", async () => {
    runtimeMock.hostKind = "tauri";
    runtimeMock.platform = "darwin";

    render(<About />);

    await waitFor(() => {
      expect(
        screen.getByText("v0.7.1 · macOS · Tauri"),
      ).toBeInTheDocument();
    });
  });

  it("falls back to fallback meta when API fails", async () => {
    getAppMetaMock.mockRejectedValueOnce(new Error("network error"));

    render(<About />);

    await waitFor(() => {
      expect(
        screen.getByText("v0.0.0 · Windows · Electron"),
      ).toBeInTheDocument();
    });
  });

  it("renders base information and the development suite, then opens the brand story in a modal", async () => {
    render(<About />);

    await waitFor(() => {
      expect(screen.getByText("codex/about-test")).toBeInTheDocument();
    });
    expect(screen.queryByText("Paragraph one")).not.toBeInTheDocument();
    expect(screen.getByTestId("development-environment-suite")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "品牌故事" }));
    const brandStoryModal = modalShowMock.mock.calls[0]?.[0] as
      | { title: string; content: ReactNode }
      | undefined;
    expect(brandStoryModal?.title).toBe("UIChat Mira");

    render(brandStoryModal?.content);
    expect(screen.getByText("Paragraph one")).toHaveClass("text-text-primary");
    expect(screen.getByText("Paragraph two")).toHaveClass(
      "font-medium",
      "text-text-primary",
    );
  });
});
