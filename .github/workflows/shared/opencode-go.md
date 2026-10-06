---
engine:
  id: opencode-go
  detection-engine: copilot
  version: "1.18.34"
  display-name: OpenCode Go
  description: OpenCode CLI routed through the gh-aw OpenAI-compatible firewall proxy to OpenCode Go.
  runtime-id: opencode
  experimental: true
  provider:
    name: openai
  behaviors:
    secret-strategy: universal-llm-consumer
    capabilities:
      tools-allowlist: true
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
        openai: opencode.ai
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
      model-env-provider-prefix: awf-proxy
      model-flag: --model
      mcp-config-env-var: OPENCODE_CONFIG
      write-timestamp: true
      provider-env-mode: universal-llm-consumer
      env:
        XDG_DATA_HOME: /tmp/opencode-data
        XDG_CONFIG_HOME: /tmp/opencode-config
        XDG_CACHE_HOME: /tmp/opencode-cache
        XDG_STATE_HOME: /tmp/opencode-state
        OPENCODE_CONFIG: /tmp/gh-aw/opencode-mcp.json
        OPENCODE_CONFIG_CONTENT: '{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","snapshot":false,"formatter":false,"lsp":false,"permission":"allow","enabled_providers":["awf-proxy"],"provider":{"awf-proxy":{"npm":"@ai-sdk/openai-compatible","name":"GitHub Agentic Workflows / OpenCode Go","options":{"baseURL":"http://172.30.0.30:10000","apiKey":"awf-proxy"},"models":{"deepseek-v4-flash":{"name":"DeepSeek V4 Flash"}}}}}'
        OPENCODE_AUTH_CONTENT: "{}"
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

The real OpenCode Go credential is supplied to the gh-aw OpenAI-compatible
firewall proxy through an `engine.env` override in the consuming workflow.
The OpenCode process itself talks only to the internal AWF proxy with a
placeholder key, so shell/tool execution inside the agent sandbox does not
receive the upstream credential.
