import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBatch,
  createSession,
  registerAdapter,
  registerProject,
  updateSession,
  updateTask,
} from "../domain.js";
import {
  createDispatch,
  transitionDispatch,
} from "../dispatch-domain.js";
import { resolveForgeStateFileFromDatabaseUrl } from "./persistence.js";
import {
  ForgeRuntime,
  getActiveForgeRuntime,
  initializeForgeRuntime,
  resetForgeRuntimeForTests,
  shutdownForgeRuntime,
} from "./runtime.js";
import { createEmptyForgeRuntimeState } from "./state.js";
import { createForgeRuntimeStore } from "./store.js";

const makeStateFile = async (prefix: string) => {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, file: path.join(dir, "state.json") };
};

const createActiveRuntimeState = () => {
  const state = createEmptyForgeRuntimeState();
  const project = registerProject(state, {
    id: "P-1",
    name: "Demo",
    rootPath: "/tmp/demo",
  });
  const batch = createBatch(state, {
    id: "B-1",
    projectId: project.id,
    tasks: [{ id: "T001", title: "Runtime lifecycle" }],
  });
  const adapter = registerAdapter(state, {
    id: "builder-local",
    name: "Builder",
    kind: "builder",
    status: "busy",
  });
  const session = createSession(state, {
    id: "S-1",
    role: "builder",
    adapterId: adapter.id,
    projectId: project.id,
    batchId: batch.id,
    taskId: "T001",
  });
  updateSession(state, session.id, { status: "running" });
  updateTask(state, batch.id, "T001", {
    status: "building",
    currentSha: "abc",
  });
  const dispatch = createDispatch(state, {
    id: "D-1",
    projectId: project.id,
    batchId: batch.id,
    taskId: "T001",
    adapterId: adapter.id,
    sessionId: session.id,
  });
  transitionDispatch(state, dispatch.id, "running", {
    externalSessionId: "external-1",
    pid: 42,
  });

  state.threads.push({
    id: "MT-1",
    projectId: project.id,
    adapter: "opencode",
    status: "running",
    lastError: null,
    updatedAt: "2026-09-06T00:00:00.000Z",
  });

  return state;
};

describe("Forge runtime persistence ownership", () => {
  it("derives Forge state under Mira's durable database directory", () => {
    const databasePath = path.join(
      path.parse(process.cwd()).root,
      "mira-data",
      "uichat-rag-test.db",
    );
    expect(resolveForgeStateFileFromDatabaseUrl(`file:${databasePath}`)).toBe(
      path.join(path.dirname(path.resolve(databasePath)), "forge", "state.json"),
    );
  });

  it("rejects non-durable database roots instead of falling back to cwd", () => {
    expect(() => resolveForgeStateFileFromDatabaseUrl("")).toThrow(
      /DATABASE_URL is required/,
    );
    expect(() => resolveForgeStateFileFromDatabaseUrl("file::memory:")).toThrow(
      /durable SQLite DATABASE_URL/,
    );
    expect(() => resolveForgeStateFileFromDatabaseUrl("file:./relative.db")).toThrow(
      /absolute Mira SQLite DATABASE_URL/,
    );
  });
});

describe("Forge runtime startup reconcile", () => {
  it("interrupts active dispatch and Main Thread state after supervision is lost", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-reconcile-");
    const store = createForgeRuntimeStore(file);
    await store.write(createActiveRuntimeState());

    const runtime = new ForgeRuntime({ store });
    const report = await runtime.initialize();
    const state = await store.read();

    expect(report.reconcile.interruptedDispatchIds).toEqual(["D-1"]);
    expect(report.reconcile.interruptedThreadIds).toEqual(["MT-1"]);

    expect(state.dispatches[0]?.status).toBe("interrupted");
    expect(state.dispatches[0]?.error).toMatch(/process supervision was lost/);
    expect(state.sessions[0]?.status).toBe("disconnected");
    expect(state.batches[0]?.tasks[0]?.status).toBe("interrupted");
    expect(state.adapters[0]?.status).toBe("offline");

    expect(state.threads[0]?.status).toBe("error");
    expect(state.threads[0]?.lastError).toBe(
      "control plane restarted during an active turn",
    );
    expect(
      state.events.some(
        (event) =>
          event.type === "dispatch.interrupted" &&
          event.dispatchId === "D-1" &&
          event.data.reason === "control_plane_restart",
      ),
    ).toBe(true);
    expect(
      state.threadEvents.some(
        (event) =>
          event.threadId === "MT-1" &&
          event.type === "status" &&
          event.text === "turn.interrupted: control plane restarted",
      ),
    ).toBe(true);

    await runtime.shutdown();
  });

  it("preserves already-terminal durable facts across restart", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-terminal-");
    const state = createActiveRuntimeState();
    transitionDispatch(state, "D-1", "completed", {
      exitCode: 0,
      resultText: "done",
    });
    state.sessions[0]!.status = "completed";
    state.batches[0]!.tasks[0]!.status = "reviewing";
    state.threads[0]!.status = "idle";
    const store = createForgeRuntimeStore(file);
    await store.write(state);

    const runtime = new ForgeRuntime({ store });
    const report = await runtime.initialize();
    const reopened = await store.read();

    expect(report.reconcile.interruptedDispatchIds).toEqual([]);
    expect(report.reconcile.interruptedThreadIds).toEqual([]);
    expect(reopened.dispatches[0]?.status).toBe("completed");
    expect(reopened.dispatches[0]?.resultText).toBe("done");
    expect(reopened.batches[0]?.tasks[0]?.status).toBe("reviewing");

    await runtime.shutdown();
  });
});

describe("Forge runtime lifecycle ownership", () => {
  it("reconciles pre-registered resources once across concurrent initialize calls", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-init-once-");
    const runtime = new ForgeRuntime({ stateFile: file });
    let reconciled = 0;

    await runtime.registerResource("pre-init-manager", {
      async reconcile() {
        reconciled += 1;
      },
    });

    const [first, second] = await Promise.all([
      runtime.initialize(),
      runtime.initialize(),
    ]);

    expect(first).toEqual(second);
    expect(reconciled).toBe(1);

    await runtime.shutdown();
  });

  it("blocks new resources while shutdown is in progress", async () => {
    const { file } = await makeStateFile("mira-forge-runtime-shutdown-race-");
    const runtime = new ForgeRuntime({ stateFile: file });
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>((resolve) => {
      releaseShutdown = resolve;
    });

    await runtime.initialize();
    await runtime.registerResource("slow-manager", {
      async shutdown() {
        await shutdownGate;
      },
    });

    const closing = runtime.shutdown();
    await expect(
      runtime.registerResource("late-manager", {}),
    ).rejects.toThrow(/closing or already closed/);
    await expect(runtime.initialize()).rejects.toThrow(
      /closing or already closed/,
    );

    releaseShutdown();
    await closing;
  });

  it("keeps one active Mira-owned runtime and shuts registered resources down once", async () => {
    resetForgeRuntimeForTests();
    const { file } = await makeStateFile("mira-forge-runtime-singleton-");
    let reconciled = 0;
    let shutdown = 0;

    const first = await initializeForgeRuntime({ stateFile: file });
    await first.registerResource("provider-manager", {
      async reconcile() {
        reconciled += 1;
      },
      async shutdown() {
        shutdown += 1;
      },
    });
    const second = await initializeForgeRuntime({ stateFile: file });

    expect(second).toBe(first);
    expect(getActiveForgeRuntime()).toBe(first);
    expect(reconciled).toBe(1);

    await shutdownForgeRuntime();
    await shutdownForgeRuntime();

    expect(shutdown).toBe(1);
    expect(getActiveForgeRuntime()).toBeNull();
  });
});
