import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSubAgentExecutionProfile } from "../src/skills/agent/profiles.js";
import { SkillScanner } from "../src/skills/context/scanner.js";
import {
  importMarkdownSkill,
  setUserSkillEnabled,
} from "../src/skills/user-skills.js";

const main = async () => {
  const previousRoot = process.env.MIRA_USER_SKILLS_ROOT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mira-subagent-smoke-"));
  process.env.MIRA_USER_SKILLS_ROOT = root;

  try {
    const imported = await importMarkdownSkill({
      fileName: "smoke-skill.md",
      content: `---
id: smoke-subagent-skill
displayName: Smoke subAgent Skill
description: deterministic smoke for uploaded Skill execution contract
version: 1.0.0
allowedTools: terminal
runtimeBindings: arbitrary_runtime
workspaceBound: true
---

# Smoke subAgent Skill

Summarize a short decision using the supplied facts.`,
    });

    assert.match(imported.content, /agent: subAgent/);
    assert.match(imported.content, /## 执行计划/);
    assert.match(imported.content, /## 完成标准/);

    const scanner = new SkillScanner();
    const discovered = await scanner.scan([root]);
    const manifest = discovered.find((skill) => skill.id === imported.id);
    assert.ok(manifest, "imported Skill must be discoverable");
    assert.equal(manifest.origin, "user");
    assert.deepEqual(manifest.execution, {
      context: "fork",
      agent: "subAgent",
      allowedTools: [],
      runtimeBindings: [],
      workspaceBound: false,
    });

    const profile = resolveSubAgentExecutionProfile({
      id: manifest.id,
      execution: manifest.execution,
    });
    assert.deepEqual(profile, {
      skillId: imported.id,
      mode: "forked-agent",
      engine: "pi-agent-core",
      allowedHarnessToolIds: [],
      runtimeBindings: [],
      workspaceBound: false,
    });

    await setUserSkillEnabled(imported.id, false);
    assert.equal(
      (await scanner.scan([root])).some((skill) => skill.id === imported.id),
      false,
      "disabled Skill must leave the matchable registry surface",
    );

    await setUserSkillEnabled(imported.id, true);
    const restored = (await scanner.scan([root])).find(
      (skill) => skill.id === imported.id,
    );
    assert.equal(restored?.version, "1.0.0");
    assert.equal(restored?.execution?.agent, "subAgent");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          skillId: imported.id,
          version: restored?.version,
          engine: profile.engine,
          automaticProfile: true,
          unauthorizedToolGrant: false,
          disableEnableRoundTrip: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MIRA_USER_SKILLS_ROOT;
    } else {
      process.env.MIRA_USER_SKILLS_ROOT = previousRoot;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
