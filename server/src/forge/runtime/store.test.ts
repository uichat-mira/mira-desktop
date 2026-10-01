import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyForgeRuntimeState } from "./state.js";
import {
  createForgeRuntimeStore,
  normalizeForgeRuntimeState,
} from "./store.js";

const makeStateFile = async (prefix: string) => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, file: path.join(dir, "state.json") };
};

describe("Forge runtime store", () => {
  it("persists schema-1 runtime state and reopens non-active facts", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-");
    const store = createForgeRuntimeStore(file);

    await store.mutate((state) => {
      state.projects.push({
        id: "p1",
        name: "Demo",
        rootPath: "/tmp/demo",
        repository: null,
        taskLedger: null,
        taskDir: null,
        integrationBranch: "dev",
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      });
    });

    const reopened = await createForgeRuntimeStore(file).read();
    expect(reopened.schemaVersion).toBe(1);
    expect(reopened.projects.map((project) => project.id)).toEqual(["p1"]);
    expect(reopened.adapters).toEqual([]);
    expect(reopened.sessions).toEqual([]);
    expect(reopened.reviews).toEqual([]);
    expect(reopened.dispatches).toEqual([]);
    expect(reopened.events).toEqual([]);
    expect(reopened.threads).toEqual([]);
    expect(reopened.threadEvents).toEqual([]);
  });

  it("serializes concurrent mutations without losing updates", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-queue-");
    const store = createForgeRuntimeStore(file);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.mutate(async (state) => {
          await new Promise((resolve) => setTimeout(resolve, index % 2));
          state.events.push({
            id: `E-${index}`,
            type: "test.event",
            projectId: null,
            batchId: null,
            taskId: null,
            dispatchId: null,
            sessionId: null,
            data: { index },
            createdAt: new Date().toISOString(),
          });
        }),
      ),
    );

    await store.flush();
    const reopened = await createForgeRuntimeStore(file).read();
    expect(reopened.events).toHaveLength(8);
    expect(new Set(reopened.events.map((event) => event.id)).size).toBe(8);
  });

  it("uses temp-file rename without leaving temp artifacts after flush", async () => {
    const { dir, file } = await makeStateFile("mira-forge-runtime-atomic-");
    const store = createForgeRuntimeStore(file);
    await store.write(createEmptyForgeRuntimeState());
    await store.flush();

    expect((await readdir(dir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps schema-1 additive-array compatibility and rejects malformed arrays", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-legacy-");
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, projects: [], batches: [] }),
      "utf8",
    );

    const state = await createForgeRuntimeStore(file).read();
    expect(state.dispatches).toEqual([]);
    expect(state.threads).toEqual([]);

    expect(() =>
      normalizeForgeRuntimeState({
        schemaVersion: 1,
        projects: [],
        batches: [],
        dispatches: {},
      }),
    ).toThrow(/Unsupported or invalid Mira Forge state file/);
  });
});
