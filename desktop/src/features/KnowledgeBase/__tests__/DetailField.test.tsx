// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DetailField from "../components/detail/DetailField";

function TestIcon({ className }: { className?: string }) {
  return <svg className={className} data-testid="test-icon" />;
}

describe("DetailField", () => {
  it("renders label and value", () => {
    render(<DetailField icon={TestIcon} label="Name" value="Tom" />);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Tom")).toBeInTheDocument();
  });

  it("renders the provided icon", () => {
    render(<DetailField icon={TestIcon} label="Name" value="Tom" />);

    expect(screen.getByTestId("test-icon")).toBeInTheDocument();
  });

  it("renders React nodes as value", () => {
    render(
      <DetailField
        icon={TestIcon}
        label="Status"
        value={<span data-testid="node-value">Active</span>}
      />,
    );

    expect(screen.getByTestId("node-value")).toHaveTextContent("Active");
  });
});
