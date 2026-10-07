import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasConfig: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/integrations/wecom/config.js", () => ({ hasWecomRobotConfig: mocks.hasConfig }));
vi.mock("@/integrations/wecom/robot.js", () => ({ sendWecomRobotMarkdownMessage: mocks.send }));

import { wecomRobotNotifyTool } from "./wecom-robot-notify.tool.js";

const createContext = (args: Record<string, unknown>) => ({
  invocationId: "wecom-notify-1",
  args,
  signal: new AbortController().signal,
  pushEvent: vi.fn(),
  addArtifact: vi.fn(),
  trace: { startSpan: vi.fn() },
});

describe("wecom_robot_notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasConfig.mockReturnValue(true);
    mocks.send.mockResolvedValue(undefined);
  });

  it("rejects blank content and missing trusted configuration", async () => {
    await expect(wecomRobotNotifyTool.execute(createContext({ content: "  " }) as never))
      .rejects.toThrow("content is required");
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.hasConfig.mockReturnValue(false);
    await expect(wecomRobotNotifyTool.execute(createContext({ content: "hello" }) as never))
      .rejects.toThrow("webhook is not configured");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("normalizes input, emits progress, and returns a secret-free result", async () => {
    const context = createContext({ title: "  Release  ", content: "  shipped  " });
    const result = await wecomRobotNotifyTool.execute(context as never);

    expect(mocks.send).toHaveBeenCalledWith({ title: "Release", content: "shipped" });
    expect(context.pushEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "invocation:progress",
    }));
    expect(result.structuredContent).toEqual({
      success: true,
      target: "robot-webhook",
      summary: "WeCom robot notification sent: Release",
    });
    expect(JSON.stringify(result)).not.toContain("https://");
  });
});
