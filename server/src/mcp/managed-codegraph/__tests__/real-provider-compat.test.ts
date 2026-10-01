import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { test } from "vitest";

import { CodebaseExploreWrapper } from "../codebase-explore-wrapper.js";
import { resolveManagedCodeGraphLaunchSpec } from "../managed-jsonrpc-session.js";
import { createTimestampedTestArtifactPath } from "@/test-support/artifacts.js";

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
  const installRoot = createTimestampedTestArtifactPath(
    "workspace",
    "codegraph-windows-shim",
  );
  const shimPath = path.join(
    installRoot,
    "node_modules",
    "@colbymchenry",
    "codegraph",
    "npm-shim.js",
  );
  const launcherPath = path.join(installRoot, "codegraph.cmd");
  const bundledNodePath = path.join(installRoot, "node.exe");

  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(launcherPath, "@echo off\r\n", "utf8");
  fs.writeFileSync(shimPath, "// fixture\n", "utf8");
  fs.writeFileSync(bundledNodePath, "", "utf8");

  try {
    const spec = resolveManagedCodeGraphLaunchSpec(
      launcherPath,
      ["serve", "--mcp"],
    );

    assert.equal(path.resolve(spec.command), path.resolve(bundledNodePath));
    assert.equal(path.resolve(spec.args[0] ?? ""), path.resolve(shimPath));
    assert.equal(spec.args[1], "serve");
    assert.equal(spec.args[2], "--mcp");
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});
