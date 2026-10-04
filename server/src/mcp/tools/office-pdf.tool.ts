import fs from "node:fs";
import path from "node:path";
import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import {
  resolveWorkspacePath,
  resolveWorkspaceWritePath,
} from "../workspace.js";
import { executePdfSkillRuntime } from "@/microapps/office-suite/skill-runtime.js";

const PDF_MIME = "application/pdf";

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest(`${field} is required`);
  }
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const requireObject = (value: unknown, field: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mcpBadRequest(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const ensureExtension = (value: string, extension: string, field: string) => {
  if (!value.toLowerCase().endsWith(extension)) {
    throw mcpBadRequest(`${field} must end with ${extension}`);
  }
};

const defaultOutputPath = (inputPath: string, suffix: string) => {
  const extension = path.extname(inputPath);
  const base = extension ? inputPath.slice(0, -extension.length) : inputPath;
  return `${base}-${suffix}.pdf`;
};

const resolveInputPdf = (value: unknown, field = "inputPath") => {
  const inputPath = requireString(value, field);
  ensureExtension(inputPath, ".pdf", field);
  const resolved = resolveWorkspacePath(inputPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw mcpBadRequest(`${field} does not exist: ${inputPath}`);
  }
  return { inputPath, resolved };
};

const resolveOutputPdf = (value: string) => {
  ensureExtension(value, ".pdf", "outputPath");
  return resolveWorkspaceWritePath(value);
};

const preparePdfCreateSpec = (value: Record<string, unknown>) => {
  const spec = structuredClone(value);
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  for (const blockValue of blocks) {
    if (!blockValue || typeof blockValue !== "object" || Array.isArray(blockValue)) {
      continue;
    }
    const block = blockValue as Record<string, unknown>;
    if (String(block.type ?? "").toLowerCase() !== "image") {
      continue;
    }
    const source = requireString(block.src, "spec.blocks[].src");
    const resolved = resolveWorkspacePath(source);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw mcpBadRequest(`PDF image source does not exist: ${source}`);
    }
    block.src = resolved;
  }
  return spec;
};

const summarize = (value: unknown) => {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
};

const addPdfArtifact = (
  context: Parameters<ToolImplementation["execute"]>[0],
  outputPath: string,
  metadata: Record<string, unknown>,
) => {
  context.addArtifact({
    kind: "document",
    title: path.basename(outputPath),
    mimeType: PDF_MIME,
    metadata: { path: outputPath, ...metadata },
  });
};

export const officePdfTool: ToolImplementation = {
  definition: {
    id: "office_pdf",
    title: "Office PDF",
    description:
      "Task-level PDF capability used by the pdf Skill. Create professional PDFs with headings/TOC/tables/images/charts/equations/code/header/footer; convert Markdown; extract text/tables/images; inspect/fill forms; merge/split/rotate/crop pages; and get/set metadata.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: [
            "create",
            "extract_text",
            "extract_tables",
            "extract_images",
            "form_info",
            "form_fill",
            "merge",
            "split",
            "rotate",
            "crop",
            "meta_get",
            "meta_set",
            "md2pdf",
          ],
        },
        inputPath: { type: "string", description: "Workspace-relative input path." },
        inputPaths: {
          type: "array",
          items: { type: "string" },
          description: "Workspace-relative PDF paths for merge.",
        },
        outputPath: {
          type: "string",
          description: "Workspace-relative output PDF path.",
        },
        outputDir: {
          type: "string",
          description: "Workspace-relative output directory for split/image extraction.",
        },
        spec: {
          type: "object",
          description:
            "Structured PDF creation specification. Local image block src values must be workspace-relative paths.",
        },
        data: { type: "object", description: "Form values or metadata key/value data." },
        pages: { type: "string", description: "1-based page selection such as 1,3-5." },
        degrees: { type: "integer" },
        box: {
          type: "array",
          items: { type: "number" },
          description: "Crop box [x0,y0,x1,y1] in PDF points.",
        },
      },
    },
    tags: ["office", "pdf", "document", "skill"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["inputPath", "outputPath", "outputDir"],
      },
    },
  },
  execute: async (context) => {
    const operation = requireString(context.args.operation, "operation");
    const pages = optionalString(context.args.pages);

    if (operation === "create") {
      const outputPath = requireString(context.args.outputPath, "outputPath");
      const resolvedOutput = resolveOutputPdf(outputPath);
      const spec = preparePdfCreateSpec(requireObject(context.args.spec, "spec"));
      const result = await executePdfSkillRuntime({
        operation: "create",
        outputPath: resolvedOutput,
        spec,
      });
      addPdfArtifact(context, outputPath, { officeOperation: operation });
      return {
        result: { operation, outputPath, runtime: result },
        evidence: {
          status: "completed",
          actionTaken: `Created PDF at ${outputPath}`,
          facts: [`Output: ${outputPath}`, `Runtime: ${summarize(result)}`],
          data: { kind: "office_pdf", operation, outputPath },
        },
      };
    }

    if (operation === "merge") {
      if (!Array.isArray(context.args.inputPaths) || context.args.inputPaths.length < 2) {
        throw mcpBadRequest("merge requires at least two inputPaths");
      }
      const inputPaths = context.args.inputPaths.map((value, index) =>
        resolveInputPdf(value, `inputPaths[${index}]`),
      );
      const outputPath = requireString(context.args.outputPath, "outputPath");
      const resolvedOutput = resolveOutputPdf(outputPath);
      const result = await executePdfSkillRuntime({
        operation: "merge",
        inputPaths: inputPaths.map((item) => item.resolved),
        outputPath: resolvedOutput,
      });
      addPdfArtifact(context, outputPath, {
        officeOperation: operation,
        sources: inputPaths.map((item) => item.inputPath),
      });
      return {
        result: {
          operation,
          inputPaths: inputPaths.map((item) => item.inputPath),
          outputPath,
          runtime: result,
        },
        evidence: {
          status: "completed",
          actionTaken: `Merged ${inputPaths.length} PDFs into ${outputPath}`,
          facts: [
            `Output: ${outputPath}`,
            `Sources: ${inputPaths.map((item) => item.inputPath).join(", ")}`,
          ],
          data: { kind: "office_pdf", operation, outputPath },
        },
      };
    }

    if (operation === "md2pdf") {
      const inputPath = requireString(context.args.inputPath, "inputPath");
      const resolvedInput = resolveWorkspacePath(inputPath);
      if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isFile()) {
        throw mcpBadRequest(`inputPath does not exist: ${inputPath}`);
      }
      const outputPath = requireString(context.args.outputPath, "outputPath");
      const resolvedOutput = resolveOutputPdf(outputPath);
      const result = await executePdfSkillRuntime({
        operation: "md2pdf",
        inputPath: resolvedInput,
        outputPath: resolvedOutput,
      });
      addPdfArtifact(context, outputPath, {
        officeOperation: operation,
        sourcePath: inputPath,
      });
      return {
        result: { operation, inputPath, outputPath, runtime: result },
        evidence: {
          status: "completed",
          actionTaken: `Converted ${inputPath} to PDF ${outputPath}`,
          facts: [`Source: ${inputPath}`, `Output: ${outputPath}`],
          data: { kind: "office_pdf", operation, inputPath, outputPath },
        },
      };
    }

    const { inputPath, resolved } = resolveInputPdf(context.args.inputPath);

    if (["extract_text", "extract_tables", "form_info", "meta_get"].includes(operation)) {
      const result = await executePdfSkillRuntime({
        operation: operation as
          | "extract_text"
          | "extract_tables"
          | "form_info"
          | "meta_get",
        inputPath: resolved,
        pages,
      });
      return {
        result: { operation, inputPath, data: result },
        evidence: {
          status: "completed",
          actionTaken: `${operation} on ${inputPath}`,
          facts: [`Source: ${inputPath}`, `Result: ${summarize(result)}`],
          data: { kind: "office_pdf", operation, inputPath, result },
        },
      };
    }

    if (operation === "extract_images" || operation === "split") {
      const defaultDir = `${inputPath.slice(0, -4)}-${
        operation === "split" ? "split" : "images"
      }`;
      const outputDir = optionalString(context.args.outputDir) ?? defaultDir;
      const resolvedOutputDir = resolveWorkspaceWritePath(outputDir);
      fs.mkdirSync(resolvedOutputDir, { recursive: true });
      const result = await executePdfSkillRuntime({
        operation,
        inputPath: resolved,
        outputDir: resolvedOutputDir,
      });
      const outputFiles = fs.existsSync(resolvedOutputDir)
        ? fs.readdirSync(resolvedOutputDir).filter(Boolean)
        : [];
      for (const fileName of outputFiles.slice(0, 200)) {
        const relativePath = path.posix.join(outputDir.replace(/\\/g, "/"), fileName);
        context.addArtifact({
          kind: operation === "split" ? "document" : "image",
          title: fileName,
          ...(operation === "split" ? { mimeType: PDF_MIME } : {}),
          metadata: {
            path: relativePath,
            officeOperation: operation,
            sourcePath: inputPath,
          },
        });
      }
      return {
        result: {
          operation,
          inputPath,
          outputDir,
          files: outputFiles,
          runtime: result,
        },
        evidence: {
          status: "completed",
          actionTaken: `${operation} from ${inputPath} into ${outputDir}`,
          facts: [
            `Source: ${inputPath}`,
            `Output directory: ${outputDir}`,
            `Files: ${outputFiles.length}`,
          ],
          data: {
            kind: "office_pdf",
            operation,
            inputPath,
            outputDir,
            fileCount: outputFiles.length,
          },
        },
      };
    }

    const outputPath =
      optionalString(context.args.outputPath) ??
      defaultOutputPath(inputPath, operation.replace(/_/g, "-"));
    const resolvedOutput = resolveOutputPdf(outputPath);
    if (path.resolve(resolved) === path.resolve(resolvedOutput)) {
      throw mcpBadRequest("outputPath must not overwrite the source PDF");
    }

    let result: unknown;
    if (operation === "form_fill") {
      result = await executePdfSkillRuntime({
        operation,
        inputPath: resolved,
        outputPath: resolvedOutput,
        data: requireObject(context.args.data, "data"),
      });
    } else if (operation === "rotate") {
      if (!Number.isInteger(context.args.degrees)) {
        throw mcpBadRequest("degrees must be an integer");
      }
      result = await executePdfSkillRuntime({
        operation,
        inputPath: resolved,
        outputPath: resolvedOutput,
        degrees: context.args.degrees as number,
        pages,
      });
    } else if (operation === "crop") {
      if (
        !Array.isArray(context.args.box) ||
        context.args.box.length !== 4 ||
        context.args.box.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      ) {
        throw mcpBadRequest("box must be [x0,y0,x1,y1]");
      }
      result = await executePdfSkillRuntime({
        operation,
        inputPath: resolved,
        outputPath: resolvedOutput,
        box: context.args.box as number[],
        pages,
      });
    } else if (operation === "meta_set") {
      result = await executePdfSkillRuntime({
        operation,
        inputPath: resolved,
        outputPath: resolvedOutput,
        data: requireObject(context.args.data, "data"),
      });
    } else {
      throw mcpBadRequest(`Unsupported office_pdf operation: ${operation}`);
    }

    addPdfArtifact(context, outputPath, {
      officeOperation: operation,
      sourcePath: inputPath,
    });
    return {
      result: { operation, inputPath, outputPath, runtime: result },
      evidence: {
        status: "completed",
        actionTaken: `${operation} on ${inputPath} and wrote ${outputPath}`,
        facts: [
          `Source: ${inputPath}`,
          `Output: ${outputPath}`,
          `Runtime: ${summarize(result)}`,
        ],
        data: { kind: "office_pdf", operation, inputPath, outputPath },
      },
    };
  },
};
