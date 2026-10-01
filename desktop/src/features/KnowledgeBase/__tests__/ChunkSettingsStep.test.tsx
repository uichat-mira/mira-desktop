// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ChunkSettingsStep from "../components/add/ChunkSettingsStep";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const defaultSettings = {
  splitterType: "recursive" as const,
  chunkSize: 500,
  chunkOverlap: 50,
  lengthMetric: "characters" as const,
  keepSeparator: true,
  separator: "",
  presetLanguage: "markdown" as const,
  separators: ["\n\n", "\n"],
  encodingName: "cl100k_base",
  allowedSpecial: "all" as const,
  disallowedSpecial: ["\\\\n"] as string[],
  replaceWhitespace: false,
  removeUrls: false,
  useQaSplit: false,
};

const defaultProps = {
  settings: defaultSettings,
  splitterHints: {
    splitterType: "hint-splitter",
    chunkSize: "hint-size",
    chunkOverlap: "hint-overlap",
    lengthMetric: "hint-metric",
    keepSeparator: "hint-keep",
    separator: "hint-separator",
    presetLanguage: "hint-preset",
    separators: "hint-separators",
    encodingName: "hint-encoding",
    allowedSpecial: "hint-allowed",
    disallowedSpecial: "hint-disallowed",
    replaceWhitespace: "hint-whitespace",
    removeUrls: "hint-urls",
    useQaSplit: "hint-qa",
  },
  previewChunks: [],
  previewStats: null,
  previewFileName: undefined,
  previewLoading: false,
  llmConfig: null,
  embeddingConfig: null,
  rerankConfig: null,
  canProceed: true,
  onSettingsChange: vi.fn(),
  onPreview: vi.fn(),
  onResample: vi.fn(),
  onReset: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
};

describe("ChunkSettingsStep", () => {
  it("renders chunk settings and model config sections", () => {
    render(<ChunkSettingsStep {...defaultProps} />);

    expect(
      screen.getByText("settings.knowledgeBase.add.chunkSettings"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.modelConfig"),
    ).toBeInTheDocument();
  });

  it("renders preview panel placeholder when no file selected", () => {
    render(<ChunkSettingsStep {...defaultProps} />);

    expect(
      screen.getByText("settings.knowledgeBase.add.noFileSelected"),
    ).toBeInTheDocument();
  });

  it("calls onSettingsChange when chunk size input changes", () => {
    const onSettingsChange = vi.fn();

    render(
      <ChunkSettingsStep
        {...defaultProps}
        onSettingsChange={onSettingsChange}
      />,
    );

    const sizeInput = screen.getByDisplayValue("500");
    fireEvent.change(sizeInput, { target: { value: "800" } });

    expect(onSettingsChange).toHaveBeenCalled();
    const lastCall =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0];
    expect(lastCall(defaultSettings)).toEqual(
      expect.objectContaining({ chunkSize: 800 }),
    );
  });

  it("shows separator input when splitterType is character", () => {
    render(
      <ChunkSettingsStep
        {...defaultProps}
        settings={{ ...defaultSettings, splitterType: "character" }}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.separator"),
    ).toBeInTheDocument();
  });

  it("calls onPreview when preview button clicked", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();

    render(<ChunkSettingsStep {...defaultProps} onPreview={onPreview} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.preview/,
      }),
    );

    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onResample when resample button clicked", async () => {
    const user = userEvent.setup();
    const onResample = vi.fn();

    render(<ChunkSettingsStep {...defaultProps} onResample={onResample} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.resample/,
      }),
    );

    expect(onResample).toHaveBeenCalledTimes(1);
  });

  it("calls onReset when reset button clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    render(<ChunkSettingsStep {...defaultProps} onReset={onReset} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.reset/,
      }),
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("calls onPrev when previous button clicked", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();

    render(<ChunkSettingsStep {...defaultProps} onPrev={onPrev} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.prevStep/,
      }),
    );

    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("calls onNext when next button clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();

    render(<ChunkSettingsStep {...defaultProps} onNext={onNext} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.nextStep/,
      }),
    );

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables next button when canProceed is false", () => {
    render(<ChunkSettingsStep {...defaultProps} canProceed={false} />);

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.nextStep/,
      }),
    ).toBeDisabled();
  });

  it("disables preview and resample buttons while loading", () => {
    render(<ChunkSettingsStep {...defaultProps} previewLoading />);

    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.previewing/,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.add\.resample/,
      }),
    ).toBeDisabled();
  });
});
