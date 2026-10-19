import type {
  ToolInvocationContext,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";
import type {
  BrowserAssertInput,
  BrowserToolResult,
  BrowserWaitInput,
} from "@/microapps/computer-use/browser/types.js";
import type { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

// Agent-created sessions must not live indefinitely; callers can override this finite idle bound.
const AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

const browserScrollPointSchema = {
  type: "object",
  required: ["x", "y"],
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
} as const;

const browserResultSchema = {
  type: "object",
  required: ["ok", "sessionId", "invocationId", "page", "artifacts"],
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" },
    sessionId: { type: "string" },
    invocationId: { type: "string" },
    page: { type: "object", required: ["url", "title"], additionalProperties: false, properties: { url: { type: "string" }, title: { type: "string" }, snapshotHash: { type: "string" } } },
    observation: { type: "object", additionalProperties: false, properties: { snapshot: { type: "string" }, visibleText: { type: "string" }, truncated: { type: "boolean" } } },
    assertion: { type: "object", required: ["kind", "passed"], additionalProperties: false, properties: { kind: { type: "string", enum: ["title", "url", "text", "visible", "value"] }, passed: { type: "boolean" } } },
    scroll: { type: "object", required: ["requested", "before", "after", "moved"], additionalProperties: false, properties: { requested: browserScrollPointSchema, before: browserScrollPointSchema, after: browserScrollPointSchema, moved: { type: "boolean" } } },
    artifacts: { type: "array", items: { type: "object", required: ["id", "kind", "title", "uri"], additionalProperties: false, properties: { id: { type: "string" }, kind: { type: "string", enum: ["screenshot", "json"] }, title: { type: "string" }, uri: { type: "string" } } } },
    error: { type: "object", required: ["code", "message", "retryable"], additionalProperties: false, properties: { code: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" } } },
  },
} as const;

const sessionId = { type: "string", minLength: 1 } as const;

const conditionSchema = {
  oneOf: [
    { type: "object", required: ["kind", "value"], additionalProperties: false, properties: { kind: { enum: ["text"] }, value: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "value"], additionalProperties: false, properties: { kind: { enum: ["url"] }, value: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "ref", "pageUrl", "snapshotHash"], additionalProperties: false, properties: { kind: { enum: ["visible"] }, ref: { type: "string", minLength: 1 }, pageUrl: { type: "string", minLength: 1 }, snapshotHash: { type: "string", minLength: 1 } } },
  ],
} as const;

const assertionSchema = {
  oneOf: [
    { type: "object", required: ["kind", "expected"], additionalProperties: false, properties: { kind: { enum: ["title", "url", "text"] }, expected: { type: "string" } } },
    { type: "object", required: ["kind", "ref"], additionalProperties: false, properties: { kind: { enum: ["visible"] }, ref: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "ref", "expected"], additionalProperties: false, properties: { kind: { enum: ["value"] }, ref: { type: "string", minLength: 1 }, expected: { type: "string" } } },
  ],
} as const;

const agentAssertSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assertion"],
  properties: { assertion: { ...assertionSchema } },
} as const;
const agentNavigateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: { url: { type: "string", minLength: 1 } },
} as const;
const agentWaitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["condition"],
  properties: { condition: { ...conditionSchema }, timeoutMs: { type: "integer", minimum: 1 } },
} as const;
const agentClickSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash", "ref"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    ref: { type: "string", minLength: 1 },
  },
} as const;
const agentFillSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash", "ref", "value"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    ref: { type: "string", minLength: 1 },
    value: { type: "string" },
  },
} as const;
const agentPressKeySchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash", "ref", "key"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    ref: { type: "string", minLength: 1 },
    key: { type: "string", minLength: 1 },
  },
} as const;
const agentSelectOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash", "ref", "value"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    ref: { type: "string", minLength: 1 },
    value: { type: "string" },
  },
} as const;
const agentScrollSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    x: { type: "number" },
    y: { type: "number" },
  },
} as const;

const emitBrowserArtifacts = (
  context: ToolInvocationContext,
  result: BrowserToolResult,
) => {
  for (const artifact of result.artifacts) {
    context.addArtifact({
      kind: artifact.kind === "screenshot" ? "image" : "text",
      title: artifact.title,
      uri: artifact.uri,
      metadata: { browserArtifactId: artifact.id },
    });
  }
};

const requireObject = <T extends object>(value: unknown, name: string): T => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mcpBadRequest(`${name} must be an object`);
  }
  return value as T;
};

export const createComputerUseBrowserTools = (
  browser: BrowserService,
  options: { sessionManager?: BrowserSessionManager; sessionIdleTimeoutMs?: number } = {},
): ToolImplementation[] => {
  const sessionsByContext = new Map<string, string>();
  const sessionManager = options.sessionManager;
  const requestedIdleTimeoutMs = options.sessionIdleTimeoutMs;
  const sessionIdleTimeoutMs = typeof requestedIdleTimeoutMs === "number" && Number.isFinite(requestedIdleTimeoutMs) && requestedIdleTimeoutMs > 0
    ? requestedIdleTimeoutMs
    : AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS;

  // These facades only operate on an existing thread-bound Managed Browser session.
  // Browser navigation/session creation is owned by browser_navigate (#360).
  const requireBoundSession = (context: ToolInvocationContext): string | undefined => {
    const key = context.threadId;
    const id = key ? sessionsByContext.get(key) : undefined;
    const session = id ? sessionManager?.get(id) : undefined;
    // Busy is still an owned, live session. Do not discard its binding: the
    // BrowserService will reject concurrent observations without creating one.
    if (session?.info.status === "ready" || session?.info.status === "busy") return id;
    if (key) sessionsByContext.delete(key);
    return undefined;
  };
  const unavailable = (context: ToolInvocationContext): BrowserToolResult => ({
    ok: false, sessionId: "", invocationId: context.invocationId,
    page: { url: "", title: "" }, artifacts: [],
    error: { code: "session_unavailable", message: "No active Managed Browser session for this thread. Navigate first.", retryable: true },
  });

  const snapshot: ToolImplementation = {
    definition: {
      id: "browser_snapshot", title: "Browser Snapshot",
      description: "Read a bounded Playwright AI aria snapshot of the existing Managed Browser page. Returns roles, names, ephemeral refs from the latest AI snapshot, page URL, title and snapshot hash. Navigate first; this tool never starts a browser.",
      domain: "browser_action", source: "internal", mode: "sync",
      inputSchema: {
        type: "object", additionalProperties: false, required: [],
        properties: {
          includeVisibleText: { type: "boolean" },
          maxSnapshotChars: { type: "integer", minimum: 100, maximum: 50000 },
        },
      },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "snapshot", "aria", "read", "inspect", "page", "快照", "读取", "页面"],
      capabilities: { sideEffect: "none", requiresApproval: false, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ includeVisibleText?: boolean; maxSnapshotChars?: number }>(context.args, "args");
      const bound = requireBoundSession(context);
      const result = bound
        ? await browser.observe({ ...args, sessionId: bound, includeScreenshot: false })
        : unavailable(context);
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const screenshot: ToolImplementation = {
    definition: {
      id: "browser_screenshot", title: "Browser Screenshot",
      description: "Capture a full-page screenshot Artifact from the existing Managed Browser session. Navigate first. Only fullPage=true is currently supported.",
      domain: "browser_action", source: "internal", mode: "sync",
      inputSchema: {
        type: "object", additionalProperties: false, required: [],
        properties: { fullPage: { type: "boolean" } },
      },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "screenshot", "capture", "image", "截图"],
      capabilities: { sideEffect: "none", requiresApproval: false, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ fullPage?: boolean }>(context.args, "args");
      if (args.fullPage === false) throw mcpBadRequest("Viewport-only screenshots are not supported; use fullPage=true.");
      const bound = requireBoundSession(context);
      const result = bound
        ? await browser.observe({ sessionId: bound, includeScreenshot: true, includeVisibleText: false })
        : unavailable(context);
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const assert: ToolImplementation = {
    definition: {
      id: "browser_assert",
      title: "Browser Assert",
      description: "Verify the managed browser state after an observation or action. Supported assertions are title(expected), url(expected), text(expected), visible(ref), and value(ref,expected). Use the latest observation and refs. The tool manages sessionId internally and returns assertion.passed plus the current page state; a failed assertion is an explicit failure, not a successful answer.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["assertion"],
        properties: {
          sessionId,
          assertion: {
            ...assertionSchema,
          },
        },
      },
      inputSchemaByExposure: { agent_intent: agentAssertSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "assert", "verify", "title", "url", "text", "visible", "value", "断言", "验证"],
      capabilities: { sideEffect: "none", requiresApproval: false, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<BrowserAssertInput>(context.args, "args");
      const bound = requireBoundSession(context);
      const result = bound
        ? await browser.assert({ ...args, sessionId: bound })
        : unavailable(context);
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const navigate: ToolImplementation = {
    definition: {
      id: "browser_navigate",
      title: "Browser Navigate",
      description: "Navigate the Managed Browser to an explicit URL, or bootstrap the first Managed Browser session for this thread when none is bound. Enforces the session's configured scheme and domain restrictions: a disallowed URL is rejected, never silently allowed or rewritten. Returns the resulting page observation so the agent can observe the destination before acting. Requires approval.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          sessionId,
          url: { type: "string", minLength: 1 },
        },
      },
      inputSchemaByExposure: { agent_intent: agentNavigateSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "navigate", "open", "visit", "url", "goto", "打开", "访问", "导航"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ url?: string }>(context.args, "args");
      const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
      if (!rawUrl) throw mcpBadRequest("url is required");
      let url: string;
      try {
        // A URI scheme does not have to contain "://": preserve mailto:, tel:,
        // file:/ and other absolute schemes for SessionManager policy checks.
        // Keep the existing hostname:port convenience for localhost and DNS.
        const explicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
        const hostnameWithPort = /^(?:localhost|(?:[a-z0-9-]+\.)+[a-z0-9-]+):\d+(?:[/?#]|$)/i.test(rawUrl);
        url = new URL(explicitScheme && !hostnameWithPort ? rawUrl : `https://${rawUrl}`).toString();
      } catch {
        throw mcpBadRequest(`url is not a valid absolute URL: ${rawUrl}`);
      }
      const bound = requireBoundSession(context);
      let sessionId: string;
      let bootstrappedSessionId: string | undefined;
      if (bound) {
        sessionId = bound;
      } else {
        if (!sessionManager) throw mcpBadRequest("Computer Use browser session is not bound; a target URL is required.");
        const parsed = new URL(url);
        const created = await sessionManager.create({ allowedDomains: [parsed.hostname], headless: true, sessionTimeoutMs: sessionIdleTimeoutMs });
        if (created.status !== "ready") {
          const result: BrowserToolResult = {
            ok: false, sessionId: "", invocationId: context.invocationId,
            page: { url: "", title: "" }, artifacts: [],
            error: { code: created.error?.code ?? "session_unavailable", message: created.error?.message ?? "Computer Use browser session could not be created.", retryable: true },
          };
          return { structuredContent: result, isError: true };
        }
        if (context.threadId) sessionsByContext.set(context.threadId, created.id);
        sessionId = created.id;
        bootstrappedSessionId = created.id;
      }
      const cleanupFailedBootstrap = async () => {
        if (!bootstrappedSessionId || !sessionManager) return;
        if (context.threadId && sessionsByContext.get(context.threadId) === bootstrappedSessionId) {
          sessionsByContext.delete(context.threadId);
        }
        await sessionManager.stop(bootstrappedSessionId);
      };
      (context.args as Record<string, unknown>).sessionId = sessionId;
      try {
        const result = await browser.navigate({ sessionId, url });
        if (!result.ok) await cleanupFailedBootstrap();
        emitBrowserArtifacts(context, result);
        return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
      } catch (cause) {
        await cleanupFailedBootstrap();
        throw cause;
      }
    },
  };

  const wait: ToolImplementation = {
    definition: {
      id: "browser_wait_for",
      title: "Browser Wait For",
      description: "Wait, up to a bounded timeout, for a future page condition. condition.kind=text waits for visible text; kind=url waits for the page URL to match; kind=visible validates pageUrl and snapshotHash from the accepted observation, then follows Playwright getByRef() for that AI-snapshot ref without rebinding to a replacement node. Waiting on UI that was never observed should use text/url conditions followed by a fresh snapshot. A timeout is a failure (wait_timeout), never a false success. Requires approval.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["condition"],
        properties: {
          sessionId,
          condition: { ...conditionSchema },
          timeoutMs: { type: "integer", minimum: 1 },
        },
      },
      inputSchemaByExposure: { agent_intent: agentWaitSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "wait", "condition", "timeout", "等待"],
      capabilities: { sideEffect: "none", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<BrowserWaitInput & { sessionId?: string }>(context.args, "args");
      const bound = requireBoundSession(context);
      const result = bound
        ? await browser.wait({ sessionId: bound, condition: args.condition, timeoutMs: args.timeoutMs })
        : unavailable(context);
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const click: ToolImplementation = {
    definition: {
      id: "browser_click",
      title: "Browser Click",
      description: "Click exactly the element identified by ref from the latest accepted observation (pageUrl + snapshotHash). Element identity is resolved by Playwright getByRef() against the latest AI snapshot, so a stale, missing or replaced ref is rejected before any click. Do not guess selectors or coordinates. Navigate first; the tool manages sessionId internally, requires approval, and returns the resulting page state.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash", "ref"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          ref: { type: "string", minLength: 1 },
        },
      },
      inputSchemaByExposure: { agent_intent: agentClickSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "click", "button", "link", "tap", "点击"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ pageUrl?: string; snapshotHash?: string; ref?: string }>(context.args, "args");
      const bound = requireBoundSession(context);
      let result: BrowserToolResult;
      if (!bound) {
        result = unavailable(context);
      } else {
        if (typeof args.pageUrl !== "string" || typeof args.snapshotHash !== "string" || typeof args.ref !== "string") {
          throw mcpBadRequest("pageUrl, snapshotHash and ref are required");
        }
        result = await browser.act({
          sessionId: bound,
          pageUrl: args.pageUrl,
          snapshotHash: args.snapshotHash,
          action: { kind: "click", ref: args.ref },
        });
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const fill: ToolImplementation = {
    definition: {
      id: "browser_fill",
      title: "Browser Fill",
      description: "Set an input/textarea element identified by ref from the latest accepted observation (pageUrl + snapshotHash) to an exact value. This replaces the previous value in one action (unlike character-by-character typing) and never re-targets a different element: the ref is resolved by Playwright getByRef() against the latest AI snapshot, so a stale, missing or replaced ref is rejected before writing. A non-fillable target fails explicitly. Navigate and observe first; the tool manages sessionId internally and requires approval.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash", "ref", "value"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          ref: { type: "string", minLength: 1 },
          value: { type: "string" },
        },
      },
      inputSchemaByExposure: { agent_intent: agentFillSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "fill", "input", "type", "value", "填写", "输入"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ pageUrl?: string; snapshotHash?: string; ref?: string; value?: string }>(context.args, "args");
      const bound = requireBoundSession(context);
      let result: BrowserToolResult;
      if (!bound) {
        result = unavailable(context);
      } else {
        if (typeof args.pageUrl !== "string" || typeof args.snapshotHash !== "string" || typeof args.ref !== "string" || typeof args.value !== "string") {
          throw mcpBadRequest("pageUrl, snapshotHash, ref and value are required");
        }
        result = await browser.act({
          sessionId: bound,
          pageUrl: args.pageUrl,
          snapshotHash: args.snapshotHash,
          action: { kind: "fill", ref: args.ref, value: args.value },
        });
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const pressKey: ToolImplementation = {
    definition: {
      id: "browser_press_key",
      title: "Browser Press Key",
      description: "Send one keyboard key or key combination (Playwright key notation, for example Enter, Escape, Tab or Control+A) to the observed control identified by ref from the latest accepted observation (pageUrl + snapshotHash). This is a discrete key action, not text entry: use browser_fill to set a field value. The ref is resolved by Playwright getByRef() against the latest AI snapshot, so a stale, missing or replaced ref is rejected before any key is sent. Navigate and observe first; the tool manages sessionId internally and requires approval because a key such as Enter may submit a form.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash", "ref", "key"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          ref: { type: "string", minLength: 1 },
          key: { type: "string", minLength: 1 },
        },
      },
      inputSchemaByExposure: { agent_intent: agentPressKeySchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "press", "key", "keyboard", "enter", "按键"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ pageUrl?: string; snapshotHash?: string; ref?: string; key?: string }>(context.args, "args");
      const bound = requireBoundSession(context);
      let result: BrowserToolResult;
      if (!bound) {
        result = unavailable(context);
      } else {
        if (typeof args.pageUrl !== "string" || typeof args.snapshotHash !== "string" || typeof args.ref !== "string" || typeof args.key !== "string") {
          throw mcpBadRequest("pageUrl, snapshotHash, ref and key are required");
        }
        result = await browser.act({
          sessionId: bound,
          pageUrl: args.pageUrl,
          snapshotHash: args.snapshotHash,
          action: { kind: "press", ref: args.ref, key: args.key },
        });
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const selectOption: ToolImplementation = {
    definition: {
      id: "browser_select_option",
      title: "Browser Select Option",
      description: "Select an option in a native HTML <select> control identified by ref from the latest accepted observation (pageUrl + snapshotHash). This is real option selection, not fill or typing simulation. The ref is resolved by Playwright getByRef() against the latest AI snapshot, so a stale, missing or replaced ref is rejected before selecting, and a target that is not a <select> or an option that does not exist fails explicitly. Navigate and observe first; the tool manages sessionId internally and requires approval.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash", "ref", "value"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          ref: { type: "string", minLength: 1 },
          value: { type: "string" },
        },
      },
      inputSchemaByExposure: { agent_intent: agentSelectOptionSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "select", "option", "dropdown", "选择"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ pageUrl?: string; snapshotHash?: string; ref?: string; value?: string }>(context.args, "args");
      const bound = requireBoundSession(context);
      let result: BrowserToolResult;
      if (!bound) {
        result = unavailable(context);
      } else {
        if (typeof args.pageUrl !== "string" || typeof args.snapshotHash !== "string" || typeof args.ref !== "string" || typeof args.value !== "string") {
          throw mcpBadRequest("pageUrl, snapshotHash, ref and value are required");
        }
        result = await browser.act({
          sessionId: bound,
          pageUrl: args.pageUrl,
          snapshotHash: args.snapshotHash,
          action: { kind: "select", ref: args.ref, value: args.value },
        });
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const scroll: ToolImplementation = {
    definition: {
      id: "browser_scroll",
      title: "Browser Scroll",
      description: "Move the current Managed Browser viewport by a bounded offset using pageUrl and snapshotHash from the latest accepted observation. Provide at least one non-zero finite offset as x and/or y in CSS pixels; this scrolls the page, it does not navigate or wait. A stale observation is rejected instead of scrolling a changed page, and the result reports the truthful resulting page state. Requires approval because scrolling may trigger lazy loading.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          x: { type: "number" },
          y: { type: "number" },
        },
      },
      inputSchemaByExposure: { agent_intent: agentScrollSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "scroll", "viewport", "滚动"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<{ pageUrl?: string; snapshotHash?: string; x?: number; y?: number }>(context.args, "args");
      const bound = requireBoundSession(context);
      let result: BrowserToolResult;
      if (!bound) {
        result = unavailable(context);
      } else {
        if (typeof args.pageUrl !== "string" || typeof args.snapshotHash !== "string") {
          throw mcpBadRequest("pageUrl and snapshotHash are required");
        }
        const x = typeof args.x === "number" ? args.x : 0;
        const y = typeof args.y === "number" ? args.y : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
          throw mcpBadRequest("browser_scroll requires at least one non-zero finite x or y offset");
        }
        result = await browser.act({
          sessionId: bound,
          pageUrl: args.pageUrl,
          snapshotHash: args.snapshotHash,
          action: { kind: "scroll", x, y },
        });
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  return [assert, navigate, wait, snapshot, screenshot, click, fill, pressKey, selectOption, scroll];
};
