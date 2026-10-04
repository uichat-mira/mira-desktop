import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { wecomOrgLookupTool } from "./wecom-org-lookup.tool.js";

const hasWecomAppConfigMock = vi.hoisted(() => vi.fn(() => false));
const getBoundWecomUserForThreadMock = vi.hoisted(() => vi.fn(() => null));
const getBoundWecomUserForUserMock = vi.hoisted(() => vi.fn(() => null));
const getWecomUserByUserIdMock = vi.hoisted(() => vi.fn());
const listWecomDepartmentsMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/wecom/config.js", () => ({
  hasWecomAppConfig: hasWecomAppConfigMock,
  hasWecomContactsConfig: vi.fn(() => false),
}));

vi.mock("@/integrations/wecom/bind-store.js", () => ({
  getBoundWecomUserForThread: getBoundWecomUserForThreadMock,
  getBoundWecomUserForUser: getBoundWecomUserForUserMock,
}));

vi.mock("@/integrations/wecom/client.js", () => ({
  getWecomUserByUserId: getWecomUserByUserIdMock,
  listWecomDepartments: listWecomDepartmentsMock,
}));

describe("wecom_org_lookup tool", () => {
  afterEach(() => {
    hasWecomAppConfigMock.mockReset();
    hasWecomAppConfigMock.mockReturnValue(false);
    getBoundWecomUserForThreadMock.mockReset();
    getBoundWecomUserForThreadMock.mockReturnValue(null);
    getBoundWecomUserForUserMock.mockReset();
    getBoundWecomUserForUserMock.mockReturnValue(null);
    getWecomUserByUserIdMock.mockReset();
    listWecomDepartmentsMock.mockReset();
  });

  it("rejects invalid mode", async () => {
    await expect(
      wecomOrgLookupTool.execute({
        invocationId: "org-1",
        args: {
          mode: "team",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-1",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow("mode must be either 'self' or 'user'");
  });

  it("requires query when mode is user", async () => {
    await expect(
      wecomOrgLookupTool.execute({
        invocationId: "org-2",
        threadId: "thread-2",
        args: {
          mode: "user",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-2",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow("query is required when mode is 'user'");
  });

  it("fails when app config is incomplete", async () => {
    await expect(
      wecomOrgLookupTool.execute({
        invocationId: "org-3",
        threadId: "thread-3",
        args: {
          mode: "self",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-3",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow(/WeCom app config is incomplete/i);
  });

  it("requires a chat user or thread context", async () => {
    await expect(
      wecomOrgLookupTool.execute({
        invocationId: "org-4",
        args: {
          mode: "self",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-4",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow(
      "WeCom organization lookup requires a chat user or thread context.",
    );
  });

  it("fails when self mode has no bound WeCom user", async () => {
    hasWecomAppConfigMock.mockReturnValue(true);

    await expect(
      wecomOrgLookupTool.execute({
        invocationId: "org-5",
        threadId: "thread-5",
        args: {
          mode: "self",
        },
        signal: new AbortController().signal,
        environment: createHarnessEnvironmentSnapshot(),
        pushEvent() {},
        addArtifact(artifact) {
          return { id: "a", ...artifact };
        },
        trace: {
          startSpan() {
            return {
              spanId: "span-5",
              end() {},
            };
          },
        },
      }),
    ).rejects.toThrow("No WeCom user is bound to the current chat thread yet.");
  });

  it("returns department summaries when config and binding are available", async () => {
    hasWecomAppConfigMock.mockReturnValue(true);
    getBoundWecomUserForThreadMock.mockReturnValue("tomz");
    getWecomUserByUserIdMock.mockResolvedValue({
      userid: "tomz",
      name: "Tomz",
      department: [2, 7],
    });
    listWecomDepartmentsMock.mockResolvedValue([
      { id: 2, name: "AI" },
      { id: 7, name: "Platform" },
    ]);

    const result = await wecomOrgLookupTool.execute({
      invocationId: "org-6",
      threadId: "thread-6",
      args: {
        mode: "self",
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot(),
      pushEvent() {},
      addArtifact(artifact) {
        return { id: "a", ...artifact };
      },
      trace: {
        startSpan() {
          return {
            spanId: "span-6",
            end() {},
          };
        },
      },
    });

    expect(getWecomUserByUserIdMock).toHaveBeenCalledWith("tomz");
    expect(result.structuredContent).toEqual({
      success: true,
      departments: [
        { id: "2", name: "AI" },
        { id: "7", name: "Platform" },
      ],
      summary: "Tomz belongs to AI, Platform",
    });
  });
});
