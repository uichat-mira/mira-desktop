import type {
  ToolInvocationContext,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";
import type {
  BrowserActInput,
  BrowserAssertInput,
  BrowserInspectInput,
  BrowserToolResult,
  BrowserWaitInput,
} from "@/microapps/computer-use/browser/types.js";
import type { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

// Agent-created sessions must not live indefinitely; callers can override this finite idle bound.
const AGENT_BROWSER_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

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
    artifacts: { type: "array", items: { type: "object", required: ["id", "kind", "title", "uri"], additionalProperties: false, properties: { id: { type: "string" }, kind: { type: "string", enum: ["screenshot", "json"] }, title: { type: "string" }, uri: { type: "string" } } } },
    error: { type: "object", required: ["code", "message", "retryable"], additionalProperties: false, properties: { code: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" } } },
  },
} as const;

const sessionId = { type: "string", minLength: 1 } as const;
const actionSchema = {
  oneOf: [
    { type: "object", required: ["kind", "url"], additionalProperties: false, properties: { kind: { enum: ["navigate"] }, url: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "ref"], additionalProperties: false, properties: { kind: { enum: ["click"] }, ref: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "ref", "text"], additionalProperties: false, properties: { kind: { enum: ["type"] }, ref: { type: "string", minLength: 1 }, text: { type: "string" } } },
    { type: "object", required: ["kind", "ref", "value"], additionalProperties: false, properties: { kind: { enum: ["select"] }, ref: { type: "string", minLength: 1 }, value: { type: "string" } } },
    { type: "object", required: ["kind", "ref", "key"], additionalProperties: false, properties: { kind: { enum: ["press"] }, ref: { type: "string", minLength: 1 }, key: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { enum: ["scroll"] }, x: { type: "number" }, y: { type: "number" } } },
    { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { enum: ["wait"] }, ref: { type: "string", minLength: 1 }, text: { type: "string" }, timeoutMs: { type: "integer", minimum: 1 } } },
  ],
} as const;

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

const agentObserveSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: { type: "string", minLength: 1 },
    includeScreenshot: { type: "boolean" },
    includeVisibleText: { type: "boolean" },
    maxSnapshotChars: { type: "integer", minimum: 100, maximum: 50000 },
  },
} as const;
const agentActSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pageUrl", "snapshotHash", "action"],
  properties: {
    pageUrl: { type: "string", minLength: 1 },
    snapshotHash: { type: "string", minLength: 1 },
    action: { ...actionSchema },
  },
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
  const resolveSessionId = async (context: ToolInvocationContext, args: Record<string, unknown>) => {
    const explicitSessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;
    if (explicitSessionId) {
      if (context.threadId) sessionsByContext.set(context.threadId, explicitSessionId);
      return explicitSessionId;
    }

    const contextKey = context.threadId;
    const existingSessionId = contextKey ? sessionsByContext.get(contextKey) : undefined;
    if (existingSessionId) {
      const existing = sessionManager?.get(existingSessionId);
      if (existing?.info.status === "ready" || existing?.info.status === "busy") return existingSessionId;
      if (contextKey) sessionsByContext.delete(contextKey);
    }

    const url = typeof args.url === "string"
      ? args.url
      : typeof (args.action as Record<string, unknown> | undefined)?.url === "string"
        ? String((args.action as Record<string, unknown>).url)
        : undefined;
    if (!sessionManager || !url) {
      throw mcpBadRequest("Computer Use browser session is not bound; a target URL is required for the first browser observation.");
    }
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const created = await sessionManager.create({
      allowedDomains: [parsed.hostname],
      initialUrl: parsed.toString(),
      headless: true,
      sessionTimeoutMs: sessionIdleTimeoutMs,
    });
    if (created.status !== "ready") {
      throw mcpBadRequest(created.error?.message ?? "Computer Use browser session could not be created.");
    }
    if (contextKey) sessionsByContext.set(contextKey, created.id);
    return created.id;
  };

  // These facades only operate on an existing thread-bound Managed Browser session.
  // Browser navigation/session creation is owned by the legacy observe bootstrap
  // and, after the atomic migration, by browser_navigate (#360).
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
      description: "Read a bounded, accessible snapshot of the existing Managed Browser page. Returns roles, names, stable element refs, page URL, title and snapshot hash. Navigate first; this tool never starts a browser.",
      domain: "browser_action", source: "internal", mode: "sync",
      inputSchema: {
        type: "object", additionalProperties: false, required: [],
        properties: {
          includeVisibleText: { type: "boolean" },
          maxSnapshotChars: { type: "integer", minimum: 100, maximum: 50000 },
        },
      },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "snapshot"],
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
      tags: ["computer-use", "browser", "screenshot"],
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

  const observe: ToolImplementation = {
    definition: {
      id: "browser_observe",
      title: "Browser Observe",
      description: "Observe the current managed browser page. On the first call, provide the target url; the tool creates or reuses the browser session internally, so never ask the user for sessionId. The result includes page.url, page.title, page.snapshotHash, observation.snapshot, observation.visibleText, and screenshot artifacts when requested. Use this result as the source of truth before choosing browser_act or browser_assert.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: [],
        properties: {
          sessionId,
          url: { type: "string", minLength: 1 },
          includeScreenshot: { type: "boolean" },
          includeVisibleText: { type: "boolean" },
          maxSnapshotChars: { type: "integer", minimum: 100, maximum: 50000 },
        },
      },
      inputSchemaByExposure: { agent_intent: agentObserveSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "observe"],
      capabilities: { sideEffect: "none", requiresApproval: false, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<BrowserInspectInput & { url?: string }>(context.args, "args");
      args.sessionId = await resolveSessionId(context, args);
      delete args.url;
      const result = await browser.observe(args);
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const act: ToolImplementation = {
    definition: {
      id: "browser_act",
      title: "Browser Act",
      description: "Perform exactly one structured action in the managed browser using pageUrl and snapshotHash from the latest browser_observe result. Supported actions are navigate(url), click(ref), type(ref,text), select(ref,value), press(ref,key), scroll(x,y), and wait(ref?,text?,timeoutMs?). Use the exact element ref from the latest snapshot for click, type, select, press, or wait. The tool manages sessionId internally, requires approval for write actions, and returns the updated page state and observation. Do not invent refs or reuse a stale snapshot.",
      domain: "browser_action",
      source: "internal",
      mode: "sync",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pageUrl", "snapshotHash", "action"],
        properties: {
          sessionId,
          pageUrl: { type: "string", minLength: 1 },
          snapshotHash: { type: "string", minLength: 1 },
          action: {
            ...actionSchema,
          },
        },
      },
      inputSchemaByExposure: { agent_intent: agentActSchema },
      outputSchema: browserResultSchema,
      tags: ["computer-use", "browser", "act"],
      capabilities: { sideEffect: "network", requiresApproval: true, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<BrowserActInput>(context.args, "args");
      args.sessionId = await resolveSessionId(context, args as unknown as Record<string, unknown>);
      const result = await browser.act(args);
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
      tags: ["computer-use", "browser", "assert"],
      capabilities: { sideEffect: "none", requiresApproval: false, networkAccess: true },
    },
    execute: async (context) => {
      const args = requireObject<BrowserAssertInput>(context.args, "args");
      args.sessionId = await resolveSessionId(context, args as unknown as Record<string, unknown>);
      const result = await browser.assert(args);
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
      tags: ["computer-use", "browser", "navigate"],
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
      let bootstrappedSession = false;
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
        bootstrappedSession = true;
      }
      (context.args as Record<string, unknown>).sessionId = sessionId;
      const result = await browser.navigate({ sessionId, url });
      if (bootstrappedSession && result.ok === false) {
        // A first navigation that never bootstrapped must not leave a poisoned
        // thread binding or an orphaned, never-used session behind. Disposing
        // here lets the next approved valid URL bootstrap normally; a session
        // that was already live is never torn down by a failed navigation.
        if (context.threadId && sessionsByContext.get(context.threadId) === sessionId) {
          sessionsByContext.delete(context.threadId);
        }
        await sessionManager?.stop(sessionId);
      }
      emitBrowserArtifacts(context, result);
      return { structuredContent: result, ...(result.ok === false ? { isError: true } : {}) };
    },
  };

  const wait: ToolImplementation = {
    definition: {
      id: "browser_wait_for",
      title: "Browser Wait For",
      description: "Wait, up to a bounded timeout, for a future page condition. condition.kind=text waits for visible text; kind=url waits for the page URL to match; kind=visible waits for a previously observed element ref and requires the observed pageUrl and snapshotHash plus the runtime-held element identity, so a replaced or renumbered element never satisfies the wait. Waiting on UI that was never observed should use text/url conditions followed by a fresh snapshot. A timeout is a failure (wait_timeout), never a false success. Requires approval.",
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
      tags: ["computer-use", "browser", "wait"],
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

  return [observe, act, assert, navigate, wait, snapshot, screenshot];
};
