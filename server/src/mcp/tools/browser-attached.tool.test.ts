import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolExecutionEvidenceSummary } from "@/agent/evidence.js";
import { attachHarnessLlmContentToExecution } from "@/agent/nodes/harness-tool-result.js";
import type { AgentToolExecutionResult } from "@/agent/types.js";
import { computerUseRepository } from "@/db/repositories/computer-use/repository.js";
import {
  clearHarnessInvocations,
  executeHarnessInvocation,
  getHarnessInvocationTrace,
} from "@/harness/invocations.js";
import {
  clearHarnessRegistry,
  listCapabilityDefinitions,
  registerCapability,
} from "@/harness/registry.js";
import {
  initializeHarnessRuntime,
  resetHarnessRuntime,
} from "@/harness/runtime.js";
import type { ToolInvocationContext } from "../core/definitions.js";
import {
  WebBridgeInvocationError,
  toWebBridgeInvocationError,
} from "@/routes/webbridge.js";
import {
  browserAttachedLookTool,
  createBrowserAttachedTools,
} from "./browser-attached.tool.js";

const { invokeWebBridgeMock } = vi.hoisted(() => ({
  invokeWebBridgeMock: vi.fn(),
}));

vi.mock("@/routes/webbridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/routes/webbridge.js")>();
  return { ...actual, invokeWebBridge: invokeWebBridgeMock };
});

const trustedUserId = 42;
const originalDatabaseUrl = process.env.DATABASE_URL;

const executeDirectly = (
  tool: ReturnType<typeof createBrowserAttachedTools>[number],
  args: Record<string, unknown>,
  signal = new AbortController().signal,
  userId: number | undefined = trustedUserId,
) => tool.execute({ args, signal, userId } as ToolInvocationContext);

describe("Attached Browser Harness tools", () => {
  beforeEach(() => {
    invokeWebBridgeMock.mockReset();
    clearHarnessRegistry();
    clearHarnessInvocations();
    resetHarnessRuntime();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearHarnessRegistry();
    clearHarnessInvocations();
    resetHarnessRuntime();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("declares the fixed Agent-facing IDs and excludes runtime, selector, path, and screenshot inputs", () => {
    const tools = createBrowserAttachedTools();
    expect(tools.map((tool) => tool.definition.id)).toEqual([
      "browser_attached_look",
      "browser_attached_browse",
      "browser_attached_act",
      "browser_attached_transfer",
    ]);

    const trustedFields = [
      "userId",
      "accessToken",
      "backendUrl",
      "transport",
      "extensionClientId",
    ];
    for (const tool of tools) {
      const properties = tool.definition.inputSchema.properties as Record<
        string,
        unknown
      >;
      for (const field of trustedFields) {
        expect(properties).not.toHaveProperty(field);
      }
      expect(properties).not.toHaveProperty("selector");
      expect(properties).not.toHaveProperty("path");
    }

    const lookProperties = tools[0].definition.inputSchema.properties as Record<
      string,
      unknown
    >;
    expect(lookProperties).not.toHaveProperty("screenshot");
    expect(lookProperties).toEqual(
      expect.objectContaining({ mode: expect.objectContaining({ enum: ["page", "snapshot", "element", "tabs"] }) }),
    );

    const transferProperties = tools[3].definition.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(transferProperties.file.properties).toEqual({
      name: { type: "string" },
      mimeType: { type: "string" },
      dataUrl: { type: "string" },
      base64: { type: "string" },
    });
  });

  it("maps all four tools without rewriting params and passes trusted userId and AbortSignal separately", async () => {
    invokeWebBridgeMock.mockResolvedValue({ ok: true });
    const controller = new AbortController();
    const calls = [
      { tool: "look", args: { mode: "snapshot", include: ["text"] } },
      { tool: "browse", args: { mode: "switch", tabId: 7 } },
      { tool: "act", args: { mode: "click", ref: "e17", doubleClick: true } },
      {
        tool: "transfer",
        args: {
          mode: "upload",
          ref: "e18",
          file: { name: "note.txt", base64: "bm90ZQ==" },
        },
      },
    ] as const;

    const tools = createBrowserAttachedTools();
    for (const [index, call] of calls.entries()) {
      await executeDirectly(tools[index], call.args, controller.signal);
      expect(invokeWebBridgeMock).toHaveBeenNthCalledWith(index + 1, {
        userId: trustedUserId,
        tool: call.tool,
        params: call.args,
        signal: controller.signal,
      });
      expect(invokeWebBridgeMock.mock.calls[index][0].params).toBe(call.args);
    }
  });

  it("requires trusted user context and rejects model attempts to inject userId", async () => {
    await expect(
      browserAttachedLookTool.execute({
        args: { mode: "page" },
        signal: new AbortController().signal,
        userId: undefined,
      } as ToolInvocationContext),
    ).rejects.toThrow(/trusted authenticated user context/i);
    expect(invokeWebBridgeMock).not.toHaveBeenCalled();

    registerCapability(browserAttachedLookTool);
    await expect(
      executeHarnessInvocation({
        toolId: "browser_attached_look",
        args: { mode: "page", userId: 999 },
        userId: trustedUserId,
      }),
    ).rejects.toThrow(/userId.*not allowed/i);
  });

  it("preserves extension error detail through invocation and Agent Evidence", async () => {
    invokeWebBridgeMock.mockRejectedValue(
      new WebBridgeInvocationError({
        code: "STALE_ELEMENT_REF",
        message: "The element ref is stale.",
        retryable: true,
        suggestedAction: "look",
      }),
    );
    registerCapability(browserAttachedLookTool);

    const invocation = await executeHarnessInvocation({
      toolId: "browser_attached_look",
      args: { mode: "snapshot" },
      userId: trustedUserId,
    });
    expect(invocation.status).toBe("failed");
    expect(invocation.error).toEqual(
      expect.objectContaining({
        code: "STALE_ELEMENT_REF",
        message: "The element ref is stale.",
        retryable: true,
        suggestedAction: "look",
      }),
    );
    expect(getHarnessInvocationTrace(invocation.id)?.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "invocation",
          status: "failed",
          metadata: expect.objectContaining({
            code: "STALE_ELEMENT_REF",
            retryable: true,
            suggestedAction: "look",
          }),
        }),
      ]),
    );

    const execution: AgentToolExecutionResult = {
      toolId: "browser_attached_look",
      args: { mode: "snapshot" },
      invocationId: invocation.id,
      status: "failed",
      failureKind: "recoverable",
      failureCode: invocation.error?.failureCode,
      errorMessage: invocation.error?.message,
      startedAt: invocation.startedAt!,
      finishedAt: invocation.finishedAt!,
    };
    const enriched = attachHarnessLlmContentToExecution(execution)!;
    expect(enriched.invocationError).toEqual({
      code: "STALE_ELEMENT_REF",
      message: "The element ref is stale.",
      retryable: true,
      suggestedAction: "look",
    });

    const evidence = createToolExecutionEvidenceSummary({
      execution: enriched,
      evidenceIndex: 0,
    });
    expect(evidence.facts).toEqual(
      expect.arrayContaining([
        "errorCode=STALE_ELEMENT_REF",
        "retryable=true",
        "suggestedAction=look",
      ]),
    );
    expect(evidence.data).toEqual(
      expect.objectContaining({
        code: "STALE_ELEMENT_REF",
        retryable: true,
        suggestedAction: "look",
      }),
    );
    expect(JSON.stringify(evidence)).not.toContain(String(trustedUserId));
  });

  it("retains browser result fields, provider evidence, args, timing, and trace in the existing Harness contract", async () => {
    const args = { mode: "snapshot", include: ["text", "interactive"] };
    const result = {
      url: "https://example.com/dashboard",
      title: "Dashboard",
      text: "Signed-in dashboard",
      version: 3,
      tabId: 12,
      elements: [
        {
          ref: "e17",
          role: "button",
          name: "Refresh",
          text: "Refresh",
          disabled: false,
          tag: "button",
          type: "button",
          href: null,
          value: "",
        },
      ],
    };
    invokeWebBridgeMock.mockResolvedValue(result);
    registerCapability(browserAttachedLookTool);

    const invocation = await executeHarnessInvocation({
      toolId: "browser_attached_look",
      args,
      userId: trustedUserId,
      threadId: "thread-attached-browser",
      turnId: "turn-attached-browser",
    });

    expect(invocation).toEqual(
      expect.objectContaining({
        toolId: "browser_attached_look",
        args,
        status: "completed",
        result,
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        traceId: expect.any(String),
      }),
    );
    expect(invocation.evidence).toEqual(
      expect.objectContaining({
        facts: expect.arrayContaining([
          "tool=browser_attached_look",
          "provider=chujie",
        ]),
        data: expect.objectContaining({
          provider: "chujie",
          url: result.url,
          title: result.title,
          version: result.version,
          tabId: result.tabId,
          elements: result.elements,
        }),
      }),
    );
    expect(JSON.stringify(invocation.evidence)).not.toMatch(
      /userId|accessToken|backendUrl|extensionClientId/,
    );
    expect(JSON.stringify(invocation.llmContent)).toContain(result.url);
    expect(JSON.stringify(invocation.llmContent)).toContain("e17");

    const trace = getHarnessInvocationTrace(invocation.id);
    expect(trace).toEqual(
      expect.objectContaining({
        toolId: "browser_attached_look",
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        spans: expect.arrayContaining([
          expect.objectContaining({
            kind: "invocation",
            status: "completed",
          }),
          expect.objectContaining({
            kind: "result_normalization",
            status: "completed",
          }),
        ]),
      }),
    );
  });

  it("normalizes extension failures and disconnected calls to the structured WebBridge contract", async () => {
    const extensionError = toWebBridgeInvocationError(
      {
        code: "AUTH_REQUIRED",
        message: "Please sign in again.",
        retryable: false,
        suggestedAction: "reauthenticate",
      },
      {
        code: "WEBBRIDGE_INVOCATION_FAILED",
        message: "fallback",
        retryable: false,
      },
    );
    expect(extensionError).toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Please sign in again.",
      retryable: false,
      suggestedAction: "reauthenticate",
    });

    const actual = await vi.importActual<typeof import("@/routes/webbridge.js")>(
      "@/routes/webbridge.js",
    );
    await expect(
      actual.invokeWebBridge({
        userId: 2_147_483_646,
        tool: "look",
        params: { mode: "page" },
      }),
    ).rejects.toMatchObject({
      code: "BRIDGE_DISCONNECTED",
      retryable: true,
    });
  });

  it("registers only browser_attached IDs in Harness runtime", () => {
    initializeHarnessRuntime();
    const ids = listCapabilityDefinitions().map((definition) => definition.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "browser_attached_look",
        "browser_attached_browse",
        "browser_attached_act",
        "browser_attached_transfer",
      ]),
    );
    expect(ids.filter((id) => id.startsWith("webbridge_"))).toEqual([]);
  });

  it("does not persist browser_attached invocations as Playwright Computer Use records", async () => {
    process.env.DATABASE_URL = "browser-attached-contract-test";
    const persistInvocation = vi
      .spyOn(computerUseRepository, "persistInvocation")
      .mockImplementation(() => undefined);
    const persistEvents = vi
      .spyOn(computerUseRepository, "persistEvents")
      .mockImplementation(() => undefined);
    invokeWebBridgeMock.mockResolvedValue({ url: "https://example.com" });
    registerCapability(browserAttachedLookTool);

    const record = await executeHarnessInvocation({
      toolId: "browser_attached_look",
      args: { mode: "page" },
      userId: trustedUserId,
    });

    expect(record.status).toBe("completed");
    expect(persistInvocation).not.toHaveBeenCalled();
    expect(persistEvents).not.toHaveBeenCalled();
  });
});
