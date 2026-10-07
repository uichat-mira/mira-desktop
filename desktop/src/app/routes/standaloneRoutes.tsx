import { Navigate } from "react-router-dom";
import About from "@/features/About/index";
import DevelopmentSettings from "@/features/Development/index";
import DevelopmentLogsPage from "@/features/Development/pages/Logs/index";
import DevelopmentDatabasePage from "@/features/Development/pages/Database/index";
import DevelopmentClientTestsPage from "@/features/Development/pages/ClientTests/index";
import DevelopmentServerTestsPage from "@/features/Development/pages/ServerTests/index";
import CapabilitiesPage from "@/features/Extensions/Capabilities/index";
import McpPage from "@/features/Extensions/Mcp/index";
import StandaloneWorkspace from "@/app/Layouts/StandaloneWorkspace";
import KnowledgeBaseSettings from "@/features/KnowledgeBase/index";
import KnowledgeBaseAddWizard from "@/features/KnowledgeBase/Add";
import KnowledgeBaseDetail from "@/features/KnowledgeBase/Detail";
import EvaluationCenter from "@/features/Evaluation/Center";
import EvaluationNew from "@/features/Evaluation/New";
import RemoteAccessSettings from "@/features/RemoteAccess/index";
import SkillsPage from "@/features/Skills/index";
import DashboardPage from "@/features/dashboard/DashboardPage";

export const standaloneRoutes = [
  {
    path: "dashboard",
    element: <StandaloneWorkspace />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
  {
    path: "remote-access",
    element: <StandaloneWorkspace />,
    children: [{ index: true, element: <RemoteAccessSettings /> }],
  },
  {
    path: "knowledge-base",
    element: <StandaloneWorkspace />,
    children: [
      { index: true, element: <KnowledgeBaseSettings /> },
      { path: "add", element: <KnowledgeBaseAddWizard /> },
      { path: "detail", element: <KnowledgeBaseDetail /> },
    ],
  },
  {
    path: "evaluation",
    element: <StandaloneWorkspace />,
    children: [
      { index: true, element: <Navigate to="center" replace /> },
      { path: "center", element: <EvaluationCenter /> },
      { path: "center/new", element: <EvaluationNew /> },
    ],
  },
  {
    path: "about",
    element: <StandaloneWorkspace />,
    children: [{ index: true, element: <About /> }],
  },
  {
    path: "extensions",
    element: <StandaloneWorkspace />,
    children: [
      { index: true, element: <Navigate to="capabilities" replace /> },
      { path: "capabilities", element: <CapabilitiesPage /> },
      { path: "mcp", element: <McpPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "tools", element: <Navigate to="/extensions/capabilities" replace /> },
    ],
  },
  {
    path: "development",
    element: <StandaloneWorkspace />,
    children: [
      {
        element: <DevelopmentSettings />,
        children: [
          { path: "logs", element: <DevelopmentLogsPage /> },
          { path: "database", element: <DevelopmentDatabasePage /> },
          { path: "client-tests", element: <DevelopmentClientTestsPage /> },
          { path: "server-tests", element: <DevelopmentServerTestsPage /> },
        ],
      },
    ],
  },
];
