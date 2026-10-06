---
engine:
  id: opencode
  detection-engine: copilot
  version: "1.18.34"
  display-name: Mira OpenCode Go
  description: OpenCode CLI pinned for the Mira Agent Dispatch POC and using OpenCode's native Go provider.
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
        - opencode.jsonc
        - AGENTS.md
      path-prefixes:
        - .opencode/
    network:
      defaults:
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
    config-file:
      path: opencode.jsonc
      step-name: Write Mira OpenCode Go config
      content: |-
        {
          "$schema": "https://opencode.ai/config.json",
          "model": "{env:OPENCODE_MODEL}",
          "enabled_providers": ["opencode-go"],
          "share": "disabled",
          "autoupdate": false,
          "permission": {
            "read": "allow",
            "glob": "allow",
            "grep": "allow",
            "skill": "allow",
            "edit": "deny",
            "bash": "deny",
            "task": "deny",
            "webfetch": "deny",
            "websearch": "deny",
            "question": "deny"
          },
          "provider": {
            "opencode-go": {
              "options": {
                "apiKey": "{env:AI_PROVIDER_OPENCODE_GO_KEY}"
              }
            }
          }
        }
      merge-strategy: json-merge
    execution:
      command-name: opencode
      args:
        - run
        - --format
        - json
        - --agent
        - build
        - --print-logs
        - --log-level
        - INFO
      step-name: Execute OpenCode CLI
      model-env-var: OPENCODE_MODEL
      write-timestamp: true
      env:
        XDG_DATA_HOME: /tmp/opencode-data
        XDG_CONFIG_HOME: /tmp/opencode-config
        XDG_CACHE_HOME: /tmp/opencode-cache
        XDG_STATE_HOME: /tmp/opencode-state
        OPENCODE_DISABLE_AUTOUPDATE: "1"
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1"
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1"
        OPENCODE_DISABLE_MODELS_FETCH: "1"
        NO_COLOR: "1"
---

This file is a narrow POC engine definition. It deliberately exposes only read-only repository tools plus the native OpenCode skill loader. GitHub writes are not granted here.
