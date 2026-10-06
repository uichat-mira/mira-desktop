import { describe, expect, it } from "vitest";

import {
  isNotificationEligibleTransition,
  type NotificationCanonicalMessage,
} from "./notification-eligibility.js";

const assistant = (
  content: string,
  status?: string,
): NotificationCanonicalMessage => ({
  id: "assistant-1",
  role: "assistant",
  content,
  parts: content ? [{ type: "text", text: content }] : [],
  metadata: status ? { agent: { status } } : {},
});

describe("notification eligibility", () => {
  it("accepts ordinary Chat/RAG absent to final exactly at first persistence", () => {
    expect(isNotificationEligibleTransition(null, assistant("完成回复"))).toBe(
      true,
    );
    expect(
      isNotificationEligibleTransition(
        assistant("完成回复"),
        assistant("完成回复"),
      ),
    ).toBe(false);
  });

  it("accepts Agent placeholder/running to completed final", () => {
    expect(
      isNotificationEligibleTransition(
        assistant("Agent 正在运行…", "running"),
        assistant("最终答案", "completed"),
      ),
    ).toBe(true);
  });

  it("never treats waiting approval as a notification result", () => {
    expect(
      isNotificationEligibleTransition(
        assistant("Agent 正在运行…", "running"),
        assistant("等待审批", "waiting_approval"),
      ),
    ).toBe(false);
  });

  it("allows approval resume after the canonical row re-enters running", () => {
    const waiting = assistant("等待审批", "waiting_approval");
    const running = assistant("等待审批", "running");
    const completed = assistant("批准后的最终答案", "completed");

    expect(isNotificationEligibleTransition(waiting, running)).toBe(false);
    expect(isNotificationEligibleTransition(running, completed)).toBe(true);
  });

  it("does not treat Agent terminal error snapshots as completed replies", () => {
    for (const status of ["failed", "blocked", "cancelled", "waiting_user"]) {
      expect(
        isNotificationEligibleTransition(
          assistant("Agent 正在运行…", "running"),
          assistant("未完成", status),
        ),
      ).toBe(false);
    }
  });

  it("rejects updates after final and mismatched canonical ids", () => {
    expect(
      isNotificationEligibleTransition(
        assistant("第一次完成", "completed"),
        assistant("execution node refresh", "completed"),
      ),
    ).toBe(false);

    expect(
      isNotificationEligibleTransition(
        { ...assistant("Agent 正在运行…", "running"), id: "assistant-old" },
        assistant("最终答案", "completed"),
      ),
    ).toBe(false);
  });
});
