import { describe, expect, test, vi } from "vitest";
import { createComputerUseBrowserTools } from "./browser-tools.tool.js";
import { clearInvocations, executeInvocation } from "../core/invocations.js";
import { clearRegistry, registerTool } from "../core/registry.js";
import { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

const browser = {
  observe: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-observe", page: { url: "https://example.com", title: "Example", snapshotHash: "hash-1" }, artifacts: [] })),
  act: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-act", page: { url: input.pageUrl, title: "Example", snapshotHash: input.snapshotHash }, artifacts: [] })),
  assert: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-assert", page: { url: "https://example.com", title: "Example" }, assertion: { kind: input.assertion.kind, passed: true }, artifacts: [] })),
};

describe("Computer Use browser MCP tools", () => {
  test("exposes legacy tools and the two atomic observation tools", () => {
    const tools = createComputerUseBrowserTools(browser as never);
    expect(tools.map((tool) => tool.definition.id)).toEqual(["browser_observe", "browser_act", "browser_assert", "browser_snapshot", "browser_screenshot"]);
    expect(tools.every((tool) => tool.definition.inputSchema.additionalProperties === false)).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.capabilities.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.description).toContain("page.title");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("navigate(url)");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("scroll(x,y)");
    expect(tools.find((tool) => tool.definition.id === "browser_assert")?.definition.description).toContain("value(ref,expected)");
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
  });

  test("snapshot and screenshot require a live bound session and reject unsupported screenshot mode", async () => {
    clearRegistry(); clearInvocations();
    const get = vi.fn((_id: string) => ({ info: { status: "ready" as const } }));
    const manager = { get, create: vi.fn(async () => ({ id: "browser-test", status: "ready" as const })) };
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager as never });
    tools.forEach(registerTool);
    const absent = await executeInvocation({ toolId: "browser_snapshot", threadId: "thread-no-session", args: {} });
    expect(absent.status).toBe("failed");
    expect(absent.error?.message).toMatch(/Navigate first/);
    const invalidMode = await executeInvocation({ toolId: "browser_screenshot", threadId: "thread-no-session", args: { fullPage: false } });
    expect(invalidMode.status).toBe("failed");
    expect(invalidMode.error?.message).toMatch(/not supported/);
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

  test("rejects action and assertion variants with missing type-specific fields", async () => {
    clearRegistry();
    clearInvocations();
    const tools = createComputerUseBrowserTools(browser as never);
    registerTool(tools.find((tool) => tool.definition.id === "browser_act")!);
    await expect(executeInvocation({ toolId: "browser_act", args: { sessionId: "s", pageUrl: "https://example.com", snapshotHash: "h", action: { kind: "click" } } })).rejects.toThrow(/schema variant/);
    clearRegistry();
    registerTool(tools.find((tool) => tool.definition.id === "browser_assert")!);
    await expect(executeInvocation({ toolId: "browser_assert", args: { sessionId: "s", assertion: { kind: "title" } } })).rejects.toThrow(/schema variant/);
  });
});
