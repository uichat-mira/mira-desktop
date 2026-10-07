import crypto from "node:crypto";
import fs from "node:fs";
import { createInvocationInputHash } from "@/agent/approval-fingerprint.js";
import { getHarnessEnvironmentSnapshot } from "@/harness/environment.js";
import { executeHarnessInvocation } from "@/harness/invocations.js";
import { getToolImplementation } from "@/harness/registry.js";
import type { ToolArtifact, ToolImplementation } from "@/mcp/core/definitions.js";
import { normalizeToolResult, projectToolEvidence } from "@/mcp/core/tool-result.js";
import { officeDocumentTool } from "@/mcp/tools/office-document.tool.js";
import { officePdfTool } from "@/mcp/tools/office-pdf.tool.js";
import { officePresentationTool } from "@/mcp/tools/office-presentation.tool.js";
import { officeSpreadsheetTool } from "@/mcp/tools/office-spreadsheet.tool.js";
import {
  resolveWorkspacePath,
  runWithWorkspaceRootOverride,
} from "@/mcp/workspace.js";
import type {
  SkillAgentApprovedInvocation,
  SkillAgentExecutionInput,
  SkillAgentRequirement,
  SkillAgentToolBinding,
} from "./types.js";

const PRIVATE_WENSHU_RUNTIME_TOOLS = new Map<string, ToolImplementation>([
  [officeDocumentTool.definition.id, officeDocumentTool],
  [officePdfTool.definition.id, officePdfTool],
  [officePresentationTool.definition.id, officePresentationTool],
  [officeSpreadsheetTool.definition.id, officeSpreadsheetTool],
]);

const READ_ONLY_PRIVATE_RUNTIME_OPERATIONS = new Map<string, Set<string>>([
  ["office_spreadsheet", new Set(["inspect", "verify"])],
  ["office_pdf", new Set(["extract_text", "extract_tables", "form_info", "meta_get"])],
  ["office_presentation", new Set(["inspect", "validate"])],
]);

const hasExactApproval = (
  toolId: string,
  inputHash: string,
  approvedInvocations: SkillAgentApprovedInvocation[] | undefined,
) =>
  Boolean(
    approvedInvocations?.some(
      (approval) => approval.toolId === toolId && approval.inputHash === inputHash,
    ),
  );

const approvalRequirement = (
  toolId: string,
  inputHash: string,
  args: Record<string, unknown>,
): SkillAgentRequirement => ({
  id: `approval:${toolId}:${inputHash}`,
  kind: "approval",
  description: `${toolId} requires approval for this exact invocation before the forked Skill agent may continue.`,
  requiredFor: toolId,
  toolId,
  input: structuredClone(args),
  inputHash,
});

const toModelPayload = (value: unknown) => {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 24_000 ? serialized : `${serialized.slice(0, 24_000)}…`;
  } catch {
    return String(value).slice(0, 24_000);
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const privateInvocationRequiresApproval = (input: {
  toolId: string;
  args: Record<string, unknown>;
  declaredRequiresApproval: boolean;
}) => {
  if (!input.declaredRequiresApproval) return false;
  const operation =
    typeof input.args.operation === "string"
      ? input.args.operation.trim().toLowerCase()
      : "";
  return !READ_ONLY_PRIVATE_RUNTIME_OPERATIONS.get(input.toolId)?.has(operation);
};

const validatePdfCreateSpec = (args: Record<string, unknown>) => {
  if (args.operation !== "create") return;
  const spec = asRecord(args.spec);
  if (!spec) {
    throw new Error(
      "office_pdf create requires a structured spec object with title and non-empty blocks.",
    );
  }
  if (typeof spec.title !== "string" || !spec.title.trim()) {
    throw new Error("office_pdf create spec.title is required.");
  }
  if (!Array.isArray(spec.blocks) || spec.blocks.length === 0) {
    throw new Error(
      "office_pdf create spec.blocks must contain the requested body structure; a title-only PDF is not an acceptable report artifact.",
    );
  }
  for (const [index, block] of spec.blocks.entries()) {
    const record = asRecord(block);
    if (!record || typeof record.type !== "string" || !record.type.trim()) {
      throw new Error(`office_pdf create spec.blocks[${index}].type is required.`);
    }
  }
};

const collectStringValues = (value: unknown, output: string[]) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const nested of Object.values(record)) collectStringValues(nested, output);
};

const collectExpectedPdfText = (spec: Record<string, unknown>) => {
  const expected: string[] = [];
  for (const key of ["title", "subtitle", "author", "subject"]) {
    collectStringValues(spec[key], expected);
  }
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) continue;
    for (const key of ["text", "title", "caption", "data", "rows", "headers"]) {
      collectStringValues(record[key], expected);
    }
  }
  return [...new Set(expected)].filter((text) => text.replace(/\s/g, "").length >= 2);
};

const normalizeExtractedText = (value: unknown) => {
  const values: string[] = [];
  collectStringValues(value, values);
  return values.join("\n").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
};

const verifyCreatedPdf = async (input: {
  implementation: ToolImplementation;
  args: Record<string, unknown>;
  execution: SkillAgentExecutionInput;
  signal?: AbortSignal;
}) => {
  if (input.args.operation !== "create") return;
  const outputPath =
    typeof input.args.outputPath === "string" ? input.args.outputPath.trim() : "";
  const spec = asRecord(input.args.spec);
  if (!outputPath || !spec) return;

  const verificationArgs = { operation: "extract_text", inputPath: outputPath };
  try {
    const verification = await input.implementation.execute({
      invocationId: crypto.randomUUID(),
      args: verificationArgs,
      userId: input.execution.userId,
      approval: {
        inputHash: createInvocationInputHash(verificationArgs),
        granted: true,
      },
      threadId: input.execution.threadId,
      turnId: input.execution.turnId,
      signal: input.signal ?? new AbortController().signal,
      environment: getHarnessEnvironmentSnapshot(),
      pushEvent: () => undefined,
      addArtifact: (artifact) => ({ id: crypto.randomUUID(), ...artifact }),
      trace: {
        startSpan: () => ({
          spanId: crypto.randomUUID(),
          end: () => undefined,
        }),
      },
    });
    const extracted = normalizeExtractedText(verification.structuredContent);
    const missing = collectExpectedPdfText(spec).filter(
      (expected) =>
        !extracted.includes(expected.normalize("NFKC").replace(/\s+/g, "").toLowerCase()),
    );
    if (missing.length > 0) {
      throw new Error(
        `PDF verification did not find requested content: ${missing.slice(0, 8).join(" | ")}`,
      );
    }
  } catch (error) {
    try {
      fs.rmSync(resolveWorkspacePath(outputPath), { force: true });
    } catch {
      // Best-effort cleanup: never replace the verification failure with cleanup noise.
    }
    throw new Error(
      `office_pdf create produced an incomplete or unreadable artifact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

export const createHarnessSkillAgentToolBinding = (input: {
  toolId: string;
  execution: SkillAgentExecutionInput;
}): SkillAgentToolBinding => {
  const implementation = getToolImplementation(input.toolId);
  if (!implementation) {
    throw new Error(`Skill Agent Harness tool is unavailable: ${input.toolId}`);
  }
  const definition = implementation.definition;

  return {
    id: definition.id,
    label: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (args, signal) => {
      const record = await runWithWorkspaceRootOverride(
        input.execution.workspaceRoot,
        async () =>
          await executeHarnessInvocation({
            toolId: definition.id,
            args,
            userId: input.execution.userId,
            threadId: input.execution.threadId,
            turnId: input.execution.turnId,
            signal,
            environment: getHarnessEnvironmentSnapshot(),
            approvedInvocations: input.execution.approvedInvocations,
          }),
      );

      if (record.status === "awaiting_approval") {
        const inputHash = createInvocationInputHash(args);
        return {
          result: {
            status: "needs_approval",
            toolId: definition.id,
            inputHash,
            message: record.approval?.reason ?? `${definition.id} requires approval.`,
          },
          evidence: record.evidence,
          artifacts: record.artifacts,
          terminate: true,
          requirement: approvalRequirement(definition.id, inputHash, args),
        };
      }

      if (record.status !== "completed") {
        throw new Error(
          record.error?.message ?? `${definition.id} ended with status ${record.status}`,
        );
      }

      return {
        result: record.result,
        evidence: record.evidence,
        artifacts: record.artifacts,
      };
    },
  };
};

export const createPrivateWenShuRuntimeToolBinding = (input: {
  runtimeId: string;
  execution: SkillAgentExecutionInput;
}): SkillAgentToolBinding => {
  const implementation = PRIVATE_WENSHU_RUNTIME_TOOLS.get(input.runtimeId);
  if (!implementation) {
    throw new Error(`Unknown private WenShu runtime adapter: ${input.runtimeId}`);
  }
  const definition = implementation.definition;
  const consumedApprovals = new Set<string>();

  return {
    id: definition.id,
    label: definition.title,
    description: `${definition.description} This adapter is private to the active Skill agent and is not a global Harness tool.`,
    inputSchema: definition.inputSchema,
    execute: async (args, signal) => {
      if (definition.id === "office_pdf") validatePdfCreateSpec(args);

      const inputHash = createInvocationInputHash(args);
      const approvalKey = `${definition.id}:${inputHash}`;
      const invocationRequiresApproval = privateInvocationRequiresApproval({
        toolId: definition.id,
        args,
        declaredRequiresApproval: definition.capabilities.requiresApproval,
      });
      const exactApprovalAvailable = hasExactApproval(
        definition.id,
        inputHash,
        input.execution.approvedInvocations,
      );
      const approvalGranted =
        exactApprovalAvailable && !consumedApprovals.has(approvalKey);

      if (invocationRequiresApproval && !approvalGranted) {
        return {
          result: {
            status: "needs_approval",
            toolId: definition.id,
            inputHash,
          },
          terminate: true,
          requirement: approvalRequirement(definition.id, inputHash, args),
        };
      }

      // Approval is a one-shot execution grant for this exact invocation inside
      // this fork. Consume it before the side-effecting runtime starts so a
      // partial failure cannot silently make the same approval reusable.
      if (invocationRequiresApproval && approvalGranted) {
        consumedApprovals.add(approvalKey);
      }

      const artifacts: ToolArtifact[] = [];
      const response = await runWithWorkspaceRootOverride(
        input.execution.workspaceRoot,
        async () => {
          const executed = await implementation.execute({
            invocationId: crypto.randomUUID(),
            args,
            userId: input.execution.userId,
            approval: {
              inputHash,
              granted: !invocationRequiresApproval || approvalGranted,
            },
            threadId: input.execution.threadId,
            turnId: input.execution.turnId,
            signal: signal ?? new AbortController().signal,
            environment: getHarnessEnvironmentSnapshot(),
            pushEvent: () => undefined,
            addArtifact: (artifact) => {
              const next: ToolArtifact = { id: crypto.randomUUID(), ...artifact };
              artifacts.push(next);
              return next;
            },
            trace: {
              startSpan: () => ({
                spanId: crypto.randomUUID(),
                end: () => undefined,
              }),
            },
          });
          if (definition.id === "office_pdf") {
            await verifyCreatedPdf({
              implementation,
              args,
              execution: input.execution,
              signal,
            });
          }
          return executed;
        },
      );

      const normalized = normalizeToolResult(response);
      return {
        result: normalized.structuredContent,
        evidence: projectToolEvidence(definition, normalized),
        artifacts,
      };
    },
  };
};

export const renderSkillAgentToolResult = (input: {
  result?: unknown;
  evidence?: unknown;
  artifacts?: unknown[];
  requirement?: SkillAgentRequirement;
}) =>
  toModelPayload({
    result: input.result ?? null,
    evidence: input.evidence ?? null,
    artifacts: input.artifacts ?? [],
    requirement: input.requirement ?? null,
  });
