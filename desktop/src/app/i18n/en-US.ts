const app = {
  app: {
    connectors: {
      description: "Connect services and tools, and manage access to external MCP servers.",
      views: { installed: "Installed", internal: "Internal", external: "External", custom: "Custom" },
      search: "Search connectors",
      searchPlaceholder: "Search name, description or capability ID",
      clearSearch: "Clear search",
      filterMenu: "Filters",
      resetFilters: "Reset filters",
      marketSource: "MCP Marketplace",
      available: "Available",
      installationLoadFailed: "Could not read installed records. Installing new services is temporarily disabled.",
      cachedMarket: "Showing the last successful marketplace results",
      cachedMarketAt: "{{message}} ({{cachedAt}})",
      syncFailedDetail: "{{message}}: {{error}}",
      builtinEntry: "Built-in entry",
      open: "Open",
      manage: "Manage",
      closeManager: "Close connector management",
      agentAllowed: "Agent access allowed",
      agentNotAllowed: "Agent access not allowed",
      agentAccess: "Allow Agent access",
      disabled: "Disabled",
      enabled: "Enabled",
      installed: "Added",
      discovered: "Discovered",
      capabilityCount_one: "{{count}} capability",
      capabilityCount_other: "{{count}} capabilities",
      noMatches: "No matching connectors",
      browseMarket: "Browse marketplace",
      installFailed: "Failed to add connector",
      deleteFailed: "Failed to remove connector",
      custom: {
        title: "Add custom MCP",
        editTitle: "Edit draft: {{name}}",
        description: "Paste JSON configuration from an MCP server provider. You can add multiple servers at once.",
        sessionOnly: "This creates drafts for the current page session. It does not save configuration or start services.",
        modes: { local: "Local", cloud: "Cloud" },
        jsonLabel: "MCP configuration JSON",
        format: "Format",
        securityHint: "Check that the configuration source is trusted before using secrets or unknown commands.",
        cancel: "Cancel",
        confirm: "Add drafts",
        add: "Add custom MCP",
        emptyTitle: "No custom MCP drafts yet",
        emptyDescription: "Add a local command or cloud HTTP MCP configuration as a draft.",
        draftStatus: "Draft · Not saved · Not running",
        draftDescription: "This configuration exists only in the current page session.",
        removeDraft: "Remove {{name}} draft",
        errors: {
          invalidJson: "The JSON is invalid.",
          serversRequired: "Provide a non-empty mcpServers object.",
          serverConfigInvalid: "Each server needs a name and an object configuration.",
          mixedTransport: "A server cannot define both command and url.",
          modeMismatch: "The configuration does not match the selected local or cloud mode.",
          localCommandRequired: "A local server needs a non-empty command.",
          localArgsInvalid: "args must be an array of strings.",
          localEnvInvalid: "env must be an object with string values.",
          cloudUrlRequired: "A cloud server needs an HTTP(S) url.",
          cloudUrlInvalid: "url must be a valid HTTP or HTTPS address.",
          cloudHeadersInvalid: "headers must be an object with string values.",
          unsupportedProperty: "The configuration contains a field this editor does not support.",
        },
      },
      builtins: {
        knowledgeBase: {
          name: "Knowledge Base",
          description: "Manage local documents and indexes for grounded retrieval."
        },
        github: {
          name: "GitHub",
          description: "Connect GitHub and manage project access and collaboration."
        },
        notion: {
          name: "Notion",
          description: "Connect a Notion workspace and manage pages, databases, and knowledge sync."
        },
        mailCenter: {
          name: "Mail Center",
          description: "Configure mail accounts and browse and manage messages."
        },
        newsHub: {
          name: "News Hub",
          description: "Manage sources, browse news, and search articles."
        },
        touchRealm: {
          name: "Touch Realm",
          description: "Connect your current Chrome, authorize the extension, and use browser actions and clipping."
        },
        codeGraph: {
          name: "CodeGraph",
          description: "Review code indexing capabilities, runtime requirements, and configuration."
        }
      }
    },
    navigation: {
      home: "Home",
      forge: "Forge",
      remoteAccess: "Remote connection",
      cloudAccount: "Cloud Account",
      dashboard: "Workbench",
      extensions: "Extensions",
      capabilities: "Capabilities",
      connectors: "Connectors",
      skills: "Skills",
      settings: "Settings",
      help: "Help",
      helpOpenFailed: "The help page could not be opened. Please try again.",
      account: "Account",
      about: "About",
      development: "Development",
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
