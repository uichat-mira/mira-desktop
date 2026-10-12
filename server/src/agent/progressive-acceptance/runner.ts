import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProgressiveAcceptanceMatrix } from "./cases.js";
import { runLiveAcceptanceMatrix } from "./live.js";
import { formatAcceptanceMarkdown, writeAcceptanceArtifacts } from "./report.js";
import type { ProgressiveAcceptanceReport } from "./contract.js";

/**
 * Test-only CLI entrypoint for the #311 acceptance matrix.
 *
 *   pnpm --filter @ui-chat-mira/server bench:progressive:acceptance
 *   pnpm --filter @ui-chat-mira/server bench:progressive:acceptance -- --live --max-live-calls=4
 *
 * It writes JSON + Markdown evidence under `.test-artifact/`. It never runs as
 * part of `pnpm check`; the live route is opt-in and provider calls are bounded.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");

interface RunnerArgs {
  live: boolean;
  maxLiveCalls: number;
  out: string | null;
}

const parseArgs = (argv: readonly string[]): RunnerArgs => {
  const args: RunnerArgs = { live: false, maxLiveCalls: 4, out: null };
  for (const token of argv) {
    if (token === "--live") {
      args.live = true;
      continue;
    }
    if (token.startsWith("--max-live-calls=")) {
      const parsed = Number(token.slice("--max-live-calls=".length));
      if (Number.isFinite(parsed) && parsed >= 0) args.maxLiveCalls = parsed;
      continue;
    }
    if (token.startsWith("--out=")) {
      args.out = path.resolve(token.slice("--out=".length));
      continue;
    }
  }
  return args;
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const report: ProgressiveAcceptanceReport = args.live
    ? await runLiveAcceptanceMatrix({ maxLiveCalls: args.maxLiveCalls })
    : await runProgressiveAcceptanceMatrix();

  const outDir =
    args.out ??
    path.join(
      REPO_ROOT,
      ".test-artifact",
      "progressive-resolution-acceptance",
      `${report.mode}-${stamp()}`,
    );
  const { jsonPath, markdownPath } = writeAcceptanceArtifacts(report, outDir);

  process.stdout.write(formatAcceptanceMarkdown(report));
  process.stdout.write(
    `\nArtifacts:\n- ${path.relative(REPO_ROOT, jsonPath)}\n- ${path.relative(REPO_ROOT, markdownPath)}\n`,
  );
  if (report.summary.failed > 0) process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
