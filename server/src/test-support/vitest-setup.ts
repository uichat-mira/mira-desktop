import fs from "node:fs";
import path from "node:path";

/**
 * Test-only environment bootstrap.
 *
 * Several suites persist through the real SQLite repositories, which require
 * DATABASE_URL. Without it those suites either throw DATABASE_URL is not set
 * or assert against unintended state, so the value is provisioned here
 * instead of being repeated per test file.
 *
 * The database is a throwaway test artifact under the repository-root
 * .test-artifact directory, scoped per test process on purpose: the runner
 * uses a single fork, so one shared file would let unrelated suites observe
 * and reset each other rows.
 */
const testArtifactRoot = path.resolve(process.cwd(), "..", ".test-artifact", "server");

if (!process.env.DATABASE_URL) {
  fs.mkdirSync(testArtifactRoot, { recursive: true });
  const databasePath = path.join(testArtifactRoot, `vitest-${process.pid}.db`);
  process.env.DATABASE_URL = "file:" + databasePath;
}
