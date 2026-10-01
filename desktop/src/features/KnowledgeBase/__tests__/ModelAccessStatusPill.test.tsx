// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ModelAccessStatusPill from "../components/add/ModelAccessStatusPill";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("ModelAccessStatusPill", () => {
  it("renders connected state", () => {
    render(<ModelAccessStatusPill label="Embedding" connected />);

    expect(screen.getByText(/Embedding/)).toBeInTheDocument();
    expect(
      screen.getByText(/settings\.knowledgeBase\.add\.connected/),
    ).toBeInTheDocument();
  });

  it("renders disconnected state", () => {
    render(<ModelAccessStatusPill label="Rerank" connected={false} />);

    expect(screen.getByText(/Rerank/)).toBeInTheDocument();
    expect(
      screen.getByText(/settings\.knowledgeBase\.add\.notConnected/),
    ).toBeInTheDocument();
  });

  it("uses success variant when connected", () => {
    const { container } = render(
      <ModelAccessStatusPill label="Embedding" connected />,
    );

    expect(container.firstChild).toHaveClass("bg-success/10");
    expect(container.firstChild).toHaveClass("text-success");
  });

  it("uses danger variant when disconnected", () => {
    const { container } = render(
      <ModelAccessStatusPill label="Rerank" connected={false} />,
    );

    expect(container.firstChild).toHaveClass("bg-danger/10");
    expect(container.firstChild).toHaveClass("text-danger-text");
  });
});
