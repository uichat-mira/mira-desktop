import { describe, expect, it } from "vitest";
import {
  normalizeMutationLockKeys,
  withMutationLocks,
} from "./locks.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe("file mutation locks", () => {
  it("normalizes, deduplicates and sorts a batch lock scope deterministically", () => {
    expect(
      normalizeMutationLockKeys([
        "/workspace/b.txt",
        "/workspace/a.txt",
        "/workspace/b.txt",
      ]),
    ).toEqual([
      normalizeMutationLockKeys(["/workspace/a.txt"])[0],
      normalizeMutationLockKeys(["/workspace/b.txt"])[0],
    ]);
  });
  it("serializes same-path mutations in call order", async () => {
    const order: string[] = [];
    const firstEntered = deferred();
    const releaseFirst = deferred();

    const first = withMutationLocks(
      ["/workspace/a.txt"],
      undefined,
      async () => {
        order.push("first:start");
        firstEntered.resolve();
        await releaseFirst.promise;
        order.push("first:end");
      },
    );

    await firstEntered.promise;

    const second = withMutationLocks(
      ["/workspace/a.txt"],
      undefined,
      async () => {
        order.push("second:start");
        order.push("second:end");
      },
    );

    expect(order).toEqual(["first:start"]);

    releaseFirst.resolve();
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
    const firstEntered = deferred();
    const releaseFirst = deferred();

    const first = withMutationLocks(
      ["/workspace/b", "/workspace/a"],
      undefined,
      async () => {
        order.push("first");
        firstEntered.resolve();
        await releaseFirst.promise;
      },
    );

    await firstEntered.promise;

    const second = withMutationLocks(
      ["/workspace/a", "/workspace/b"],
      undefined,
      async () => {
        order.push("second");
      },
    );

    expect(order).toEqual(["first"]);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
