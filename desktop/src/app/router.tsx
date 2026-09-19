import { createHashRouter } from "react-router-dom";
import App from "../App";
import { GuestOnly } from "./route-guards/GuestOnly";
import { RequireAuth } from "./route-guards/RequireAuth";
import LoginPage from "../features/auth/pages/LoginPage";
import ExtensionAuthorizePage from "../features/auth/pages/ExtensionAuthorizePage";
import BaseLayout from "@/app/Layouts/BaseLayout";
import HomePage from "@/features/dashboard/pages/HomePage";
import { RouteErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { settingsRoutes } from "@/app/routes/settingsRoutes";
import { ChatApplicationStateBoundary } from "@/app/ChatApplicationStateBoundary";
import CuixingPage from "@/features/forge/pages/CuixingPage";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ChatApplicationStateBoundary />,
            children: [
              { index: true, element: <HomePage /> },
              { path: "forge", element: <CuixingPage /> },
              {
                path: "chat",
                element: <BaseLayout />,
              },
              {
                path: "dashboard",
                element: <BaseLayout />,
              },
              {
                path: "settings",
                element: <BaseLayout />,
                children: settingsRoutes,
              },
            ],
          },
        ],
      },
      {
        element: <GuestOnly />,
        children: [{ path: "login", element: <LoginPage /> }],
      },
      {
        children: [{ path: "oauth/authorize", element: <ExtensionAuthorizePage /> }],
      },
    ],
  },
]);
