// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PreviewPanel from "../components/add/PreviewPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("PreviewPanel", () => {
  it("renders placeholder when no file selected", () => {
    render(
      <PreviewPanel
        fileName={undefined}
        previewChunks={[]}
        previewStats={null}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.noFileSelected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.previewPlaceholder"),
    ).toBeInTheDocument();
  });

  it("renders file name and preview count", () => {
    const chunks = [
      { id: "1", index: 0, text: "hello", charCount: 5 },
      { id: "2", index: 1, text: "world", charCount: 5 },
    ];

    render(
      <PreviewPanel
        fileName="doc.txt"
        previewChunks={chunks}
        previewStats={null}
      />,
    );

    expect(screen.getByText("doc.txt")).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.previewCount"),
    ).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders stats when provided", () => {
    const chunks = [{ id: "1", index: 0, text: "hello world", charCount: 11 }];
    const stats = {
      totalChunks: 10,
      averageChunkLength: 20,
      minChunkLength: 5,
      maxChunkLength: 50,
    };

    render(
      <PreviewPanel
        fileName="doc.txt"
        previewChunks={chunks}
        previewStats={stats}
      />,
    );

    expect(screen.getByText(/totalChunks.*10$/)).toBeInTheDocument();
    expect(screen.getByText(/avgLength.*20$/)).toBeInTheDocument();
    expect(screen.getByText(/minLength.*5$/)).toBeInTheDocument();
    expect(screen.getByText(/maxLength.*50$/)).toBeInTheDocument();
  });
});
