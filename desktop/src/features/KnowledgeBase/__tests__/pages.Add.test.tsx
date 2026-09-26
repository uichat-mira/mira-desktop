// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseAddWizard from "../pages/Add";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../hooks/useAddWizard", () => ({
  useAddWizard: () => ({
    currentStep: 1,
    settings: { chunkSize: 1024 },
    files: [],
    previewStats: null,
    previewFileId: "",
    processingProgress: 0,
    processingDone: false,
    processingError: null,
    createdDocuments: [],
    previewLoading: false,
    llmConfig: { providerCode: "openai", remoteModelId: "gpt-4" },
    embeddingConfig: {
      providerCode: "openai",
      remoteModelId: "text-embedding",
    },
    rerankConfig: null,
    canProceedStep1: false,
    canProceedStep2: true,
    canUploadDocument: true,
    activeFile: null,
    effectivePreviewChunks: [],
    splitterHints: {},
    modelAccessStatus: {
      embeddingConnected: true,
      llmConnected: true,
      rerankConnected: false,
    },
    appendFiles: vi.fn(),
    removeFile: vi.fn(),
    goToStep: vi.fn(),
    handlePreview: vi.fn(),
    handleResample: vi.fn(),
    resetSettings: vi.fn(),
    setSettings: vi.fn(),
    setPreviewFileId: vi.fn(),
  }),
}));

vi.mock("../components/add/FileUploadStep", () => ({
  default: () => <div data-testid="upload-step">FileUploadStep</div>,
}));

vi.mock("../components/add/ChunkSettingsStep", () => ({
  default: () => <div data-testid="chunk-step">ChunkSettingsStep</div>,
}));

vi.mock("../components/add/ProcessingStep", () => ({
  default: () => <div data-testid="processing-step">ProcessingStep</div>,
}));

describe("KnowledgeBaseAddWizard page", () => {
  it("renders step 1 upload step", () => {
    render(<KnowledgeBaseAddWizard />);

    expect(screen.getByTestId("upload-step")).toBeInTheDocument();
  });
});
