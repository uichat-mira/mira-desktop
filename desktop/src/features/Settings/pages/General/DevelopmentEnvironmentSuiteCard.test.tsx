// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DevelopmentEnvironmentSuiteCard from "./DevelopmentEnvironmentSuiteCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("DevelopmentEnvironmentSuiteCard", () => {
  it("renders only the suite title, tool names, versions, and logos", () => {
    const { container } = render(<DevelopmentEnvironmentSuiteCard />);

    expect(
      screen.getByText("settings.about.developmentEnvironment.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("Windows x64")).toBeInTheDocument();
    expect(screen.getByText("Node.js")).toBeInTheDocument();
    expect(screen.getByText("v24.22.1")).toBeInTheDocument();
    expect(screen.getByText("npm / npx")).toBeInTheDocument();
    expect(screen.getByText("v10.9.8")).toBeInTheDocument();
    expect(screen.getByText("MinGit")).toBeInTheDocument();
    expect(screen.getByText("v2.55.0.windows.3")).toBeInTheDocument();
    expect(screen.getByText("uv")).toBeInTheDocument();
    expect(screen.getByText("v0.11.31")).toBeInTheDocument();
    expect(screen.getByText("ripgrep")).toBeInTheDocument();
    expect(screen.getByText("v15.2.0")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(container.querySelectorAll('img[alt=""]')).toHaveLength(4);
    expect(container.querySelectorAll(".rounded-ui-panel")).toHaveLength(1);
    expect(container.querySelectorAll("section section")).toHaveLength(0);
  });
});
