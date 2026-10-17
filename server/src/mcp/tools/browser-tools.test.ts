import { describe, expect, test, vi } from "vitest";
import { createComputerUseBrowserTools } from "./browser-tools.tool.js";
import { clearInvocations, executeInvocation } from "../core/invocations.js";
import { clearRegistry, registerTool } from "../core/registry.js";
import { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

const browser = {
  observe: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-observe", page: { url: "https://example.com", title: "Example", snapshotHash: "hash-1" }, artifacts: [] })),
  act: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-act", page: { url: input.pageUrl, title: "Example", snapshotHash: input.snapshotHash }, artifacts: [] })),
  assert: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-assert", page: { url: "https://example.com", title: "Example" }, assertion: { kind: input.assertion.kind, passed: true }, artifacts: [] })),
  navigate: vi.fn(async (input: { sessionId: string; url: string }) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-navigate", page: { url: input.url, title: "Destination", snapshotHash: "hash-nav" }, observation: { snapshot: 'heading "Destination" ref=e1' }, artifacts: [] })),
  wait: vi.fn(async (input: { sessionId: string; condition: { kind: string } }) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-wait", page: { url: "https://example.com", title: "Example", snapshotHash: "hash-wait" }, observation: { snapshot: 'button "Go" ref=e2' }, artifacts: [] })),
};

describe("Computer Use browser MCP tools", () => {
  test("exposes legacy tools and the atomic navigation/observation tools", () => {
    const tools = createComputerUseBrowserTools(browser as never);
    expect(tools.map((tool) => tool.definition.id)).toEqual(["browser_observe", "browser_act", "browser_assert", "browser_navigate", "browser_wait_for", "browser_snapshot", "browser_screenshot"]);
    expect(tools.every((tool) => tool.definition.inputSchema.additionalProperties === false)).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.capabilities.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.description).toContain("page.title");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("navigate(url)");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("scroll(x,y)");
    expect(tools.find((tool) => tool.definition.id === "browser_assert")?.definition.description).toContain("value(ref,expected)");
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
    expect(tools.find((tool) => tool.definition.id === "browser_navigate")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
    expect(tools.find((tool) => tool.definition.id === "browser_wait_for")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
  });

  test("navigation and wait facades are separate approval-gated tools with strict schemas", () => {
    const tools = createComputerUseBrowserTools(browser as never);
    const navigate = tools.find((tool) => tool.definition.id === "browser_navigate")!.definition;
    expect(navigate.capabilities).toMatchObject({ sideEffect: "network", requiresApproval: true, networkAccess: true });
    expect(navigate.inputSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["url"] });
    expect(navigate.inputSchemaByExposure?.agent_intent).toMatchObject({ required: ["url"], additionalProperties: false });
    const wait = tools.find((tool) => tool.definition.id === "browser_wait_for")!.definition;
    expect(wait.capabilities).toMatchObject({ sideEffect: "none", requiresApproval: true, networkAccess: true });
    expect(wait.inputSchema).toMatchObject({ type: "object", additionalProperties: false, required: ["condition"] });
    const condition = (wait.inputSchema.properties as { condition: { oneOf: Array<{ properties: { kind: { enum: string[] } } }> } }).condition;
    expect(condition.oneOf.map((variant) => variant.properties.kind.enum[0])).toEqual(["text", "url", "visible"]);
  });

  test("snapshot and screenshot require a live bound session and reject unsupported screenshot mode", async () => {
    clearRegistry(); clearInvocations();
    const get = vi.fn((_id: string) => ({ info: { status: "ready" as const } }));
    const manager = { get, create: vi.fn(async () => ({ id: "browser-test", status: "ready" as const })) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager as never });
    tools.forEach(registerTool);
    const absent = await executeInvocation({ toolId: "browser_snapshot", threadId: "thread-no-session", args: {} });
    expect(absent.status).toBe("completed");
    expect(absent.result).toMatchObject({ ok: false, error: { code: "session_unavailable", retryable: true } });
    const invalidMode = await executeInvocation({ toolId: "browser_screenshot", threadId: "thread-no-session", args: { fullPage: false } });
    expect(invalidMode.status).toBe("failed");
    expect(invalidMode.error?.message).toMatch(/not supported/);
    const absentScreenshot = await executeInvocation({ toolId: "browser_screenshot", threadId: "thread-no-session", args: {} });
    expect(absentScreenshot.result).toMatchObject({ ok: false, error: { code: "session_unavailable" } });
    expect(manager.create).not.toHaveBeenCalled();
    expect(browser.observe).not.toHaveBeenCalled();
    expect(tools.find((x) => x.definition.id === "browser_snapshot")?.definition.capabilities).toMatchObject({ sideEffect: "none", requiresApproval: false });
    expect(tools.find((x) => x.definition.id === "browser_screenshot")?.definition.capabilities).toMatchObject({ sideEffect: "none", requiresApproval: false });
    for (const toolId of ["browser_snapshot", "browser_screenshot"]) {
      const def = tools.find((tool) => tool.definition.id === toolId)!.definition;
      expect(def.inputSchema).toMatchObject({ type: "object", additionalProperties: false, required: [] });
      expect(def.outputSchema).toHaveProperty("properties.artifacts");
    }
  });

  test("atomic snapshot and screenshot reuse the existing thread session and surface image Artifacts", async () => {
    clearRegistry(); clearInvocations();
    const screenshotArtifact = { id: "shot", kind: "screenshot", title: "Captured", uri: "/tmp/test.png" };
    const mock = {
      ...browser,
      observe: vi.fn(async (arg: { sessionId: string; includeScreenshot?: boolean }) => ({
        ok: true, sessionId: arg.sessionId, invocationId: "inv", page: { url: "https://example.com/", title: "Page", snapshotHash: "valid" },
        observation: { snapshot: 'button "Checkout" ref=e1', truncated: false },
        artifacts: arg.includeScreenshot ? [screenshotArtifact] : [],
      })),
    };
    const tools = createComputerUseBrowserTools(mock as never, { sessionManager: {
      create: vi.fn(async () => ({ id: "bound", status: "ready" as const })),
      get: vi.fn(() => ({ info: { status: "ready" as const } })),
    } as never });
    tools.forEach(registerTool);
    await executeInvocation({ toolId: "browser_observe", threadId: "bound-thread", args: { url: "https://example.com" } });
    const snapshot = await executeInvocation({ toolId: "browser_snapshot", threadId: "bound-thread", args: { maxSnapshotChars: 100 } });
    expect(snapshot.status).toBe("completed");
    expect(mock.observe).toHaveBeenCalledWith({ sessionId: "bound", includeScreenshot: false, maxSnapshotChars: 100 });
    const screenshot = await executeInvocation({ toolId: "browser_screenshot", threadId: "bound-thread", args: { fullPage: true } });
    expect(screenshot.status).toBe("completed");
    expect(mock.observe).toHaveBeenCalledWith({ sessionId: "bound", includeScreenshot: true, includeVisibleText: false });
    expect(screenshot.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "image", uri: "/tmp/test.png", metadata: { browserArtifactId: "shot" },
    })]));
  });

  test("creates a session in the tool runtime and reuses it for the browser context", async () => {
    clearRegistry();
    clearInvocations();
    const sessionManager = {
      create: vi.fn(async () => ({ id: "browser-1", status: "ready" as const })),
      get: vi.fn((id: string) => id === "browser-1" ? { info: { status: "ready" as const } } : undefined),
    };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: sessionManager as never });
    tools.forEach(registerTool);

    const observed = await executeInvocation({
      toolId: "browser_observe",
      args: { url: "https://example.com" },
      threadId: "agent-thread-1",
    });
    const asserted = await executeInvocation({
      toolId: "browser_assert",
      args: { assertion: { kind: "title", expected: "Example" } },
      threadId: "agent-thread-1",
    });

    expect(sessionManager.create).toHaveBeenCalledWith(expect.objectContaining({ allowedDomains: ["example.com"], initialUrl: "https://example.com/", headless: true, sessionTimeoutMs: expect.any(Number) }));
    expect(browser.observe).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "browser-1" }));
    expect(browser.assert).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "browser-1" }));
    expect(observed.args).toMatchObject({ sessionId: "browser-1" });
    expect(asserted.args).toMatchObject({ sessionId: "browser-1" });
    expect(observed.evidence?.facts).toEqual(expect.arrayContaining(["title=Example", "url=https://example.com"]));
    expect(asserted.evidence?.data).toMatchObject({ kind: "computer_use_browser", operation: "assert" });
  });

  test("binds a finite configurable idle timeout to agent-created sessions", async () => {
    clearRegistry();
    clearInvocations();
    const create = vi.fn(async () => ({ id: "browser-timeout", status: "ready" as const }));
    const sessionManager = { create, get: vi.fn(() => ({ info: { status: "ready" as const } })) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: sessionManager as never, sessionIdleTimeoutMs: 1234 });
    tools.forEach(registerTool);

    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "timeout-thread" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sessionTimeoutMs: 1234 }));
  });

  test("uses a finite default idle timeout when no override is provided", async () => {
    clearRegistry();
    clearInvocations();
    const create = vi.fn(async (_config: { sessionTimeoutMs?: number }) => ({ id: "browser-default", status: "ready" as const }));
    const sessionManager = { create, get: vi.fn(() => ({ info: { status: "ready" as const } })) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: sessionManager as never });
    tools.forEach(registerTool);

    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "default-thread" });

    const call = create.mock.calls[0]?.[0];
    expect(call?.sessionTimeoutMs).toBeGreaterThan(0);
    expect(Number.isFinite(call?.sessionTimeoutMs)).toBe(true);
  });

  test("does not reuse a stopped session binding and creates a new session", async () => {
    clearRegistry();
    clearInvocations();
    let nextId = 0;
    const create = vi.fn(async () => ({ id: `browser-${++nextId}`, status: "ready" as const }));
    const get = vi.fn(() => ({ info: { status: "stopped" as const } }));
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: { create, get } as never });
    tools.forEach(registerTool);

    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "stale-thread" });
    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "stale-thread" });

    expect(create).toHaveBeenCalledTimes(2);
  });

  test("keeps sessions for different threads separate", async () => {
    clearRegistry();
    clearInvocations();
    const live = new Map<string, { info: { status: "ready" } }>();
    const create = vi.fn(async () => {
      const id = `browser-${live.size + 1}`;
      live.set(id, { info: { status: "ready" as const } });
      return { id, status: "ready" as const };
    });
    const get = vi.fn((id: string) => live.get(id));
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: { create, get } as never });
    tools.forEach(registerTool);

    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-a" });
    await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-b" });

    expect(create).toHaveBeenCalledTimes(2);
  });

  test("expires an agent-created session after the configured idle timeout", async () => {
    clearRegistry();
    clearInvocations();
    vi.useFakeTimers();
    try {
      const sessionManager = new BrowserSessionManager({
        runtime: { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) },
        launcher: { launch: vi.fn(async () => ({ newContext: vi.fn(async () => ({ newPage: vi.fn(async () => ({ goto: vi.fn(async () => undefined), url: vi.fn(() => "https://example.com/"), title: vi.fn(async () => "Example") })), close: vi.fn(async () => undefined) })), close: vi.fn(async () => undefined) })) } as never,
      });
      const tools = createComputerUseBrowserTools(browser as never, { sessionManager, sessionIdleTimeoutMs: 10 });
      tools.forEach(registerTool);

      const observed = await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "expiry-thread" });
      const sessionId = (observed.args as { sessionId?: string }).sessionId;
      expect(sessionId).toBeTruthy();
      expect(sessionManager.get(sessionId!)).toBeDefined();

      await vi.advanceTimersByTimeAsync(11);
      expect(sessionManager.get(sessionId!)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("approval is invalidated when page or snapshot arguments change", async () => {
    clearRegistry();
    clearInvocations();
    const act = createComputerUseBrowserTools(browser as never).find((tool) => tool.definition.id === "browser_act")!;
    registerTool(act);
    const args = { sessionId: "session-1", pageUrl: "https://example.com", snapshotHash: "hash-1", action: { kind: "click", ref: "e1" } };
    const pending = await executeInvocation({ toolId: "browser_act", args });
    expect(pending.status).toBe("awaiting_approval");
    const changed = await executeInvocation({ toolId: "browser_act", args: { ...args, snapshotHash: "hash-2" }, approvedInvocations: [{ toolId: "browser_act", inputHash: "invalid" }] });
    expect(changed.status).toBe("awaiting_approval");
    expect(browser.act).not.toHaveBeenCalled();
  });

  test("rejects action, assertion and wait variants with missing type-specific fields", async () => {
    clearRegistry();
    clearInvocations();
    const tools = createComputerUseBrowserTools(browser as never);
    registerTool(tools.find((tool) => tool.definition.id === "browser_act")!);
    await expect(executeInvocation({ toolId: "browser_act", args: { sessionId: "s", pageUrl: "https://example.com", snapshotHash: "h", action: { kind: "click" } } })).rejects.toThrow(/schema variant/);
    clearRegistry();
    registerTool(tools.find((tool) => tool.definition.id === "browser_assert")!);
    await expect(executeInvocation({ toolId: "browser_assert", args: { sessionId: "s", assertion: { kind: "title" } } })).rejects.toThrow(/schema variant/);
    clearRegistry();
    registerTool(tools.find((tool) => tool.definition.id === "browser_wait_for")!);
    await expect(executeInvocation({ toolId: "browser_wait_for", args: { condition: { kind: "visible", ref: "e1" } } })).rejects.toThrow(/schema variant/);
  });

  test("browser_navigate bootstraps a session on first use, then reuses it", async () => {
    clearRegistry();
    clearInvocations();
    browser.navigate.mockClear();
    const create = vi.fn(async () => ({ id: "nav-session", status: "ready" as const }));
    const manager = { create, get: vi.fn((id: string) => id === "nav-session" ? { info: { status: "ready" as const } } : undefined) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager as never });
    tools.forEach(registerTool);

    const firstArgs = { url: "example.com" };
    const firstPending = await executeInvocation({ toolId: "browser_navigate", threadId: "nav-thread", args: firstArgs });
    expect(firstPending.status).toBe("awaiting_approval");
    expect(create).not.toHaveBeenCalled();
    const first = await executeInvocation({ toolId: "browser_navigate", threadId: "nav-thread", args: firstArgs, approvedInvocations: [{ toolId: "browser_navigate", inputHash: firstPending.inputHash! }] });
    expect(first.status).toBe("completed");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ allowedDomains: ["example.com"], headless: true, sessionTimeoutMs: expect.any(Number) }));
    expect(browser.navigate).toHaveBeenCalledWith({ sessionId: "nav-session", url: "https://example.com/" });

    const secondArgs = { url: "https://example.com/next" };
    const secondPending = await executeInvocation({ toolId: "browser_navigate", threadId: "nav-thread", args: secondArgs });
    await executeInvocation({ toolId: "browser_navigate", threadId: "nav-thread", args: secondArgs, approvedInvocations: [{ toolId: "browser_navigate", inputHash: secondPending.inputHash! }] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(browser.navigate).toHaveBeenLastCalledWith({ sessionId: "nav-session", url: "https://example.com/next" });
  });

  test("browser_navigate preserves explicit URI schemes but still supports host:port shorthand", async () => {
    clearRegistry();
    clearInvocations();
    const navigate = vi.fn(async (input: { sessionId: string; url: string }) => ({
      ok: true, sessionId: input.sessionId, invocationId: "navigate",
      page: { url: input.url, title: "" }, artifacts: [],
    }));
    const create = vi.fn(async () => ({ id: "uri-session", status: "ready" as const }));
    const manager = { create, get: vi.fn(() => ({ info: { status: "ready" as const } })) };
    createComputerUseBrowserTools({ ...browser, navigate } as never, { sessionManager: manager as never }).forEach(registerTool);

    const scenarios = [
      ["mailto:alice@example.com", "mailto:alice@example.com"],
      ["tel:1234567", "tel:1234567"],
      ["file:/tmp/report.txt", "file:///tmp/report.txt"],
      ["localhost:3000", "https://localhost:3000/"],
    ];
    for (const [index, [input, expected]] of scenarios.entries()) {
      const args = { url: input };
      const threadId = "uri-" + index;
      const pending = await executeInvocation({ toolId: "browser_navigate", threadId, args });
      expect(pending.status).toBe("awaiting_approval");
      await executeInvocation({
        toolId: "browser_navigate", threadId, args,
        approvedInvocations: [{ toolId: "browser_navigate", inputHash: pending.inputHash! }],
      });
      expect(navigate).toHaveBeenLastCalledWith({ sessionId: "uri-session", url: expected });
    }
  });

  test("browser_navigate surfaces a blocked navigation result without rewriting the URL", async () => {
    clearRegistry();
    clearInvocations();
    const navigate = vi.fn(async (input: { sessionId: string; url: string }) => ({ ok: false, sessionId: input.sessionId, invocationId: "nav", page: { url: "", title: "" }, artifacts: [], error: { code: "navigation_blocked", message: "Navigation domain is not allowed: evil.com", retryable: true } }));
    const blocked = { ...browser, navigate };
    const manager = { create: vi.fn(async () => ({ id: "blocked-session", status: "ready" as const })), get: vi.fn(() => ({ info: { status: "ready" as const } })) };
    const tools = createComputerUseBrowserTools(blocked as never, { sessionManager: manager as never });
    tools.forEach(registerTool);

    const args = { url: "https://evil.com/steal" };
    const pending = await executeInvocation({ toolId: "browser_navigate", threadId: "blocked-thread", args });
    const result = await executeInvocation({ toolId: "browser_navigate", threadId: "blocked-thread", args, approvedInvocations: [{ toolId: "browser_navigate", inputHash: pending.inputHash! }] });
    expect(result.status).toBe("completed");
    expect(result.result).toMatchObject({ ok: false, error: { code: "navigation_blocked" } });
    expect(navigate).toHaveBeenCalledWith({ sessionId: "blocked-session", url: "https://evil.com/steal" });
  });

  test("browser_wait_for rejects a missing session and forwards approved conditions", async () => {
    clearRegistry();
    clearInvocations();
    browser.wait.mockClear();
    const create = vi.fn(async () => ({ id: "wait-session", status: "ready" as const }));
    const manager = { create, get: vi.fn((id: string) => id === "wait-session" ? { info: { status: "ready" as const } } : undefined) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager as never });
    tools.forEach(registerTool);

    const unboundArgs = { condition: { kind: "text", value: "Ready" } };
    const unboundPending = await executeInvocation({ toolId: "browser_wait_for", threadId: "wait-unbound", args: unboundArgs });
    expect(unboundPending.status).toBe("awaiting_approval");
    const unbound = await executeInvocation({ toolId: "browser_wait_for", threadId: "wait-unbound", args: unboundArgs, approvedInvocations: [{ toolId: "browser_wait_for", inputHash: unboundPending.inputHash! }] });
    expect(unbound.result).toMatchObject({ ok: false, error: { code: "session_unavailable" } });
    expect(browser.wait).not.toHaveBeenCalled();

    await executeInvocation({ toolId: "browser_observe", threadId: "wait-bound", args: { url: "https://example.com" } });
    const boundArgs = { condition: { kind: "visible", ref: "e1", pageUrl: "https://example.com/", snapshotHash: "hash-1" }, timeoutMs: 500 };
    const boundPending = await executeInvocation({ toolId: "browser_wait_for", threadId: "wait-bound", args: boundArgs });
    expect(boundPending.status).toBe("awaiting_approval");
    const bound = await executeInvocation({ toolId: "browser_wait_for", threadId: "wait-bound", args: boundArgs, approvedInvocations: [{ toolId: "browser_wait_for", inputHash: boundPending.inputHash! }] });
    expect(bound.status).toBe("completed");
    expect(browser.wait).toHaveBeenCalledWith({ sessionId: "wait-session", condition: { kind: "visible", ref: "e1", pageUrl: "https://example.com/", snapshotHash: "hash-1" }, timeoutMs: 500 });
  });
});
