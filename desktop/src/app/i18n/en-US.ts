const app = {
  app: {
    navigation: {
      home: "Home",
      history: "History",
      projects: "Knowledge and Evaluation",
      forge: "Forge",
      remoteAccess: "Remote connection",
      dashboard: "Workbench",
      settings: "Settings",
      help: "Help",
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
