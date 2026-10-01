// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatEvaluationKnowledgeBaseLabel } from "../knowledgeBaseLabel";

describe("formatEvaluationKnowledgeBaseLabel", () => {
  it("returns null when knowledgeBaseId is undefined", () => {
    expect(formatEvaluationKnowledgeBaseLabel(undefined, "KB")).toBeNull();
  });

  it("returns null when knowledgeBaseId is null", () => {
    expect(formatEvaluationKnowledgeBaseLabel(null, "KB")).toBeNull();
  });

  it("returns null when knowledgeBaseId is empty", () => {
    expect(formatEvaluationKnowledgeBaseLabel("", "KB")).toBeNull();
  });

  it("prefers knowledgeBaseName when available", () => {
    expect(formatEvaluationKnowledgeBaseLabel("kb1", "Knowledge Base")).toBe(
      "Knowledge Base",
    );
  });

  it("falls back to knowledgeBaseId when name is missing", () => {
    expect(formatEvaluationKnowledgeBaseLabel("kb1", undefined)).toBe("kb1");
  });

  it("falls back to knowledgeBaseId when name is empty", () => {
    expect(formatEvaluationKnowledgeBaseLabel("kb1", "   ")).toBe("kb1");
  });
});
