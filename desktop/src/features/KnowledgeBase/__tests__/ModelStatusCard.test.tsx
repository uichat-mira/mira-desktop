// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ModelStatusCard from "../components/add/ModelStatusCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ModelStatusCard", () => {
  it("renders title, description and icon", () => {
    render(
      <ModelStatusCard
        title="Embedding"
        description="Used for vector search"
        config={null}
        icon={<span data-testid="icon" />}
      />,
    );

    expect(screen.getByText("Embedding")).toBeInTheDocument();
    expect(screen.getByText("Used for vector search")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("shows configured state with model summary", () => {
    render(
      <ModelStatusCard
        title="LLM"
        description="Generation model"
        config={{
          providerCode: "openai",
          remoteModelId: "gpt-4",
          name: "GPT-4",
        }}
        icon={<span />}
      />,
    );

    expect(screen.getByText("openai · GPT-4")).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.configured"),
    ).toBeInTheDocument();
  });

  it("shows not configured state when optional", () => {
    render(
      <ModelStatusCard
        title="Rerank"
        description="Reranking model"
        config={null}
        icon={<span />}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.notConfigured"),
    ).toBeInTheDocument();
  });

  it("shows required config state when required and missing", () => {
    render(
      <ModelStatusCard
        title="LLM"
        description="Generation model"
        config={null}
        required
        icon={<span />}
      />,
    );

    expect(
      screen.getByText("settings.knowledgeBase.add.requiredConfig"),
    ).toBeInTheDocument();
  });

  it("shows built-in model state when provider config is missing", () => {
    render(
      <ModelStatusCard
        title="Embedding"
        description="Vector model"
        config={null}
        builtInModel={{
          role: "embedding",
          modelId: "multilingual-e5-small",
          displayName: "multilingual-e5-small",
          runtime: "onnxruntime-web / WASM",
          source: "local",
          dimensions: 384,
          optional: false,
        }}
        required
        icon={<span />}
      />,
    );

    expect(
      screen.getByText(
        "settings.knowledgeBase.add.builtInLocal · multilingual-e5-small",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.builtInReady"),
    ).toBeInTheDocument();
    expect(screen.getByText("onnxruntime-web / WASM")).toBeInTheDocument();
    expect(
      screen.getByText("settings.knowledgeBase.add.dimensions"),
    ).toBeInTheDocument();
  });

  it("falls back to remoteModelId when name is missing", () => {
    render(
      <ModelStatusCard
        title="Embedding"
        description="Vector model"
        config={{
          providerCode: "local",
          remoteModelId: "bge-large",
        }}
        icon={<span />}
      />,
    );

    expect(screen.getByText("local · bge-large")).toBeInTheDocument();
  });
});
