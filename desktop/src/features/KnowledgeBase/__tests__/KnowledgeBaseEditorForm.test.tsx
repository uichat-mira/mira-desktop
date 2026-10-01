// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import KnowledgeBaseEditorForm from "../components/KnowledgeBaseEditorForm";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const defaultProps = {
  title: "Create Knowledge Base",
  confirmLabel: "Create",
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn(),
};

describe("KnowledgeBaseEditorForm", () => {
  it("renders all input fields", () => {
    render(<KnowledgeBaseEditorForm {...defaultProps} />);

    expect(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.namePlaceholder",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.descriptionPlaceholder",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.personaPlaceholder",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.scenarioPlaceholder",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.tagsPlaceholder",
      ),
    ).toBeInTheDocument();
  });

  it("populates initial values", () => {
    render(
      <KnowledgeBaseEditorForm
        {...defaultProps}
        initialName="My KB"
        initialDescription="A test KB"
        initialPersona="Expert"
        initialScenario="Support"
        initialTags="tag1, tag2"
      />,
    );

    expect(screen.getByDisplayValue("My KB")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A test KB")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Expert")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Support")).toBeInTheDocument();
    expect(screen.getByDisplayValue("tag1, tag2")).toBeInTheDocument();
  });

  it("calls onSubmit with form values when confirm clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<KnowledgeBaseEditorForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.change(
      screen.getByPlaceholderText(
        "settings.knowledgeBase.editor.namePlaceholder",
      ),
      { target: { value: "New KB" } },
    );

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New KB" }),
    );
  });

  it("calls onCancel when cancel clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<KnowledgeBaseEditorForm {...defaultProps} onCancel={onCancel} />);

    await user.click(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.editor\.cancel/,
      }),
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables buttons while submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    );

    render(<KnowledgeBaseEditorForm {...defaultProps} onSubmit={onSubmit} />);

    const confirmButton = screen.getByRole("button", { name: "Create" });
    await user.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /settings\.knowledgeBase\.editor\.cancel/,
      }),
    ).toBeDisabled();
  });
});
