import { afterEach, describe, expect, it } from "vitest";

import {
  appendPersistentTerminalOutput,
  cancelPersistentTerminalOutputsForSession,
  clearAllPersistentTerminalOutputs,
  completePersistentTerminalOutput,
  createPersistentTerminalOutput,
  getPersistentTerminalSessionStatus,
  readPersistentTerminalOutput,
} from "../persistent-output-store.js";

describe("persistent terminal output store", () => {
  afterEach(async () => {
    await clearAllPersistentTerminalOutputs();
  });

  it("pages UTF-8 output on stable byte boundaries", async () => {
    const record = createPersistentTerminalOutput({
      sessionId: "session-utf8",
      command: "emit unicode",
    });
    appendPersistentTerminalOutput(record.id, "ab你好cd");
    await completePersistentTerminalOutput(record.id, 0);

    const first = await readPersistentTerminalOutput({
      id: record.id,
      offset: 0,
      limitBytes: 4,
    });
    expect(first.output).toBe("ab");
    expect(first.nextOutputOffset).toBe(2);
    expect(first.truncated).toBe(true);

    const second = await readPersistentTerminalOutput({
      id: record.id,
      offset: first.nextOutputOffset,
      limitBytes: 4,
    });
    expect(second.output).toBe("你");
    expect(second.nextOutputOffset).toBe(5);
    expect(second.truncated).toBe(true);

    const third = await readPersistentTerminalOutput({
      id: record.id,
      offset: second.nextOutputOffset,
      limitBytes: 16,
    });
    expect(third.output).toBe("好cd");
    expect(third.continuationAvailable).toBe(false);
    expect(third.commandCompleted).toBe(true);
    expect(third.exitCode).toBe(0);
    expect(third.state).toBe("completed");
  });

  it("keeps continuation available while a command is still collecting output", async () => {
    const record = createPersistentTerminalOutput({
      sessionId: "session-running",
      command: "watch",
    });
    appendPersistentTerminalOutput(record.id, "ready\n");

    const page = await readPersistentTerminalOutput({
      id: record.id,
      offset: 0,
      limitBytes: 64,
    });
    expect(page.output).toBe("ready\n");
    expect(page.truncated).toBe(false);
    expect(page.commandCompleted).toBe(false);
    expect(page.continuationAvailable).toBe(true);
    expect(page.state).toBe("running");
    expect(page.nextOutputOffset).toBe(Buffer.byteLength("ready\n", "utf8"));
  });

  it("reports failed and cancelled persistent states", async () => {
    const failed = createPersistentTerminalOutput({
      sessionId: "session-failed",
      command: "exit 2",
    });
    await completePersistentTerminalOutput(failed.id, 2);
    expect(
      (await getPersistentTerminalSessionStatus("session-failed"))?.state,
    ).toBe("failed");

    const running = createPersistentTerminalOutput({
      sessionId: "session-cancelled",
      command: "watch",
    });
    appendPersistentTerminalOutput(running.id, "working");
    await cancelPersistentTerminalOutputsForSession("session-cancelled");

    const cancelled = await getPersistentTerminalSessionStatus(
      "session-cancelled",
    );
    expect(cancelled?.state).toBe("cancelled");
    expect(cancelled?.commandCompleted).toBe(true);
  });
});
