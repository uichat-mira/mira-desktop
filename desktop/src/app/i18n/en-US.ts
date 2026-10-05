const app = {
  app: {
    navigation: {
      home: "Home",
      projects: "Knowledge and Evaluation",
      forge: "Forge",
      remoteAccess: "Remote connection",
      dashboard: "Workbench",
      extensions: "Extensions",
      tools: "Tools",
      mcp: "MCP",
      skills: "Skills",
      settings: "Settings",
      help: "Help",
      helpOpenFailed: "The help page could not be opened. Please try again.",
      account: "Account",
      about: "About",
      development: "Development",
      knowledgeBase: "Knowledge Base",
      evaluation: "Evaluation Center",
      externalApp: "Open externally",
      primary: "Primary navigation",
    },
    sidebar: {
      unknown: "Checking",
      running: "Running",
      stopped: "Stopped",
      unknownUser: "Unknown user",
      logout: "Log out",
    },
  },
} as const;

export default app;
