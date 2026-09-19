import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTaskModelText } from "@/services/task-model.service.js";
import { getDashboardMail, getShanghaiDayRange, resetDashboardMailAnalysisCache } from "./dashboard-mail.js";

vi.mock("@/services/task-model.service.js", () => ({ collectTaskModelText: vi.fn() }));

const makeMessage = (id: string, subject: string) => ({
  id,
  accountId: "account-1",
  subject,
  from: { name: "客户", address: "client@example.com" },
  to: [{ address: "me@example.com" }],
  previewText: subject,
  textContent: `${subject} 的正文`,
  sentAt: "2026-07-30T01:00:00.000Z",
  receivedAt: "2026-07-30T01:00:00.000Z",
  isRead: false,
  isFlagged: false,
  hasAttachments: false,
});

describe("dashboard mail analysis", () => {
  afterEach(() => {
    vi.mocked(collectTaskModelText).mockReset();
    resetDashboardMailAnalysisCache();
  });

  it("calculates the current Shanghai calendar day", () => {
    expect(getShanghaiDayRange(new Date("2026-07-30T15:59:59.000Z"))).toEqual({
      dayKey: "2026-07-30",
      since: "2026-07-29T16:00:00.000Z",
      until: "2026-07-30T16:00:00.000Z",
    });
  });

  it("syncs all accounts, applies the score rubric, and keeps only attention mail", async () => {
    const queryMail = vi.fn(async () => ({
      sync: {
        requested: "force" as const,
        performed: true,
        status: "succeeded" as const,
        syncedCount: 2,
        lastSyncedAt: "2026-07-30T02:00:00.000Z",
        error: null,
      },
      items: [makeMessage("important", "今天确认报价"), makeMessage("marketing", "产品周报")],
      total: 2,
      nextCursor: null,
    }));
    vi.mocked(collectTaskModelText).mockResolvedValue(JSON.stringify({
      items: [
        {
          messageId: "important",
          content: "客户要求今天确认报价。",
          attentionReason: "有明确行动要求和当日截止时间。",
          suggestedNextStep: "核对报价后今天回复客户。",
          signals: { deadlineWithin24Hours: true, explicitActionRequired: true },
        },
        {
          messageId: "marketing",
          content: "常规产品资讯。",
          attentionReason: "群发资讯。",
          suggestedNextStep: "无需处理。",
          signals: { bulkOrMarketing: true, informationalOnly: true },
        },
      ],
    }));

    const result = await getDashboardMail(
      { queryMail } as never,
      7,
      new Date("2026-07-30T02:00:00.000Z"),
      "zh-CN",
    );

    expect(queryMail).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      since: "2026-07-29T16:00:00.000Z",
      until: "2026-07-30T15:59:59.999Z",
      includeBody: true,
      sync: "force",
    }));
    expect(result).toMatchObject({ status: "ready", totalToday: 2, attentionCount: 1 });
    expect(result.items[0]).toMatchObject({
      id: "important",
      priority: "high",
      content: "客户要求今天确认报价。",
    });
  });

  it("reuses the cached result without syncing again within one hour", async () => {
    const queryMail = vi.fn(async () => ({
      sync: {
        requested: "force" as const,
        performed: true,
        status: "succeeded" as const,
        syncedCount: 1,
        lastSyncedAt: "2026-07-30T02:00:00.000Z",
        error: null,
      },
      items: [makeMessage("important", "Review the quote today")],
      total: 1,
      nextCursor: null,
    }));
    vi.mocked(collectTaskModelText).mockResolvedValue(JSON.stringify({
      items: [{
        messageId: "important",
        content: "The client needs the quote reviewed today.",
        attentionReason: "There is an explicit action and a same-day deadline.",
        suggestedNextStep: "Review the quote and reply today.",
        signals: { deadlineWithin24Hours: true, explicitActionRequired: true },
      }],
    }));

    const service = { queryMail } as never;
    const first = await getDashboardMail(service, 7, new Date("2026-07-30T02:00:00.000Z"), "en-US");
    const second = await getDashboardMail(service, 7, new Date("2026-07-30T02:59:59.999Z"), "en-US");

    expect(second).toEqual(first);
    expect(queryMail).toHaveBeenCalledTimes(1);
    expect(collectTaskModelText).toHaveBeenCalledTimes(1);
  });

  it("syncs after one hour and reuses the analysis when mail is unchanged", async () => {
    const queryMail = vi.fn(async () => ({
      sync: {
        requested: "force" as const,
        performed: true,
        status: "succeeded" as const,
        syncedCount: 1,
        lastSyncedAt: "2026-07-30T03:00:00.000Z",
        error: null,
      },
      items: [makeMessage("important", "Review the quote today")],
      total: 1,
      nextCursor: null,
    }));
    vi.mocked(collectTaskModelText).mockResolvedValue(JSON.stringify({
      items: [{
        messageId: "important",
        content: "The client needs the quote reviewed today.",
        attentionReason: "There is an explicit action and a same-day deadline.",
        suggestedNextStep: "Review the quote and reply today.",
        signals: { deadlineWithin24Hours: true, explicitActionRequired: true },
      }],
    }));

    const service = { queryMail } as never;
    const first = await getDashboardMail(service, 7, new Date("2026-07-30T02:00:00.000Z"), "en-US");
    const second = await getDashboardMail(service, 7, new Date("2026-07-30T03:00:00.000Z"), "en-US");

    expect(second).toEqual(first);
    expect(queryMail).toHaveBeenCalledTimes(2);
    expect(collectTaskModelText).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh across concurrent requests", async () => {
    let releaseQuery!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    let allowQueryToFinish!: () => void;
    const queryCanFinish = new Promise<void>((resolve) => {
      allowQueryToFinish = resolve;
    });
    const queryMail = vi.fn(async () => {
      releaseQuery();
      await queryCanFinish;
      return {
        sync: {
          requested: "force" as const,
          performed: true,
          status: "succeeded" as const,
          syncedCount: 0,
          lastSyncedAt: "2026-07-30T02:00:00.000Z",
          error: null,
        },
        items: [],
        total: 0,
        nextCursor: null,
      };
    });

    const service = { queryMail } as never;
    const first = getDashboardMail(service, 7, new Date("2026-07-30T02:00:00.000Z"), "zh-CN");
    await queryStarted;
    const second = getDashboardMail(service, 7, new Date("2026-07-30T02:00:01.000Z"), "zh-CN");
    allowQueryToFinish();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(queryMail).toHaveBeenCalledTimes(1);
  });
});
