// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FileUploadStep from "../components/add/FileUploadStep";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  files: [
    { id: "f1", name: "doc1.md", extension: "md", size: 1024 },
    { id: "f2", name: "doc2.txt", extension: "txt", size: 2048 },
  ],
  previewFileId: "f1",
  canProceed: true,
  canUpload: true,
  embeddingConnected: true,
  llmConnected: true,
  rerankConnected: false,
  helperText: "Drop a markdown or text file",
  onSelectFiles: vi.fn(),
  onSetPreviewFileId: vi.fn(),
  onRemoveFile: vi.fn(),
  onNext: vi.fn(),
};

describe("FileUploadStep", () => {
  it("renders title and helper text", () => {
    render(<FileUploadStep {...defaultProps} />);

    expect(
      screen.getByText("settings.knowledgeBase.add.uploadTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Drop a markdown or text file"),
    ).toBeInTheDocument();
  });

  it("shows warning when embedding is not connected", () => {
    render(<FileUploadStep {...defaultProps} embeddingConnected={false} />);

    expect(
      screen.getByText("settings.knowledgeBase.add.noEmbeddingWarning"),
    ).toBeInTheDocument();
  });

  it("does not show warning when embedding is connected", () => {
    render(<FileUploadStep {...defaultProps} embeddingConnected />);

    expect(
      screen.queryByText("settings.knowledgeBase.add.noEmbeddingWarning"),
    ).not.toBeInTheDocument();
  });

  it("renders file list items", () => {
    render(<FileUploadStep {...defaultProps} />);

    expect(screen.getByText("doc1.md")).toBeInTheDocument();
    expect(screen.getByText("doc2.txt")).toBeInTheDocument();
  });

  it("calls onNext when next button clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();

    render(<FileUploadStep {...defaultProps} onNext={onNext} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.nextStep/,
      }),
    );

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables next button when cannot proceed", () => {
    render(<FileUploadStep {...defaultProps} canProceed={false} />);

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.nextStep/,
      }),
    ).toBeDisabled();
  });
});
