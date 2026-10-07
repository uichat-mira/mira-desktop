import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { executeHarnessInvocation } from "../../harness/invocations.js";
import { clearHarnessRegistry, registerTool } from "../../harness/registry.js";

const transportMock = vi.hoisted(() => ({ fetchWebResource: vi.fn() }));

vi.mock("./transport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport.js")>();
  return { ...actual, fetchWebResource: transportMock.fetchWebResource };
});

import { webFetchTool } from "../tools/web-fetch.tool.js";
import { WebFetchTransportError } from "./transport.js";

describe("web fetch caller cancellation at the Harness invocation boundary", () => {
  afterEach(() => {
    transportMock.fetchWebResource.mockReset();
    clearHarnessRegistry();
  });

  it("projects caller cancellation to a cancelled invocation", async () => {
    clearHarnessRegistry();
    registerTool(webFetchTool);

    const controller = new AbortController();
    transportMock.fetchWebResource.mockImplementation(
      (input: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener(
            "abort",
            () => reject(new WebFetchTransportError("cancelled")),
            { once: true },
          );
        }),
    );

    const pending = executeHarnessInvocation({
      toolId: "web_fetch",
      args: { url: "https://example.com/page" },
      signal: controller.signal,
      environment: createHarnessEnvironmentSnapshot(),
    });
    setTimeout(() => controller.abort(), 0);

    const record = await pending;

    expect(record.status).toBe("cancelled");
    expect(record.error?.failureCode).toBe("cancelled");
  });
});
