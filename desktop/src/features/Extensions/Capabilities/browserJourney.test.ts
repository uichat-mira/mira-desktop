import { describe, expect, it } from "vitest";
import {
  createBrowserJourneyState,
  findBrowserSnapshotRef,
  readBrowserResult,
} from "./browserJourney";

describe("Browser journey helpers", () => {
  it("starts with five ordered pending steps and no reused invocation facts", () => {
    const state = createBrowserJourneyState();

    expect(state.status).toBe("idle");
    expect(state.handle).toBeNull();
    expect(state.steps.map((step) => step.id)).toEqual([
      "navigate",
      "snapshot",
      "click",
      "observe-after-click",
      "assert",
    ]);
    expect(
      state.steps.every(
        (step) =>
          step.status === "pending" &&
          step.invocationId === null &&
          step.page === null &&
          step.ref === null,
      ),
    ).toBe(true);
  });

  it("resolves a clickable ref only from the live AI snapshot text", () => {
    const snapshot = [
      '- heading "Web form" [level=1] [ref=e6]',
      '- button "Submit" [ref=e40] [cursor=pointer]',
      '- link "Return to index" [ref=e21]',
    ].join("\n");

    expect(findBrowserSnapshotRef(snapshot, { role: "button", name: "Submit" })).toBe(
      "e40",
    );
    expect(findBrowserSnapshotRef(snapshot, { role: "link", name: "Return to index" })).toBe(
      "e21",
    );
    expect(findBrowserSnapshotRef(snapshot, { role: "button", name: "Cancel" })).toBeNull();
    expect(findBrowserSnapshotRef(null, { role: "button", name: "Submit" })).toBeNull();
  });

  it("reads real Browser result facts and explicit failures", () => {
    expect(
      readBrowserResult({
        ok: true,
        sessionId: "session-1",
        page: {
          url: "https://www.selenium.dev/selenium/web/web-form.html",
          title: "Web form",
          snapshotHash: "hash-1",
        },
        observation: { snapshot: '- button "Submit" [ref=e40]' },
      }),
    ).toMatchObject({
      ok: true,
      sessionId: "session-1",
      page: { title: "Web form", snapshotHash: "hash-1" },
      observationSnapshot: '- button "Submit" [ref=e40]',
    });

    expect(
      readBrowserResult({
        ok: false,
        sessionId: "",
        page: { url: "", title: "" },
        error: {
          code: "session_unavailable",
          message: "No active Managed Browser session for this thread.",
        },
      }),
    ).toMatchObject({
      ok: false,
      sessionId: null,
      error: { code: "session_unavailable" },
    });

    expect(readBrowserResult({ ok: "yes" })).toBeNull();
    expect(readBrowserResult(null)).toBeNull();
  });
});
