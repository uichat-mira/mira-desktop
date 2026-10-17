import { describe, expect, test, vi } from "vitest";
import { createComputerUseBrowserTools } from "./browser-tools.tool.js";
import { clearInvocations, executeInvocation } from "../core/invocations.js";
import { clearRegistry, registerTool } from "../core/registry.js";
import { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

const readyRuntime = { resolveRuntime: () => ({ status: "ready" as const, strategy: "managed" as const, runtime: { source: "managed" as const, channel: "chromium" as const, executablePath: "C:/chrome.exe", version: "1", installedAt: "now" }, inspectedCandidates: [] }) };

const createLauncher = (browserClose: () => Promise<void> = async () => undefined) => ({
  launch: vi.fn(async () => ({
    newContext: vi.fn(async () => ({
      newPage: vi.fn(async () => ({ goto: vi.fn(async () => undefined), url: vi.fn(() => "https://example.com"), close: vi.fn(async () => undefined) })),
      close: vi.fn(async () => undefined),
    })),
    close: vi.fn(browserClose),
  })),
});

const browser = {
  observe: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-observe", page: { url: "https://example.com", title: "Example", snapshotHash: "hash-1" }, artifacts: [] })),
  act: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-act", page: { url: input.pageUrl, title: "Example", snapshotHash: input.snapshotHash }, artifacts: [] })),
  assert: vi.fn(async (input) => ({ ok: true, sessionId: input.sessionId, invocationId: "browser-assert", page: { url: "https://example.com", title: "Example" }, assertion: { kind: input.assertion.kind, passed: true }, artifacts: [] })),
};

describe("Computer Use browser MCP tools", () => {
  test("exposes exactly the three strict browser tools", () => {
    const tools = createComputerUseBrowserTools(browser as never);
    expect(tools.map((tool) => tool.definition.id)).toEqual(["browser_observe", "browser_act", "browser_assert"]);
    expect(tools.every((tool) => tool.definition.inputSchema.additionalProperties === false)).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.capabilities.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.description).toContain("page.title");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("navigate(url)");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.description).toContain("scroll(x,y)");
    expect(tools.find((tool) => tool.definition.id === "browser_assert")?.definition.description).toContain("value(ref,expected)");
    expect(tools.find((tool) => tool.definition.id === "browser_observe")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
    expect(tools.find((tool) => tool.definition.id === "browser_act")?.definition.inputSchemaByExposure?.agent_intent).not.toHaveProperty("properties.sessionId");
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

    expect(sessionManager.create).toHaveBeenCalledWith({ allowedDomains: ["example.com"], initialUrl: "https://example.com/", headless: true, sessionTimeoutMs: 300_000 });
    expect(browser.observe).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "browser-1" }));
    expect(browser.assert).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "browser-1" }));
    expect(observed.args).toMatchObject({ sessionId: "browser-1" });
    expect(asserted.args).toMatchObject({ sessionId: "browser-1" });
    expect(observed.evidence?.facts).toEqual(expect.arrayContaining(["title=Example", "url=https://example.com"]));
    expect(asserted.evidence?.data).toMatchObject({ kind: "computer_use_browser", operation: "assert" });
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

  test("binds agent-created sessions to a finite idle timeout, reuses live sessions and drops expired bindings", async () => {
    vi.useFakeTimers();
    try {
      clearRegistry();
      clearInvocations();
      const browserClose = vi.fn(async () => undefined);
      const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: createLauncher(browserClose) });
      const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager, sessionIdleTimeoutMs: 10 });
      tools.forEach(registerTool);

      const first = await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-a" });
      const firstSessionId = (first.args as { sessionId: string }).sessionId;
      expect(manager.get(firstSessionId)?.info.config.sessionTimeoutMs).toBe(10);

      const reuse = await executeInvocation({ toolId: "browser_observe", args: {}, threadId: "thread-a" });
      expect((reuse.args as { sessionId: string }).sessionId).toBe(firstSessionId);
      expect(manager.get(firstSessionId)).toBeDefined();

      await vi.advanceTimersByTimeAsync(11);
      expect(manager.get(firstSessionId)).toBeUndefined();
      expect(browserClose).toHaveBeenCalledOnce();

      const recreated = await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-a" });
      expect((recreated.args as { sessionId: string }).sessionId).not.toBe(firstSessionId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps sessions from different threads separate so ending one does not close another", async () => {
    clearRegistry();
    clearInvocations();
    const manager = new BrowserSessionManager({ runtime: readyRuntime, launcher: createLauncher() });
    const tools = createComputerUseBrowserTools(browser as never, { sessionManager: manager, sessionIdleTimeoutMs: 60_000 });
    tools.forEach(registerTool);

    const first = await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-a" });
    const second = await executeInvocation({ toolId: "browser_observe", args: { url: "https://example.com" }, threadId: "thread-b" });
    const firstSessionId = (first.args as { sessionId: string }).sessionId;
    const secondSessionId = (second.args as { sessionId: string }).sessionId;
    expect(firstSessionId).not.toBe(secondSessionId);

    await manager.stop(firstSessionId);
    expect(manager.get(firstSessionId)).toBeUndefined();
    expect(manager.get(secondSessionId)?.info.status).toBe("ready");
    await manager.closeAll();
  });
});
