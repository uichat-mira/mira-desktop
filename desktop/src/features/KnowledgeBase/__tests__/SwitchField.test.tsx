// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SwitchField from "../components/add/SwitchField";

describe("SwitchField", () => {
  it("renders label and hint via FieldHelpLabel", async () => {
    render(
      <SwitchField
        label="Enable Split"
        hint="split documents into chunks"
        checked={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Enable Split").length).toBeGreaterThanOrEqual(
      1,
    );

    const user = userEvent.setup();
    const helpIcon = document.querySelector("svg");
    expect(helpIcon).toBeInTheDocument();
    await user.hover(helpIcon!);

    expect(
      await screen.findByText("split documents into chunks"),
    ).toBeInTheDocument();
  });

  it("renders switch with checked state", () => {
    const { rerender } = render(
      <SwitchField
        label="Enable Split"
        hint="hint"
        checked={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    rerender(
      <SwitchField
        label="Enable Split"
        hint="hint"
        checked={true}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange when switch is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SwitchField
        label="Enable Split"
        hint="hint"
        checked={false}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
