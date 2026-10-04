import type {
  ToolContentBlock,
  ToolDefinition,
  ToolEvidence,
  ToolResult,
} from "./definitions.js";

export type NormalizedToolResult = {
  content: ToolContentBlock[];
  structuredContent: unknown;
  isError: boolean;
};

export const normalizeToolResult = (result: ToolResult): NormalizedToolResult => ({
  content: result.content ?? [],
  structuredContent: result.structuredContent,
  isError: result.isError === true,
});

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const textPreview = (value: unknown, limit = 280) => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()}...` : normalized;
};

const baseEvidence = (input: {
  result: unknown;
  isError: boolean;
  actionTaken: string;
  facts: string[];
  gaps?: string[];
  error?: string;
  status?: ToolEvidence["status"];
  data?: unknown;
}): ToolEvidence => ({
  actionTaken: input.actionTaken,
  facts: input.facts,
  ...(input.gaps?.length ? { gaps: input.gaps } : {}),
  ...(input.error ? { error: input.error } : {}),
  status: input.status ?? (input.isError ? "failed" : "completed"),
  ...(input.data === undefined ? {} : { data: input.data }),
});

const projectReadEvidence = (toolId: string, result: Record<string, unknown>, isError: boolean) => {
  if (toolId === "read_open" || toolId === "read") {
    const path = typeof result.path === "string" ? result.path : "unknown";
    const source = asRecord(result.source);
    const text = typeof source?.text === "string" ? source.text : "";
    const contentPreview = textPreview(text);
    const truncated = contentPreview.length < text.length;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Opened file ${path}.`,
      facts: [`contentLength=${text.length}`, ...(contentPreview ? [contentPreview] : [])],
      gaps: truncated ? ["File content is truncated."] : undefined,
      status: truncated ? "truncated" : undefined,
      data: { kind: "read_open", path, contentPreview, contentLength: text.length, truncated },
    });
  }
  if (toolId === "read_list" || toolId === "read_discover") {
    const operation = typeof result.operation === "string" ? result.operation : "list";
    const entries = Array.isArray(result.entries) ? result.entries : Array.isArray(result.matches) ? result.matches : [];
    const returnedCount = typeof result.returnedCount === "number" ? result.returnedCount : entries.length;
    const totalCount = typeof result.totalCount === "number" ? result.totalCount : undefined;
    const truncated = result.truncated === true || result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount);
    const candidatePaths = toolId === "read_discover"
      ? (operation === "list"
        ? entries.filter(asRecord).map((entry) => typeof entry.name === "string" ? entry.name : "unknown")
        : entries.filter(asRecord).map((entry) => typeof entry.path === "string" ? entry.path : "unknown"))
      : [];
    const candidatePreview = candidatePaths.slice(0, 5);
    const path = typeof result.path === "string" ? result.path : undefined;
    const root = typeof result.root === "string" ? result.root : typeof result.scope === "string" ? result.scope : undefined;
    const query = typeof result.query === "string" ? result.query : undefined;
    return baseEvidence({
      result,
      isError,
      actionTaken: `Discovered ${returnedCount} workspace candidate(s) using ${operation}.`,
      facts: [
        `operation=${operation}`,
        ...(path ? [`path=${path}`] : []),
        ...(root ? [`root=${root}`] : []),
        ...(query ? [`query=${query}`] : []),
        `candidateCount=${returnedCount}`,
        `returnedCount=${returnedCount}`,
        ...(totalCount === undefined ? [] : [`totalCount=${totalCount}`]),
        `hasMore=${result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount)}`,
        `truncated=${truncated}`,
        ...candidatePreview.map((candidate) => `candidatePath=${candidate}`),
      ],
      gaps: truncated ? ["Discovery results are truncated; more candidates may exist."] : entries.length === 0 ? ["No workspace matches were returned."] : undefined,
      status: truncated ? "truncated" : undefined,
      data: {
        kind: toolId === "read_list" ? "read_list" : "read_discover",
        ...(toolId === "read_discover" ? {
          mode: typeof result.mode === "string" ? result.mode : operation,
          operation,
          ...(path ? { path } : {}),
          ...(root ? { root } : {}),
          ...(query ? { query } : {}),
          candidateCount: returnedCount,
          candidatePaths: candidatePreview,
          returnedCount,
          ...(totalCount === undefined ? {} : { totalCount }),
          hasMore: result.hasMore === true || (totalCount !== undefined && returnedCount < totalCount),
        } : {
          operation,
          returnedCount,
          ...(totalCount === undefined ? {} : { totalCount }),
        }),
        truncated,
      },
    });
  }
  if (toolId === "read_locate" || toolId === "grep") {
    const query = typeof result.query === "string" ? result.query : "";
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const sortedMatches = matches.filter(asRecord).map((match) => ({
      path: typeof match.path === "string" ? match.path : "unknown",
      matchType: match.matchType === "content" ? "content" : "path",
      preview: typeof match.preview === "string" ? textPreview(match.preview, 120) : "",
    })).sort((left, right) => {
      const leftPriority = /^(docs[\\/]|readme\\.md$|agents\\.md$)/iu.test(left.path) ? 0 : 1;
      const rightPriority = /^(docs[\\/]|readme\\.md$|agents\\.md$)/iu.test(right.path) ? 0 : 1;
      return leftPriority - rightPriority || left.path.localeCompare(right.path);
    });
    const truncated = result.truncated === true || sortedMatches.length > 5;
    const matchesPreview = sortedMatches.slice(0, 5).map((match) =>
      match.preview ? `[${match.matchType}] ${match.path}: ${match.preview}` : `[${match.matchType}] ${match.path}`,
    );
    return baseEvidence({
      result,
      isError,
      actionTaken: `Located ${sortedMatches.length} workspace match(es) for "${query}".`,
      facts: [`matchCount=${sortedMatches.length}`, ...matchesPreview],
      gaps: [
        ...(sortedMatches.length === 0 ? ["No workspace matches were returned."] : []),
        ...(truncated ? ["Search results are truncated."] : []),
      ],
      status: truncated ? "truncated" : undefined,
      data: {
        kind: "read_locate",
        scope: typeof result.scope === "string" ? result.scope : "workspace",
        query,
        searchMode: result.searchMode === "path" || result.searchMode === "content" ? result.searchMode : "auto",
        matchCount: sortedMatches.length,
        matchedPaths: sortedMatches.map((match) => match.path),
        matchesPreview,
        truncated,
      },
    });
  }
  return undefined;
};

export const projectToolEvidence = (
  definition: Pick<ToolDefinition, "id" | "source" | "domain">,
  normalized: NormalizedToolResult,
): ToolEvidence | undefined => {
  const result = asRecord(normalized.structuredContent);
  if (!result) {
    return baseEvidence({
      result: normalized.structuredContent,
      isError: normalized.isError,
      actionTaken: `${definition.id} completed.`,
      facts: [`toolId=${definition.id}`],
      gaps: normalized.structuredContent === undefined ? ["The tool returned no structured result."] : undefined,
      data: { kind: "generic_structured", value: normalized.structuredContent },
    });
  }

  const readEvidence = projectReadEvidence(definition.id, result, normalized.isError);
  if (readEvidence) return readEvidence;

  if (definition.id === "terminal_session") {
    const exitCode = typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : null;
    const timedOut = result.timedOut === true;
    const command = typeof result.command === "string" ? result.command : "unknown";
    const commandSucceeded = timedOut ? "unknown" : exitCode === 0 ? "true" : typeof exitCode === "number" ? "false" : "unknown";
    const stdout = typeof result.stdout === "string" ? textPreview(result.stdout) : "";
    const stderr = typeof result.stderr === "string" ? textPreview(result.stderr) : "";
    const stdoutEncoding = result.stdoutEncoding ?? "unknown";
    const stderrEncoding = result.stderrEncoding ?? "unknown";
    const binaryDetected = result.binaryDetected === true;
    const unreadableReason = binaryDetected
      ? "Terminal output contains binary data."
      : stdoutEncoding === "unknown" || stderrEncoding === "unknown"
        ? "Terminal output encoding is unknown."
        : /[\uFFFD�]|锟|\?{3,}/u.test(`${stdout} ${stderr}`)
          ? "Terminal output contains replacement, mojibake, or placeholder characters."
          : undefined;
    const outputInterpretable = unreadableReason === undefined;
    const gaps = [
      ...(timedOut ? ["Command did not finish."] : []),
      ...(result.truncated === true ? ["Terminal output is truncated."] : []),
      ...(!outputInterpretable ? ["Terminal output encoding or text is not reliably interpretable."] : []),
    ];
    const status = timedOut
      ? "timed_out"
      : result.truncated === true
        ? "truncated"
        : !outputInterpretable
          ? binaryDetected ? "binaryDetected" : "partial"
          : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Executed terminal command "${command}".`,
      facts: [
        `exitCode=${exitCode === null ? "null" : exitCode}`,
        `timedOut=${timedOut}`,
        `truncated=${result.truncated === true}`,
        ...(stdout ? [`stdout=${stdout}`] : []),
        ...(stderr ? [`stderr=${stderr}`] : []),
      ],
      gaps,
      status,
      data: {
        kind: "terminal_session",
        command,
        exitCode,
        processCompleted: !timedOut,
        commandSucceeded,
        stdoutPreview: stdout,
        stderrPreview: stderr,
        stdoutEncoding,
        stderrEncoding,
        timedOut,
        truncated: result.truncated === true,
        binaryDetected,
        violations: Array.isArray(result.violations) ? result.violations.filter((item): item is string => typeof item === "string") : [],
        outputInterpretable,
        ...(unreadableReason ? { unreadableReason } : {}),
      },
    });
  }

  if (definition.source === "external" && definition.domain === "external_mcp" && definition.id.startsWith("mcp:")) {
    const serverId = typeof result.serverId === "string" ? result.serverId : "unknown";
    const remoteToolName = typeof result.remoteToolName === "string" ? result.remoteToolName : definition.id;
    const nested = result.result;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Called remote MCP tool ${remoteToolName}.`,
      facts: [`serverId=${serverId}`, `remoteToolName=${remoteToolName}`, `invocationStatus=${String(result.invocationStatus ?? "completed")}`],
      gaps: normalized.isError ? ["The remote MCP tool reported an error outcome."] : undefined,
      data: { kind: "external_mcp", serverId, remoteToolName, invocationStatus: result.invocationStatus ?? "completed", recoveryOccurred: result.recoveryOccurred === true, resultPreview: textPreview(nested) },
    });
  }

  if (definition.id.startsWith("browser_") || definition.id.startsWith("browser_attached_")) {
    const page = asRecord(result.page);
    const url = typeof result.url === "string" ? result.url : typeof page?.url === "string" ? page.url : undefined;
    const title = typeof result.title === "string" ? result.title : typeof page?.title === "string" ? page.title : undefined;
    const operation = definition.id === "browser_observe" ? "observe" : definition.id === "browser_act" ? "act" : definition.id === "browser_assert" ? "assert" : definition.id;
    const observation = asRecord(result.observation);
    const assertion = asRecord(result.assertion);
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: `Called ${definition.id}.`,
      facts: [
        `operation=${operation}`,
        `ok=${result.ok === false ? "false" : "true"}`,
        ...(url ? [`url=${url}`] : []),
        ...(title ? [`title=${title}`] : []),
        ...(typeof page?.snapshotHash === "string" ? [`snapshotHash=${page.snapshotHash}`] : []),
        ...(typeof observation?.visibleText === "string" ? [`visibleText=${textPreview(observation.visibleText)}`] : []),
        ...(typeof assertion?.kind === "string" ? [`assertion=${assertion.kind}`] : []),
        ...(typeof assertion?.passed === "boolean" ? [`passed=${assertion.passed}`] : []),
      ],
      gaps: normalized.isError ? ["Browser operation reported an error outcome."] : undefined,
      error: typeof asRecord(result.error)?.message === "string" ? String(asRecord(result.error)?.message) : undefined,
      status: normalized.isError || result.ok === false ? "failed" : undefined,
      data: { kind: "computer_use_browser", operation, ...(url ? { url } : {}), ...(title ? { title } : {}), ...result },
    });
  }

  if (definition.id.startsWith("github_")) {
    const repository = typeof result.repository === "string" ? result.repository : "unknown";
    const operation = typeof result.operation === "string" ? result.operation : undefined;
    const issue = asRecord(result.issue);
    const pullRequest = asRecord(result.pullRequest);
    const run = asRecord(result.run);
    const comments = Array.isArray(result.comments) ? result.comments.length : 0;
    const files = Array.isArray(result.files) ? result.files.length : 0;
    const reviews = Array.isArray(result.reviews) ? result.reviews.length : 0;
    const facts = [`toolId=${definition.id}`, `repository=${repository}`];
    if (definition.id === "github_repo_read") {
      const metadata = asRecord(result.metadata);
      facts.push(`Default branch is ${typeof metadata?.defaultBranch === "string" && metadata.defaultBranch ? metadata.defaultBranch : "unknown"}.`);
      facts.push(`Returned ${Array.isArray(result.commits) ? result.commits.length : 0} commit(s) and ${Array.isArray(result.branches) ? result.branches.length : 0} branch(es).`);
    } else if (issue) {
      facts.push(`Issue state is ${String(issue.state ?? "unknown")}.`, `Returned ${comments} comment(s).`);
    } else if (pullRequest) {
      facts.push(`Pull Request state is ${String(pullRequest.state ?? "unknown")}.`, `Returned ${files} file(s), ${comments} comment(s), and ${reviews} review(s).`);
    } else if (run) {
      facts.push(`Run status is ${String(run.status ?? "unknown")}.`, `Run conclusion is ${String(run.conclusion ?? "not completed")}.`, `Returned ${Array.isArray(result.jobs) ? result.jobs.length : 0} Job(s).`);
    } else if (operation) {
      facts.push(`operation=${operation}`);
    }
    return baseEvidence({ result, isError: normalized.isError, actionTaken: `Executed ${definition.id}.`, facts, data: { kind: "github", repository, ...(operation ? { operation } : {}), ...result } });
  }

  const unwrapped = asRecord(result.result) ?? result;
  if (definition.id === "edit_file" || definition.id === "write_file" || definition.id === "replace_block") {
    if (typeof unwrapped.path === "string" && (unwrapped.operation === "write_file" || unwrapped.operation === "replace_block")) {
      const dryRun = unwrapped.dryRun === true;
      const operation = unwrapped.operation === "replace_block" ? "replace" : "create";
      const actionProfileId = typeof result.actionProfileId === "string" ? result.actionProfileId : undefined;
      const runtimeToolId = typeof result.runtimeToolId === "string" ? result.runtimeToolId : undefined;
      return baseEvidence({
        result,
        isError: normalized.isError,
        actionTaken: dryRun ? `Prepared a dry-run edit for workspace file ${unwrapped.path}.` : `Changed workspace file ${unwrapped.path}.`,
        facts: [`operation=${operation}`, `targetPath=${unwrapped.path}`, `dryRun=${dryRun}`, `changed=${!dryRun}`],
        data: { kind: "edit_file", operation, targetPath: unwrapped.path, dryRun, changed: !dryRun, created: !dryRun && operation === "create", replaced: !dryRun && operation === "replace", ...(actionProfileId ? { actionProfileId } : {}), ...(runtimeToolId ? { runtimeToolId } : {}) },
      });
    }
  }

  if (definition.id === "workspace_mutation" && typeof unwrapped.targetPath === "string" && (unwrapped.operation === "write" || unwrapped.operation === "delete" || unwrapped.operation === "move")) {
    const dryRun = unwrapped.dryRun === true;
    const operation = unwrapped.operation === "write" ? unwrapped.overwrite === true ? "overwrite" : "create" : unwrapped.operation;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: dryRun ? `Prepared a dry-run workspace mutation for ${unwrapped.targetPath}.` : `Applied workspace mutation to ${unwrapped.targetPath}.`,
      facts: [`operation=${operation}`, `targetPath=${unwrapped.targetPath}`, `dryRun=${dryRun}`, `changed=${!dryRun}`],
      data: { kind: "workspace_mutation", operation, targetPath: unwrapped.targetPath, ...(typeof unwrapped.destinationPath === "string" ? { destinationPath: unwrapped.destinationPath } : {}), dryRun, changed: !dryRun, created: !dryRun && operation === "create", replaced: !dryRun && operation === "overwrite", deleted: !dryRun && operation === "delete", moved: !dryRun && operation === "move" },
    });
  }

  if (definition.id.startsWith("office_")) {
    const operation = typeof result.operation === "string" ? result.operation : "unknown";
    const pathFacts = [
      typeof result.inputPath === "string" ? `Source: ${result.inputPath}` : undefined,
      typeof result.outputPath === "string" ? `Output: ${result.outputPath}` : undefined,
    ].filter((value): value is string => Boolean(value));
    const detail = result.summary ?? result.runtime ?? result.validation ?? result.verification ?? result.recalculation ?? result.data;
    return baseEvidence({ result, isError: normalized.isError, actionTaken: `Executed ${definition.id} operation ${operation}.`, facts: [`toolId=${definition.id}`, ...pathFacts, ...(detail === undefined ? [] : [`Result: ${textPreview(detail)}`])], data: { kind: definition.id, operation, ...result } });
  }

  if (definition.id === "ask_external_expert") {
    const status = typeof result.status === "string" ? result.status : "completed";
    const latencyMs = typeof result.latencyMs === "number" ? result.latencyMs : undefined;
    return baseEvidence({ result, isError: normalized.isError, actionTaken: "Received advice from the configured external expert.", facts: ["tool=ask_external_expert", `status=${status}`, ...(latencyMs === undefined ? [] : [`latencyMs=${latencyMs}`])], data: result });
  }

  if (definition.id === "codebase_explore") {
    const verified = asRecord(result.verifiedEvidenceInput);
    const retrieval = result.retrievalEvidence;
    const nestedExplore = asRecord(result.exploreResult);
    const degraded = result.degraded === true || nestedExplore?.degraded === true;
    const fallbackSignal = typeof result.fallbackSignal === "string" ? result.fallbackSignal : asRecord(nestedExplore?.fallbackSignal);
    const fallbackText = typeof fallbackSignal === "string" ? fallbackSignal : fallbackSignal ? textPreview(fallbackSignal) : undefined;
    return baseEvidence({
      result,
      isError: normalized.isError,
      actionTaken: "Explored the codebase.",
      facts: [degraded ? "degraded=true" : "degraded=false", ...(fallbackText ? [`fallbackSignal=${fallbackText}`] : []), ...(nestedExplore?.status ? [`exploreStatus=${String(nestedExplore.status)}`] : [])],
      gaps: degraded || result.partial === true ? ["Codebase exploration returned partial evidence."] : undefined,
      status: degraded || result.partial === true ? "partial" : undefined,
      data: { kind: "codebase_explore", verifiedEvidenceInput: verified ?? null, retrievalEvidence: retrieval ?? null, exploreResult: nestedExplore ?? null },
    });
  }

  return baseEvidence({
    result,
    isError: normalized.isError,
    actionTaken: `${definition.id} returned structured data.`,
    facts: [`resultKeys=${Object.keys(result).join(",")}`],
    gaps: normalized.isError ? ["The tool reported an error outcome."] : undefined,
    data: { kind: "generic_structured", preview: result },
  });
};
