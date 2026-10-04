import type { AgentEvidenceSummary, AgentRetrievalEvidence } from "@/agent/types";
import { getActiveCodeGraphStudioService } from "@/microapps/codegraph/index.js";
import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  type CodebaseExploreTrace,
  type CodebaseVerificationResult,
} from "./types.js";
import { CodebaseExploreWrapper } from "./codebase-explore-wrapper.js";
import {
  toAgentRetrievalEvidenceFromVerification,
  verifyCodebaseExploreResult,
} from "./codegraph-verification-bridge.js";
import {
  createManagedCodeGraphPlannerStorageFromAppDataRoot,
  resolveManagedCodeGraphExternalIndexSupport,
  resolveManagedCodeGraphPlannerConfig,
} from "./planner-exposure-config.js";
import { createCodebaseExploreTrace } from "./codegraph-trace-diagnostics.js";
import {
  createManagedCodeGraphWorkspaceHash,
  isRealCodeGraphCommand,
  type ManagedCodeGraphProcessManager,
} from "./repo-local-process-manager.js";
import {
  getRepoLocalManagedCodeGraphManager,
  getRepoLocalManagedCodeGraphManagerForAgentWorkspace,
  type RepoLocalManagedContext,
  type RepoLocalRuntimeContext,
} from "./repo-local-manager-cache.js";

const nowIso = () => new Date().toISOString();
const PLANNER_VERIFIED_SOURCE_LIMIT = 5;
const PLANNER_VERIFIED_EXCERPT_CHAR_LIMIT = 900;
const PLANNER_VERIFIED_SUMMARY_CHAR_LIMIT = 240;

const compactPlannerText = (value: string | null | undefined, limit: number) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
};

const createVerifiedSourceFindings = (
  verification: CodebaseVerificationResult,
) =>
  verification.verified
    .slice(0, PLANNER_VERIFIED_SOURCE_LIMIT)
    .map((entry, index) => {
      const sourcePath = entry.verifiedPath ?? entry.path;
      const lineRange =
        entry.verifiedStartLine && entry.verifiedEndLine
          ? `L${entry.verifiedStartLine}-L${entry.verifiedEndLine}`
          : "verified-range-unavailable";
      const summary = compactPlannerText(
        entry.verifiedSummary,
        PLANNER_VERIFIED_SUMMARY_CHAR_LIMIT,
      );
      const excerpt = compactPlannerText(
        entry.minimalExcerpt,
        PLANNER_VERIFIED_EXCERPT_CHAR_LIMIT,
      );

      return [
        `verifiedSource[${index + 1}]`,
        `path=${sourcePath}`,
        `lines=${lineRange}`,
        summary ? `summary=${summary}` : null,
        excerpt ? `excerpt=${excerpt}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    });

const createCodebaseExploreRetrievalSummary = (input: {
  retrieval: AgentRetrievalEvidence;
  verification: CodebaseVerificationResult;
  exploreTrace: CodebaseExploreTrace;
  verificationTrace: CodebaseExploreTrace;
}): AgentEvidenceSummary => {
  const documentsPreview = input.retrieval.chunks
    .slice(0, PLANNER_VERIFIED_SOURCE_LIMIT)
    .map((chunk) => chunk.documentName);
  const verifiedSourceFindings = createVerifiedSourceFindings(input.verification);
  const partial =
    input.exploreTrace.status !== "ok" ||
    input.verificationTrace.status !== "ok" ||
    input.exploreTrace.fallbackUsed;
  const gaps = [
    ...(input.verification.rejected.length > 0
      ? [
          `${input.verification.rejected.length} CodeGraph candidate(s) were rejected during workspace source verification; only open a rejected target if the remaining task explicitly requires that missing context.`,
        ]
      : []),
    ...(input.verification.unverifiable.length > 0
      ? [
          `${input.verification.unverifiable.length} CodeGraph candidate(s) lacked a stable verifiable range; targeted read_open is appropriate only for those specific unresolved targets.`,
        ]
      : []),
    ...(input.exploreTrace.fallbackReason
      ? [`CodeGraph fallback reason: ${input.exploreTrace.fallbackReason}`]
      : []),
  ];

  return {
    source: "retrieval",
    status: partial ? "partial" : "completed",
    actionTaken: `Codebase explore verified ${input.retrieval.chunkCount} workspace chunk(s) for "${input.retrieval.query}". Verified excerpts below are already source-body evidence re-read from the workspace.`,
    keyFindings: [
      ...verifiedSourceFindings,
      `verifiedChunkCount=${input.retrieval.chunkCount}`,
      `verifiedCandidateCount=${input.verification.verified.length}`,
      `rejectedCandidateCount=${input.verification.rejected.length}`,
      `unverifiableCandidateCount=${input.verification.unverifiable.length}`,
      `exploreStatus=${input.exploreTrace.status}`,
      `verificationStatus=${input.verificationTrace.status}`,
      ...(input.exploreTrace.fallbackReason
        ? [`fallbackReason=${input.exploreTrace.fallbackReason}`]
        : []),
    ],
    ...(gaps.length > 0 ? { gaps } : {}),
    data: {
      kind: "retrieval",
      query: input.retrieval.query,
      chunkCount: input.retrieval.chunkCount,
      documentsPreview,
    },
  };
};

const createInvocationWorkspaceRuntimeContext = (input: {
  workspaceRoot: string;
  studioDraft: {
    command: string;
    startArgs: string[];
    versionProbeArgs: string[];
    telemetryProbeArgs: string[];
    appDataRoot: string;
    timeoutMs: number;
  };
}): RepoLocalRuntimeContext => {
  const workspaceHash = createManagedCodeGraphWorkspaceHash(input.workspaceRoot);
  const plannerConfig = resolveManagedCodeGraphPlannerConfig(input.workspaceRoot);
  const plannerStorage = input.studioDraft.appDataRoot.trim()
    ? createManagedCodeGraphPlannerStorageFromAppDataRoot(
        workspaceHash,
        input.studioDraft.appDataRoot,
      )
    : plannerConfig.storage;

  return {
    draft: {
      command: input.studioDraft.command,
      startArgs: [...input.studioDraft.startArgs],
      versionProbeArgs: [...input.studioDraft.versionProbeArgs],
      telemetryProbeArgs: [...input.studioDraft.telemetryProbeArgs],
      timeoutMs: input.studioDraft.timeoutMs,
    },
    plannerStorage,
    externalIndexSupport: resolveManagedCodeGraphExternalIndexSupport(
      input.studioDraft.command,
    ),
  };
};

export const codebaseExploreTool: ToolImplementation = {
  definition: {
    id: "codebase_explore",
    title: "Codebase Explore",
    description:
      "Primary local code-understanding tool for architecture, symbols, relationships, and impact. Candidates are re-read from the workspace before Evidence. Successful results include bounded verified source excerpts with paths and line ranges; treat those verified excerpts as source-body evidence and do not mechanically read_open the same files unless a specific unresolved line/context gap remains.",
    domain: "read",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
    },
    tags: ["codebase", "codegraph", "architecture", "explore", "verification"],
    capabilities: {
      sideEffect: "none",
      requiresApproval: false,
      workspaceBound: true,
    },
  },
  execute: async (context) => {
    const queryValue = context.args.query;
    if (typeof queryValue !== "string" || !queryValue.trim()) {
      throw mcpBadRequest("query is required");
    }

    const workspaceRoot = context.environment?.workspace.rootPath?.trim();
    if (!workspaceRoot) {
      throw mcpInternalError(
        "codebase_explore requires a resolved workspace root in the harness environment.",
      );
    }

    const studioService = getActiveCodeGraphStudioService();
    const studioDraft = studioService?.getDraft() ?? null;
    const plannerConfig = resolveManagedCodeGraphPlannerConfig(workspaceRoot);
    const realProvider = Boolean(
      studioDraft && isRealCodeGraphCommand(studioDraft.command),
    );
    const managedContext = realProvider
      ? null
      : (studioService?.getManagedCapabilityContext(workspaceRoot) ?? null);
    let manager: ManagedCodeGraphProcessManager | null = null;
    let runtimeMode: "studio" | "repo_local" = "studio";

    // Real Agent invocations are owned by the current thread/workspace, not by the
    // singleton Studio workspace. Studio only supplies provider configuration.
    if (realProvider && studioDraft) {
      manager = await getRepoLocalManagedCodeGraphManagerForAgentWorkspace(
        workspaceRoot,
        createInvocationWorkspaceRuntimeContext({
          workspaceRoot,
          studioDraft,
        }),
        {
          microAppEnabled: studioDraft.microAppEnabled,
          agentCapabilityEnabled: studioDraft.agentCapabilityEnabled,
        },
        context.threadId,
      );
      if (manager) {
        runtimeMode = "repo_local";
      }
    } else if (managedContext?.ok) {
      // Keep the managed Studio path for fake/test providers.
      manager = managedContext.manager;
    } else if (managedContext) {
      manager = await getRepoLocalManagedCodeGraphManager(
        workspaceRoot,
        managedContext as RepoLocalManagedContext,
      );
      if (manager) {
        runtimeMode = "repo_local";
      }
    }

    if (!manager && studioDraft && !realProvider) {
      manager = await getRepoLocalManagedCodeGraphManagerForAgentWorkspace(
        workspaceRoot,
        createInvocationWorkspaceRuntimeContext({
          workspaceRoot,
          studioDraft,
        }),
        {
          microAppEnabled: studioDraft.microAppEnabled,
          agentCapabilityEnabled: studioDraft.agentCapabilityEnabled,
        },
        context.threadId,
      );
      if (manager) {
        runtimeMode = "repo_local";
      }
    }

    if (!manager) {
      const gateReasonRecord = managedContext?.gate.reasons ?? [];
      const prioritizedGateReason =
        gateReasonRecord.find((reason) => reason.code === "app_data_root_unavailable") ??
        gateReasonRecord.find((reason) => reason.code === "agent_capability_disabled") ??
        gateReasonRecord.find((reason) => reason.code === "repo_pollution_risk") ??
        gateReasonRecord[0];
      const blockedReason =
        (!studioDraft
          ? "CodeGraph microapp configuration is unavailable."
          : !studioDraft.microAppEnabled
            ? "CodeGraph microapp is disabled."
            : prioritizedGateReason?.message) ??
        plannerConfig.externalIndexSupport.reason ??
        plannerConfig.storage.reason ??
        "Managed CodeGraph runtime is unavailable.";
      const trace = createCodebaseExploreTrace({
        originalQuery: queryValue,
        normalizedQuery: queryValue.trim(),
        selectedScope: ["workspace-general"],
        includePaths: [],
        excludePaths: [],
        internalCommand: "mixed",
        resultCount: 0,
        truncated: false,
        limitations: ["provider_unavailable", "query_failed"],
        fallbackSignal: {
          required: true,
          reason: "provider_unavailable",
          suggestedChain: [
            "codegraph",
            "scoped_search_text",
            "workspace_inventory",
            "read_file_slice",
          ],
        },
        verificationReadCount: 0,
        durationMs: 0,
        status: "failed",
        runtimeStatus: {
          providerVersion: null,
          telemetryStatus: "unavailable",
          workspaceHash: null,
          status: "blocked",
        },
      });
      const retrieval = {
        query: queryValue.trim(),
        chunkCount: 0,
        chunks: [],
        createdAt: nowIso(),
      };

      return {

        structuredContent: {
          capabilityId: "codebase_explore",
          plannerExposure: "controlled_tool_only",
          query: queryValue.trim(),
          scope: ["workspace-general"],
          verifiedEvidenceInput: retrieval,
          retrievalEvidence: retrieval,
          exploreResult: {
            status: "degraded",
            truncated: false,
            degraded: true,
            limitations: ["provider_unavailable", "query_failed"],
            followUpHints: [blockedReason],
            fallbackSignal: {
              required: true,
              reason: "provider_unavailable",
              suggestedChain: [
                "codegraph",
                "scoped_search_text",
                "workspace_inventory",
                "read_file_slice",
              ],
            },
          },
          verificationResult: {
            verifiedCount: 0,
            rejectedCount: 0,
            unverifiableCount: 0,
          },
          trace: {
            exposureMode: "controlled_tool_only",
            runtimeMode: "unavailable",
            explore: trace,
            verification: trace,
          },
        },
      };
    }

    const wrapper = new CodebaseExploreWrapper(manager);
    const exploreResult = await wrapper.explore({
      query: queryValue,
    });
    const verification = verifyCodebaseExploreResult(exploreResult, {
      workspaceRoot,
    });
    const retrieval = toAgentRetrievalEvidenceFromVerification(verification);
    retrieval.createdAt = nowIso();
    const retrievalSummary = createCodebaseExploreRetrievalSummary({
      retrieval,
      verification,
      exploreTrace: exploreResult.trace,
      verificationTrace: verification.trace,
    });
    retrieval.summary = retrievalSummary;

    context.addArtifact({
      kind: "search-results",
      title: `Codebase explore trace for ${queryValue.trim()}`,
      data: {
        runtimeMode,
        workspaceRoot,
        exploreTrace: exploreResult.trace,
        verificationTrace: verification.trace,
      },
      metadata: {
        capabilityId: "codebase_explore",
        plannerExposure: "controlled_tool_only",
        verifiedChunkCount: retrieval.chunkCount,
        runtimeMode,
        workspaceRoot,
      },
    });

    return {

      structuredContent: {
        capabilityId: "codebase_explore",
        plannerExposure: "controlled_tool_only",
        workspaceRoot,
        query: exploreResult.query,
        scope: exploreResult.scope,
        verifiedEvidenceInput: retrieval,
        retrievalEvidence: retrieval,
        exploreResult: {
          status: exploreResult.status,
          truncated: exploreResult.truncated,
          degraded: exploreResult.degraded,
          limitations: exploreResult.limitations,
          followUpHints: exploreResult.followUpHints,
          fallbackSignal: exploreResult.fallbackSignal,
        },
        verificationResult: {
          verifiedCount: verification.verified.length,
          rejectedCount: verification.rejected.length,
          unverifiableCount: verification.unverifiable.length,
        },
        trace: {
          exposureMode: "controlled_tool_only",
          runtimeMode,
          explore: exploreResult.trace,
          verification: verification.trace,
        },
      },
    };
  },
};
