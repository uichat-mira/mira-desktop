import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerForgeProject } from "../project/project-registry.js";
import { createForgeRuntimeStore } from "../runtime/store.js";
import type {
  MainThreadAdapter,
  MainThreadAdapterTurnInput,
} from "../adapters/main-thread/types.js";
import { createMainThreadManager } from "./manager.js";

const artifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.test-artifact/forge-t005-main-thread",
);

async function fixture() {
  await mkdir(artifactRoot, { recursive: true });
  const root = await mkdtemp(path.join(artifactRoot, "case-"));
  const taskDir = path.join(root, "docs", "tasks");
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    path.join(root, "TASKS.md"),
    [
      "| ID | Task | Status |",
      "| --- | --- | --- |",
      "| T100 | Existing task | TODO |",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(taskDir, "T100-existing-task.md"),
    "# T100 — Existing task\n\nStatus: TODO\n",
    "utf8",
  );

  const store = createForgeRuntimeStore(
    path.join(root, ".runtime", "state.json"),
  );
  await registerForgeProject(store, {
    id: "P-1",
    name: "Fixture",
    rootPath: root,
    taskLedger: "TASKS.md",
    taskDir: "docs/tasks",
  });

  return { root, taskDir, store };
}

function fakeAdapter(
  id: MainThreadAdapter["id"],
  handler: (
    input: MainThreadAdapterTurnInput,
  ) => Promise<{
    externalThreadId: string;
    responseText: string;
    events?: Parameters<
      NonNullable<MainThreadAdapterTurnInput["onEvent"]>
    >[0][];
  }>,
): MainThreadAdapter {
  return {
    id,
    async runTurn(input) {
      const result = await handler(input);
      return {
        externalThreadId: result.externalThreadId,
        responseText: result.responseText,
        events: result.events ?? [],
        providerEventType: id + ".turn.completed",
      };
    },
  };
}

describe("Forge Main Thread manager", () => {
  it("keeps Main Thread state separate and resumes the exact durable provider thread", async () => {
    const { root, store } = await fixture();
    try {
      const seen: Array<string | null> = [];
      const adapter = fakeAdapter("opencode", async (input) => {
        seen.push(input.externalThreadId);
        return {
          externalThreadId: input.externalThreadId ?? "ses-durable-1",
          responseText: "read-only reply",
        };
      });
      const manager = createMainThreadManager({
        store,
        adapters: new Map([[adapter.id, adapter]]),
      });

      const opened = await manager.openThread({
        projectId: "P-1",
        adapter: "opencode",
      });
      const first = await manager.sendMessage(opened.id, {
        message: "inspect project",
      });
      expect(first.thread.externalThreadId).toBe("ses-durable-1");

      const reopenedStore = createForgeRuntimeStore(store.filePath);
      const reopened = createMainThreadManager({
        store: reopenedStore,
        adapters: new Map([[adapter.id, adapter]]),
      });
      const second = await reopened.sendMessage(opened.id, {
        message: "continue",
      });

      expect(seen).toEqual([null, "ses-durable-1"]);
      expect(second.thread.externalThreadId).toBe("ses-durable-1");
      expect(
        second.events.filter(
          (event) => event.type === "message" && event.role === "assistant",
        ),
      ).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a provider that silently switches the durable thread identity", async () => {
    const { root, store } = await fixture();
    try {
      let turn = 0;
      const adapter = fakeAdapter("codex", async () => {
        turn += 1;
        return {
          externalThreadId: turn === 1 ? "thr-1" : "thr-other",
          responseText: "reply",
        };
      });
      const manager = createMainThreadManager({
        store,
        adapters: new Map([[adapter.id, adapter]]),
      });
      const thread = await manager.openThread({
        projectId: "P-1",
        adapter: "codex",
      });

      await manager.sendMessage(thread.id, { message: "first" });
      await expect(
        manager.sendMessage(thread.id, { message: "second" }),
      ).rejects.toThrow(/provider resumed a different thread/);

      expect((await manager.getThread(thread.id)).thread.status).toBe("error");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats provider file-write evidence as a read-only contract violation", async () => {
    const { root, store } = await fixture();
    try {
      const adapter = fakeAdapter("opencode", async (input) => {
        await input.onEvent?.({
          type: "tool",
          tool: { name: "edit", status: "completed" },
          provider: { adapter: "opencode" },
        });
        return {
          externalThreadId: "ses-write-attempt",
          responseText: "changed file",
        };
      });
      const manager = createMainThreadManager({
        store,
        adapters: new Map([[adapter.id, adapter]]),
      });
      const thread = await manager.openThread({
        projectId: "P-1",
        adapter: "opencode",
      });

      await expect(
        manager.sendMessage(thread.id, { message: "inspect only" }),
      ).rejects.toThrow(/file-change attempt/);
      const snapshot = await manager.getThread(thread.id);
      expect(snapshot.thread.status).toBe("error");
      expect(snapshot.thread.lastError).toMatch(/read-only main thread/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses explicit Task capabilities and creates a handoff without dispatching", async () => {
    const { root, store } = await fixture();
    try {
      const adapter = fakeAdapter("codex", async () => ({
        externalThreadId: "thr-1",
        responseText: "reply",
      }));
      const manager = createMainThreadManager({
        store,
        adapters: new Map([[adapter.id, adapter]]),
      });
      const thread = await manager.openThread({
        projectId: "P-1",
        adapter: "codex",
      });

      expect((await manager.inspectTasks(thread.id)).tasks).toHaveLength(1);
      expect((await manager.resolveTask(thread.id, "T100")).taskRef).toBe(
        "docs/tasks/T100-existing-task.md",
      );

      const marker = "main-thread-task-body-must-stay-in-repository";
      const created = await manager.createTask(thread.id, {
        id: "T101",
        title: "Created explicitly",
        status: "TODO",
        body: "## Goal\n" + marker,
      });
      await manager.updateTask(thread.id, "T101", {
        status: "REVIEW",
      });
      const handoff = await manager.createHandoff(thread.id, {
        taskId: "T101",
        preferredBuilder: "opencode-local",
      });

      expect(handoff.type).toBe("handoff");
      expect(handoff.handoff).toEqual({
        projectId: "P-1",
        taskId: "T101",
        taskRef: created.taskRef,
        preferredBuilder: "opencode-local",
      });

      const state = await store.read();
      expect(state.dispatches).toEqual([]);
      expect(JSON.stringify(state)).not.toContain(marker);
      expect(
        await readFile(path.join(root, created.taskRef), "utf8"),
      ).toContain(marker);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconciles a lost active Main Thread turn to an explicit error", async () => {
    const { root, store } = await fixture();
    try {
      const adapter = fakeAdapter("codex", async () => ({
        externalThreadId: "thr-1",
        responseText: "unused",
      }));
      const manager = createMainThreadManager({
        store,
        adapters: new Map([[adapter.id, adapter]]),
      });
      const thread = await manager.openThread({
        projectId: "P-1",
        adapter: "codex",
      });

      await store.mutate((state) => {
        const target = state.threads.find((item) => item.id === thread.id);
        if (!target) throw new Error("thread missing");
        target.status = "running";
      });

      expect(await manager.reconcile()).toEqual([thread.id]);
      const snapshot = await manager.getThread(thread.id);
      expect(snapshot.thread.status).toBe("error");
      expect(snapshot.thread.lastError).toBe(
        "control plane restarted during an active turn",
      );
      expect(
        snapshot.events.some(
          (event) =>
            event.type === "status" &&
            event.text === "turn.interrupted: control plane restarted",
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
