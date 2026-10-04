import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveWenshuOfficePackRoot,
  resolveWenshuOfficeSitePackages,
} from "@/microapps/office-suite/runtime-pack-paths.js";
import { clearHarnessRegistry, listToolDefinitions } from "./registry.js";
import {
  reconcileWenshuOfficeHarnessCapabilities,
  WENSHU_OPTIONAL_CAPABILITY_IDS,
} from "./wenshu-office-capability.js";

const previousRuntimePacksDir = process.env.MIRA_RUNTIME_PACKS_DIR;
let tempRoot = "";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mira-wenshu-harness-test-"));
  process.env.MIRA_RUNTIME_PACKS_DIR = tempRoot;
  clearHarnessRegistry();
});

afterEach(() => {
  clearHarnessRegistry();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (previousRuntimePacksDir === undefined) {
    delete process.env.MIRA_RUNTIME_PACKS_DIR;
  } else {
    process.env.MIRA_RUNTIME_PACKS_DIR = previousRuntimePacksDir;
  }
});

describe("WenShu Office Harness capability reconciliation", () => {
  it("keeps optional Office capabilities absent while the runtime pack is unavailable", () => {
    const state = reconcileWenshuOfficeHarnessCapabilities();

    expect(state.runtimePackAvailable).toBe(false);
    expect(state.registeredCapabilityIds).toEqual([]);
    expect(listToolDefinitions().map((definition) => definition.id)).toEqual([]);
  });

  it("keeps optional Office capabilities absent even when the Runtime Pack is ready", () => {
    const packRoot = resolveWenshuOfficePackRoot();
    fs.mkdirSync(resolveWenshuOfficeSitePackages(), { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "manifest.json"),
      JSON.stringify({ id: "wenshu-office", version: "1.0.0" }),
      "utf8",
    );

    const available = reconcileWenshuOfficeHarnessCapabilities();
    expect(available.runtimePackAvailable).toBe(true);
    expect(available.registeredCapabilityIds).toEqual([]);
    expect(
      listToolDefinitions()
        .map((definition) => definition.id)
        .filter((id) => WENSHU_OPTIONAL_CAPABILITY_IDS.includes(id)),
    ).toEqual([]);

    fs.rmSync(packRoot, { recursive: true, force: true });
    const unavailable = reconcileWenshuOfficeHarnessCapabilities();
    expect(unavailable.runtimePackAvailable).toBe(false);
    expect(
      listToolDefinitions()
        .map((definition) => definition.id)
        .filter((id) => WENSHU_OPTIONAL_CAPABILITY_IDS.includes(id)),
    ).toEqual([]);
  });
});
