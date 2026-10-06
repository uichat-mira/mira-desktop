---
engine:
  id: opencode-go
  detection-engine: copilot
  version: "1.18.34"
  display-name: OpenCode Go
  description: OpenCode CLI using the OpenCode Go API with a repository-provided model
  runtime-id: opencode
  experimental: true
  auth:
    - role: api-key
      secret: AI_PROVIDER_OPENCODE_GO_KEY
  behaviors:
    capabilities:
      max-turns: true
    manifest:
      files:
        - opencode.json
        - opencode.jsonc
        - AGENTS.md
      path-prefixes:
        - .opencode/
    network:
      defaults:
        - host.docker.internal
        - github.com
        - raw.githubusercontent.com
        - opencode.ai
      provider-domains:
        opencode-go: opencode.ai
    installation:
      package-manager: npm
      package-name: opencode-ai
      version: "1.18.34"
      step-name: Install OpenCode CLI
      binary-name: opencode
      include-node-setup: true
      post-install-scripts: true
      cooldown: true
      verify-command: opencode --version
      verify-step-name: Verify OpenCode CLI installation
      docs-url: https://opencode.ai/docs
    execution:
      command-name: opencode
      args:
        - run
        - --format
        - json
        - --agent
        - build
        - --thinking
        - --print-logs
        - --log-level
        - INFO
      step-name: Execute OpenCode Go worker
      model-env-var: OPENCODE_MODEL
      model-flag: --model
      mcp-config-env-var: OPENCODE_CONFIG
      write-timestamp: true
      env:
        XDG_DATA_HOME: /tmp/opencode-data
        XDG_CONFIG_HOME: /tmp/opencode-config
        XDG_CACHE_HOME: /tmp/opencode-cache
        XDG_STATE_HOME: /tmp/opencode-state
        OPENCODE_CONFIG: /tmp/gh-aw/opencode-mcp.json
        OPENCODE_CONFIG_CONTENT: '{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","permission":"allow","provider":{"opencode-go":{"npm":"@ai-sdk/openai-compatible","name":"OpenCode Go","options":{"baseURL":"https://opencode.ai/zen/go/v1","apiKey":"{env:AI_PROVIDER_OPENCODE_GO_KEY}"},"models":{"deepseek-v4-flash":{"name":"DeepSeek V4 Flash"}}}}}'
        OPENCODE_DISABLE_AUTOUPDATE: "1"
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1"
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1"
        OPENCODE_DISABLE_MODELS_FETCH: "1"
        NO_COLOR: "1"
    mcp:
      config-path: /tmp/gh-aw/opencode-mcp.json
      config-adapter: |
        const { loadGatewayContext, filterAndTransformServers, rewriteUrl, writeSecureOutput } = require("./convert_gateway_config_shared.cjs");
        const context = loadGatewayContext();
        const mcp = filterAndTransformServers(context.servers, context.cliServers, (name, entry) => {
          if (typeof entry.url !== "string") {
            throw new Error(`OpenCode requires a gateway HTTP URL for MCP server ${name}`);
          }
          return {
            type: "remote",
            url: rewriteUrl(entry.url, context.urlPrefix),
            enabled: true,
            oauth: false,
            ...(entry.headers ? { headers: entry.headers } : {}),
          };
        });
        writeSecureOutput("/tmp/gh-aw/opencode-mcp.json", JSON.stringify({ mcp }, null, 2));
---

# OpenCode Go engine

POC-only declarative engine for GitHub Agentic Workflows.

It deliberately uses the supported third-party engine extension point instead of
forking `gh-aw`. The existing repository secret `AI_PROVIDER_OPENCODE_GO_KEY`
is injected only at runtime. OpenCode receives the provider configuration through
`OPENCODE_CONFIG_CONTENT`; no repository config file is written into the agent
workspace.
