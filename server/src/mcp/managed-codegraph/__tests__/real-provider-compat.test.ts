import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import { CodebaseExploreWrapper } from "../codebase-explore-wrapper.js";
import { resolveManagedCodeGraphLaunchSpec } from "../managed-jsonrpc-session.js";

test("CodebaseExploreWrapper can normalize real codegraph_explore text output", async () => {
  const wrapper = new CodebaseExploreWrapper({
    start: async () =>
      ({
        status: "ready",
        providerVersion: "1.3.0",
        telemetryStatus: "verified_off",
        handshakeStatus: "ok",
        initializedNotificationSent: true,
        workspaceHash: "workspace-hash",
        workspaceRoot: "D:\\workspace\\rag-demo",
        allowedWorkspaceRoot: "D:\\workspace\\rag-demo",
        workspaceMatches: true,
        logRoot: "D:\\tmp\\logs",
        indexRoot: "D:\\tmp\\index",
        processAlive: true,
        startedAt: Date.now(),
        stoppedAt: null,
        durationMs: null,
        exitCode: null,
        lastStatus: null,
        lastError: null,
        crashCount: 0,
        startDisposition: "primary",
      }) as const,
    callTool: async () => ({
      content: [
        {
          type: "text",
          text: `**Exploration: agentGraph.run**

Found 2 symbols across 1 file.

**Source Code**

**\`server/src/agent/index.ts\`** — runAgent(function), agentGraph(constant)

\`\`\`typescript
49\t    const output = await agentGraph.run({
50\t      messages,
51\t      runtime,
52\t    });
\`\`\``,
        },
      ],
    }),
    getStatus: () => ({
      status: "ready",
      providerVersion: "1.3.0",
      telemetryStatus: "verified_off",
      handshakeStatus: "ok",
      initializedNotificationSent: true,
      workspaceHash: "workspace-hash",
      workspaceRoot: "D:\\workspace\\rag-demo",
      allowedWorkspaceRoot: "D:\\workspace\\rag-demo",
      workspaceMatches: true,
      logRoot: "D:\\tmp\\logs",
      indexRoot: "D:\\tmp\\index",
      processAlive: true,
      startedAt: Date.now(),
      stoppedAt: null,
      durationMs: null,
      exitCode: null,
      lastStatus: null,
      lastError: null,
      crashCount: 0,
      startDisposition: "primary",
    }),
    request: async () => {
      throw new Error("Method not found: codegraph/query");
    },
  } as never);

  const result = await wrapper.explore({
    query: "agentGraph.run entry point",
    scope: "agent-runtime",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.path, "server/src/agent/index.ts");
  assert.equal(result.candidates[0]?.startLine, 49);
  assert.equal(result.candidates[0]?.endLine, 52);
  assert.equal(result.followUpReads.length, 1);
  assert.equal(result.followUpReads[0]?.path, "server/src/agent/index.ts");
  assert.equal(result.trace.providerVersion, "1.3.0");
  assert.equal(result.trace.exposureMode, "controlled_tool_only");
});

test.skipIf(process.platform !== "win32")("resolveManagedCodeGraphLaunchSpec resolves Windows npm shims to node plus npm-shim.js", () => {
  const spec = resolveManagedCodeGraphLaunchSpec(
    path.join("C:\\Program Files\\nodejs", "codegraph.cmd"),
    ["serve", "--mcp"],
  );

  assert.equal(path.basename(spec.command).toLowerCase(), "node.exe");
  assert.equal(spec.args[0]?.includes("npm-shim.js"), true);
  assert.equal(spec.args[1], "serve");
  assert.equal(spec.args[2], "--mcp");
});
