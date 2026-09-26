// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseMetadataContent from "../components/KnowledgeBaseMetadataContent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("KnowledgeBaseMetadataContent", () => {
  it("renders metadata and summary values", () => {
    render(
      <KnowledgeBaseMetadataContent
        metadata={{
          persona: "Expert",
          scenario: "Support",
          tags: ["ai", "rag"],
        }}
        documentCount={10}
        enabledDocumentCount={7}
        totalChunks={1234}
      />,
    );

    expect(screen.getByText("Expert")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
    expect(screen.getByText("ai / rag")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("1234")).toBeInTheDocument();
  });

  it("shows not set placeholders when metadata is null", () => {
    render(
      <KnowledgeBaseMetadataContent
        metadata={null}
        documentCount={0}
        enabledDocumentCount={0}
        totalChunks={0}
      />,
    );

    expect(
      screen.getAllByText("settings.knowledgeBase.metadata.notSet").length,
    ).toBe(3);
  });

  it("shows not set when fields are empty", () => {
    render(
      <KnowledgeBaseMetadataContent
        metadata={{
          persona: "",
          scenario: "",
          tags: [],
        }}
        documentCount={5}
        enabledDocumentCount={3}
        totalChunks={100}
      />,
    );

    expect(
      screen.getAllByText("settings.knowledgeBase.metadata.notSet").length,
    ).toBe(3);
  });

  it("renders footer", () => {
    render(
      <KnowledgeBaseMetadataContent
        metadata={null}
        documentCount={0}
        enabledDocumentCount={0}
        totalChunks={0}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.metadata.footer"),
    ).toBeInTheDocument();
  });
});
