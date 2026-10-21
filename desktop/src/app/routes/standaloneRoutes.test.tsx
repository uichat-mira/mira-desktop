// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  useRoutes,
  useLocation,
  Outlet,
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
vi.mock("@/features/Extensions/Capabilities/index", () => ({
  default: () => <div data-testid="extensions-capabilities">extensions-capabilities</div>,
}));
vi.mock("@/features/Extensions/Connectors/index", () => ({
  default: () => <div data-testid="extensions-connectors">extensions-connectors</div>,
}));
vi.mock("@/features/Skills/index", () => ({
  default: () => <div data-testid="extensions-skills">extensions-skills</div>,
}));

function renderStandaloneRoute(path: string) {
  // These routes have no data loaders. MemoryRouter exercises redirects without
  // mixing Node's Request with jsdom's AbortSignal.
  const router = { state: { location: { pathname: "", search: "" } } };
  function TestRoutes() {
    router.state.location = useLocation();
    return useRoutes(standaloneRoutes);
  }
  render(<MemoryRouter initialEntries={[path]}><TestRoutes /></MemoryRouter>);
  return router;
}

describe("standalone routes", () => {
  it("mounts the canonical connectors route", async () => {
    renderStandaloneRoute("/extensions/connectors");
    expect(await screen.findByTestId("extensions-connectors")).toBeInTheDocument();
  });

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

  it("redirects /extensions to the Capabilities surface", async () => {
    const router = renderStandaloneRoute("/extensions");

    expect(await screen.findByTestId("extensions-capabilities")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/extensions/capabilities");
  });

  it("mounts the Capabilities surface at /extensions/capabilities", async () => {
    renderStandaloneRoute("/extensions/capabilities");

    expect(await screen.findByTestId("extensions-capabilities")).toBeInTheDocument();
  });

  it("redirects the old MCP surface to connectors", async () => {
    const router = renderStandaloneRoute("/extensions/mcp");

    expect(await screen.findByTestId("extensions-connectors")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/extensions/connectors");
    expect(router.state.location.search).toBe("?view=installed");
  });

  it("mounts the Skills surface at /extensions/skills", async () => {
    renderStandaloneRoute("/extensions/skills");

    expect(await screen.findByTestId("extensions-skills")).toBeInTheDocument();
  });

  it("redirects the legacy tools route to the Capabilities surface", async () => {
    const router = renderStandaloneRoute("/extensions/tools");

    expect(await screen.findByTestId("extensions-capabilities")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/extensions/capabilities");
  });
});
