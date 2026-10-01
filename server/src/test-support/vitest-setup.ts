import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Test-only environment bootstrap.
 *
 * Several suites persist through the real SQLite repositories, which require
 * DATABASE_URL. Vitest runs this setup file before each test file, so allocate
 * a fresh database every time instead of sharing one database across the
 * single-fork test process.
 *
 * Suites that intentionally own a dedicated database may still replace
 * DATABASE_URL in their module setup.
 */
const testArtifactRoot = path.resolve(process.cwd(), "..", ".test-artifact", "server");
fs.mkdirSync(testArtifactRoot, { recursive: true });

const databasePath = path.join(
  testArtifactRoot,
  `vitest-${process.pid}-${crypto.randomUUID()}.db`,
);
process.env.DATABASE_URL = "file:" + databasePath;
