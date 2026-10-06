import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageTerminalDevRuntime } from "./terminal-runtime-staging.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const artifactsRoot = path.join(projectRoot, ".artifacts");
const testRoot = path.join(projectRoot, ".test-artifact", "terminal-dev-runtime-staged");
const resourcesRoot = path.join(testRoot, "resources");
const workspaceRoot = path.join(testRoot, "workspace");
const full = process.argv.includes("--full");
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Terminal Dev Runtime staged smoke currently requires Windows x64.");
}

const requiredArtifactPaths = [
  path.join(artifactsRoot, "node-runtime", "node.exe"),
  path.join(artifactsRoot, "terminal-runtime", "manifest.json"),
  path.join(artifactsRoot, "server-bundle", "server.cjs"),
  path.join(artifactsRoot, "server-bundle", "node_modules", "node-pty"),
];
for (const requiredPath of requiredArtifactPaths) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Missing staged input. Run the prepare and server build first: ${requiredPath}`);
  }
}

fs.rmSync(testRoot, { recursive: true, force: true });
fs.mkdirSync(resourcesRoot, { recursive: true });
stageTerminalDevRuntime({ artifactsRoot, destinationRoot: resourcesRoot });
fs.cpSync(path.join(artifactsRoot, "server-bundle"), path.join(resourcesRoot, "server"), {
  recursive: true,
});
fs.mkdirSync(workspaceRoot, { recursive: true });

const runtimePaths = [
  path.join(resourcesRoot, "node-runtime"),
  path.join(resourcesRoot, "terminal-runtime", "bin"),
  path.join(resourcesRoot, "terminal-runtime", "git", "cmd"),
  path.join(resourcesRoot, "terminal-runtime", "git", "mingw64", "bin"),
  path.join(resourcesRoot, "terminal-runtime", "git", "usr", "bin"),
];
const systemPaths = [path.join(systemRoot, "System32"), path.dirname(powershell)];
const cleanEnv = {
  SystemRoot: systemRoot,
  WINDIR: systemRoot,
  ComSpec: path.join(systemRoot, "System32", "cmd.exe"),
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  PATH: [...runtimePaths, ...systemPaths].join(path.delimiter),
  TEMP: path.join(testRoot, "temp"),
  TMP: path.join(testRoot, "temp"),
  HOME: path.join(testRoot, "home"),
  USERPROFILE: path.join(testRoot, "home"),
  APPDATA: path.join(testRoot, "home", "AppData", "Roaming"),
  LOCALAPPDATA: path.join(testRoot, "home", "AppData", "Local"),
  npm_config_cache: path.join(testRoot, "cache", "npm"),
  UV_CACHE_DIR: path.join(testRoot, "cache", "uv"),
  UV_PYTHON_INSTALL_DIR: path.join(testRoot, "python"),
  UV_NO_PROGRESS: "1",
  GIT_TERMINAL_PROMPT: "0",
  UI_CHAT_DESKTOP_RESOURCES_ROOT: resourcesRoot,
};
for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"]) {
  if (process.env[name]) cleanEnv[name] = process.env[name];
}
for (const directory of [cleanEnv.TEMP, cleanEnv.HOME, cleanEnv.APPDATA, cleanEnv.LOCALAPPDATA]) {
  fs.mkdirSync(directory, { recursive: true });
}

const evidence = [];
function runPowerShell(label, command, cwd = workspaceRoot, timeout = 120_000) {
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { cwd, env: cleanEnv, encoding: "utf8", windowsHide: true, timeout },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${output || result.error?.message}`);
  }
  evidence.push({ label, output: output.slice(0, 4_000) });
  return output;
}

function assertCommandSource(command, expectedPath) {
  const actual = runPowerShell(
    `${command} bundled source`,
    `(Get-Command ${command} -ErrorAction Stop).Source`,
  ).trim();
  if (path.resolve(actual).toLowerCase() !== path.resolve(expectedPath).toLowerCase()) {
    throw new Error(`${command} resolved to ${actual}; expected ${expectedPath}`);
  }
}

const expectedSources = {
  node: path.join(resourcesRoot, "node-runtime", "node.exe"),
  npm: path.join(resourcesRoot, "node-runtime", "npm.cmd"),
  npx: path.join(resourcesRoot, "node-runtime", "npx.cmd"),
  git: path.join(resourcesRoot, "terminal-runtime", "git", "cmd", "git.exe"),
  uv: path.join(resourcesRoot, "terminal-runtime", "bin", "uv.exe"),
  rg: path.join(resourcesRoot, "terminal-runtime", "bin", "rg.exe"),
};
for (const [command, expectedPath] of Object.entries(expectedSources)) {
  assertCommandSource(command, expectedPath);
}

runPowerShell(
  "runtime versions",
  "node --version; npm --version; npx --version; git --version; uv --version; rg --version | Select-Object -First 1",
);
runPowerShell(
  "Git HTTPS helper",
  "(Get-Command git-remote-https -ErrorAction Stop).Source",
);
runPowerShell("Git SSH runtime", "cmd.exe /d /s /c \"ssh -V 2^>^&1\"");
runPowerShell("Git credential runtime", "git credential-manager --version");

const ptySmokePath = path.join(testRoot, "pty-smoke.cjs");
fs.writeFileSync(ptySmokePath, `
const path = require("node:path");
const pty = require(${JSON.stringify(path.join(resourcesRoot, "server", "node_modules", "node-pty"))});
const shell = ${JSON.stringify(powershell)};
const child = pty.spawn(shell, ["-NoProfile", "-NonInteractive"], {
  name: "xterm-color",
  cwd: ${JSON.stringify(workspaceRoot)},
  env: process.env,
});
let output = "";
let phase = 0;
const timer = setTimeout(() => { child.kill(); console.error("staged node-pty smoke timed out"); process.exit(1); }, 30000);
child.onData((chunk) => {
  output += chunk;
  if (phase === 0 && output.includes("pty-one")) {
    phase = 1;
    child.write("Write-Output 'pty-two'\\r");
  } else if (phase === 1 && output.includes("pty-two")) {
    phase = 2;
    child.write("exit\\r");
  }
});
child.onExit(() => {
  clearTimeout(timer);
  if (phase !== 2) { console.error(output); process.exit(1); }
  console.log("staged-node-pty-ok");
  process.exit(0);
});
child.write("Write-Output 'pty-one'\\r");
`);
const ptyResult = spawnSync(expectedSources.node, [ptySmokePath], {
  cwd: workspaceRoot,
  env: cleanEnv,
  encoding: "utf8",
  windowsHide: true,
  timeout: 45_000,
});
if (ptyResult.error || ptyResult.status !== 0 || !ptyResult.stdout.includes("staged-node-pty-ok")) {
  throw new Error(`Staged node-pty smoke failed: ${ptyResult.stdout}${ptyResult.stderr}`);
}
evidence.push({ label: "staged node-pty persistent writes", output: ptyResult.stdout.trim() });

const terminalSessionResult = spawnSync(
  process.execPath,
  [
    path.join(projectRoot, "server", "node_modules", "tsx", "dist", "cli.mjs"),
    "--tsconfig",
    path.join(projectRoot, "server", "tsconfig.json"),
    path.join(projectRoot, "scripts", "smoke-terminal-session.ts"),
    resourcesRoot,
    workspaceRoot,
  ],
  { cwd: projectRoot, env: process.env, encoding: "utf8", windowsHide: true, timeout: 90_000 },
);
if (terminalSessionResult.error || terminalSessionResult.status !== 0) {
  throw new Error(
    `terminal smoke failed: ${terminalSessionResult.error?.message ?? ""}${terminalSessionResult.stdout ?? ""}${terminalSessionResult.stderr ?? ""}`,
  );
}
evidence.push({
  label: "terminal ephemeral and persistent",
  output: `${terminalSessionResult.stdout ?? ""}${terminalSessionResult.stderr ?? ""}`.trim(),
});

if (full) {
  const httpsCloneRoot = path.join(workspaceRoot, "https-clone");
  let httpsCloneError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    fs.rmSync(httpsCloneRoot, { recursive: true, force: true });
    try {
      runPowerShell(
        `Git HTTPS clone (attempt ${attempt})`,
        `git clone --depth 1 https://gitlab.com/gitlab-org/gitlab-test.git ${JSON.stringify(httpsCloneRoot)}`,
        workspaceRoot,
        180_000,
      );
      httpsCloneError = undefined;
      break;
    } catch (error) {
      httpsCloneError = error;
    }
  }
  if (httpsCloneError) throw httpsCloneError;
  runPowerShell("Git HTTPS status", "git status --short --branch", httpsCloneRoot);

  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const repoRoot = path.join(workspaceRoot, "agent-project");
  runPowerShell("Git bare remote", `git init --bare ${JSON.stringify(remoteRoot)}`);
  runPowerShell("Git clone local remote", `git clone ${JSON.stringify(remoteRoot)} ${JSON.stringify(repoRoot)}`);
  runPowerShell("Git identity", "git config user.name 'Mira Runtime Smoke'; git config user.email 'runtime-smoke@localhost'", repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "Mira terminal runtime smoke\n");
  runPowerShell("Git add and commit", "git add README.md; git commit -m 'initial runtime smoke'; git branch -M main; git push -u origin main", repoRoot);
  runPowerShell("Git fetch and pull", "git fetch; git pull", repoRoot);
  runPowerShell("Git switch", "git switch -c feature/runtime-smoke", repoRoot);
  fs.appendFileSync(path.join(repoRoot, "README.md"), "ripgrep bundled search marker\n");
  runPowerShell("ripgrep source search", "rg 'bundled search marker' .", repoRoot);
  runPowerShell("Git diff and log", "git diff -- README.md; git log -1 --oneline", repoRoot);
  runPowerShell("Git feature commit and push", "git add README.md; git commit -m 'verify runtime tools'; git push -u origin feature/runtime-smoke", repoRoot);
  runPowerShell("Git checkout", "git checkout main", repoRoot);
  const worktreeRoot = path.join(workspaceRoot, "agent-worktree");
  runPowerShell("Git worktree", `git worktree add ${JSON.stringify(worktreeRoot)} feature/runtime-smoke; git worktree remove ${JSON.stringify(worktreeRoot)}`, repoRoot);

  const nodeProjectRoot = path.join(workspaceRoot, "node-project");
  fs.mkdirSync(nodeProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(nodeProjectRoot, "package.json"), JSON.stringify({
    private: true,
    scripts: { build: "node build.mjs" },
  }, null, 2));
  fs.writeFileSync(path.join(nodeProjectRoot, "build.mjs"), "await import('node:fs').then(fs => fs.writeFileSync('dist.txt', 'node-build-ok\\n'));\n");
  runPowerShell("npm install", "npm install", nodeProjectRoot, 180_000);
  runPowerShell("npm build", "npm run build", nodeProjectRoot);
  if (!fs.existsSync(path.join(nodeProjectRoot, "dist.txt"))) {
    throw new Error("Bundled npm build did not create dist.txt");
  }

  const pythonProjectRoot = path.join(workspaceRoot, "python-project");
  fs.mkdirSync(pythonProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(pythonProjectRoot, "smoke.py"), "print('uv-python-ok')\n");
  runPowerShell("uv Python install", "uv python install 3.12", pythonProjectRoot, 300_000);
  runPowerShell("uv venv", "uv venv --python 3.12", pythonProjectRoot, 180_000);
  runPowerShell("uv pip", "uv pip list --python .venv\\Scripts\\python.exe", pythonProjectRoot);
  runPowerShell("uv run", "uv run --python 3.12 python smoke.py", pythonProjectRoot, 180_000);
  runPowerShell("managed Python script", ".venv\\Scripts\\python.exe smoke.py", pythonProjectRoot);
}

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : null;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});
const backendPort = await getFreePort();
const backendEnv = {
  ...cleanEnv,
  HOST: "127.0.0.1",
  PORT: String(backendPort),
  UI_CHAT_BACKEND_HOST: "127.0.0.1",
  UI_CHAT_BACKEND_PORT: String(backendPort),
  NODE_ENV: "production",
  JWT_SECRET: "terminal-runtime-smoke-jwt-secret-32-bytes",
  SETTINGS_SECRET: "terminal-runtime-smoke-settings-secret-32-bytes",
  UI_CHAT_ALLOW_DEFAULT_BOOTSTRAP: "1",
  UI_CHAT_DATABASE_DIR: path.join(testRoot, "backend-data"),
  UI_CHAT_LOG_DIR: path.join(testRoot, "backend-logs"),
};
fs.mkdirSync(backendEnv.UI_CHAT_DATABASE_DIR, { recursive: true });
fs.mkdirSync(backendEnv.UI_CHAT_LOG_DIR, { recursive: true });
const backend = spawn(expectedSources.node, [path.join(resourcesRoot, "server", "server.cjs")], {
  cwd: path.join(resourcesRoot, "server"),
  env: backendEnv,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let backendLog = "";
backend.stdout.on("data", (chunk) => { backendLog += chunk.toString(); });
backend.stderr.on("data", (chunk) => { backendLog += chunk.toString(); });
try {
  const deadline = Date.now() + 45_000;
  let response;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${backendPort}/health`);
      if (response.ok) break;
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) {
    throw new Error(`Staged backend health failed: ${backendLog.slice(-4_000)}`);
  }
  evidence.push({ label: "staged bundled-Node backend health", output: await response.text() });
} finally {
  backend.kill();
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(resourcesRoot, "terminal-runtime", "manifest.json"), "utf8"),
);
const report = {
  mode: full ? "full" : "quick",
  stagedResourcesRoot: resourcesRoot,
  cleanPath: cleanEnv.PATH,
  manifest: manifest.components,
  sizes: manifest.sizes,
  evidence,
};
fs.writeFileSync(path.join(testRoot, "smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Terminal Dev Runtime ${report.mode} staged smoke passed.`);
console.log(`Evidence: ${path.join(testRoot, "smoke-report.json")}`);
