// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import FieldHelpLabel from "../components/add/FieldHelpLabel";

describe("FieldHelpLabel", () => {
  it("renders label text", () => {
    render(<FieldHelpLabel label="Chunk Size" hint="helpful text" />);

    expect(screen.getByText("Chunk Size")).toBeInTheDocument();
  });

  it("shows tooltip hint on hover", async () => {
    const user = userEvent.setup();
    render(<FieldHelpLabel label="Chunk Size" hint="helpful text" />);

    const helpIcon = document.querySelector("svg");
    expect(helpIcon).toBeInTheDocument();

    await user.hover(helpIcon!);

    expect(await screen.findByText("helpful text")).toBeInTheDocument();
  });
});
