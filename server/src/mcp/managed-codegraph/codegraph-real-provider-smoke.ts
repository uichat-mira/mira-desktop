import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { codebaseExploreTool } from "./codebase-explore.tool.js";
import { ManagedCodeGraphProcessManager } from "./managed-codegraph-process-manager.js";
import { resolveManagedCodeGraphLaunchSpec } from "./managed-jsonrpc-session.js";
import { resolveManagedCodeGraphPlannerConfig } from "./planner-exposure-config.js";

type SmokeQueryResult = {
  query: string;
  rawOutputFile: string;
  command: string;
  commandExitCode: number | null;
  status: string;
  candidateCount: number;
  verifiedCount: number;
  rejectedCount: number;
  unverifiableCount: number;
  fallbackReason: string | null;
};

type CommandCapture = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const reportRoot = path.join(repoRoot, "server", "test-report");
const reportPrefix = "code_T014-codegraph-real-provider-smoke";
const appDataRoot = path.join(
  os.tmpdir(),
  "uichat-mira-codegraph-smoke",
  new Date().toISOString().replace(/[:.]/g, "-"),
);

const smokeQueries = [
  "agentGraph.run 的入口在哪里？",
  "Planner -> Normalize -> Policy -> ToolNode -> Evidence 链路如何走？",
  "selectedToolIds 在哪里写入和消费？",
  "ToolNode 到 executeHarnessInvocation 的路径是什么？",
] as const;

const ensureDir = (targetPath: string) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const writeText = (targetPath: string, content: string) => {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
};

const sanitizeFilePart = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "query";

const runCommand = (command: string, args: string[], cwd: string): CommandCapture => {
  const launch = resolveManagedCodeGraphLaunchSpec(command, args);
  const result = spawnSync(launch.command, launch.args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    command: [launch.command, ...launch.args].join(" "),
    exitCode: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
};

const captureCommand = (name: string, capture: CommandCapture) => {
  const targetPath = path.join(reportRoot, `${reportPrefix}-${name}.txt`);
  writeText(
    targetPath,
    [`$ ${capture.command}`, "", capture.stdout, capture.stderr].filter(Boolean).join("\n"),
  );
  return targetPath;
};

const runSmoke = async () => {
  ensureDir(reportRoot);
  process.env.UI_CHAT_CODEGRAPH_PLANNER_ENABLED = "1";
  process.env.UI_CHAT_CODEGRAPH_APP_DATA_ROOT = appDataRoot;

  const plannerConfig = resolveManagedCodeGraphPlannerConfig(repoRoot);
  const manager = new ManagedCodeGraphProcessManager({
    command: plannerConfig.command,
    startArgs: plannerConfig.startArgs,
    versionProbe: {
      args: plannerConfig.versionProbeArgs,
    },
    telemetryProbe: {
      args: plannerConfig.telemetryProbeArgs,
    },
    workspaceRoot: repoRoot,
    allowedWorkspaceRoot: repoRoot,
    logRoot: plannerConfig.logRoot!,
    indexRoot: plannerConfig.indexRoot!,
  });

  const preRepoCodegraph = fs.existsSync(path.join(repoRoot, ".codegraph"));
  const preRepoArtifacts = fs.existsSync(path.join(repoRoot, ".artifacts"));

  const versionCapture = runCommand("codegraph", ["--version"], repoRoot);
  const telemetryCapture = runCommand("codegraph", ["telemetry", "status"], repoRoot);
  const detect = await manager.detect();
  const preInitStart = await manager.start();
  const preInitHealth = await manager.health();
  await manager.stop();

  const initCapture = runCommand("codegraph", ["init", repoRoot], repoRoot);

  const readyManager = new ManagedCodeGraphProcessManager({
    command: plannerConfig.command,
    startArgs: plannerConfig.startArgs,
    versionProbe: {
      args: plannerConfig.versionProbeArgs,
    },
    telemetryProbe: {
      args: plannerConfig.telemetryProbeArgs,
    },
    workspaceRoot: repoRoot,
    allowedWorkspaceRoot: repoRoot,
    logRoot: plannerConfig.logRoot!,
    indexRoot: plannerConfig.indexRoot!,
  });
  const postInitStart = await readyManager.start();
  const readyHealth = await readyManager.health();
  await readyManager.stop();

  const queryResults: SmokeQueryResult[] = [];
  for (const query of smokeQueries) {
    const rawCapture = runCommand("codegraph", ["explore", "-p", repoRoot, query], repoRoot);
    const slug = sanitizeFilePart(query);
    const rawOutputFile = path.join(reportRoot, `${reportPrefix}-${slug}-raw.txt`);
    writeText(
      rawOutputFile,
      [`$ ${rawCapture.command}`, "", rawCapture.stdout, rawCapture.stderr]
        .filter(Boolean)
        .join("\n"),
    );

    const toolResult = await codebaseExploreTool.execute({
      invocationId: `code-t014-${slug}`,
      args: { query },
      pushEvent: () => {},
      addArtifact: () => ({ id: `artifact-${slug}`, kind: "search-results", title: slug, data: {} }),
      trace: {
        startSpan: () => ({
          spanId: `span-${slug}`,
          end: () => {},
        }),
      },
      signal: new AbortController().signal,
      environment: createHarnessEnvironmentSnapshot({
        workspace: {
          rootPath: repoRoot,
          source: "selected",
        },
      }),
    });

    const payload = toolResult.structuredContent as Record<string, any>;
    const exploreResult = payload.exploreResult as Record<string, any>;
    const verificationResult = payload.verificationResult as Record<string, any>;
    const trace = payload.trace as Record<string, any>;
    const exploreTrace = trace.explore as Record<string, any>;

    queryResults.push({
      query,
      rawOutputFile,
      command: rawCapture.command,
      commandExitCode: rawCapture.exitCode,
      status: String(exploreResult.status),
      candidateCount: Number(exploreTrace.resultCount ?? 0),
      verifiedCount: Number(verificationResult.verifiedCount ?? 0),
      rejectedCount: Number(verificationResult.rejectedCount ?? 0),
      unverifiableCount: Number(verificationResult.unverifiableCount ?? 0),
      fallbackReason:
        typeof exploreTrace.fallbackReason === "string" ? exploreTrace.fallbackReason : null,
    });
  }

  const postRepoCodegraph = fs.existsSync(path.join(repoRoot, ".codegraph"));
  const postRepoArtifacts = fs.existsSync(path.join(repoRoot, ".artifacts"));
  const pollution = {
    preRepoCodegraph,
    postRepoCodegraph,
    preRepoArtifacts,
    postRepoArtifacts,
    addedRepoCodegraph: !preRepoCodegraph && postRepoCodegraph,
    addedRepoArtifacts: !preRepoArtifacts && postRepoArtifacts,
  };

  const summary = {
    workspaceRoot: repoRoot,
    appDataRoot,
    detect,
    preInitStart,
    preInitHealth,
    postInitStart,
    readyHealth,
    pollution,
    queryResults,
    commandOutputs: {
      version: captureCommand("version", versionCapture),
      telemetry: captureCommand("telemetry", telemetryCapture),
      init: captureCommand("init", initCapture),
    },
  };

  writeText(
    path.join(reportRoot, `${reportPrefix}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const reportLines = [
    `# code_T014 CodeGraph Real Provider Smoke`,
    ``,
    `## Detect`,
    `- command: \`${plannerConfig.command}\``,
    `- startArgs: \`${JSON.stringify(plannerConfig.startArgs)}\``,
    `- providerVersion: \`${detect.providerVersion}\``,
    `- telemetryStatus: \`${detect.telemetryStatus}\``,
    `- appDataRoot: \`${appDataRoot}\``,
    `- logRoot: \`${plannerConfig.logRoot}\``,
    `- indexRoot: \`${plannerConfig.indexRoot}\``,
    ``,
    `## Start And Health`,
    `- pre-init start: \`${preInitStart.status}\``,
    `- pre-init health: \`${preInitHealth.status}\` (${preInitHealth.lastError ?? "no-error"})`,
    `- post-init start: \`${postInitStart.status}\``,
    `- post-init health: \`${readyHealth.status}\` (${readyHealth.lastError ?? "no-error"})`,
    `- initializedNotificationSent: \`${readyHealth.initializedNotificationSent}\``,
    ``,
    `## Query Results`,
    ...queryResults.flatMap((result) => [
      `### ${result.query}`,
      `- command: \`${result.command}\``,
      `- raw output: \`${path.relative(repoRoot, result.rawOutputFile).replace(/\\/g, "/")}\``,
      `- status: \`${result.status}\``,
      `- candidateCount: \`${result.candidateCount}\``,
      `- verifiedCount: \`${result.verifiedCount}\``,
      `- rejectedCount: \`${result.rejectedCount}\``,
      `- unverifiableCount: \`${result.unverifiableCount}\``,
      `- fallbackReason: \`${result.fallbackReason ?? "none"}\``,
      ``,
    ]),
    `## Repo Pollution`,
    `- preRepoCodegraph: \`${pollution.preRepoCodegraph}\``,
    `- postRepoCodegraph: \`${pollution.postRepoCodegraph}\``,
    `- preRepoArtifacts: \`${pollution.preRepoArtifacts}\``,
    `- postRepoArtifacts: \`${pollution.postRepoArtifacts}\``,
    `- addedRepoCodegraph: \`${pollution.addedRepoCodegraph}\``,
    `- addedRepoArtifacts: \`${pollution.addedRepoArtifacts}\``,
    ``,
    `## Conclusion`,
    pollution.addedRepoCodegraph || pollution.addedRepoArtifacts
      ? `blocked`
      : `continue`,
  ];

  writeText(
    path.join(reportRoot, `${reportPrefix}.md`),
    `${reportLines.join("\n")}\n`,
  );
};

await runSmoke();
