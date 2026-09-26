// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProcessingStep from "../components/add/ProcessingStep";

const navigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  filesLength: 2,
  createdDocuments: [
    { id: "d1", name: "doc1.txt", chunkCount: 5 },
    { id: "d2", name: "doc2.txt", chunkCount: 3 },
  ],
  effectivePreviewChunks: [{ id: "c1", index: 0, text: "preview chunk" }],
  processingProgress: 45,
  processingDone: false,
  processingError: null,
  settings: {
    chunkSize: 500,
    replaceWhitespace: true,
    removeUrls: false,
    useQaSplit: true,
  },
  onBack: vi.fn(),
};

describe("ProcessingStep", () => {
  it("renders processing state with progress", () => {
    render(<ProcessingStep {...defaultProps} />);

    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText(/ruleReplaceWhitespace/)).toBeInTheDocument();
    expect(screen.getByText(/ruleQaSplit/)).toBeInTheDocument();
  });

  it("renders completed state and navigates on button click", async () => {
    const user = userEvent.setup();
    render(<ProcessingStep {...defaultProps} processingDone />);

    expect(
      screen.getByText("settings.knowledgeBase.add.processComplete"),
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.backToManage/,
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/knowledge-base");
  });

  it("renders error state and calls onBack", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(
      <ProcessingStep
        {...defaultProps}
        processingError="Something went wrong"
        onBack={onBack}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.processFailedTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.backToPrev/,
      }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("falls back to effectivePreviewChunks length when no created documents", () => {
    render(
      <ProcessingStep
        {...defaultProps}
        processingDone
        createdDocuments={[]}
        effectivePreviewChunks={[
          { id: "c1", index: 0, text: "a" },
          { id: "c2", index: 1, text: "b" },
        ]}
      />,
    );

    const textChunksLabel = screen.getByText(
      "settings.knowledgeBase.add.textChunks",
    );
    expect(textChunksLabel.parentElement).toHaveTextContent("2");
  });

  it("shows no extra rules when no preprocessing enabled", () => {
    render(
      <ProcessingStep
        {...defaultProps}
        settings={{
          chunkSize: 500,
          replaceWhitespace: false,
          removeUrls: false,
          useQaSplit: false,
        }}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.noExtraRules"),
    ).toBeInTheDocument();
  });
});
