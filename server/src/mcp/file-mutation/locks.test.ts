import { describe, expect, it } from "vitest";
import { withMutationLocks } from "./locks.js";

describe("file mutation locks", () => {
  it("serializes same-path mutations in call order", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withMutationLocks(["/workspace/a.txt"], undefined, async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });

    await Promise.resolve();

    const second = withMutationLocks(["/workspace/a.txt"], undefined, async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("sorts multi-path locks so reversed move pairs cannot deadlock", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withMutationLocks(
      ["/workspace/b", "/workspace/a"],
      undefined,
      async () => {
        order.push("first");
        await gate;
      },
    );

    await Promise.resolve();

    const second = withMutationLocks(
      ["/workspace/a", "/workspace/b"],
      undefined,
      async () => {
        order.push("second");
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["first"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
