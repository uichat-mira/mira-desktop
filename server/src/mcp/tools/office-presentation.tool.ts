import fs from "node:fs";
import path from "node:path";
import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { resolveWorkspacePath, resolveWorkspaceWritePath } from "../workspace.js";
import { executePresentationSkillRuntime } from "@/microapps/office-suite/skill-runtime.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw mcpBadRequest(`${field} is required`);
  return value.trim();
};

const requireSpec = (value: unknown, field = "spec") => {
  if (!isRecord(value)) throw mcpBadRequest(`${field} must be an object`);
  return value;
};

const summarize = (value: unknown) => {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
};

const resolveAssetPath = (value: string) => {
  if (value.startsWith("data:")) {
    throw mcpBadRequest("Presentation data URI assets are not supported; use a workspace file");
  }
  const resolved = resolveWorkspacePath(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw mcpBadRequest(`Presentation asset does not exist: ${value}`);
  }
  return resolved;
};

const resolveImageSource = (value: unknown) => {
  if (!isRecord(value) || value.type !== "image" || typeof value.src !== "string") return;
  value.src = resolveAssetPath(value.src);
};

const resolvePageAssets = (page: JsonRecord) => {
  resolveImageSource(page.background);
  const elements = Array.isArray(page.elements) ? page.elements : [];
  for (const value of elements) {
    if (!isRecord(value)) continue;
    const elementType = String(value.elementType ?? "").toLowerCase();
    if (elementType === "image" && typeof value.src === "string") {
      value.src = resolveAssetPath(value.src);
    }
    resolveImageSource(value.fill);
    if (elementType === "table" && Array.isArray(value.rows)) {
      for (const row of value.rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          if (isRecord(cell)) resolveImageSource(cell.fill);
        }
      }
    }
  }
};

const preparePresentationSpec = (value: JsonRecord) => {
  const spec = structuredClone(value);
  if (!isRecord(spec.entry)) {
    throw mcpBadRequest("spec.entry must be the native Kimi PPTD root object");
  }
  if (!isRecord(spec.pageFiles)) {
    throw mcpBadRequest("spec.pageFiles must map relative .page paths to page objects");
  }
  const pages = spec.entry.pages;
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((item) => typeof item !== "string")) {
    throw mcpBadRequest("spec.entry.pages must be a non-empty array of relative .page paths");
  }
  const referenced = new Set<string>();
  for (const item of pages) {
    const pagePath = (item as string).replace(/\\/g, "/").trim();
    if (!pagePath.endsWith(".page") || pagePath.startsWith("/") || pagePath.includes("..")) {
      throw mcpBadRequest(`Invalid PPTD page path: ${item}`);
    }
    if (referenced.has(pagePath)) throw mcpBadRequest(`Duplicate PPTD page path: ${pagePath}`);
    referenced.add(pagePath);
    const page = spec.pageFiles[pagePath];
    if (!isRecord(page)) throw mcpBadRequest(`spec.pageFiles is missing ${pagePath}`);
    resolvePageAssets(page);
  }
  for (const pagePath of Object.keys(spec.pageFiles)) {
    if (!referenced.has(pagePath)) {
      throw mcpBadRequest(`spec.pageFiles contains an unreferenced page: ${pagePath}`);
    }
  }
  return spec;
};

const assertNoBlockingValidationErrors = (validation: unknown, label = "Presentation") => {
  const record = isRecord(validation) ? validation : {};
  if (typeof record.errors === "number" && record.errors > 0) {
    throw mcpBadRequest(`${label} validation failed with ${record.errors} blocking issue(s)`);
  }
};

const createOne = async (input: { outputPath: string; spec: JsonRecord }) => {
  if (!input.outputPath.toLowerCase().endsWith(".pptx")) {
    throw mcpBadRequest("outputPath must be a .pptx file");
  }
  const resolvedOutput = resolveWorkspaceWritePath(input.outputPath);
  const preparedSpec = preparePresentationSpec(input.spec);
  const created = await executePresentationSkillRuntime({
    operation: "create",
    outputPath: resolvedOutput,
    spec: preparedSpec,
  });
  const validation = isRecord(created) ? created.validation : undefined;
  return { outputPath: input.outputPath, validation, created };
};

const nativePptdSpecSchema = () => ({
  type: "object",
  required: ["entry", "pageFiles"],
  properties: {
    entry: {
      type: "object",
      required: ["pages"],
      description: "Native Kimi .pptd root: title, size, theme and relative .page references.",
      properties: {
        title: { type: "string" },
        size: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        theme: { type: "object" },
        pages: { type: "array", minItems: 1, items: { type: "string" } },
      },
    },
    pageFiles: {
      type: "object",
      description:
        "Map each entry.pages path to its native Kimi .page object. Text elements must use content.text.",
    },
  },
});

export const officePresentationTool: ToolImplementation = {
  definition: {
    id: "office_presentation",
    title: "Office Presentation",
    description:
      "Task-level PPTX capability backed by Kimi's original multi-file PPTD checker/parser/renderer. Validate or create a native {entry,pageFiles} project, create a prepared batch, or explicitly inspect an existing PPTX for diagnostics.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: { type: "string", enum: ["create", "create_batch", "validate", "inspect"] },
        inputPath: { type: "string", description: "Workspace-relative .pptx path for inspect." },
        outputPath: { type: "string", description: "Workspace-relative .pptx output path for create." },
        spec: nativePptdSpecSchema(),
        presentations: {
          type: "array",
          description:
            "For create_batch: all native PPTD projects must be supplied before execution. Each item contains outputPath and spec.",
          items: {
            type: "object",
            required: ["outputPath", "spec"],
            properties: { outputPath: { type: "string" }, spec: nativePptdSpecSchema() },
          },
        },
      },
    },
    tags: ["office", "powerpoint", "ppt", "pptx", "slides", "presentation", "skill", "swarm"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: { argKeys: ["inputPath", "outputPath"] },
    },
  },
  execute: async (context) => {
    const operation = requireString(context.args.operation, "operation");

    if (operation === "validate") {
      const spec = preparePresentationSpec(requireSpec(context.args.spec));
      const validation = await executePresentationSkillRuntime({ operation: "validate", spec });
      return {
        structuredContent: { operation, validation },

      };
    }

    if (operation === "inspect") {
      const inputPath = requireString(context.args.inputPath, "inputPath");
      if (!inputPath.toLowerCase().endsWith(".pptx")) throw mcpBadRequest("inputPath must be a .pptx file");
      const resolvedInput = resolveWorkspacePath(inputPath);
      if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isFile()) {
        throw mcpBadRequest(`inputPath does not exist: ${inputPath}`);
      }
      const inspection = await executePresentationSkillRuntime({ operation: "inspect", inputPath: resolvedInput });
      return {
        structuredContent: { operation, inputPath, inspection },

      };
    }

    if (operation === "create_batch") {
      if (!Array.isArray(context.args.presentations) || context.args.presentations.length === 0) {
        throw mcpBadRequest("create_batch requires a non-empty presentations array");
      }
      const entries = context.args.presentations.map((value, index) => {
        if (!isRecord(value)) throw mcpBadRequest(`presentations[${index}] must be an object`);
        const outputPath = requireString(value.outputPath, `presentations[${index}].outputPath`);
        const spec = preparePresentationSpec(requireSpec(value.spec, `presentations[${index}].spec`));
        return { outputPath, spec };
      });

      const validations: Array<{ outputPath: string; validation: unknown }> = [];
      for (const entry of entries) {
        const validation = await executePresentationSkillRuntime({ operation: "validate", spec: entry.spec });
        assertNoBlockingValidationErrors(validation, entry.outputPath);
        validations.push({ outputPath: entry.outputPath, validation });
      }

      const outputs: Array<{
        outputPath: string;
        validation: unknown;
        created: unknown;
      }> = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]!;
        if (!entry.outputPath.toLowerCase().endsWith(".pptx")) {
          throw mcpBadRequest(`presentations[${index}].outputPath must be a .pptx file`);
        }
        const resolvedOutput = resolveWorkspaceWritePath(entry.outputPath);
        const created = await executePresentationSkillRuntime({
          operation: "create",
          outputPath: resolvedOutput,
          spec: entry.spec,
        });
        const validation = validations[index]!.validation;
        outputs.push({ outputPath: entry.outputPath, validation, created });
        context.addArtifact({
          kind: "document",
          title: path.basename(entry.outputPath),
          mimeType: PPTX_MIME,
          metadata: {
            path: entry.outputPath,
            officeOperation: "create_batch",
            validation,
          },
        });
      }

      return {
        structuredContent: { operation, count: outputs.length, outputs },

      };
    }

    if (operation !== "create") {
      throw mcpBadRequest(`Unsupported office_presentation operation: ${operation}`);
    }

    const outputPath = requireString(context.args.outputPath, "outputPath");
    const result = await createOne({ outputPath, spec: requireSpec(context.args.spec) });
    context.addArtifact({
      kind: "document",
      title: path.basename(outputPath),
      mimeType: PPTX_MIME,
      metadata: {
        path: outputPath,
        officeOperation: "create",
        validation: result.validation,
      },
    });
    return {
      structuredContent: { operation, ...result },

    };
  },
};
