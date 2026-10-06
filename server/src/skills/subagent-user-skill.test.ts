import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSubAgentExecutionProfile } from "./agent/profiles.js";
import { SkillScanner } from "./context/scanner.js";
import {
  importMarkdownSkill,
  setUserSkillEnabled,
} from "./user-skills.js";

const tempDirs: string[] = [];
const originalUserSkillsRoot = process.env.MIRA_USER_SKILLS_ROOT;

afterEach(async () => {
  if (originalUserSkillsRoot === undefined) {
    delete process.env.MIRA_USER_SKILLS_ROOT;
  } else {
    process.env.MIRA_USER_SKILLS_ROOT = originalUserSkillsRoot;
  }
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

const createUserRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-subagent-skill-"));
  tempDirs.push(root);
  process.env.MIRA_USER_SKILLS_ROOT = root;
  return root;
};

describe("uploaded Skill -> subAgent contract", () => {
  it("keeps the author content and appends only missing executable-manual sections", async () => {
    await createUserRoot();

    const imported = await importMarkdownSkill({
      fileName: "review-playbook.md",
      content:
        "# 产品复盘教练\n\n帮助我复盘一个产品决策，并优先找出最关键的错误假设。",
    });

    expect(imported.content).toContain("# 产品复盘教练");
    expect(imported.content).toContain("executionContext: fork");
    expect(imported.content).toContain("agent: subAgent");
    expect(imported.content).toContain("## 何时使用");
    expect(imported.content).toContain("## 执行计划");
    expect(imported.content).toContain("## 边界与安全");
    expect(imported.content).toContain("## 完成标准");
  });

  it("automatically derives one subAgent profile without granting Markdown-declared tools", async () => {
    const root = await createUserRoot();

    const imported = await importMarkdownSkill({
      fileName: "unsafe-request.md",
      content: `---
id: imported-unsafe-request
displayName: Imported Unsafe Request
description: asks for capabilities
version: 1.0.0
allowedTools: terminal, github_repository
runtimeBindings: unknown_private_runtime
workspaceBound: true
---

# Imported Unsafe Request

Use the requested capabilities.`,
    });

    const manifests = await new SkillScanner().scan([root]);
    const manifest = manifests.find((candidate) => candidate.id === imported.id);
    expect(manifest).toBeDefined();
    expect(manifest?.origin).toBe("user");
    expect(manifest?.execution).toEqual({
      context: "fork",
      agent: "subAgent",
      allowedTools: [],
      runtimeBindings: [],
      workspaceBound: false,
    });

    const profile = resolveSubAgentExecutionProfile({
      id: manifest!.id,
      execution: manifest!.execution,
    });
    expect(profile).toEqual({
      skillId: imported.id,
      mode: "forked-agent",
      engine: "pi-agent-core",
      allowedHarnessToolIds: [],
      runtimeBindings: [],
      workspaceBound: false,
    });
  });

  it("keeps a manually placed user package unprivileged even when it reuses a built-in id", async () => {
    const root = await createUserRoot();
    const packageDir = path.join(root, "docx");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(
      path.join(packageDir, "SKILL.md"),
      `---
id: docx
displayName: Fake DOCX
version: 1.0.0
allowedTools: read_open, terminal
runtimeBindings: office_document
workspaceBound: true
---

# Fake DOCX

This user package must never inherit the built-in Office runtime.`,
      "utf8",
    );

    const [manifest] = await new SkillScanner().scan([root]);
    expect(manifest).toMatchObject({
      id: "docx",
      origin: "user",
      execution: {
        context: "fork",
        agent: "subAgent",
        allowedTools: [],
        runtimeBindings: [],
        workspaceBound: false,
      },
    });
    expect(manifest?.runtimeRequirements).toBeUndefined();
  });

  it("removes disabled packages from discovery and restores the same version when enabled", async () => {
    const root = await createUserRoot();
    const imported = await importMarkdownSkill({
      fileName: "toggle-me.md",
      content: `---
id: toggle-me
version: 1.2.3
---

# Toggle Me

A reusable workflow.`,
    });

    expect((await new SkillScanner().scan([root])).map((skill) => skill.id)).toContain(
      imported.id,
    );

    const disabled = await setUserSkillEnabled(imported.id, false);
    expect(disabled.enabled).toBe(false);
    expect(path.basename(path.dirname(disabled.entry))).toBe(`.disabled-${imported.id}`);
    expect((await new SkillScanner().scan([root])).map((skill) => skill.id)).not.toContain(
      imported.id,
    );

    const enabled = await setUserSkillEnabled(imported.id, true);
    expect(enabled.enabled).toBe(true);
    const restored = (await new SkillScanner().scan([root])).find(
      (skill) => skill.id === imported.id,
    );
    expect(restored?.version).toBe("1.2.3");
    expect(restored?.execution?.agent).toBe("subAgent");
  });

  it("rejects non-semantic versions before creating a package", async () => {
    const root = await createUserRoot();

    await expect(
      importMarkdownSkill({
        fileName: "bad-version.md",
        content: `---
id: bad-version
version: latest
---

# Bad Version`,
      }),
    ).rejects.toThrow("semantic versioning");

    await expect(fs.readdir(root)).resolves.toEqual([]);
  });
});
