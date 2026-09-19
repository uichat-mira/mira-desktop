// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BaseInformationPanel from "../BaseInformationPanel";

const uiMocks = vi.hoisted(() => ({
  modalShow: vi.fn(),
  modalClose: vi.fn(),
  openExternalUrl: vi.fn(),
  checkGithubTagUpdate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  isDesktopShell: () => true,
  getApiBaseUrl: () => "http://127.0.0.1:8787",
  openExternalUrl: uiMocks.openExternalUrl,
}));

vi.mock("@/shared/ui/Modal", () => ({
  Modal: {
    show: uiMocks.modalShow,
    close: uiMocks.modalClose,
  },
}));

vi.mock("../githubUpdate", () => ({
  checkGithubTagUpdate: uiMocks.checkGithubTagUpdate,
}));

const appMeta = {
    name: "ui-chat-mira",
    version: "0.7.1",
    displayName: "UIChat Mira",
    author: "Tomz Dang",
    description: "Test app",
    repositoryUrl: "https://github.com/uichat-mira/mira-desktop.git",
    homepageUrl: "",
    links: [
      {
        label: "Author",
        value: "Tomz Dang",
        href: "https://github.com/dangjingtao",
      },
      {
        label: "官方文档",
        value: "https://tomz.io",
        href: "https://tomz.io",
      },
    ],
    git: {
      branch: "codex/feature-test",
      versions: Array.from({ length: 6 }, (_, index) => ({
        version: `0.${index}`,
        commit: {
          hash: `hash-${index}`,
          shortHash: `short-${index}`,
          message: `commit-${index}`,
          author: "Tomz Dang",
          date: "2026-07-26T00:00:00.000Z",
        },
      })),
    },
};

describe("BaseInformationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the base information panel", async () => {
    const { container } = render(<BaseInformationPanel appMeta={appMeta} />);

    await waitFor(() => {
      expect(screen.getAllByText("Tomz Dang").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("commit-0")).toBeInTheDocument();
    expect(screen.getByText("commit-4")).toBeInTheDocument();
    expect(screen.queryByText("commit-5")).not.toBeInTheDocument();
    expect(screen.getByTestId("git-current-branch")).toHaveTextContent(
      "codex/feature-test",
    );
    expect(
      screen.getByTestId("git-current-branch").firstElementChild,
    ).toHaveClass(
      "rounded-full",
      "text-primary",
    );
    expect(
      screen.queryByText("settings.about.currentBranch"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("git-version-list")).toHaveClass(
      "overflow-hidden",
      "rounded-ui-panel",
      "border",
    );
    expect(screen.getByTestId("git-version-0.0")).not.toHaveClass(
      "border",
      "rounded-lg",
      "rounded-ui-panel",
      "bg-surface-secondary/60",
    );
    expect(screen.getByTestId("git-version-main-0.0")).toHaveClass(
      "min-w-0",
      "items-center",
    );
    expect(screen.getByText("commit-0")).toHaveClass("truncate");
    expect(screen.getByTestId("git-version-meta-0.0")).toHaveClass(
      "shrink-0",
      "whitespace-nowrap",
    );
    expect(screen.getByTestId("base-information-links")).toHaveClass(
      "overflow-hidden",
      "rounded-ui-panel",
      "border",
    );
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(container.querySelectorAll("section section")).toHaveLength(0);
    expect(container.querySelectorAll("section")[0]).toHaveAttribute(
      "data-testid",
      "base-information-links",
    );
    expect(container.querySelectorAll("section")[1]).toHaveAttribute(
      "data-testid",
      "git-version-list",
    );

    await userEvent.click(screen.getByText("MIT License"));
    expect(uiMocks.modalShow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "MIT License",
        footer: null,
      }),
    );

    await userEvent.click(screen.getByText("CHANGELOG.md"));
    expect(uiMocks.modalShow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "更新日志",
        footer: null,
      }),
    );

    await userEvent.click(screen.getByText("https://tomz.io"));
    expect(uiMocks.openExternalUrl).toHaveBeenCalledWith("https://tomz.io");

    uiMocks.modalShow.mockReturnValueOnce("feedback-modal");
    await userEvent.click(screen.getByText("应用反馈"));
    const feedbackModal = uiMocks.modalShow.mock.calls.find(
      ([options]) => options.title === "应用反馈",
    )?.[0] as { content: ReactNode } | undefined;
    expect(feedbackModal).toBeDefined();

    render(feedbackModal?.content);
    await userEvent.click(
      screen.getByRole("button", { name: /提交 GitHub Issue/ }),
    );
    await waitFor(() => {
      expect(uiMocks.openExternalUrl).toHaveBeenCalledWith(
        "https://github.com/uichat-mira/mira-desktop/issues/new",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /发送邮件/ }));
    await waitFor(() => {
      expect(uiMocks.openExternalUrl).toHaveBeenCalledWith(
        "mailto:dangjingtao@gmail.com?subject=UIChat%20Mira%20反馈",
      );
    });
    expect(uiMocks.modalClose).toHaveBeenCalledWith("feedback-modal");
  });

  it("checks GitHub tags and opens the newer-version modal", async () => {
    let resolveCheck!: (value: {
      currentVersion: string;
      latestVersion: string;
      latestTag: string;
      tagUrl: string;
      updateAvailable: boolean;
    }) => void;
    uiMocks.checkGithubTagUpdate.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    uiMocks.modalShow.mockReturnValue("update-modal");
    const user = userEvent.setup();
    render(<BaseInformationPanel appMeta={appMeta} />);

    await user.click(
      screen.getByRole("button", { name: "settings.about.updateCheck.action" }),
    );
    expect(
      screen.getByRole("button", { name: "settings.about.updateCheck.checking" }),
    ).toBeDisabled();

    resolveCheck({
      currentVersion: "0.7.1",
      latestVersion: "0.8.0",
      latestTag: "v0.8.0",
      tagUrl: "https://github.com/uichat-mira/mira-desktop/tree/v0.8.0",
      updateAvailable: true,
    });

    await waitFor(() => {
      expect(uiMocks.checkGithubTagUpdate).toHaveBeenCalledWith(
        "https://github.com/uichat-mira/mira-desktop.git",
        "0.7.1",
      );
      expect(uiMocks.modalShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.about.updateCheck.availableTitle",
          width: 520,
        }),
      );
    });

    const updateModal = uiMocks.modalShow.mock.calls.find(
      ([options]) => options.title === "settings.about.updateCheck.availableTitle",
    )?.[0] as { content: ReactNode; footer: ReactNode } | undefined;
    expect(updateModal).toBeDefined();
    render(
      <>
        {updateModal?.content}
        {updateModal?.footer}
      </>,
    );
    expect(screen.getByText("v0.7.1")).toBeInTheDocument();
    expect(screen.getByText("v0.8.0")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "settings.about.updateCheck.viewTag" }),
    );
    await waitFor(() => {
      expect(uiMocks.openExternalUrl).toHaveBeenCalledWith(
        "https://github.com/uichat-mira/mira-desktop/tree/v0.8.0",
      );
      expect(uiMocks.modalClose).toHaveBeenCalledWith("update-modal");
    });
  });

  it("opens an error modal when the GitHub tag check fails", async () => {
    uiMocks.checkGithubTagUpdate.mockRejectedValue(new Error("GitHub rate limit"));
    const user = userEvent.setup();
    render(<BaseInformationPanel appMeta={appMeta} />);

    await user.click(
      screen.getByRole("button", { name: "settings.about.updateCheck.action" }),
    );

    await waitFor(() => {
      expect(uiMocks.modalShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "settings.about.updateCheck.failureTitle",
          width: 520,
        }),
      );
    });
    const errorModal = uiMocks.modalShow.mock.calls[0]?.[0] as
      | { content: ReactNode }
      | undefined;
    render(errorModal?.content);
    expect(screen.getByText("GitHub rate limit")).toBeInTheDocument();
  });
});
