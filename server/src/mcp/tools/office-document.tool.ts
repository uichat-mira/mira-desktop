import fs from "node:fs";
import path from "node:path";
import { executeOfficeRuntimeTask } from "@/microapps/office-suite/runtime.js";
import type {
  OfficeRuntimeWordCreateParagraph,
  OfficeRuntimeWordCreateTable,
} from "@/microapps/office-suite/contract.js";
import type { ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest, mcpInternalError } from "../core/errors.js";
import {
  ensureParentDir,
  resolveWorkspacePath,
  resolveWorkspaceWritePath,
} from "../workspace.js";

const WORD_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw mcpBadRequest(`${field} is required`);
  }
  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const assertDocxPath = (value: string, field: string) => {
  if (!value.toLowerCase().endsWith(".docx")) {
    throw mcpBadRequest(`${field} must be a .docx path`);
  }
};

const parseParagraphs = (value: unknown): OfficeRuntimeWordCreateParagraph[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw mcpBadRequest("paragraphs must be an array");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw mcpBadRequest(`paragraphs[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : null;
    if (text === null) {
      throw mcpBadRequest(`paragraphs[${index}].text must be a string`);
    }
    const style = record.style;
    if (
      style !== undefined &&
      style !== "title" &&
      style !== "heading1" &&
      style !== "heading2" &&
      style !== "heading3" &&
      style !== "body"
    ) {
      throw mcpBadRequest(`paragraphs[${index}].style is invalid`);
    }
    return {
      text,
      ...(typeof record.bold === "boolean" ? { bold: record.bold } : {}),
      ...(typeof style === "string"
        ? { style: style as OfficeRuntimeWordCreateParagraph["style"] }
        : {}),
    };
  });
};

const parseTables = (value: unknown): OfficeRuntimeWordCreateTable[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw mcpBadRequest("tables must be an array");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw mcpBadRequest(`tables[${index}] must be an object`);
    }
    const rows = (item as Record<string, unknown>).rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw mcpBadRequest(`tables[${index}].rows must be a non-empty array`);
    }
    return {
      rows: rows.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length === 0) {
          throw mcpBadRequest(`tables[${index}].rows[${rowIndex}] must be non-empty`);
        }
        return row.map((cell) => String(cell ?? ""));
      }),
    };
  });
};

const defaultReviewOutputPath = (inputPath: string) => {
  const extension = path.extname(inputPath);
  const base = inputPath.slice(0, -extension.length);
  return `${base}-wenshu.docx`;
};

export const officeDocumentTool: ToolImplementation = {
  definition: {
    id: "office_document",
    title: "Office Document",
    description:
      "Task-level Word/DOCX capability used by the docx Skill. Create a structured .docx or review an existing .docx with native comments and tracked changes while producing a new file.",
    domain: "edit",
    source: "internal",
    mode: "sync",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          enum: ["create", "review"],
        },
        inputPath: {
          type: "string",
          description: "Workspace-relative existing .docx path for review.",
        },
        outputPath: {
          type: "string",
          description: "Workspace-relative .docx output path.",
        },
        title: { type: "string" },
        paragraphs: {
          type: "array",
          items: {
            type: "object",
            required: ["text"],
            properties: {
              text: { type: "string" },
              style: {
                type: "string",
                enum: ["title", "heading1", "heading2", "heading3", "body"],
              },
              bold: { type: "boolean" },
            },
          },
        },
        tables: {
          type: "array",
          items: {
            type: "object",
            required: ["rows"],
            properties: {
              rows: {
                type: "array",
                items: {
                  type: "array",
                  items: {
                    oneOf: [
                      { type: "string" },
                      { type: "number" },
                      { type: "boolean" },
                    ],
                  },
                },
              },
            },
          },
        },
        targetText: {
          type: "string",
          description: "Exact visible text anchor in the existing document.",
        },
        commentText: { type: "string" },
        replacementText: {
          type: "string",
          description:
            "Suggested replacement. The original text becomes a tracked deletion and this text becomes a tracked insertion.",
        },
        author: { type: "string" },
      },
    },
    tags: ["office", "word", "docx", "document", "skill"],
    capabilities: {
      sideEffect: "local-write",
      requiresApproval: true,
      workspaceBound: true,
      workspaceBoundary: {
        argKeys: ["inputPath", "outputPath"],
      },
    },
  },
  execute: async (context) => {
    const operation = requireString(context.args.operation, "operation");

    if (operation === "create") {
      const outputPath = requireString(context.args.outputPath, "outputPath");
      assertDocxPath(outputPath, "outputPath");
      const resolvedOutput = resolveWorkspaceWritePath(outputPath);
      const paragraphs = parseParagraphs(context.args.paragraphs);
      const tables = parseTables(context.args.tables);
      const title = optionalString(context.args.title);

      const result = await executeOfficeRuntimeTask({
        operation: "create",
        kind: "word",
        request: {
          type: "document",
          fileName: path.basename(outputPath),
          title,
          paragraphs,
          tables,
        },
      });
      if (result.status !== "completed" || !result.artifacts[0]) {
        throw mcpBadRequest(
          result.status === "failed" ? result.error.message : "Word create returned no artifact",
        );
      }
      const artifact = result.artifacts[0];
      try {
        ensureParentDir(resolvedOutput);
        fs.writeFileSync(resolvedOutput, artifact.buffer);
      } catch (error) {
        throw mcpInternalError(`Failed to write Word artifact: ${outputPath}`, { cause: error });
      }

      context.addArtifact({
        kind: "document",
        title: artifact.fileName,
        mimeType: WORD_MIME,
        metadata: {
          path: outputPath,
          byteSize: artifact.byteSize,
          officeOperation: "create",
        },
      });
      return {
        result: {
          operation: "create",
          outputPath,
          byteSize: artifact.byteSize,
          summary: result.summary,
          warnings: result.warnings,
        },
        evidence: {
          status: "completed",
          actionTaken: `Created Word document at ${outputPath}`,
          facts: [result.summary, `Output: ${outputPath}`, `Bytes: ${artifact.byteSize}`],
          gaps: result.warnings,
          data: {
            kind: "office_document",
            operation: "create",
            outputPath,
            byteSize: artifact.byteSize,
          },
        },
      };
    }

    if (operation !== "review") {
      throw mcpBadRequest("operation must be create or review");
    }

    const inputPath = requireString(context.args.inputPath, "inputPath");
    assertDocxPath(inputPath, "inputPath");
    const outputPath =
      optionalString(context.args.outputPath) ?? defaultReviewOutputPath(inputPath);
    assertDocxPath(outputPath, "outputPath");
    const resolvedInput = resolveWorkspacePath(inputPath);
    const resolvedOutput = resolveWorkspaceWritePath(outputPath);
    if (path.resolve(resolvedInput) === path.resolve(resolvedOutput)) {
      throw mcpBadRequest("outputPath must not overwrite the source document");
    }
    if (!fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isFile()) {
      throw mcpBadRequest(`inputPath does not exist: ${inputPath}`);
    }

    const targetText = requireString(context.args.targetText, "targetText");
    const commentText = optionalString(context.args.commentText);
    const replacementText = optionalString(context.args.replacementText);
    if (!commentText && !replacementText) {
      throw mcpBadRequest("review requires commentText or replacementText");
    }
    const author = optionalString(context.args.author) ?? "Mira";
    const sourceBuffer = fs.readFileSync(resolvedInput);
    const runtimeResult = await executeOfficeRuntimeTask({
      operation: "modify",
      kind: "word",
      input: {
        fileName: path.basename(inputPath),
        mimeType: WORD_MIME,
        buffer: sourceBuffer,
      },
      request: {
        type: "review",
        author,
        comments: commentText ? [{ targetText, text: commentText }] : undefined,
        insertions: replacementText
          ? [{ afterText: targetText, text: replacementText }]
          : undefined,
        deletions: replacementText ? [{ targetText }] : undefined,
      },
    });
    if (runtimeResult.status !== "completed" || !runtimeResult.artifacts[0]) {
      throw mcpBadRequest(
        runtimeResult.status === "failed"
          ? runtimeResult.error.message
          : "Word review returned no artifact",
      );
    }
    const artifact = runtimeResult.artifacts[0];
    try {
      ensureParentDir(resolvedOutput);
      fs.writeFileSync(resolvedOutput, artifact.buffer);
    } catch (error) {
      throw mcpInternalError(`Failed to write reviewed Word artifact: ${outputPath}`, {
        cause: error,
      });
    }

    context.addArtifact({
      kind: "document",
      title: artifact.fileName,
      mimeType: WORD_MIME,
      metadata: {
        sourcePath: inputPath,
        path: outputPath,
        byteSize: artifact.byteSize,
        officeOperation: "review",
      },
    });
    return {
      result: {
        operation: "review",
        inputPath,
        outputPath,
        byteSize: artifact.byteSize,
        summary: runtimeResult.summary,
        warnings: runtimeResult.warnings,
      },
      evidence: {
        status: "completed",
        actionTaken: `Reviewed Word document ${inputPath} and wrote ${outputPath}`,
        facts: [
          runtimeResult.summary,
          `Source: ${inputPath}`,
          `Output: ${outputPath}`,
          `Bytes: ${artifact.byteSize}`,
        ],
        gaps: runtimeResult.warnings,
        data: {
          kind: "office_document",
          operation: "review",
          inputPath,
          outputPath,
          byteSize: artifact.byteSize,
        },
      },
    };
  },
};
