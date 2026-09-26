// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { standaloneRoutes } from "./standaloneRoutes";

vi.mock("@/app/Layouts/StandaloneWorkspace", () => ({
  default: () => <Outlet />,
}));

vi.mock("@/features/dashboard/DashboardPage", () => ({
  default: () => null,
}));
vi.mock("@/features/RemoteAccess/index", () => ({
  default: () => null,
}));
vi.mock("@/features/KnowledgeBase/index", () => ({
  default: () => null,
}));
vi.mock("@/features/KnowledgeBase/Add", () => ({
  default: () => null,
}));
vi.mock("@/features/KnowledgeBase/Detail", () => ({
  default: () => null,
}));
vi.mock("@/features/Evaluation/Center", () => ({
  default: () => <div data-testid="evaluation-center">evaluation-center</div>,
}));
vi.mock("@/features/Evaluation/New", () => ({
  default: () => <div data-testid="evaluation-new">evaluation-new</div>,
}));
vi.mock("@/features/About/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Development/index", () => ({
  default: () => <Outlet />,
}));
vi.mock("@/features/Development/pages/Logs/index", () => ({
  default: () => <div data-testid="development-logs">development-logs</div>,
}));
vi.mock("@/features/Development/pages/Database/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Development/pages/ClientTests/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Development/pages/ServerTests/index", () => ({
  default: () => null,
}));

function renderStandaloneRoute(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        children: standaloneRoutes,
      },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

describe("standalone routes", () => {
  it("redirects /evaluation to the evaluation center", async () => {
    const router = renderStandaloneRoute("/evaluation");

    expect(await screen.findByTestId("evaluation-center")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/evaluation/center");
  });

  it("mounts the new evaluation page at /evaluation/center/new", async () => {
    renderStandaloneRoute("/evaluation/center/new");

    expect(await screen.findByTestId("evaluation-new")).toBeInTheDocument();
  });

  it("mounts development logs through the development layout", async () => {
    renderStandaloneRoute("/development/logs");

    expect(await screen.findByTestId("development-logs")).toBeInTheDocument();
  });
});
