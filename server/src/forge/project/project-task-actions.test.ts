import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createForgeRuntimeStore } from "../runtime/store.js";
import {
  createProjectBatch,
  createProjectRepositoryTask,
  inspectProjectTaskSource,
  resolveProjectTask,
  updateProjectRepositoryTask,
} from "./project-task-actions.js";
import {
  getForgeProject,
  registerForgeProject,
  updateForgeProject,
} from "./project-registry.js";

const testArtifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.test-artifact/forge-t004-project",
);

async function makeTestRoot(prefix: string): Promise<string> {
  await mkdir(testArtifactRoot, { recursive: true });
  return mkdtemp(path.join(testArtifactRoot, prefix));
}

async function fixture() {
  const root = await makeTestRoot("case-");
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
  const store = createForgeRuntimeStore(path.join(root, ".forge-test", "state.json"));
  return { root, taskDir, store };
}

describe("Forge project registry", () => {
  it("registers a real project only after its configured task source validates", async () => {
    const { root, store } = await fixture();
    try {
      const result = await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
        repository: "dangjingtao/fixture",
        integrationBranch: "test",
        taskLedger: "TASKS.md",
        taskDir: "docs/tasks",
      });

      expect(result.project.id).toBe("P-1");
      expect(result.project.integrationBranch).toBe("test");
      expect(result.source?.tasks.map((task) => task.id)).toEqual(["T100"]);
      expect((await getForgeProject(store, "P-1")).taskLedger).toBe("TASKS.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects wrong roots and invalid source configuration before persistence", async () => {
    const { root, store } = await fixture();
    try {
      await expect(
        registerForgeProject(store, {
          id: "P-bad-root",
          name: "Bad root",
          rootPath: path.join(root, "missing"),
        }),
      ).rejects.toThrow(/project root is unavailable/);

      await expect(
        registerForgeProject(store, {
          id: "P-bad-source",
          name: "Bad source",
          rootPath: root,
          taskLedger: "missing.md",
          taskDir: "docs/tasks",
        }),
      ).rejects.toThrow(/task ledger is unavailable/);

      expect((await store.read()).projects).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not infer legacy task-source defaults for unconfigured projects", async () => {
    const { root, store } = await fixture();
    try {
      const result = await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
      });
      expect(result.source).toBeNull();
      expect(result.project.taskLedger).toBeNull();
      expect(result.project.taskDir).toBeNull();

      await expect(inspectProjectTaskSource(store, "P-1")).rejects.toThrow(
        /project task source is not configured/,
      );

      const configured = await updateForgeProject(store, "P-1", {
        taskLedger: "TASKS.md",
        taskDir: "docs/tasks",
      });
      expect(configured.source?.tasks.map((task) => task.id)).toEqual(["T100"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves concurrent updates to different project fields", async () => {
    const { root, store } = await fixture();
    try {
      await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
      });

      await Promise.all([
        updateForgeProject(store, "P-1", { name: "Renamed" }),
        updateForgeProject(store, "P-1", { integrationBranch: "release" }),
      ]);

      const project = await getForgeProject(store, "P-1");
      expect(project.name).toBe("Renamed");
      expect(project.integrationBranch).toBe("release");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate registered roots", async () => {
    const { root, store } = await fixture();
    try {
      await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
      });
      await expect(
        registerForgeProject(store, {
          id: "P-2",
          name: "Duplicate",
          rootPath: root,
        }),
      ).rejects.toThrow(/project root is already registered/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Forge project task actions", () => {
  it("inspects, resolves, creates and updates repository tasks without copying card body into runtime", async () => {
    const { root, store } = await fixture();
    try {
      await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
        taskLedger: "TASKS.md",
        taskDir: "docs/tasks",
      });

      expect((await inspectProjectTaskSource(store, "P-1")).tasks).toHaveLength(1);
      expect((await resolveProjectTask(store, "P-1", "T100")).taskRef).toBe(
        "docs/tasks/T100-existing-task.md",
      );

      const marker = "repository-body-must-not-enter-runtime-state";
      const created = await createProjectRepositoryTask(store, "P-1", {
        id: "T101",
        title: "Second task",
        status: "TODO",
        body: "## Goal\n" + marker,
      });
      expect(created.taskRef).toBe("docs/tasks/T101-second-task.md");

      const updated = await updateProjectRepositoryTask(
        store,
        "P-1",
        "T101",
        { title: "Second task refined", status: "REVIEW" },
      );
      expect(updated.status).toBe("REVIEW");

      const batch = await createProjectBatch(store, "P-1", {
        name: "Smoke",
        taskIds: ["T101"],
      });
      expect(batch.tasks[0]?.id).toBe("T101");
      expect(batch.tasks[0]?.title).toBe("Second task refined");
      expect(batch.tasks[0]?.status).toBe("waiting");

      const runtimeJson = JSON.stringify(await store.read());
      expect(runtimeJson).not.toContain(marker);
      expect(runtimeJson).not.toContain("## Goal");

      const card = await readFile(path.join(root, created.taskRef), "utf8");
      expect(card).toContain(marker);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate active runtime bindings for the same repository task", async () => {
    const { root, store } = await fixture();
    try {
      await registerForgeProject(store, {
        id: "P-1",
        name: "Fixture",
        rootPath: root,
        taskLedger: "TASKS.md",
        taskDir: "docs/tasks",
      });
      await createProjectBatch(store, "P-1", { taskIds: ["T100"] });
      await expect(
        createProjectBatch(store, "P-1", { taskIds: ["T100"] }),
      ).rejects.toThrow(/already exists in an active batch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
