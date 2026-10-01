// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DevelopmentDatabasePage from "../pages/Database/index";

let runtimeState = {
  backendState: { status: "running", detail: "backend ok" },
  databaseState: { status: "running", detail: "sqlite ok" },
  vectorState: { status: "stopped", detail: "sqlite-vec missing" },
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getRuntimeDisplayLabel: () => "Desktop",
}));

vi.mock("@/features/system/hooks/useRuntimeHealth", () => ({
  useRuntimeHealth: () => ({
    runtime: { kind: "desktop", backendUrl: "http://127.0.0.1:8787" },
    ...runtimeState,
  }),
}));

describe("DevelopmentDatabasePage", () => {
  beforeEach(() => {
    runtimeState = {
      backendState: { status: "running", detail: "backend ok" },
      databaseState: { status: "running", detail: "sqlite ok" },
      vectorState: { status: "stopped", detail: "sqlite-vec missing" },
    };
  });

  it("shows one page skeleton while runtime health is unknown", () => {
    runtimeState = {
      backendState: { status: "unknown", detail: "waiting" },
      databaseState: { status: "unknown", detail: "waiting" },
      vectorState: { status: "unknown", detail: "waiting" },
    };

    render(<DevelopmentDatabasePage />);

    expect(screen.getByTestId("development-page-skeleton")).toBeInTheDocument();
  });

  it("renders backend, sqlite, and vector states as one divided settings section", () => {
    render(<DevelopmentDatabasePage />);

    expect(
      screen.getByText("settings.general.health.services.server"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.general.health.services.sqlite"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.general.health.services.sqliteVec"),
    ).toBeInTheDocument();
    expect(screen.getByText("backend ok")).toBeInTheDocument();
    expect(screen.getByText("sqlite ok")).toBeInTheDocument();
    expect(screen.getByText("sqlite-vec missing")).toBeInTheDocument();
    expect(
      screen.getByTestId("database-status-list").querySelector(".divide-y"),
    ).not.toBeNull();
    expect(screen.getByTestId("database-status-backend")).toBeInTheDocument();
    expect(screen.getByTestId("database-status-sqlite")).toBeInTheDocument();
    expect(
      screen.getByTestId("database-status-sqlite-vec"),
    ).toBeInTheDocument();
  });
});
