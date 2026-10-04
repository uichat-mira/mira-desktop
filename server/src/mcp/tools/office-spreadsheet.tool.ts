import fs from "node:fs";
import path from "node:path";
import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { resolveWorkspacePath, resolveWorkspaceWritePath } from "../workspace.js";
import { executeSpreadsheetSkillRuntime } from "@/microapps/office-suite/skill-runtime.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw mcpBadRequest(`${field} is required`);
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const defaultOutputPath = (inputPath: string, suffix = "recalculated") => {
  const extension = path.extname(inputPath);
  return `${inputPath.slice(0, -extension.length)}-${suffix}.xlsx`;
};

const summaryPreview = (value: unknown) => {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
};

const resolveExistingWorkbook = (value: unknown) => {
  const inputPath = requireString(value, "inputPath");
  if (!inputPath.toLowerCase().endsWith(".xlsx")) {
    throw mcpBadRequest("inputPath must be a .xlsx file");
  }
  const resolved = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw mcpBadRequest(`inputPath does not exist: ${inputPath}`);
  }
  return { inputPath, resolved };
};

export const officeSpreadsheetTool: ToolImplementation = {
  definition: {
    id: "office_spreadsheet",
    title: "Office Spreadsheet Diagnostics",
    description:
      "Compatibility diagnostics for existing XLSX files: inspect, recalculate, or verify. XLSX creation, editing, and formula repair are owned by the xlsx Skill's MiniMax-derived XML template/unpack/edit/pack workflow and must not be routed through this legacy openpyxl runtime.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: { type: "string", enum: ["inspect", "recalc", "verify"] },
        inputPath: { type: "string", description: "Workspace-relative existing .xlsx path." },
        outputPath: {
          type: "string",
          description: "Workspace-relative output .xlsx path for compatibility recalc only.",
        },
      },
    },
    tags: ["office", "excel", "xlsx", "spreadsheet", "inspect", "verify", "recalc", "legacy"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: { argKeys: ["inputPath", "outputPath"] },
    },
  },
  execute: async (context) => {
    const operation = requireString(context.args.operation, "operation");

    if (operation === "inspect" || operation === "verify") {
      const { inputPath, resolved } = resolveExistingWorkbook(context.args.inputPath);
      const result = await executeSpreadsheetSkillRuntime({ operation, inputPath: resolved });
      return {
        structuredContent: { operation, inputPath, data: result },

      };
    }

    if (operation === "recalc") {
      const { inputPath, resolved } = resolveExistingWorkbook(context.args.inputPath);
      const outputPath = optionalString(context.args.outputPath) ?? defaultOutputPath(inputPath);
      if (!outputPath.toLowerCase().endsWith(".xlsx")) {
        throw mcpBadRequest("outputPath must be a .xlsx file");
      }
      const resolvedOutput = resolveWorkspaceWritePath(outputPath);
      if (path.resolve(resolved) === path.resolve(resolvedOutput)) {
        throw mcpBadRequest("outputPath must not overwrite the source workbook");
      }
      fs.copyFileSync(resolved, resolvedOutput);
      const recalculation = await executeSpreadsheetSkillRuntime({
        operation: "recalc",
        inputPath: resolvedOutput,
      });
      const verification = await executeSpreadsheetSkillRuntime({
        operation: "verify",
        inputPath: resolvedOutput,
      });
      context.addArtifact({
        kind: "table",
        title: path.basename(outputPath),
        mimeType: XLSX_MIME,
        metadata: {
          sourcePath: inputPath,
          path: outputPath,
          officeOperation: "recalc",
          recalculation,
          verification,
        },
      });
      return {
        structuredContent: { operation, inputPath, outputPath, recalculation, verification },

      };
    }

    throw mcpBadRequest(`Unsupported office_spreadsheet operation: ${operation}`);
  },
};
