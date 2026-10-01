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
import {
  CODEX_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  PIAGENT_ADAPTER_ID,
} from "../builder-contract.js";
import {
  createProjectBatch,
} from "../project/project-task-actions.js";
import { registerForgeProject } from "../project/project-registry.js";
import { createForgeRuntimeStore } from "../runtime/store.js";
import { createMainThread } from "../main-thread/domain.js";
import type {
  BuilderExitResult,
  BuilderProcessHandle,
  BuilderProviderEvent,
  BuilderRunner,
  BuilderStartInput,
} from "../adapters/builder/types.js";
import { createDispatchManager } from "./manager.js";

const artifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.test-artifact/forge-t006-dispatch",
);

class ControlledRunner implements BuilderRunner {
  input: BuilderStartInput | null = null;
  killed: NodeJS.Signals[] = [];

  constructor(private readonly killResult = true) {}

  start(input: BuilderStartInput): BuilderProcessHandle {
    this.input = input;
    return {
      pid: 4242,
      kill: (signal: NodeJS.Signals = "SIGTERM") => {
        this.killed.push(signal);
        return this.killResult;
      },
    };
  }

  started(pid = 4242): void {
    this.input?.onStarted?.({ pid });
  }

  event(event: BuilderProviderEvent): void {
    this.input?.onEvent?.(event);
  }

  exit(
    result: Partial<BuilderExitResult> = {},
  ): void {
    this.input?.onExit?.({
      code: result.code ?? 0,
      signal: result.signal ?? null,
      stderr: result.stderr ?? "",
      resultText: result.resultText ?? "builder result",
      errorText: result.errorText ?? null,
    });
  }

  error(error: unknown, stderr = ""): void {
    this.input?.onError?.(error, { stderr });
  }
}

async function createFixture(taskIds = ["T100", "T101", "T102"]) {
  await mkdir(artifactRoot, { recursive: true });
  const root = await mkdtemp(path.join(artifactRoot, "case-"));
  const taskDir = path.join(root, "docs", "tasks");
  await mkdir(taskDir, { recursive: true });

  const ledger = [
    "| ID | Task | Status |",
    "| --- | --- | --- |",
    ...taskIds.map(
      (id, index) =>
        "| " +
        id +
        " | Task " +
        String(index + 1) +
        " | TODO |",
    ),
    "",
  ].join("\n");
  await writeFile(path.join(root, "TASKS.md"), ledger, "utf8");

  for (const [index, id] of taskIds.entries()) {
    await writeFile(
      path.join(taskDir, id + "-task.md"),
      [
        "# " + id + " — Task " + String(index + 1),
        "",
        "Status: TODO",
        "",
        "## Goal",
        "Repository truth for " + id,
        "",
      ].join("\n"),
      "utf8",
    );
  }

  const store = createForgeRuntimeStore(
    path.join(root, ".runtime", "state.json"),
  );
  await registerForgeProject(store, {
    id: "P-1",
    name: "Fixture",
    rootPath: root,
    taskLedger: "TASKS.md",
    taskDir: "docs/tasks",
    integrationBranch: "dev",
  });
  const batch = await createProjectBatch(store, "P-1", {
    name: "Fixture batch",
    taskIds,
  });
  const sourceThreadId = await store.mutate((state) =>
    createMainThread(state, {
      id: "MT-source",
      projectId: "P-1",
      adapter: "codex",
    }).id,
  );

  return { root, taskDir, store, batch, sourceThreadId };
}

async function flush(store: ReturnType<typeof createForgeRuntimeStore>) {
  await store.flush();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await store.flush();
}

describe("Forge Builder dispatch manager", () => {
  it("runs all three Builder choices through one durable contract", async () => {
    const { root, store, batch, sourceThreadId } = await createFixture();
    try {
      const opencode = new ControlledRunner();
      const piagent = new ControlledRunner();
      const codex = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([
          [OPENCODE_ADAPTER_ID, opencode],
          [PIAGENT_ADAPTER_ID, piagent],
          [CODEX_ADAPTER_ID, codex],
        ]),
      });

      const cases = [
        {
          taskId: "T100",
          builder: "opencode",
          adapterId: OPENCODE_ADAPTER_ID,
          runner: opencode,
          externalSessionId: "oc-session",
        },
        {
          taskId: "T101",
          builder: "piagent",
          adapterId: PIAGENT_ADAPTER_ID,
          runner: piagent,
          externalSessionId: "pi-session",
        },
        {
          taskId: "T102",
          builder: "codex",
          adapterId: CODEX_ADAPTER_ID,
          runner: codex,
          externalSessionId: "codex-thread",
        },
      ] as const;

      for (const item of cases) {
        const dispatch = await manager.dispatchTask({
          batchId: batch.id,
          taskId: item.taskId,
          builder: item.builder,
          sourceThreadId,
        });
        expect(dispatch.adapterId).toBe(item.adapterId);
        expect(dispatch.taskRef).toContain(item.taskId);

        item.runner.started();
        item.runner.event({
          externalSessionId: item.externalSessionId,
          provider: {
            adapter: item.builder,
            eventType: "tool.started",
            itemType: "tool",
            status: "running",
          },
          tool: {
            name: "read",
            status: "running",
          },
        });
        item.runner.exit({
          code: 0,
          resultText: item.builder + " completed",
        });
        await flush(store);

        const state = await store.read();
        const durable = state.dispatches.find(
          (value) => value.id === dispatch.id,
        );
        const task = state.batches
          .find((value) => value.id === batch.id)
          ?.tasks.find((value) => value.id === item.taskId);
        const session = state.sessions.find(
          (value) => value.id === dispatch.sessionId,
        );

        expect(durable?.status).toBe("completed");
        expect(durable?.externalSessionId).toBe(
          item.externalSessionId,
        );
        expect(durable?.resultText).toBe(
          item.builder + " completed",
        );
        expect(session?.status).toBe("completed");
        expect(session?.externalSessionId).toBe(
          item.externalSessionId,
        );
        expect(task?.status).toBe("reviewing");
        expect(task?.builder).toBe(item.adapterId);
        expect(
          state.events.some(
            (event) =>
              event.dispatchId === dispatch.id &&
              event.type === "dispatch.provider_event",
          ),
        ).toBe(true);
        const resultHandoffs = state.threadEvents.filter(
          (event) =>
            event.threadId === sourceThreadId &&
            event.type === "handoff" &&
            event.handoff?.kind === "builder_result" &&
            event.handoff.dispatchId === dispatch.id,
        );
        expect(resultHandoffs).toHaveLength(1);
        const result = resultHandoffs[0]?.handoff;
        expect(result?.kind).toBe("builder_result");
        if (result?.kind === "builder_result") {
          expect(result.dispatchStatus).toBe("completed");
          expect(result.sessionStatus).toBe("completed");
          expect(result.taskStatus).toBe("reviewing");
          expect(result.resultText).toBe(item.builder + " completed");
        }
      }

      const repositoryCard = await readFile(
        path.join(root, "docs", "tasks", "T100-task.md"),
        "utf8",
      );
      expect(repositoryCard).toContain("Status: TODO");
      expect(repositoryCard).not.toContain("PASS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces one global active Builder lane and releases it after cancel", async () => {
    const { root, store, batch } = await createFixture(["T100", "T101"]);
    try {
      const opencode = new ControlledRunner();
      const piagent = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([
          [OPENCODE_ADAPTER_ID, opencode],
          [PIAGENT_ADAPTER_ID, piagent],
        ]),
      });

      const first = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
      });

      await expect(
        manager.dispatchTask({
          batchId: batch.id,
          taskId: "T101",
          builder: "piagent",
        }),
      ).rejects.toThrow(/builder dispatch already active/);

      await manager.cancelDispatch(first.id);
      expect(opencode.killed).toEqual(["SIGTERM"]);

      const second = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T101",
        builder: "piagent",
      });
      expect(second.adapterId).toBe(PIAGENT_ADAPTER_ID);
      await manager.cancelDispatch(second.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not forge cancelled state when live process termination fails", async () => {
    const { root, store, batch } = await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner(false);
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
      });
      runner.started();
      await flush(store);

      await expect(
        manager.cancelDispatch(dispatch.id),
      ).rejects.toThrow(/failed to terminate live Builder process/);

      let state = await store.read();
      let durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      expect(durable?.status).toBe("running");
      expect(
        state.events.some(
          (event) =>
            event.dispatchId === dispatch.id &&
            event.type === "dispatch.warning" &&
            event.data.code === "cancel_signal_failed",
        ),
      ).toBe(true);

      runner.exit({ code: 0, resultText: "real terminal result" });
      await flush(store);
      state = await store.read();
      durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      expect(durable?.status).toBe("completed");
      expect(state.batches[0]?.tasks[0]?.status).toBe("reviewing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists explicit cancel and ignores a late provider exit", async () => {
    const { root, store, batch, sourceThreadId } =
      await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
        sourceThreadId,
      });
      runner.started();
      await flush(store);

      const cancelled = await manager.cancelDispatch(dispatch.id);
      expect(cancelled.status).toBe("cancelled");
      expect(runner.killed).toEqual(["SIGTERM"]);

      runner.exit({
        code: 0,
        resultText: "late success must not win",
      });
      await flush(store);

      const state = await store.read();
      const durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      const session = state.sessions.find(
        (item) => item.id === dispatch.sessionId,
      );
      const task = state.batches[0]?.tasks[0];

      expect(durable?.status).toBe("cancelled");
      expect(durable?.resultText).toBeNull();
      expect(session?.status).toBe("disconnected");
      expect(task?.status).toBe("interrupted");
      const handoffs = state.threadEvents.filter(
        (event) =>
          event.threadId === sourceThreadId &&
          event.handoff?.kind === "builder_result" &&
          event.handoff.dispatchId === dispatch.id,
      );
      expect(handoffs).toHaveLength(1);
      const handoff = handoffs[0]?.handoff;
      if (handoff?.kind === "builder_result") {
        expect(handoff.dispatchStatus).toBe("cancelled");
        expect(handoff.sessionStatus).toBe("disconnected");
        expect(handoff.taskStatus).toBe("interrupted");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats provider-reported error as failure even with exit code zero", async () => {
    const { root, store, batch, sourceThreadId } =
      await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[CODEX_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "codex",
        sourceThreadId,
      });
      runner.started();
      runner.exit({
        code: 0,
        resultText: "partial result",
        errorText: "provider turn failed",
      });
      await flush(store);

      const state = await store.read();
      const durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      const session = state.sessions.find(
        (item) => item.id === dispatch.sessionId,
      );

      expect(durable?.status).toBe("failed");
      expect(durable?.exitCode).toBe(0);
      expect(durable?.error).toBe("provider turn failed");
      expect(session?.status).toBe("failed");
      expect(state.batches[0]?.tasks[0]?.status).toBe("interrupted");
      const handoffs = state.threadEvents.filter(
        (event) =>
          event.threadId === sourceThreadId &&
          event.handoff?.kind === "builder_result" &&
          event.handoff.dispatchId === dispatch.id,
      );
      expect(handoffs).toHaveLength(1);
      const handoff = handoffs[0]?.handoff;
      if (handoff?.kind === "builder_result") {
        expect(handoff.dispatchStatus).toBe("failed");
        expect(handoff.sessionStatus).toBe("failed");
        expect(handoff.taskStatus).toBe("interrupted");
        expect(handoff.resultText).toBe("partial result");
        expect(handoff.error).toBe("provider turn failed");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records spawn errors as structured terminal evidence", async () => {
    const { root, store, batch } = await createFixture(["T100"]);
    try {
      const runner: BuilderRunner = {
        start() {
          throw new Error("spawn ENOENT");
        },
      };
      const manager = createDispatchManager({
        store,
        runners: new Map([[PIAGENT_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "piagent",
      });
      await flush(store);

      const state = await store.read();
      const durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );

      expect(durable?.status).toBe("failed");
      expect(durable?.error).toContain("spawn ENOENT");
      expect(state.batches[0]?.tasks[0]?.status).toBe("interrupted");
      expect(
        state.events.some(
          (event) =>
            event.dispatchId === dispatch.id &&
            event.type === "dispatch.failed",
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reconciles lost supervision and ignores late callbacks after restart", async () => {
    const { root, store, batch, sourceThreadId } =
      await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
        sourceThreadId,
      });
      runner.started();
      await flush(store);

      expect(await manager.reconcile()).toBe(1);
      runner.event({
        externalSessionId: "late-session",
        provider: {
          adapter: "opencode",
          eventType: "late",
          status: "completed",
        },
      });
      runner.exit({
        code: 0,
        resultText: "late completion",
      });
      await flush(store);

      const state = await store.read();
      const durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      expect(durable?.status).toBe("interrupted");
      expect(durable?.error).toBe(
        "control plane restarted; process supervision was lost",
      );
      expect(durable?.externalSessionId).toBeNull();
      expect(state.batches[0]?.tasks[0]?.status).toBe("interrupted");
      expect(
        state.events.filter(
          (event) =>
            event.dispatchId === dispatch.id &&
            event.type === "dispatch.interrupted",
        ),
      ).toHaveLength(1);
      const handoffs = state.threadEvents.filter(
        (event) =>
          event.threadId === sourceThreadId &&
          event.handoff?.kind === "builder_result" &&
          event.handoff.dispatchId === dispatch.id,
      );
      expect(handoffs).toHaveLength(1);
      const handoff = handoffs[0]?.handoff;
      if (handoff?.kind === "builder_result") {
        expect(handoff.dispatchStatus).toBe("interrupted");
        expect(handoff.sessionStatus).toBe("disconnected");
        expect(handoff.taskStatus).toBe("interrupted");
        expect(handoff.error).toBe(
          "control plane restarted; process supervision was lost",
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes readiness reasons for status, active session and dependencies", async () => {
    const { root, store, batch } = await createFixture(["T100", "T101"]);
    try {
      await store.mutate((state) => {
        const targetBatch = state.batches.find(
          (item) => item.id === batch.id,
        );
        if (!targetBatch) throw new Error("batch missing");
        const dependency = targetBatch.tasks.find(
          (item) => item.id === "T100",
        );
        const target = targetBatch.tasks.find(
          (item) => item.id === "T101",
        );
        if (!dependency || !target) throw new Error("task missing");
        target.dependsOn = ["T100"];
      });

      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      let readiness = await manager.getReadiness(batch.id);
      expect(
        readiness.blocked
          .find((item) => item.taskId === "T101")
          ?.reasons.map((reason) => reason.code),
      ).toContain("dependency_not_integrated");

      await store.mutate((state) => {
        const task = state.batches
          .find((item) => item.id === batch.id)
          ?.tasks.find((item) => item.id === "T100");
        if (!task) throw new Error("task missing");
        task.status = "integrated";
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T101",
        builder: "opencode",
      });
      readiness = await manager.getReadiness(batch.id);
      const target = readiness.blocked.find(
        (item) => item.taskId === "T101",
      );
      expect(target?.reasons.map((reason) => reason.code)).toContain(
        "task_status",
      );
      expect(target?.reasons.map((reason) => reason.code)).toContain(
        "active_builder_session",
      );

      await manager.cancelDispatch(dispatch.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the canonical Task Card mandatory when inline instruction is supplied", async () => {
    const { root, store, batch } = await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
        prompt: "Check only the requested acceptance edge case.",
      });

      expect(runner.input?.prompt).toContain("## Must Read");
      expect(runner.input?.prompt).toContain("- AGENTS.md");
      expect(runner.input?.prompt).toContain(
        "- docs/tasks/T100-task.md",
      );
      expect(runner.input?.prompt).toContain(
        "## Additional Operator Instruction",
      );
      expect(runner.input?.prompt).toContain(
        "Check only the requested acceptance edge case.",
      );

      await manager.cancelDispatch(dispatch.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects mismatched task refs, cross-project source threads and missing selected runners", async () => {
    const { root, store, batch } = await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      await expect(
        manager.dispatchTask({
          batchId: batch.id,
          taskId: "T100",
          builder: "opencode",
          taskRef: "docs/tasks/not-T100.md",
        }),
      ).rejects.toThrow(/taskRef does not match repository Task Card/);

      await store.mutate((state) => {
        state.threads.push({
          id: "MT-other",
          projectId: "P-other",
          adapter: "codex",
          status: "idle",
          lastError: null,
          updatedAt: new Date().toISOString(),
        });
      });

      await expect(
        manager.dispatchTask({
          batchId: batch.id,
          taskId: "T100",
          builder: "opencode",
          sourceThreadId: "MT-other",
        }),
      ).rejects.toThrow(/does not match dispatch project/);

      await expect(
        manager.dispatchTask({
          batchId: batch.id,
          taskId: "T100",
          builder: "codex",
        }),
      ).rejects.toThrow(
        "no runner configured for adapter: " + CODEX_ADAPTER_ID,
      );

      const state = await store.read();
      expect(state.dispatches).toEqual([]);
      expect(state.sessions).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shutdown interrupts owned live handles and kills them exactly once", async () => {
    const { root, store, batch } = await createFixture(["T100"]);
    try {
      const runner = new ControlledRunner();
      const manager = createDispatchManager({
        store,
        runners: new Map([[OPENCODE_ADAPTER_ID, runner]]),
      });

      const dispatch = await manager.dispatchTask({
        batchId: batch.id,
        taskId: "T100",
        builder: "opencode",
      });
      runner.started();
      await flush(store);

      await manager.shutdown();
      expect(runner.killed).toEqual(["SIGTERM"]);

      const state = await store.read();
      const durable = state.dispatches.find(
        (item) => item.id === dispatch.id,
      );
      expect(durable?.status).toBe("interrupted");
      expect(durable?.error).toBe("control plane shutdown");
      expect(state.batches[0]?.tasks[0]?.status).toBe("interrupted");

      await manager.shutdown();
      expect(runner.killed).toEqual(["SIGTERM"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
