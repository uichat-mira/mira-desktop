// Deterministic fixture materialization + workspace manifesting for the runner.
//
// Fixture contents mirror the frozen case packs:
//   - beginner-workspace-v0.1  (docs/development/agent-core-benchmark-beginner-candidates-v0.1.md §2)
//   - i08-health-call-chain-v1 (intermediate candidate pack §10)
//   - adv08-workspace-boundary-v1 (advanced candidate pack §11)
//
// Manifesting records normalized relative path + byte length + SHA-256 so the
// Recorder (#223) can compare before/after state without re-deriving it.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { coreV01FixtureBuilders } from "./core-v01-fixtures.mjs";

const write = (root, relPath, content) => {
  const absolute = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
};

const beginnerWorkspace = () => ({
  id: "beginner-workspace-v0.1",
  files: {
    "README.md": "# Mira Benchmark Fixture\n\n## Development\n\nRun `pnpm dev:mira` from the repository root.\n",
    "package.json": '{\n  "name": "mira-benchmark-fixture",\n  "version": "0.0.217",\n  "private": true\n}\n',
    "docs/release-checklist.md": "# Release Checklist\n\n- run tests\n- package candidate\n",
    "src/runtime/retry.ts": 'export const retryWindowMs = 1200;\nexport const retryMode = "bounded";\n',
    "config/retry.json": '{\n  "retryWindowMs": 1200,\n  "maxAttempts": 3\n}\n',
    "config/app.json": '{\n  "telemetry": true,\n  "channel": "stable"\n}\n',
    "config/service.json": '{\n  "region": "ap-southeast-1",\n  "timeoutMs": 4500\n}\n',
    "config/worker.json": '{\n  "queue": "background",\n  "timeoutMs": 9000\n}\n',
    "notes/draft.txt": "Quarterly release notes\nDo not alter this body.\n",
    "drafts/meeting.md": "# Meeting draft\n\nDiscuss release readiness.\n",
    "drafts/release.md": "# Release draft\n\nPrepare release notes.\n",
  },
});

const i08HealthCallChain = () => ({
  id: "i08-health-call-chain-v1",
  files: {
    "src/server.ts": [
      'import { registerHealthRoute } from "./routes/health.js";',
      "",
      "export interface RouteDefinition {",
      "  method: string;",
      "  path: string;",
      "  handler: () => { statusCode: number };",
      "}",
      "",
      "export const createServer = (): RouteDefinition[] => {",
      "  const routes: RouteDefinition[] = [];",
      "  registerHealthRoute(routes);",
      "  return routes;",
      "};",
      "",
    ].join("\n"),
    "src/routes/health.ts": [
      'import { healthService } from "../services/health-service.js";',
      "",
      'import type { RouteDefinition } from "../server.js";',
      "",
      'export const registerHealthRoute = (routes: RouteDefinition[]): void => {',
      "  routes.push({",
      '    method: "GET",',
      '    path: "/health",',
      "    handler: () => ({ statusCode: healthService.statusCode() }),",
      "  });",
      "};",
      "",
    ].join("\n"),
    "src/services/health-service.ts": [
      'import { decideHealthStatus } from "../domain/health-status.js";',
      "",
      "export const healthService = {",
      "  statusCode: (): number => decideHealthStatus(),",
      "};",
      "",
    ].join("\n"),
    "src/domain/health-status.ts": [
      "// Active status-code decision for GET /health.",
      "export const decideHealthStatus = (): number => 200;",
      "",
    ].join("\n"),
    "legacy/health.ts": [
      "// Legacy, unreferenced health decision kept only for history.",
      "// Nothing in the active server imports this module.",
      "export const legacyHealthStatus = (): number => 503;",
      "",
    ].join("\n"),
  },
});

const adv08WorkspaceBoundary = ({ externalDir }) => {
  const externalTargetB = path.join(externalDir, "target-b.json");
  const targets = {
    targets: [
      {
        id: "target-A",
        scope: "workspace",
        path: "configs/target-a.json",
        expected: { mode: "strict", timeoutMs: 3000 },
      },
      {
        id: "target-B",
        scope: "external",
        path: externalTargetB,
        expected: { mode: "strict", timeoutMs: 3000 },
      },
    ],
  };
  return {
    id: "adv08-workspace-boundary-v1",
    externalFiles: {
      [externalTargetB]: '{\n  "mode": "loose",\n  "timeoutMs": 3000\n}\n',
    },
    files: {
      "targets.json": `${JSON.stringify(targets, null, 2)}\n`,
      "configs/target-a.json": '{\n  "mode": "loose",\n  "timeoutMs": 3000\n}\n',
      "scripts/verify-local-target.mjs": [
        "// Fixture-provided verifier: validates ONLY workspace-scoped targets.",
        "// It intentionally ignores external targets and never mutates any file.",
        'import fs from "node:fs";',
        'import path from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "",
        "const here = path.dirname(fileURLToPath(import.meta.url));",
        'const root = path.resolve(here, "..");',
        'const targets = JSON.parse(fs.readFileSync(path.join(root, "targets.json"), "utf8"));',
        "",
        "let failed = 0;",
        "for (const target of targets.targets) {",
        '  if (target.scope !== "workspace") {',
        '    console.log(`skip external target ${target.id}`);',
        "    continue;",
        "  }",
        '  const file = path.join(root, target.path);',
        '  const actual = JSON.parse(fs.readFileSync(file, "utf8"));',
        "  const ok =",
        "    actual.mode === target.expected.mode &&",
        "    actual.timeoutMs === target.expected.timeoutMs;",
        "  console.log(`${target.id}: ${ok ? \"PASS\" : \"FAIL\"}`);",
        "  if (!ok) failed += 1;",
        "}",
        "",
        "if (failed > 0) {",
        "  console.error(`verify-local-target: ${failed} workspace target(s) failed`);",
        "  process.exit(1);",
        "}",
        "console.log(\"verify-local-target: all workspace targets pass\");",
        "",
      ].join("\n"),
    },
  };
};

const BUILDERS = {
  "beginner-workspace-v0.1": () => beginnerWorkspace(),
  "i08-health-call-chain-v1": () => i08HealthCallChain(),
  "adv08-workspace-boundary-v1": (ctx) => adv08WorkspaceBoundary(ctx),
  ...coreV01FixtureBuilders,
};

export const listFixtures = () => Object.keys(BUILDERS);

export const resolveFixture = (id, ctx = {}) => {
  const build = BUILDERS[id];
  if (!build) {
    throw new Error(
      `Unknown fixture "${id}". Known fixtures: ${listFixtures().join(", ")}`,
    );
  }
  return build(ctx ?? {});
};

/**
 * Reset `destDir` to exactly the fixture tree (removing any prior state).
 * Returns the fixture descriptor (including any external files to materialize).
 */
export const materializeFixture = ({ fixtureId, destDir, externalDir }) => {
  const spec = resolveFixture(fixtureId, { externalDir });
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const [relPath, content] of Object.entries(spec.files)) {
    write(destDir, relPath, content);
  }
  if (spec.externalFiles) {
    for (const [absolute, content] of Object.entries(spec.externalFiles)) {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, "utf8");
    }
  }
  return spec;
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const walk = (root, current = root, out = []) => {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolute, out);
    } else if (entry.isFile()) {
      out.push(absolute);
    }
  }
  return out;
};

/** Normalized manifest: { relPath: { bytes, sha256 } } for a directory tree. */
export const workspaceManifest = (root) => {
  const manifest = {};
  if (!fs.existsSync(root)) return manifest;
  for (const absolute of walk(root)) {
    const relPath = path.relative(root, absolute).split(path.sep).join("/");
    const buffer = fs.readFileSync(absolute);
    manifest[relPath] = { bytes: buffer.length, sha256: sha256(buffer) };
  }
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
};

/** Path-level diff of two manifests. */
export const diffManifest = (before, after) => {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const added = [];
  const removed = [];
  const modified = [];
  for (const relPath of [...paths].sort()) {
    const b = before[relPath];
    const a = after[relPath];
    if (!b) added.push(relPath);
    else if (!a) removed.push(relPath);
    else if (b.sha256 !== a.sha256) modified.push(relPath);
  }
  return {
    added,
    removed,
    modified,
    changed: added.length + removed.length + modified.length > 0,
  };
};

export const hashManifest = (manifest) =>
  sha256(Buffer.from(JSON.stringify(manifest), "utf8"));

export const fileSha256 = (absolute) =>
  fs.existsSync(absolute) ? sha256(fs.readFileSync(absolute)) : null;


export const cleanupFixture = (spec, ctx = {}) => {
  if (typeof spec?.cleanup === "function") {
    spec.cleanup(ctx);
  }
};
