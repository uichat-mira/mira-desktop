import type {
  ToolInvocationContext,
  ToolEvidence,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { BrowserService } from "@/microapps/computer-use/browser/service.js";
import type {
  BrowserActInput,
  BrowserAssertInput,
  BrowserInspectInput,
  BrowserToolResult,
} from "@/microapps/computer-use/browser/types.js";
import type { BrowserSessionManager } from "@/microapps/computer-use/session/manager.js";

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

const createBrowserEvidence = (
  operation: "observe" | "act" | "assert",
  result: BrowserToolResult,
): ToolEvidence => ({
  actionTaken: result.ok
    ? `Completed managed browser ${operation}.`
    : `Managed browser ${operation} failed.`,
  facts: [
    `operation=${operation}`,
    `ok=${result.ok}`,
    `url=${result.page.url}`,
    `title=${result.page.title}`,
    ...(result.page.snapshotHash ? [`snapshotHash=${result.page.snapshotHash}`] : []),
    ...(result.observation?.visibleText ? [`visibleText=${result.observation.visibleText.slice(0, 280)}`] : []),
    ...(result.assertion ? [`assertion=${result.assertion.kind}`, `passed=${result.assertion.passed}`] : []),
  ],
  ...(result.error ? { error: result.error.message } : {}),
  status: result.ok ? "completed" : "failed",
  data: {
    kind: "computer_use_browser",
    operation,
    page: result.page,
    ...(result.observation ? { observation: result.observation } : {}),
    ...(result.assertion ? { assertion: result.assertion } : {}),
    ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
  },
});

const requireObject = <T extends object>(value: unknown, name: string): T => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mcpBadRequest(`${name} must be an object`);
  }
  return value as T;
};

export const createComputerUseBrowserTools = (
  browser: BrowserService,
  options: { sessionManager?: BrowserSessionManager } = {},
): ToolImplementation[] => {
  const sessionsByContext = new Map<string, string>();
  const sessionManager = options.sessionManager;
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
    });
    if (created.status !== "ready") {
      throw mcpBadRequest(created.error?.message ?? "Computer Use browser session could not be created.");
    }
    if (contextKey) sessionsByContext.set(contextKey, created.id);
    return created.id;
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
      return { result, evidence: createBrowserEvidence("observe", result) };
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
      return { result, evidence: createBrowserEvidence("act", result) };
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
      return { result, evidence: createBrowserEvidence("assert", result) };
    },
  };

  return [observe, act, assert];
};
