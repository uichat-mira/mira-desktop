import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
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
      timeoutMs: 5000,
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
