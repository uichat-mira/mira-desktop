import type { ToolImplementation } from "../core/definitions.js";
import * as S from "./github-domain.shared.js";

const {
  GITHUB_WORKBENCH, actionsSchema, normalizeOperation,
  normalizeGitHubRepositoryName, runReadDelegate, authorizeRepository,
  encodeGitHubRepositoryPath, normalizeInteger, MAX_TEXT_CHARS, truncate,
  addArtifact, completed, normalizeString, normalizeObject,
  requireRemoteWriteApproval, normalizeBoolean, mcpBadRequest,
} = S;
type GitHubReadClient = S.GitHubReadClient;
type GitHubApi = ReturnType<typeof S.createGitHubApi>;
type WorkflowJobsResponse = S.WorkflowJobsResponse;

export const createActionsTool = (
  client: GitHubReadClient,
  api: GitHubApi,
  baseTool: ToolImplementation,
): ToolImplementation => ({
  definition: {
    id: "github_actions",
    title: "GitHub Actions",
    description:
      "列出和读取 workflow run、读取 Job 日志、触发 workflow_dispatch、重新运行或取消 workflow run。operation 决定具体参数结构。",
    domain: "github",
    source: "internal",
    mode: "sync",
    inputSchema: actionsSchema,
    outputSchema: { type: "object", additionalProperties: true },
    tags: [
      "github",
      "actions",
      "workflow",
      "ci",
      "build",
      "日志",
      "工作流",
      "构建",
    ],
    capabilities: {
      sideEffect: "network",
      requiresApproval: false,
      networkAccess: true,
    },
    workbench: {
      ...GITHUB_WORKBENCH,
      defaultArgs: {
        operation: "list_runs",
        repository: "owner/repository",
        limit: 20,
        page: 1,
      },
    },
  },
  execute: async (context) => {
    const operation = normalizeOperation(context.args.operation, [
      "list_runs",
      "get_run",
      "get_logs",
      "dispatch",
      "rerun",
      "cancel",
    ] as const);
    const repository = normalizeGitHubRepositoryName(context.args.repository);

    if (operation === "list_runs" || operation === "get_run") {
      return runReadDelegate(baseTool, context, "github_actions", operation, {
        repository,
        ...(operation === "get_run"
          ? {
              runId: context.args.runId,
              includeJobs: context.args.includeJobs,
              jobLimit: context.args.jobLimit,
            }
          : {
              workflow: context.args.workflow,
              branch: context.args.branch,
              event: context.args.event,
              status: context.args.status,
              actor: context.args.actor,
              limit: context.args.limit,
              page: context.args.page,
            }),
      });
    }

    const authorized = await authorizeRepository(context, client, repository);
    const repoPath = encodeGitHubRepositoryPath(authorized.repository.fullName);
    const token = authorized.connection.accessToken;

    if (operation === "get_logs") {
      const runId = normalizeInteger(context.args.runId, "runId", {
        required: true,
        min: 1,
      })!;
      const jobId = normalizeInteger(context.args.jobId, "jobId", { min: 1 });
      const maxChars = normalizeInteger(context.args.maxChars, "maxChars", {
        fallback: MAX_TEXT_CHARS,
        min: 1,
        max: 500_000,
      })!;
      let jobs: NonNullable<WorkflowJobsResponse["jobs"]> = [];
      if (jobId) {
        jobs = [{ id: jobId }];
      } else {
        const response = await api.json<WorkflowJobsResponse>(
          `/repos/${repoPath}/actions/runs/${runId}/jobs?per_page=100&page=1`,
          token,
          { signal: context.signal },
        );
        jobs = response?.jobs ?? [];
      }
      const logs: Array<{
        jobId: string;
        name: string;
        status: string;
        conclusion: string | null;
        text: string;
        truncated: boolean;
      }> = [];
      let remaining = maxChars;
      for (const job of jobs) {
        if (!job.id || remaining <= 0) break;
        const raw =
          (await api.text(
            `/repos/${repoPath}/actions/jobs/${job.id}/logs`,
            token,
            {
              signal: context.signal,
              accept: "text/plain",
            },
          )) ?? "";
        const text = truncate(raw, remaining);
        logs.push({
          jobId: String(job.id),
          name: job.name ?? "",
          status: job.status ?? "",
          conclusion: job.conclusion ?? null,
          text,
          truncated: raw.length > remaining,
        });
        remaining -= Math.min(raw.length, remaining);
      }
      const result = {
        repository: authorized.repository.fullName,
        runId: String(runId),
        logs,
        truncated: logs.some((item) => item.truncated) || jobs.length > logs.length,
      };
      addArtifact(context, {
        toolId: "github_actions",
        operation,
        repository: authorized.repository.fullName,
        title: `GitHub Actions logs for run ${runId}`,
        kind: "text",
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Returned logs for ${logs.length} job(s) in run ${runId}.`,
      ]);
    }

    if (operation === "dispatch") {
      const workflowValue = context.args.workflow;
      if (
        !(
          (typeof workflowValue === "string" && workflowValue.trim()) ||
          (Number.isInteger(workflowValue) && (workflowValue as number) > 0)
        )
      ) {
        throw mcpBadRequest("workflow must be a non-empty string or positive integer");
      }
      const workflow = String(workflowValue).trim();
      const ref = normalizeString(context.args.ref, "ref", {
        required: true,
        maxLength: 255,
      })!;
      const inputs = normalizeObject(context.args.inputs, "inputs");
      if (inputs) {
        for (const [key, value] of Object.entries(inputs)) {
          if (
            !key.trim() ||
            !(typeof value === "string" || typeof value === "boolean" || typeof value === "number")
          ) {
            throw mcpBadRequest(
              "inputs must contain non-empty keys with string, boolean or number values",
            );
          }
        }
      }
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `Dispatch workflow ${workflow} on ref ${ref}.`,
      });
      await api.json(
        `/repos/${repoPath}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
        token,
        {
          method: "POST",
          body: { ref, ...(inputs ? { inputs } : {}) },
          signal: context.signal,
        },
      );
      const result = {
        repository: authorized.repository.fullName,
        workflow,
        ref,
        dispatched: true,
        inputs: inputs ?? {},
      };
      addArtifact(context, {
        toolId: "github_actions",
        operation,
        repository: authorized.repository.fullName,
        title: `Dispatched workflow ${workflow}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Dispatched workflow ${workflow} on ${ref}.`,
      ]);
    }

    const runId = normalizeInteger(context.args.runId, "runId", {
      required: true,
      min: 1,
    })!;
    if (operation === "rerun") {
      const failedJobsOnly = normalizeBoolean(
        context.args.failedJobsOnly,
        "failedJobsOnly",
      );
      requireRemoteWriteApproval(context, {
        operation,
        repository: authorized.repository.fullName,
        summary: `${failedJobsOnly ? "Rerun failed jobs in" : "Rerun"} workflow run ${runId}.`,
      });
      await api.json(
        `/repos/${repoPath}/actions/runs/${runId}/${
          failedJobsOnly ? "rerun-failed-jobs" : "rerun"
        }`,
        token,
        { method: "POST", signal: context.signal },
      );
      const result = {
        repository: authorized.repository.fullName,
        runId: String(runId),
        rerunRequested: true,
        failedJobsOnly,
      };
      addArtifact(context, {
        toolId: "github_actions",
        operation,
        repository: authorized.repository.fullName,
        title: `Rerun Actions run ${runId}`,
        data: result,
      });
      return completed(operation, authorized.repository.fullName, result, [
        `Requested rerun for workflow run ${runId}.`,
      ]);
    }

    requireRemoteWriteApproval(context, {
      operation,
      repository: authorized.repository.fullName,
      summary: `Cancel workflow run ${runId}.`,
      highRisk: true,
    });
    await api.json(`/repos/${repoPath}/actions/runs/${runId}/cancel`, token, {
      method: "POST",
      signal: context.signal,
    });
    const result = {
      repository: authorized.repository.fullName,
      runId: String(runId),
      cancelRequested: true,
    };
    addArtifact(context, {
      toolId: "github_actions",
      operation,
      repository: authorized.repository.fullName,
      title: `Cancelled Actions run ${runId}`,
      data: result,
    });
    return completed(operation, authorized.repository.fullName, result, [
      `Requested cancellation for workflow run ${runId}.`,
    ]);
  },
});
