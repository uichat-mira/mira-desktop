const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildBackendEnv,
  buildElectronEnv,
  findAvailableTcpPort,
  isCloudPilotMode,
  resolveShellCommand,
  resolveBackendWorkspaceRoot,
} = require("./dev-launcher.cjs");

const createTempRoot = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "mira-electron-launcher-"));

test("POSIX child commands inherit the current PATH without a login shell", () => {
  assert.deepEqual(resolveShellCommand("pnpm dev", "darwin"), {
    file: "sh",
    args: ["-c", "pnpm dev"],
  });
});

test("Windows child commands keep the existing cmd invocation", () => {
  assert.deepEqual(
    resolveShellCommand("pnpm dev", "win32", { ComSpec: "C:\\Windows\\cmd.exe" }),
    {
      file: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm dev"],
    },
  );
});

test("buildBackendEnv creates and exports the owned default workspace", (t) => {
  const tempRoot = createTempRoot();
  const defaultWorkspaceRoot = path.join(tempRoot, "Default Workspace");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const env = buildBackendEnv(
    { PATH: process.env.PATH ?? "" },
    defaultWorkspaceRoot,
  );

  assert.equal(env.UI_CHAT_ALLOW_BACKEND_REUSE, "1");
  assert.equal(env.UI_CHAT_WORKSPACE_ROOT, path.resolve(defaultWorkspaceRoot));
  assert.equal(fs.statSync(defaultWorkspaceRoot).isDirectory(), true);
});

test("buildBackendEnv forwards an existing explicit UI_CHAT_WORKSPACE_ROOT", (t) => {
  const tempRoot = createTempRoot();
  const explicitRoot = path.join(tempRoot, "custom-workspace");
  fs.mkdirSync(explicitRoot, { recursive: true });
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const env = buildBackendEnv({
    PATH: process.env.PATH ?? "",
    UI_CHAT_WORKSPACE_ROOT: `  ${explicitRoot}  `,
  });

  assert.equal(env.UI_CHAT_ALLOW_BACKEND_REUSE, "1");
  assert.equal(env.UI_CHAT_WORKSPACE_ROOT, path.resolve(explicitRoot));
});

test("explicit missing workspace is rejected without being created", (t) => {
  const tempRoot = createTempRoot();
  const missingRoot = path.join(tempRoot, "missing-workspace");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  assert.throws(
    () =>
      resolveBackendWorkspaceRoot({
        UI_CHAT_WORKSPACE_ROOT: missingRoot,
      }),
    new RegExp(`UI_CHAT_WORKSPACE_ROOT does not exist: ${missingRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  assert.equal(fs.existsSync(missingRoot), false);
});

test("explicit workspace file is rejected", (t) => {
  const tempRoot = createTempRoot();
  const filePath = path.join(tempRoot, "not-a-directory");
  fs.writeFileSync(filePath, "x", "utf8");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  assert.throws(
    () =>
      resolveBackendWorkspaceRoot({
        UI_CHAT_WORKSPACE_ROOT: filePath,
      }),
    /UI_CHAT_WORKSPACE_ROOT must be a directory/,
  );
});

test("blank UI_CHAT_WORKSPACE_ROOT uses the owned default", (t) => {
  const tempRoot = createTempRoot();
  const defaultWorkspaceRoot = path.join(tempRoot, "Default Workspace");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const env = buildBackendEnv(
    { UI_CHAT_WORKSPACE_ROOT: "   " },
    defaultWorkspaceRoot,
  );

  assert.equal(env.UI_CHAT_WORKSPACE_ROOT, path.resolve(defaultWorkspaceRoot));
  assert.equal(fs.statSync(defaultWorkspaceRoot).isDirectory(), true);
});

test("Cloud Pilot is explicit and gives Electron an owned Node executable", (t) => {
  const tempRoot = createTempRoot();
  const defaultWorkspaceRoot = path.join(tempRoot, "Default Workspace");
  const nodeBinary = path.join(tempRoot, "node");
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  assert.equal(isCloudPilotMode({}), false);
  assert.equal(isCloudPilotMode({ UI_CHAT_CLOUD_PILOT: "1" }), true);

  const env = buildElectronEnv(
    { PATH: process.env.PATH ?? "", UI_CHAT_CLOUD_PILOT: "1" },
    nodeBinary,
    defaultWorkspaceRoot,
  );

  assert.equal(env.UI_CHAT_CLOUD_PILOT, "1");
  assert.equal(env.UI_CHAT_CLOUD_PILOT_NODE_BINARY, nodeBinary);
  assert.equal(env.UI_CHAT_ALLOW_BACKEND_REUSE, "0");
  assert.equal(env.UI_CHAT_WORKSPACE_ROOT, path.resolve(defaultWorkspaceRoot));
  assert.equal(fs.statSync(defaultWorkspaceRoot).isDirectory(), true);
});

test("ordinary development does not enable Cloud Pilot or change its environment", () => {
  const baseEnv = {
    PATH: process.env.PATH ?? "",
    UI_CHAT_ALLOW_BACKEND_REUSE: "1",
  };
  assert.deepEqual(buildElectronEnv(baseEnv, process.execPath), baseEnv);
});

test("Cloud Pilot rejects a relative Node executable", () => {
  assert.throws(
    () => buildElectronEnv({ UI_CHAT_CLOUD_PILOT: "1" }, "node.exe"),
    /absolute Node executable path/,
  );
});

test("Cloud Pilot can allocate an independent renderer port without reusing a listener", async () => {
  const port = await findAvailableTcpPort("127.0.0.1");
  assert.equal(Number.isInteger(port), true);
  assert.ok(port > 0 && port <= 65535);
});
