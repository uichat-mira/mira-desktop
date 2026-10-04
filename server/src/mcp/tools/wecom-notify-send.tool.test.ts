import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessEnvironmentSnapshot } from "../../harness/environment.js";
import { wecomNotifySendTool } from "./wecom-notify-send.tool.js";

const hasWecomAppConfigMock = vi.hoisted(() => vi.fn(() => false));
const hasWecomRobotConfigMock = vi.hoisted(() => vi.fn(() => false));
const getBoundWecomUserForThreadMock = vi.hoisted(() => vi.fn(() => null));
const getBoundWecomUserForUserMock = vi.hoisted(() => vi.fn(() => null));
const sendWecomTextMessageToUserMock = vi.hoisted(() => vi.fn());
const sendWecomRobotMarkdownMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/wecom/config.js", () => ({
  hasWecomAppConfig: hasWecomAppConfigMock,
  hasWecomRobotConfig: hasWecomRobotConfigMock,
}));

vi.mock("@/integrations/wecom/bind-store.js", () => ({
  getBoundWecomUserForThread: getBoundWecomUserForThreadMock,
  getBoundWecomUserForUser: getBoundWecomUserForUserMock,
}));

vi.mock("@/integrations/wecom/client.js", () => ({
  sendWecomTextMessageToUser: sendWecomTextMessageToUserMock,
}));

vi.mock("@/integrations/wecom/robot.js", () => ({
  sendWecomRobotMarkdownMessage: sendWecomRobotMarkdownMessageMock,
}));

describe("wecom_notify_send tool", () => {
  afterEach(() => {
    hasWecomAppConfigMock.mockReset();
    hasWecomAppConfigMock.mockReturnValue(false);
    hasWecomRobotConfigMock.mockReturnValue(false);
    getBoundWecomUserForThreadMock.mockReset();
    getBoundWecomUserForThreadMock.mockReturnValue(null);
    getBoundWecomUserForUserMock.mockReset();
    getBoundWecomUserForUserMock.mockReturnValue(null);
    sendWecomTextMessageToUserMock.mockReset();
    sendWecomRobotMarkdownMessageMock.mockReset();
  });

  it("rejects missing content", async () => {
    await expect(
      wecomNotifySendTool.execute({
        invocationId: "notify-1",
        args: {},
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
    ).rejects.toThrow("content is required");
  });

  it("fails when app config is incomplete", async () => {
    await expect(
      wecomNotifySendTool.execute({
        invocationId: "notify-2",
        threadId: "thread-1",
        args: {
          content: "hello",
          title: "test",
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
    ).rejects.toThrow(/WeCom config is incomplete/i);
  });

  it("uses robot webhook when configured", async () => {
    hasWecomRobotConfigMock.mockReturnValue(true);
    sendWecomRobotMarkdownMessageMock.mockResolvedValue({
      errcode: 0,
    });

    const result = await wecomNotifySendTool.execute({
      invocationId: "notify-robot-1",
      threadId: "thread-robot-1",
      args: {
        title: "Summary",
        content: "hello",
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
            spanId: "span-robot-1",
            end() {},
          };
        },
      },
    });

    expect(sendWecomRobotMarkdownMessageMock).toHaveBeenCalledWith({
      title: "Summary",
      content: "hello",
    });
    expect(result.structuredContent).toEqual({
      success: true,
      target: "robot-webhook",
      summary: "WeCom robot notification sent",
    });
  });

  it("requires a chat user or thread context", async () => {
    await expect(
      wecomNotifySendTool.execute({
        invocationId: "notify-3",
        args: {
          content: "hello",
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
    ).rejects.toThrow("WeCom notify requires a chat user or thread context.");
  });

  it("fails when the current chat thread is not bound to a WeCom user", async () => {
    hasWecomAppConfigMock.mockReturnValue(true);

    await expect(
      wecomNotifySendTool.execute({
        invocationId: "notify-4",
        threadId: "thread-4",
        args: {
          content: "hello",
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
    ).rejects.toThrow("No WeCom user is bound to the current chat thread yet.");
  });

  it("sends a WeCom notification when config and binding are available", async () => {
    hasWecomAppConfigMock.mockReturnValue(true);
    getBoundWecomUserForThreadMock.mockReturnValue("tomz");
    sendWecomTextMessageToUserMock.mockResolvedValue({
      errcode: 0,
    });

    const result = await wecomNotifySendTool.execute({
      invocationId: "notify-5",
      threadId: "thread-5",
      args: {
        title: "Summary",
        content: "hello",
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
    });

    expect(sendWecomTextMessageToUserMock).toHaveBeenCalledWith({
      userId: "tomz",
      content: "Summary\n\nhello",
    });
    expect(result.structuredContent).toEqual({
      success: true,
      target: "tomz",
      summary: "WeCom notification sent to tomz",
    });
  });
});
