const skillsEn = {
  settings: {
    skills: {
      metadata: {
        labels: {
          id: "Skill ID",
          name: "Name",
          displayName: "Display name",
          description: "Description",
          version: "Version",
          category: "Category",
          visibility: "Visibility",
          source: "Source",
          status: "Status",
          executionContext: "Execution mode",
          executionAgent: "Execution agent",
          allowedTools: "Available tools",
          runtimeBindings: "Runtime bindings",
          workspaceBound: "Workspace scope",
        },
        values: {
          visibility: {
            public: "Public",
            private: "Private",
          },
          status: {
            active: "Available",
            review: "In review",
            draft: "Draft",
            deprecated: "Deprecated",
          },
          executionContext: {
            fork: "Isolated execution",
            inline: "Main-agent execution",
          },
          executionAgent: {
            subAgent: "Sub-agent",
            mainAgent: "Main agent",
          },
          workspaceBound: {
            true: "Current workspace only",
            false: "Not workspace-restricted",
          },
          tools: {
            read: "Read file",
            list: "List directory",
            glob: "Find paths",
            grep: "Search file contents",
            terminalSession: "Terminal",
            githubRepository: "GitHub repositories",
            githubPullRequest: "GitHub pull requests",
            githubActions: "GitHub Actions",
          },
        },
      },
    },
  },
} as const;

export default skillsEn;
