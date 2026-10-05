// @vitest-environment jsdom
import type { ReactNode } from "react";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { ChatApplicationStateBoundary } from "./ChatApplicationStateBoundary";
import { router as appRouter } from "./router";
import { RequireAuth } from "./route-guards/RequireAuth";

const boundaryState = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  sessionUserId: 7,
}));

vi.mock("@/app/providers/AuthProvider", () => ({
  useAuth: () => ({
    session: {
      token: "token",
      user: {
        id: boundaryState.sessionUserId,
        username: "tester",
        role: "user",
      },
    },
  }),
}));

vi.mock("@/features/chat/core/runtime", () => ({
  AppChatRuntimeProvider: ({
    sessionKey,
    children,
  }: {
    sessionKey: string | number;
    children: ReactNode;
  }) => {
    React.useEffect(() => {
      boundaryState.mounts += 1;
      return () => {
        boundaryState.unmounts += 1;
      };
    }, []);

    return <div data-session-key={sessionKey}>{children}</div>;
  },
}));

function CurrentRoute() {
  return <div>{useLocation().pathname}</div>;
}

const createWorkspaceRouter = () =>
  createMemoryRouter(
    [
      {
        element: <ChatApplicationStateBoundary />,
        children: [
          { path: "/chat", element: <CurrentRoute /> },
          { path: "/settings/general", element: <CurrentRoute /> },
        ],
      },
    ],
    { initialEntries: ["/chat"] },
  );

beforeEach(() => {
  boundaryState.mounts = 0;
  boundaryState.unmounts = 0;
  boundaryState.sessionUserId = 7;
});

test("keeps the application chat state boundary mounted across workspace routes", async () => {
  const router = createWorkspaceRouter();
  render(<RouterProvider router={router} />);

  expect(screen.getByText("/chat")).toBeInTheDocument();
  expect(boundaryState).toMatchObject({ mounts: 1, unmounts: 0 });

  await act(() => router.navigate("/settings/general"));

  expect(screen.getByText("/settings/general")).toBeInTheDocument();
  expect(boundaryState).toMatchObject({ mounts: 1, unmounts: 0 });

  await act(() => router.navigate("/chat"));

  expect(screen.getByText("/chat")).toBeInTheDocument();
  expect(boundaryState).toMatchObject({ mounts: 1, unmounts: 0 });
});

test("passes the authenticated user id to the UChat application state host", () => {
  const router = createWorkspaceRouter();
  const { container } = render(<RouterProvider router={router} />);

  expect(container.querySelector("[data-session-key='7']")).toBeInTheDocument();
});

test("production routes place home, chat, dashboard, and settings below one application state boundary", () => {
  const rootRoute = appRouter.routes[0];
  const authenticatedRoute = rootRoute?.children?.find(
    (route) =>
      React.isValidElement(route.element) && route.element.type === RequireAuth,
  );
  const applicationStateRoute = authenticatedRoute?.children?.find(
    (route) =>
      React.isValidElement(route.element) &&
      route.element.type === ChatApplicationStateBoundary,
  );

  expect(applicationStateRoute).toBeDefined();
  expect(applicationStateRoute?.children?.map((route) => route.path ?? "index"))
    .toEqual([
      "index",
      "forge",
      "dashboard",
      "remote-access",
      "knowledge-base",
      "evaluation",
      "about",
      "extensions",
      "development",
      "chat",
      "settings",
    ]);
});
