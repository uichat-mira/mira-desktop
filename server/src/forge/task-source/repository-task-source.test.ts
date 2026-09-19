import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ForgeProject } from "../types.js";
import { RepositoryTaskSource } from "./repository-task-source.js";

const testArtifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.test-artifact/forge-t004-task-source",
);

async function makeTestRoot(prefix: string): Promise<string> {
  await mkdir(testArtifactRoot, { recursive: true });
  return mkdtemp(path.join(testArtifactRoot, prefix));
}

async function fixture() {
  const root = await makeTestRoot("case-");
  const taskDir = path.join(root, "docs", "tasks");
  await mkdir(taskDir, { recursive: true });
  const ledgerPath = path.join(root, "TASKS.md");
  await writeFile(
    ledgerPath,
    [
      "| ID | Task | Status | Evidence |",
      "| --- | --- | --- | --- |",
      "| T100 | First task | TODO | keep \\| this |",
      "| T101 | 本地化任务 | 待评审 | |",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(taskDir, "T100-first-task.md"),
    "# T100 — First task\n\nStatus: TODO\n\n## Goal\nKeep truth in repo.\n",
    "utf8",
  );
  await writeFile(
    path.join(taskDir, "T101-localized.md"),
    "# T101：本地化任务\n\n状态：**待评审**\n",
    "utf8",
  );

  const project: ForgeProject = {
    id: "P-1",
    name: "Fixture",
    rootPath: root,
    repository: null,
    taskLedger: "TASKS.md",
    taskDir: "docs/tasks",
    integrationBranch: "dev",
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
  return { root, taskDir, ledgerPath, project };
}

describe("Repository Task Source", () => {
  it("inspects canonical and localized cards without mutating repository truth", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const beforeLedger = await readFile(ledgerPath, "utf8");
      const beforeFiles = (await readdir(taskDir)).sort();

      const source = await new RepositoryTaskSource().inspect(project);

      expect(source.tasks.map((task) => task.id)).toEqual(["T100", "T101"]);
      expect(source.tasks[1]?.cardStatus).toBe("待评审");
      expect(source.tasks[1]?.warnings).toEqual([]);
      expect(await readFile(ledgerPath, "utf8")).toBe(beforeLedger);
      expect((await readdir(taskDir)).sort()).toEqual(beforeFiles);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces ledger/card drift as warnings without repairing it", async () => {
    const { root, taskDir, project } = await fixture();
    try {
      await writeFile(
        path.join(taskDir, "T100-first-task.md"),
        "# T100 — Changed title\n\nStatus: REVIEW\n",
        "utf8",
      );

      const resolved = await new RepositoryTaskSource().resolve(project, "T100");

      expect(resolved.status).toBe("TODO");
      expect(resolved.cardStatus).toBe("REVIEW");
      expect(resolved.warnings).toEqual([
        "ledger status TODO differs from task card status REVIEW",
        "ledger title differs from task card title",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves unrelated drift during partial updates", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      await writeFile(
        path.join(taskDir, "T100-first-task.md"),
        "# T100 — Card-only title\n\nStatus: REVIEW\n",
        "utf8",
      );

      const updated = await new RepositoryTaskSource().update(
        project,
        "T100",
        { status: "DOING" },
      );

      const ledger = await readFile(ledgerPath, "utf8");
      const card = await readFile(
        path.join(taskDir, "T100-first-task.md"),
        "utf8",
      );
      expect(ledger).toContain("| T100 | First task | DOING |");
      expect(card).toContain("# T100 — Card-only title");
      expect(card).toContain("Status: DOING");
      expect(updated.warnings).toEqual(["ledger title differs from task card title"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate ledger IDs, missing cards and duplicate cards", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      await writeFile(
        ledgerPath,
        [
          "| ID | Task | Status |",
          "| --- | --- | --- |",
          "| T100 | First task | TODO |",
          "| T100 | Duplicate | TODO |",
          "",
        ].join("\n"),
        "utf8",
      );
      await expect(new RepositoryTaskSource().inspect(project)).rejects.toThrow(
        /appears more than once/,
      );

      await writeFile(
        ledgerPath,
        [
          "| ID | Task | Status |",
          "| --- | --- | --- |",
          "| T404 | Missing | TODO |",
          "",
        ].join("\n"),
        "utf8",
      );
      await expect(new RepositoryTaskSource().inspect(project)).rejects.toThrow(
        /task card not found/,
      );

      await writeFile(
        ledgerPath,
        [
          "| ID | Task | Status |",
          "| --- | --- | --- |",
          "| T100 | First task | TODO |",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(taskDir, "T100-other.md"),
        "# T100 — Other\n\nStatus: TODO\n",
        "utf8",
      );
      await expect(new RepositoryTaskSource().inspect(project)).rejects.toThrow(
        /multiple task cards match T100/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects task source and task identity escape attempts", async () => {
    const { root, project } = await fixture();
    try {
      await expect(
        new RepositoryTaskSource().resolve(
          { ...project, taskLedger: "../outside.md" },
          "T100",
        ),
      ).rejects.toThrow(/escapes project root/);
      await expect(
        new RepositoryTaskSource().resolve(project, "../T100"),
      ).rejects.toThrow(/unsupported characters/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked task sources that escape the registered project root", async () => {
    if (process.platform === "win32") return;

    const { root, project } = await fixture();
    const outside = await makeTestRoot("outside-");
    try {
      const outsideLedger = path.join(outside, "outside.md");
      await writeFile(
        outsideLedger,
        [
          "| ID | Task | Status |",
          "| --- | --- | --- |",
          "| T100 | Outside | TODO |",
          "",
        ].join("\n"),
        "utf8",
      );
      await symlink(outsideLedger, path.join(root, "linked-ledger.md"));

      await expect(
        new RepositoryTaskSource().resolve(
          { ...project, taskLedger: "linked-ledger.md" },
          "T100",
        ),
      ).rejects.toThrow(/escapes project root/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("creates and updates repository truth while preserving unrelated columns and prose", async () => {
    const { root, ledgerPath, project } = await fixture();
    try {
      const source = new RepositoryTaskSource();
      const created = await source.create(project, {
        id: "T102",
        title: "Third task",
        status: "TODO",
        body: "## Goal\nbody-marker",
      });
      expect(created.taskRef).toBe("docs/tasks/T102-third-task.md");

      const updated = await source.update(project, "T102", {
        title: "Third task refined",
        status: "REVIEW",
      });
      expect(updated.title).toBe("Third task refined");
      expect(updated.status).toBe("REVIEW");

      const ledger = await readFile(ledgerPath, "utf8");
      const card = await readFile(path.join(root, created.taskRef), "utf8");
      expect(ledger).toContain("| T102 | Third task refined | REVIEW |  |");
      expect(ledger).toContain("keep \\| this");
      expect(card).toContain("## Goal\nbody-marker");
      expect(card).toContain("# T102 — Third task refined");
      expect(card).toContain("Status: REVIEW");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inserts dollar-sign title and status values literally", async () => {
    const { root, taskDir, project } = await fixture();
    try {
      const source = new RepositoryTaskSource();
      await source.update(project, "T100", {
        title: "Dollar   it("refuses repository writes while existing task truth is malformed", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      await rm(path.join(taskDir, "T101-localized.md"));

      const source = new RepositoryTaskSource();
      await expect(
        source.create(project, { id: "T102", title: "Should not write", status: "TODO" }),
      ).rejects.toThrow(/task card not found for T101/);

      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
      expect(await readFile(ledgerPath, "utf8")).not.toContain("T102");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card creation when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.create(project, { id: "T102", title: "Rollback", status: "TODO" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the original ledger error when rollback also fails", async () => {
    const { root, project } = await fixture();
    try {
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2) {
          throw new Error("injected ledger failure");
        }
        if (writeCount === 3) {
          throw new Error("injected rollback failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      let caught: unknown;
      try {
        await source.update(project, "T100", { status: "REVIEW" });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AggregateError);
      const errors = (caught as AggregateError).errors as unknown[];
      expect(errors.map((error) => error instanceof Error ? error.message : String(error))).toEqual([
        "injected ledger failure",
        "injected rollback failure",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card update when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const cardPath = path.join(taskDir, "T100-first-task.md");
      const originalCard = await readFile(cardPath, "utf8");
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.update(project, "T100", { status: "REVIEW" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(cardPath, "utf8")).toBe(originalCard);
      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
 $ literal",
        status: "STATE-  it("refuses repository writes while existing task truth is malformed", async () => {-$",
      });

      const card = await readFile(
        path.join(taskDir, "T100-first-task.md"),
        "utf8",
      );
      expect(card).toContain("# T100 — Dollar   it("refuses repository writes while existing task truth is malformed", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      await rm(path.join(taskDir, "T101-localized.md"));

      const source = new RepositoryTaskSource();
      await expect(
        source.create(project, { id: "T102", title: "Should not write", status: "TODO" }),
      ).rejects.toThrow(/task card not found for T101/);

      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
      expect(await readFile(ledgerPath, "utf8")).not.toContain("T102");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card creation when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.create(project, { id: "T102", title: "Rollback", status: "TODO" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card update when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const cardPath = path.join(taskDir, "T100-first-task.md");
      const originalCard = await readFile(cardPath, "utf8");
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.update(project, "T100", { status: "REVIEW" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(cardPath, "utf8")).toBe(originalCard);
      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
 $ literal");
      expect(card).toContain("Status: STATE-  it("refuses repository writes while existing task truth is malformed", async () => {-$");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent writes for the same project", async () => {
    const { root, project } = await fixture();
    try {
      const source = new RepositoryTaskSource();
      await Promise.all([
        source.create(project, {
          id: "T102",
          title: "Concurrent A",
          status: "TODO",
        }),
        source.create(project, {
          id: "T103",
          title: "Concurrent B",
          status: "TODO",
        }),
      ]);

      const inspection = await source.inspect(project);
      expect(inspection.tasks.map((task) => task.id)).toEqual([
        "T100",
        "T101",
        "T102",
        "T103",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses repository writes while existing task truth is malformed", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      await rm(path.join(taskDir, "T101-localized.md"));

      const source = new RepositoryTaskSource();
      await expect(
        source.create(project, { id: "T102", title: "Should not write", status: "TODO" }),
      ).rejects.toThrow(/task card not found for T101/);

      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
      expect(await readFile(ledgerPath, "utf8")).not.toContain("T102");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card creation when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.create(project, { id: "T102", title: "Rollback", status: "TODO" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
      expect((await readdir(taskDir)).some((name) => name.startsWith("T102"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back card update when ledger write fails", async () => {
    const { root, taskDir, ledgerPath, project } = await fixture();
    try {
      const cardPath = path.join(taskDir, "T100-first-task.md");
      const originalCard = await readFile(cardPath, "utf8");
      const originalLedger = await readFile(ledgerPath, "utf8");
      let writeCount = 0;
      const source = new RepositoryTaskSource(async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 2 && filePath === ledgerPath) {
          throw new Error("injected ledger write failure");
        }
        await writeFile(filePath, content, "utf8");
      });

      await expect(
        source.update(project, "T100", { status: "REVIEW" }),
      ).rejects.toThrow(/injected ledger write failure/);

      expect(await readFile(cardPath, "utf8")).toBe(originalCard);
      expect(await readFile(ledgerPath, "utf8")).toBe(originalLedger);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
