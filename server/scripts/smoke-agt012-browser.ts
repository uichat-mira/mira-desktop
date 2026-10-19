import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { createPiAgentLoop } from "@/agent/pi-loop/index.js";
import { createAgentGoal } from "@/agent/nodes/goal-plan.js";
import type { AgentGraphInput, AgentGraphOutput } from "@/agent/types.js";
import type { AgentInputWithCheckpoint } from "@/agent/runtime-checkpoint.js";
import { clearHarnessRegistry, registerTool } from "@/harness/registry.js";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";
import type { BrowserSessionConfig } from "@/microapps/computer-use/browser/types.js";
import { isAgt012SmokeAutoApprovableTool, isExpectedAgt012FinalBrowserState } from "@/microapps/computer-use/agt012-smoke-evidence.js";
import { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";
import { resolveAgentTaskProvider } from "@/services/provider-proxy.service/resolution.js";

const workspaceRoot = path.basename(process.cwd()) === "server"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const evidenceRoot = path.join(
  workspaceRoot,
  ".test-artifact",
  "computer-use",
  "agt-012",
);
fs.mkdirSync(evidenceRoot, { recursive: true });

const executableCandidates = (() => {
  const cache = path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(cache)) return [];
  return fs.readdirSync(cache)
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
if (!executablePath) {
  throw new Error("AGT-012 smoke requires a real Chromium/Chrome executable.");
}

const requests: string[] = [];
const fixtureServer = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  requests.push(requestUrl.pathname + requestUrl.search);

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
  fixtureServer.once("error", reject);
  fixtureServer.listen(0, "127.0.0.1", () => resolve());
});
const address = fixtureServer.address();
if (!address || typeof address === "string") {
  throw new Error("AGT-012 fixture did not expose a TCP port.");
}
const loginUrl = `http://127.0.0.1:${address.port}/login`;
const prompt = `Open ${loginUrl}, sign in as Mira, wait until the page reports Welcome Mira, then tell me the final page state.`;

class RecordingBrowserSessionManager extends BrowserSessionManager {
  readonly createdSessionIds: string[] = [];

  override async create(config: BrowserSessionConfig) {
    const session = await super.create(config);
    if (session.status === "ready") this.createdSessionIds.push(session.id);
    return session;
  }
}

const manager = new RecordingBrowserSessionManager({
  launcher: {
    launch: (options) => chromium.launch({ ...options, executablePath }),
  },
  artifactRoot: evidenceRoot,
});
const browser = new BrowserService(manager);
clearHarnessRegistry();
for (const tool of createComputerUseBrowserTools(browser, { sessionManager: manager })) {
  registerTool(tool);
}

const provider = resolveAgentTaskProvider("default");
const providerUrl = new URL(provider.baseUrl);
const providerIdentity = {
  providerCode: provider.providerCode,
  model: provider.model,
  endpointOrigin: providerUrl.origin,
};

const executionNodes: unknown[] = [];
const loop = createPiAgentLoop();
const baseInput: AgentInputWithCheckpoint = {
  runId: `agt012-real-${crypto.randomUUID()}`,
  threadId: `agt012-real-thread-${crypto.randomUUID()}`,
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
  maxIterations: 30,
  onExecutionNode: async (node) => {
    executionNodes.push(node);
  },
};

const approvals: Array<{
  approvalId: string;
  toolId: string;
  inputHash: string;
  input: Record<string, unknown>;
}> = [];
const attempts: Array<{
  status: AgentGraphOutput["status"];
  pendingToolId?: string;
  answer?: string;
  executedToolIds: string[];
  errorMessage?: string;
}> = [];


let input: AgentGraphInput = baseInput;
let output: AgentGraphOutput | undefined;
let stoppedForLegacySelection = false;
let stoppedForUnexpectedTool: string | undefined;

try {
  for (let resumeCount = 0; resumeCount < 20; resumeCount += 1) {
    output = await loop.run(input);
    attempts.push({
      status: output.status,
      pendingToolId: output.pendingToolCall?.toolId,
      answer: output.answer,
      executedToolIds: output.evidence.toolExecutions.map((item) => item.toolId),
      errorMessage: output.errorMessage,
    });

    if (output.status !== "waiting_approval") break;
    const pending = output.pendingToolCall;
    const approval = output.pendingApproval;
    if (!pending || !approval) {
      throw new Error("Pi loop reported waiting_approval without a frozen invocation.");
    }

    if (pending.toolId === "browser_observe" || pending.toolId === "browser_act") {
      stoppedForLegacySelection = true;
      break;
    }
    if (!isAgt012SmokeAutoApprovableTool(pending.toolId)) {
      stoppedForUnexpectedTool = pending.toolId;
      break;
    }

    approvals.push({
      approvalId: approval.id,
      toolId: pending.toolId,
      inputHash: pending.inputHash,
      input: pending.args,
    });

    input = {
      ...baseInput,
      currentTaskFrame: output.currentTaskFrame,
      observations: output.observations,
      evidence: output.evidence,
      retrievedChunks: output.retrievedChunks,
      lastToolExecution: output.lastToolExecution,
      iterationCount: (output as AgentGraphOutput & { iterationCount?: number }).iterationCount,
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
    } as AgentInputWithCheckpoint;
  }

  if (!output) throw new Error("Pi loop produced no output.");
  const parentExecutedToolIds = output.evidence.toolExecutions.map((item) => item.toolId);
  const subAgentExecutedToolIds = executionNodes.flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const details = (node as { details?: unknown }).details;
    if (!details || typeof details !== "object" || Array.isArray(details)) return [];
    const record = details as Record<string, unknown>;
    if (record.subAgentTraceEvent !== true || record.subAgentEventType !== "tool.completed") return [];
    const traceDetails = record.traceDetails;
    if (!traceDetails || typeof traceDetails !== "object" || Array.isArray(traceDetails)) return [];
    const trace = traceDetails as Record<string, unknown>;
    if (trace.bindingExecuted !== true || typeof trace.toolId !== "string") return [];
    return [trace.toolId];
  });
  const executedToolIds = [...parentExecutedToolIds, ...subAgentExecutedToolIds];
  const legacyExecutions = executedToolIds.filter(
    (toolId) => toolId === "browser_observe" || toolId === "browser_act",
  );
  const attachedExecutions = executedToolIds.filter((toolId) =>
    toolId.startsWith("browser_attached_"),
  );
  const childDiscoverableToolIds = executionNodes.flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const record = node as { nodeId?: unknown; details?: unknown };
    if (record.nodeId !== "agent-generic-task-subagent") return [];
    if (!record.details || typeof record.details !== "object" || Array.isArray(record.details)) return [];
    const ids = (record.details as Record<string, unknown>).childDiscoverableToolIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
  const legacyDiscoverableToolIds = childDiscoverableToolIds.filter(
    (toolId) => toolId === "browser_observe" || toolId === "browser_act",
  );
  const finalEvidence = output.evidence.toolExecutions.at(-1)?.result;
  const finalBrowserSessionId = manager.createdSessionIds.at(-1);
  const finalBrowserSession = finalBrowserSessionId
    ? manager.get(finalBrowserSessionId)
    : undefined;
  const expectedFinalUrl = new URL("/success?name=Mira", loginUrl).toString();
  let finalBrowserUrl: string | undefined;
  let finalBrowserVisibleText: string | undefined;
  let finalBrowserReadError: string | undefined;
  if (finalBrowserSession) {
    try {
      finalBrowserUrl = finalBrowserSession.page.url();
      finalBrowserVisibleText = await finalBrowserSession.page.evaluate(
        () => document.body?.innerText ?? "",
      );
    } catch (cause) {
      finalBrowserReadError = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const browserStatePassed = isExpectedAgt012FinalBrowserState({
    actualUrl: finalBrowserUrl,
    expectedUrl: expectedFinalUrl,
    visibleText: finalBrowserVisibleText,
  });
  const passed =
    !stoppedForLegacySelection &&
    !stoppedForUnexpectedTool &&
    output.status === "completed" &&
    legacyExecutions.length === 0 &&
    legacyDiscoverableToolIds.length === 0 &&
    attachedExecutions.length === 0 &&
    requests.includes("/success?name=Mira") &&
    browserStatePassed;

  const evidence = {
    recordedAt: new Date().toISOString(),
    provider: providerIdentity,
    prompt,
    passed,
    stoppedForLegacySelection,
    stoppedForUnexpectedTool,
    output: {
      status: output.status,
      answer: output.answer,
      errorMessage: output.errorMessage,
      terminalReason: output.terminalReason,
      pendingToolId: output.pendingToolCall?.toolId,
      parentExecutedToolIds,
      subAgentExecutedToolIds,
      executedToolIds,
      legacyExecutions,
      childDiscoverableToolIds,
      legacyDiscoverableToolIds,
      attachedExecutions,
      progressiveResolution: output.progressiveResolution,
      finalEvidence,
    },
    approvals,
    attempts,
    browserState: {
      sessionId: finalBrowserSessionId,
      expectedUrl: expectedFinalUrl,
      actualUrl: finalBrowserUrl,
      visibleText: finalBrowserVisibleText,
      readError: finalBrowserReadError,
      passed: browserStatePassed,
    },
    fixture: {
      loginUrl,
      requests,
    },
    executionNodes,
  };
  const target = path.join(evidenceRoot, "real-model-smoke.json");
  fs.writeFileSync(target, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    target,
    provider: providerIdentity,
    passed,
    status: output.status,
    answer: output.answer,
    pendingToolId: output.pendingToolCall?.toolId,
    parentExecutedToolIds,
    subAgentExecutedToolIds,
    executedToolIds,
    legacyExecutions,
    childDiscoverableToolIds,
    legacyDiscoverableToolIds,
    attachedExecutions,
    approvals: approvals.map(({ toolId, inputHash }) => ({ toolId, inputHash })),
    requests,
    browserState: {
      expectedUrl: expectedFinalUrl,
      actualUrl: finalBrowserUrl,
      visibleText: finalBrowserVisibleText,
      readError: finalBrowserReadError,
      passed: browserStatePassed,
    },
    stoppedForLegacySelection,
    stoppedForUnexpectedTool,
    errorMessage: output.errorMessage,
  }, null, 2));

  if (!passed) process.exitCode = 2;
} finally {
  await manager.closeAll();
  clearHarnessRegistry();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
}
