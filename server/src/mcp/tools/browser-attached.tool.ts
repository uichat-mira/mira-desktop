import type {
  ToolInvocationContext,
  ToolImplementation,
} from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { invokeWebBridge } from "@/routes/webbridge.js";

const BROWSER_ATTACHED_PROVIDER = "chujie";

const modeSchemas = {
  look: ["page", "snapshot", "element", "tabs"],
  browse: [
    "open",
    "new",
    "switch",
    "close",
    "back",
    "forward",
    "reload",
    "scroll",
    "scrollTo",
    "paginate",
    "wait",
  ],
  act: ["click", "hover", "drag", "fill", "select", "press", "dialog"],
  transfer: ["upload", "download"],
} as const;

type BrowserAttachedToolName = keyof typeof modeSchemas;

const afterSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const inputSchemas: Record<BrowserAttachedToolName, Record<string, unknown>> = {
  look: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {
      mode: { type: "string", enum: modeSchemas.look },
      ref: { type: "string" },
      include: {
        type: "array",
        items: { type: "string", enum: ["text", "interactive", "snapshot"] },
      },
    },
  },
  browse: {
    type: "object",
    additionalProperties: false,
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: modeSchemas.browse },
      url: { type: "string" },
      ref: { type: "string" },
      tabId: { type: "integer" },
      amount: { type: "number" },
      after: afterSchema,
    },
  },
  act: {
    type: "object",
    additionalProperties: false,
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: modeSchemas.act },
      ref: { type: "string" },
      fromRef: { type: "string" },
      toRef: { type: "string" },
      value: {},
      fields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "value"],
          properties: {
            ref: { type: "string" },
            value: {},
          },
        },
      },
      key: { type: "string" },
      submit: { type: "string" },
      doubleClick: { type: "boolean" },
      after: afterSchema,
    },
  },
  transfer: {
    type: "object",
    additionalProperties: false,
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: modeSchemas.transfer },
      ref: { type: "string" },
      url: { type: "string" },
      filename: { type: "string" },
      saveAs: { type: "boolean" },
      file: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          mimeType: { type: "string" },
          dataUrl: { type: "string" },
          base64: { type: "string" },
        },
      },
      after: afterSchema,
    },
  },
};

const descriptions: Record<BrowserAttachedToolName, string> = {
  look:
    "Observe the user's already-connected browser, including the current page, existing tabs, page text, and stable interactive refs. Use this before browser_attached_act. Screenshot is intentionally not exposed.",
  browse:
    "Navigate or change state in the user's already-connected browser, including existing tabs, history, scrolling, pagination, and waits. Do not invent URLs, refs, or selectors.",
  act:
    "Perform one structured interaction in the user's already-connected browser using refs from the latest browser_attached_look result. CSS selectors are not accepted.",
  transfer:
    "Upload explicit in-memory file content or download from the user's already-connected browser. Local host paths are not accepted.",
};

const toEvidenceData = (result: unknown): Record<string, unknown> =>
  result && typeof result === "object" && !Array.isArray(result)
    ? { provider: BROWSER_ATTACHED_PROVIDER, ...(result as Record<string, unknown>) }
    : { provider: BROWSER_ATTACHED_PROVIDER, result };

const createBrowserAttachedTool = (
  tool: BrowserAttachedToolName,
): ToolImplementation => ({
  definition: {
    id: `browser_attached_${tool}`,
    title: `Attached Browser ${tool[0].toUpperCase()}${tool.slice(1)}`,
    description: descriptions[tool],
    domain: "browser_action",
    source: "internal",
    mode: "sync",
    inputSchema: inputSchemas[tool],
    tags: ["browser", "attached-browser", "chujie", tool],
    capabilities: {
      sideEffect: tool === "look" ? "none" : "network",
      requiresApproval: tool === "act" || tool === "transfer",
      networkAccess: true,
    },
  },
  execute: async (context: ToolInvocationContext) => {
    if (context.userId === undefined || !Number.isInteger(context.userId)) {
      throw mcpBadRequest(
        "Attached Browser requires a trusted authenticated user context",
      );
    }

    const result = await invokeWebBridge({
      userId: context.userId,
      tool,
      params: context.args,
      signal: context.signal,
    });

    return {
      result,
      evidence: {
        actionTaken: `Called ${BROWSER_ATTACHED_PROVIDER} Attached Browser ${tool}.`,
        facts: [
          `tool=browser_attached_${tool}`,
          `provider=${BROWSER_ATTACHED_PROVIDER}`,
        ],
        status: "completed",
        data: toEvidenceData(result),
      },
    };
  },
});

export const browserAttachedLookTool = createBrowserAttachedTool("look");
export const browserAttachedBrowseTool = createBrowserAttachedTool("browse");
export const browserAttachedActTool = createBrowserAttachedTool("act");
export const browserAttachedTransferTool = createBrowserAttachedTool("transfer");

export const createBrowserAttachedTools = (): ToolImplementation[] => [
  browserAttachedLookTool,
  browserAttachedBrowseTool,
  browserAttachedActTool,
  browserAttachedTransferTool,
];
