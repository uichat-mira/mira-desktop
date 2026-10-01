import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { resolveManagedCodeGraphPlannerConfig } from "../planner-exposure-config.js";

const originalEnv = {
  UI_CHAT_CODEGRAPH_APP_DATA_ROOT: process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT,
  UI_CHAT_LOG_DIR: process.env.UI_CHAT_LOG_DIR,
  UI_CHAT_DATABASE_DIR: process.env.UI_CHAT_DATABASE_DIR,
  UI_CHAT_CODEGRAPH_COMMAND: process.env.UI_CHAT_CODEGRAPH_COMMAND,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("resolveManagedCodeGraphPlannerConfig does not default to repo .artifacts when app-data root is unavailable", () => {
  delete process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT;
  delete process.env.UI_CHAT_LOG_DIR;
  delete process.env.UI_CHAT_DATABASE_DIR;

  const result = resolveManagedCodeGraphPlannerConfig("D:\\workspace\\rag-demo");

  assert.equal(result.storage.status, "blocked");
  assert.equal(result.storage.source, "unresolved");
  assert.equal(result.storage.appDataRoot, null);
  assert.equal(result.logRoot, null);
  assert.equal(result.indexRoot, null);
  assert.equal(
    String(result.storage.reason).includes("app-data root"),
    true,
  );
  assert.equal(String(result.logRoot).includes(".artifacts"), false);
  assert.equal(String(result.indexRoot).includes(".artifacts"), false);
});

test("resolveManagedCodeGraphPlannerConfig uses explicit app-data root when available", () => {
  const appDataRoot = path.join(os.tmpdir(), "codegraph-appdata-explicit");
  process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT = appDataRoot;
  process.env.UI_CHAT_CODEGRAPH_COMMAND = process.execPath;
  delete process.env.UI_CHAT_LOG_DIR;
  delete process.env.UI_CHAT_DATABASE_DIR;

  const result = resolveManagedCodeGraphPlannerConfig("D:\\workspace\\rag-demo");

  assert.equal(result.storage.status, "ready");
  assert.equal(result.storage.source, "explicit_app_data_root");
  assert.equal(result.storage.appDataRoot, path.resolve(appDataRoot));
  assert.equal(result.logRoot?.startsWith(path.resolve(appDataRoot)), true);
  assert.equal(result.indexRoot?.startsWith(path.resolve(appDataRoot)), true);
  assert.equal(result.externalIndexSupport.status, "ready");
  delete process.env.UI_CHAT_CODEGRAPH_COMMAND;
});

test("resolveManagedCodeGraphPlannerConfig derives app-data root from existing log dir config", () => {
  const appDataRoot = path.join(os.tmpdir(), "codegraph-appdata-logdir");
  process.env.UI_CHAT_LOG_DIR = path.join(appDataRoot, "logs");
  process.env.UI_CHAT_CODEGRAPH_COMMAND = process.execPath;
  delete process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT;
  delete process.env.UI_CHAT_DATABASE_DIR;

  const result = resolveManagedCodeGraphPlannerConfig("D:\\workspace\\rag-demo");

  assert.equal(result.storage.status, "ready");
  assert.equal(result.storage.source, "log_dir_parent");
  assert.equal(result.storage.appDataRoot, path.resolve(appDataRoot));
  assert.equal(result.logRoot?.startsWith(path.resolve(appDataRoot)), true);
  assert.equal(result.indexRoot?.startsWith(path.resolve(appDataRoot)), true);
  assert.equal(result.externalIndexSupport.status, "ready");
  delete process.env.UI_CHAT_CODEGRAPH_COMMAND;
});

test.skipIf(process.platform !== "win32")("resolveManagedCodeGraphPlannerConfig defaults to serve --mcp for the real provider", () => {
  process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT = path.join(
    os.tmpdir(),
    "codegraph-appdata-default-args",
  );
  delete process.env.UI_CHAT_LOG_DIR;
  delete process.env.UI_CHAT_DATABASE_DIR;

  const result = resolveManagedCodeGraphPlannerConfig("D:\\workspace\\rag-demo");

  assert.deepEqual(result.startArgs, ["serve", "--mcp"]);
  assert.equal(result.externalIndexSupport.status, "blocked");
  assert.equal(result.externalIndexSupport.externalIndexRootSupported, false);
  assert.equal(result.externalIndexSupport.repoDataDirName, ".codegraph");
  assert.match(
    result.externalIndexSupport.reason ?? "",
    /cannot relocate.*workspace\/\.codegraph/i,
  );
});
