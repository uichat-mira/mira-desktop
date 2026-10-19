import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import {
  appendPendingEvidence,
  createAgentGoal,
  genericTaskSubAgentNode,
  normalizeAndFreezeToolCall,
  pauseForApproval,
  policyNode,
  prepareContextNode,
  retrieveNode,
  toolNode,
  toolSchemaDisclosureNode,
} from "@/agent/nodes/index.js";
import { createPiAgentLoop, type PiAgentLoopSemantics } from "@/agent/pi-loop/index.js";
import type { AgentNodeState } from "@/agent/node-runtime.js";
import type { AgentInputWithCheckpoint } from "@/agent/runtime-checkpoint.js";
import type { AgentGraphOutput } from "@/agent/types.js";
import {
  clearInvocations,
  executeInvocation,
  resolveInvocationApproval,
} from "@/mcp/core/invocations.js";
import {
  clearRegistry,
  registerTool,
} from "@/mcp/core/registry.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import { BrowserService } from "../browser/service.js";
import { BrowserSessionManager } from "../session/manager.js";

const workspaceRoot = path.basename(process.cwd()) === "server"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const evidenceRoot = path.join(
  workspaceRoot,
  ".test-artifact",
  "computer-use",
  "agt-012",
);

const executableCandidates = (() => {
  const cache = path.join(
    process.env.HOME ?? "",
    "Library",
    "Caches",
    "ms-playwright",
  );
  if (!fs.existsSync(cache)) return [];
  return fs
    .readdirSync(cache)
    .filter((entry) => /^chromium-\d+$/.test(entry))
    .sort()
    .reverse()
    .map((revision) =>
      path.join(
        cache,
        revision,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      ),
    );
})();

const installedBrowsers = [
  process.env.MIRA_BROWSER_TEST_EXECUTABLE,
  chromium.executablePath(),
  ...executableCandidates,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = installedBrowsers.find(
  (candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)),
);

type FixtureServer = {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
};

const startFixtureServer = async (): Promise<FixtureServer> => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(requestUrl.pathname);

    if (requestUrl.pathname === "/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
<head><title>AGT-012 Login</title></head>
<body>
  <h1>Managed Browser Login</h1>
  <label for="name">Name</label>
  <input id="name" value="">
  <button id="login">Sign in</button>
  <p id="status">Signed out</p>
  <script>
    document.getElementById("login").addEventListener("click", () => {
      const name = document.getElementById("name").value;
      document.getElementById("status").textContent = "Signing in";
      setTimeout(() => {
        window.location.href = "/success?name=" + encodeURIComponent(name);
      }, 120);
    });
  </script>
</body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/success") {
      const name = requestUrl.searchParams.get("name") ?? "Unknown";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
<head><title>AGT-012 Success</title></head>
<body><h1>Welcome ${name}</h1><p id="status">authenticated</p></body>
</html>`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Fixture server did not expose a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const approve = (toolId: string, args: Record<string, unknown>) => ({
  toolId,
  inputHash: createInvocationInputHash(args),
});

const resultOf = <T>(invocation: { result?: unknown }) => invocation.result as T;

const snapshotRefs = (snapshot: string | undefined) => ({
  input: snapshot?.match(/textbox "Name"[^\n]*\[ref=([^\]]+)\]/)?.[1],
  button: snapshot?.match(/button "Sign in"[^\n]*\[ref=([^\]]+)\]/)?.[1],
});

const managers: BrowserSessionManager[] = [];
const servers: FixtureServer[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  clearRegistry();
  clearInvocations();
});

describe.skipIf(!executablePath)("AGT-012 Managed Browser cutover acceptance", () => {
  it("completes the atomic Tool journey through real Chromium and Harness approval without legacy Browser Tool ids", async () => {
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const fixture = await startFixtureServer();
    servers.push(fixture);

    const manager = new BrowserSessionManager({
      launcher: {
        launch: (options) => chromium.launch({ ...options, executablePath }),
      },
      artifactRoot: evidenceRoot,
    });
    managers.push(manager);
    const browser = new BrowserService(manager);
    for (const tool of createComputerUseBrowserTools(browser, { sessionManager: manager })) {
      registerTool(tool);
    }

    const threadId = `agt012-${crypto.randomUUID()}`;
    const toolSequence: string[] = [];
    const loginUrl = `${fixture.baseUrl}/login`;

    const navigateArgs = { url: loginUrl };
    const navigatePending = await executeInvocation({
      toolId: "browser_navigate",
      threadId,
      args: navigateArgs,
    });
    expect(navigatePending.status).toBe("awaiting_approval");
    expect(fixture.requests).toEqual([]);
    const navigated = await executeInvocation({
      toolId: "browser_navigate",
      threadId,
      args: navigateArgs,
      approvedInvocations: [approve("browser_navigate", navigateArgs)],
    });
    toolSequence.push(navigated.toolId);
    expect(navigated.status).toBe("completed");
    expect(resultOf<{ ok: boolean; page: { url: string } }>(navigated)).toMatchObject({
      ok: true,
      page: { url: loginUrl },
    });

    const snapshot = await executeInvocation({
      toolId: "browser_snapshot",
      threadId,
      args: {},
    });
    toolSequence.push(snapshot.toolId);
    expect(snapshot.status).toBe("completed");
    const snapshotResult = resultOf<{
      page: { url: string; snapshotHash: string };
      observation?: { snapshot?: string };
    }>(snapshot);
    const refs = snapshotRefs(snapshotResult.observation?.snapshot);
    expect(refs.input).toBeTruthy();
    expect(refs.button).toBeTruthy();

    const sessionId = navigated.args.sessionId as string;
    const page = manager.get(sessionId)!.page;

    const fillArgs = {
      pageUrl: snapshotResult.page.url,
      snapshotHash: snapshotResult.page.snapshotHash,
      ref: refs.input!,
      value: "Mira",
    };
    const fillPending = await executeInvocation({
      toolId: "browser_fill",
      threadId,
      args: fillArgs,
    });
    expect(fillPending.status).toBe("awaiting_approval");
    expect(fillPending.inputHash).toBe(createInvocationInputHash(fillArgs));
    expect(
      await page.evaluate(() => (document.getElementById("name") as HTMLInputElement).value),
    ).toBe("");
    const filled = await executeInvocation({
      toolId: "browser_fill",
      threadId,
      args: fillArgs,
      approvedInvocations: [
        { toolId: "browser_fill", inputHash: fillPending.inputHash! },
      ],
    });
    toolSequence.push(filled.toolId);
    expect(filled.status).toBe("completed");
    expect(
      await page.evaluate(() => (document.getElementById("name") as HTMLInputElement).value),
    ).toBe("Mira");

    const afterFill = resultOf<{
      page: { url: string; snapshotHash: string };
      observation?: { snapshot?: string };
    }>(
      await executeInvocation({
        toolId: "browser_snapshot",
        threadId,
        args: {},
      }),
    );
    const freshButtonRef = snapshotRefs(afterFill.observation?.snapshot).button;
    expect(freshButtonRef).toBeTruthy();

    const rejectedClickArgs = {
      pageUrl: afterFill.page.url,
      snapshotHash: afterFill.page.snapshotHash,
      ref: freshButtonRef!,
    };
    const rejectedClick = await executeInvocation({
      toolId: "browser_click",
      threadId,
      args: rejectedClickArgs,
    });
    expect(rejectedClick.status).toBe("awaiting_approval");
    const rejection = resolveInvocationApproval({
      invocationId: rejectedClick.id,
      decision: "rejected",
      reason: "AGT-012 negative approval check",
    });
    expect(rejection.status).toBe("cancelled");
    expect(page.url()).toBe(loginUrl);
    expect(fixture.requests).not.toContain("/success");

    const clickPending = await executeInvocation({
      toolId: "browser_click",
      threadId,
      args: rejectedClickArgs,
    });
    expect(clickPending.status).toBe("awaiting_approval");
    const clicked = await executeInvocation({
      toolId: "browser_click",
      threadId,
      args: rejectedClickArgs,
      approvedInvocations: [
        { toolId: "browser_click", inputHash: clickPending.inputHash! },
      ],
    });
    toolSequence.push(clicked.toolId);
    expect(clicked.status).toBe("completed");

    const waitArgs = {
      condition: { kind: "text" as const, value: "Welcome Mira" },
      // Full Windows CI can spend several seconds capturing a real AI aria
      // snapshot under load. This is the success-path integration budget; the
      // explicit wait_timeout negative below stays at 100 ms.
      timeoutMs: 15000,
    };
    const waitPending = await executeInvocation({
      toolId: "browser_wait_for",
      threadId,
      args: waitArgs,
    });
    expect(waitPending.status).toBe("awaiting_approval");
    const waited = await executeInvocation({
      toolId: "browser_wait_for",
      threadId,
      args: waitArgs,
      approvedInvocations: [
        { toolId: "browser_wait_for", inputHash: waitPending.inputHash! },
      ],
    });
    toolSequence.push(waited.toolId);
    expect(waited.status).toBe("completed");
    expect(resultOf<{ ok: boolean }>(waited)).toMatchObject({ ok: true });

    const finalSnapshot = await executeInvocation({
      toolId: "browser_snapshot",
      threadId,
      args: {},
    });
    toolSequence.push(finalSnapshot.toolId);
    const finalSnapshotResult = resultOf<{
      ok: boolean;
      page: { url: string; title: string };
      observation?: { visibleText?: string };
    }>(finalSnapshot);
    expect(finalSnapshotResult.ok).toBe(true);
    expect(finalSnapshotResult.page.url).toContain("/success?name=Mira");
    expect(finalSnapshotResult.observation?.visibleText).toContain("Welcome Mira");

    const asserted = await executeInvocation({
      toolId: "browser_assert",
      threadId,
      args: { assertion: { kind: "text", expected: "Welcome Mira" } },
    });
    toolSequence.push(asserted.toolId);
    expect(asserted.status).toBe("completed");
    expect(resultOf<{ ok: boolean; assertion?: { passed: boolean } }>(asserted)).toMatchObject({
      ok: true,
      assertion: { passed: true },
    });

    expect(toolSequence).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_fill",
      "browser_click",
      "browser_wait_for",
      "browser_snapshot",
      "browser_assert",
    ]);
    expect(toolSequence).not.toContain("browser_observe");
    expect(toolSequence).not.toContain("browser_act");

    await manager.stop(sessionId);
    const afterStop = await executeInvocation({
      toolId: "browser_snapshot",
      threadId,
      args: {},
    });
    expect(resultOf<{ ok: boolean; error?: { code: string } }>(afterStop)).toMatchObject({
      ok: false,
      error: { code: "session_unavailable" },
    });

    fs.writeFileSync(
      path.join(evidenceRoot, "atomic-journey.json"),
      JSON.stringify(
        {
          loginUrl,
          toolSequence,
          requests: fixture.requests,
          approval: {
            rejectedInvocation: rejectedClick.id,
            rejectedStatus: rejection.status,
            approvedFillHash: fillPending.inputHash,
            approvedClickHash: clickPending.inputHash,
            approvedWaitHash: waitPending.inputHash,
          },
          final: finalSnapshotResult,
          afterStop: afterStop.result,
        },
        null,
        2,
      ),
    );
  }, 30000);

  it("runs the application-default Pi loop through Browser metadata disclosure, atomic execution and approval resume", async () => {
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const fixture = await startFixtureServer();
    servers.push(fixture);

    const manager = new BrowserSessionManager({
      launcher: {
        launch: (options) => chromium.launch({ ...options, executablePath }),
      },
      artifactRoot: evidenceRoot,
    });
    managers.push(manager);
    const browser = new BrowserService(manager);
    for (const tool of createComputerUseBrowserTools(browser, { sessionManager: manager })) {
      registerTool(tool);
    }

    const loginUrl = `${fixture.baseUrl}/login`;
    const prompt = `Open ${loginUrl}, sign in as Mira, wait until the page reports Welcome Mira, then report the final state.`;
    const plannerCalls: Array<{
      exposed: string[];
      schemas: string[];
      executed: string[];
      selected: string;
    }> = [];

    const browserResultFromExecution = (
      state: AgentNodeState,
      toolId: string,
    ) => {
      const execution = [...(state.evidence?.toolExecutions ?? [])]
        .reverse()
        .find((item) => item.toolId === toolId);
      return execution?.result as {
        page?: { url?: string; snapshotHash?: string };
        observation?: { snapshot?: string; visibleText?: string };
        assertion?: { passed?: boolean };
      } | undefined;
    };

    const planner: PiAgentLoopSemantics["planner"] = async (state) => {
      const executions = state.evidence?.toolExecutions ?? [];
      const executed = executions.map((item) => item.toolId);
      const metaById = new Map(
        (state.toolExposure?.toolMeta ?? []).map((meta) => [meta.toolId, meta]),
      );
      const hasSchema = (toolId: string) => Boolean(metaById.get(toolId)?.inputSchema);
      const useTool = (toolId: string, args: Record<string, unknown>) => {
        plannerCalls.push({
          exposed: [...(state.toolExposure?.exposedTools ?? [])],
          schemas: [...metaById.entries()]
            .filter(([, meta]) => Boolean(meta.inputSchema))
            .map(([id]) => id),
          executed: [...executed],
          selected: toolId,
        });
        return {
          nextAction: {
            type: "use_tool" as const,
            toolId,
            args,
            reason: `AGT-012 deterministic Pi acceptance step: ${toolId}`,
          },
        };
      };
      const requestOrUse = (toolId: string, args: Record<string, unknown>) =>
        useTool(toolId, hasSchema(toolId) ? args : {});

      if (!executed.includes("browser_navigate")) {
        return requestOrUse("browser_navigate", { url: loginUrl });
      }
      if (executed.filter((toolId) => toolId === "browser_snapshot").length === 0) {
        return requestOrUse("browser_snapshot", {});
      }
      if (!executed.includes("browser_fill")) {
        const snapshot = browserResultFromExecution(state, "browser_snapshot");
        const refs = snapshotRefs(snapshot?.observation?.snapshot);
        if (!snapshot?.page?.url || !snapshot.page.snapshotHash || !refs.input) {
          return {
            errorMessage: "AGT-012 planner could not derive the input ref from Browser evidence.",
            errorSourceNodeId: "nextActionPlanner",
            nextAction: {
              type: "error" as const,
              reason: "Missing input Browser evidence.",
            },
          };
        }
        return requestOrUse("browser_fill", {
          pageUrl: snapshot.page.url,
          snapshotHash: snapshot.page.snapshotHash,
          ref: refs.input,
          value: "Mira",
        });
      }
      if (executed.filter((toolId) => toolId === "browser_snapshot").length === 1) {
        return requestOrUse("browser_snapshot", {});
      }
      if (!executed.includes("browser_click")) {
        const snapshot = browserResultFromExecution(state, "browser_snapshot");
        const refs = snapshotRefs(snapshot?.observation?.snapshot);
        if (!snapshot?.page?.url || !snapshot.page.snapshotHash || !refs.button) {
          return {
            errorMessage: "AGT-012 planner could not derive the button ref from Browser evidence.",
            errorSourceNodeId: "nextActionPlanner",
            nextAction: {
              type: "error" as const,
              reason: "Missing button Browser evidence.",
            },
          };
        }
        return requestOrUse("browser_click", {
          pageUrl: snapshot.page.url,
          snapshotHash: snapshot.page.snapshotHash,
          ref: refs.button,
        });
      }
      if (!executed.includes("browser_wait_for")) {
        return requestOrUse("browser_wait_for", {
          condition: { kind: "text", value: "Welcome Mira" },
          timeoutMs: 5000,
        });
      }
      if (executed.filter((toolId) => toolId === "browser_snapshot").length === 2) {
        return requestOrUse("browser_snapshot", {});
      }
      if (!executed.includes("browser_assert")) {
        return requestOrUse("browser_assert", {
          assertion: { kind: "text", expected: "Welcome Mira" },
        });
      }

      const finalSnapshot = browserResultFromExecution(state, "browser_snapshot");
      const asserted = browserResultFromExecution(state, "browser_assert");
      if (
        !finalSnapshot?.observation?.visibleText?.includes("Welcome Mira") ||
        asserted?.assertion?.passed !== true
      ) {
        return {
          nextAction: {
            type: "error" as const,
            reason: "Final Browser evidence did not prove the requested state.",
          },
          errorMessage: "Final Browser evidence did not prove the requested state.",
          errorSourceNodeId: "nextActionPlanner",
        };
      }
      return {
        nextAction: {
          type: "answer" as const,
          reason: "Atomic Browser evidence proves the requested final state.",
          completionProof: [
            {
              criterion: "Welcome Mira is visible and asserted",
              evidenceRefs: ["browser_snapshot", "browser_assert"],
            },
          ],
          unresolvedGaps: [],
        },
      };
    };

    const semantics: PiAgentLoopSemantics = {
      prepareContext: prepareContextNode,
      planner,
      delegateTask: genericTaskSubAgentNode,
      discloseToolSchema: toolSchemaDisclosureNode,
      normalizeAndFreeze: normalizeAndFreezeToolCall,
      evaluatePolicy: policyNode,
      pauseForApproval,
      retrieve: retrieveNode,
      executeTool: toolNode,
      appendEvidence: appendPendingEvidence,
      generate: async () => ({ answer: "Welcome Mira is visible on the authenticated page." }),
      finalize: async () => ({ terminalReason: "completed" }),
      finishWithError: async (state) => ({
        errorMessage: state.errorMessage ?? "AGT-012 Pi acceptance failed.",
      }),
    };
    const loop = createPiAgentLoop(semantics);
    const baseInput: AgentInputWithCheckpoint = {
      runId: `agt012-pi-${crypto.randomUUID()}`,
      threadId: `agt012-pi-thread-${crypto.randomUUID()}`,
      userId: 1,
      goal: createAgentGoal(prompt),
      messages: [
        {
          role: "user",
          content: prompt,
          parts: [{ type: "text", text: prompt }],
        },
      ],
      requestedToolGroupIds: ["browser"],
      maxIterations: 20,
    };

    const approvalTrace: Array<{
      toolId: string;
      inputHash: string;
      approvalId: string;
    }> = [];
    let input: AgentInputWithCheckpoint = baseInput;
    let output: AgentGraphOutput & { iterationCount?: number };

    for (let resumeCount = 0; resumeCount < 12; resumeCount += 1) {
      output = await loop.run(input) as AgentGraphOutput & { iterationCount?: number };
      if (output.status !== "waiting_approval") break;
      expect(output.pendingApproval).toBeDefined();
      expect(output.pendingToolCall).toBeDefined();
      const approval = output.pendingApproval!;
      const pending = output.pendingToolCall!;
      expect(approval.toolId).toBe(pending.toolId);
      expect(approval.inputHash).toBe(pending.inputHash);
      approvalTrace.push({
        toolId: pending.toolId,
        inputHash: pending.inputHash,
        approvalId: approval.id,
      });
      input = {
        ...baseInput,
        currentTaskFrame: output.currentTaskFrame,
        observations: output.observations,
        evidence: output.evidence,
        retrievedChunks: output.retrievedChunks,
        lastToolExecution: output.lastToolExecution,
        iterationCount: output.iterationCount,
        finalizationPacket: output.finalizationPacket,
        workspaceOutputs: output.workspaceOutputs,
        progressiveResolution: output.progressiveResolution,
        pendingToolCall: pending,
        approvedInvocations: [
          {
            toolId: pending.toolId,
            input: pending.args,
            inputHash: pending.inputHash,
            approvedAt: new Date().toISOString(),
            approvalId: approval.id,
          },
        ],
      };
    }

    expect(output!).toBeDefined();
    expect(output!.status).toBe("completed");
    expect(output!.answer).toContain("Welcome Mira");
    const executed = output!.evidence.toolExecutions.map((execution) => execution.toolId);
    expect(executed).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_fill",
      "browser_snapshot",
      "browser_click",
      "browser_wait_for",
      "browser_snapshot",
      "browser_assert",
    ]);
    expect(executed).not.toContain("browser_observe");
    expect(executed).not.toContain("browser_act");
    // Current Agent MVP policy conservatively requires approval for the
    // browser_action domain even when a concrete Tool declares sideEffect:none.
    // AGT-012 verifies and preserves that policy; it does not relax approvals.
    expect(approvalTrace.map((item) => item.toolId)).toEqual(executed);
    expect(output!.progressiveResolution?.budget.consumed).toBe(6);
    for (const toolId of [
      "browser_navigate",
      "browser_snapshot",
      "browser_fill",
      "browser_click",
      "browser_wait_for",
      "browser_assert",
    ]) {
      expect(output!.progressiveResolution?.disclosure[toolId]).toBe("schema");
    }
    expect(
      plannerCalls.some(
        (call) =>
          call.selected === "browser_click" &&
          !call.schemas.includes("browser_click"),
      ),
    ).toBe(true);
    expect(
      plannerCalls.some(
        (call) =>
          call.selected === "browser_click" &&
          call.schemas.includes("browser_click"),
      ),
    ).toBe(true);

    fs.writeFileSync(
      path.join(evidenceRoot, "pi-main-agent-trace.json"),
      JSON.stringify(
        {
          prompt,
          executed,
          approvalTrace,
          progressiveResolution: output!.progressiveResolution,
          plannerCalls,
          answer: output!.answer,
        },
        null,
        2,
      ),
    );
  }, 60000);

  it("keeps stale identity, navigation policy and wait timeout failures explicit on the atomic Tool path", async () => {
    const fixture = await startFixtureServer();
    servers.push(fixture);
    const manager = new BrowserSessionManager({
      launcher: {
        launch: (options) => chromium.launch({ ...options, executablePath }),
      },
      artifactRoot: evidenceRoot,
    });
    managers.push(manager);
    const browser = new BrowserService(manager);
    for (const tool of createComputerUseBrowserTools(browser, { sessionManager: manager })) {
      registerTool(tool);
    }

    const threadId = `agt012-negative-${crypto.randomUUID()}`;
    const navigateArgs = { url: `${fixture.baseUrl}/login` };
    const navigated = await executeInvocation({
      toolId: "browser_navigate",
      threadId,
      args: navigateArgs,
      approvedInvocations: [approve("browser_navigate", navigateArgs)],
    });
    expect(navigated.status).toBe("completed");

    const snapshot = resultOf<{
      page: { url: string; snapshotHash: string };
      observation?: { snapshot?: string };
    }>(await executeInvocation({ toolId: "browser_snapshot", threadId, args: {} }));
    const refs = snapshotRefs(snapshot.observation?.snapshot);
    expect(refs.input).toBeTruthy();

    const staleArgs = {
      pageUrl: snapshot.page.url,
      snapshotHash: "stale-hash",
      ref: refs.input!,
      value: "Mallory",
    };
    const stale = await executeInvocation({
      toolId: "browser_fill",
      threadId,
      args: staleArgs,
      approvedInvocations: [approve("browser_fill", staleArgs)],
    });
    expect(resultOf<{ ok: boolean; error?: { code: string } }>(stale)).toMatchObject({
      ok: false,
      error: { code: "stale_snapshot" },
    });

    const port = new URL(fixture.baseUrl).port;
    const blockedArgs = { url: `http://localhost:${port}/success?name=WrongHost` };
    const blocked = await executeInvocation({
      toolId: "browser_navigate",
      threadId,
      args: blockedArgs,
      approvedInvocations: [approve("browser_navigate", blockedArgs)],
    });
    expect(resultOf<{ ok: boolean; error?: { code: string } }>(blocked)).toMatchObject({
      ok: false,
      error: { code: "navigation_blocked" },
    });
    expect(fixture.requests).not.toContain("/success");

    const timeoutArgs = {
      condition: { kind: "text" as const, value: "Never Appears" },
      timeoutMs: 100,
    };
    const timedOut = await executeInvocation({
      toolId: "browser_wait_for",
      threadId,
      args: timeoutArgs,
      approvedInvocations: [approve("browser_wait_for", timeoutArgs)],
    });
    expect(resultOf<{ ok: boolean; error?: { code: string } }>(timedOut)).toMatchObject({
      ok: false,
      error: { code: "wait_timeout" },
    });
  }, 30000);
});
