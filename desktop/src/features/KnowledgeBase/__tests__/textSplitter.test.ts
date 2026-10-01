import { describe, expect, it } from "vitest";
import { splitTextIntoChunks } from "../utils/textSplitter";

describe("splitTextIntoChunks", () => {
  it("preserves all content across chunks", () => {
    const chunks = splitTextIntoChunks("a\n\nb\n\nc", {
      separator: "\n\n",
      maxLength: 1000,
      overlap: 0,
      replaceWhitespace: false,
      removeUrls: false,
      useQaSplit: false,
    });

    const fullText = chunks.map((chunk) => chunk.text).join("\n");
    expect(fullText).toContain("a");
    expect(fullText).toContain("b");
    expect(fullText).toContain("c");
  });

  it("respects maxLength and creates multiple chunks", () => {
    const text = "a".repeat(300);
    const chunks = splitTextIntoChunks(text, {
      separator: "\n",
      maxLength: 100,
      overlap: 0,
      replaceWhitespace: false,
      removeUrls: false,
      useQaSplit: false,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 100)).toBe(true);
  });

  it("extracts QA blocks when useQaSplit is true", () => {
    const text = "Q: What is AI?\nA: Artificial intelligence.\n\nQ: What is ML?\nA: Machine learning.";

    const chunks = splitTextIntoChunks(text, {
      separator: "\n\n",
      maxLength: 1000,
      overlap: 0,
      replaceWhitespace: false,
      removeUrls: false,
      useQaSplit: true,
    });

    const fullText = chunks.map((chunk) => chunk.text).join("\n");
    expect(fullText).toContain("Q: What is AI?");
    expect(fullText).toContain("A: Artificial intelligence.");
    expect(fullText).toContain("Q: What is ML?");
    expect(fullText).toContain("A: Machine learning.");
  });

  it("removes URLs when removeUrls is true", () => {
    const chunks = splitTextIntoChunks("Visit https://example.com today", {
      separator: "\n",
      maxLength: 1000,
      overlap: 0,
      replaceWhitespace: false,
      removeUrls: true,
      useQaSplit: false,
    });

    expect(chunks[0].text).not.toContain("https://example.com");
    expect(chunks[0].text).toContain("Visit");
  });

  it("normalizes whitespace when replaceWhitespace is true", () => {
    const chunks = splitTextIntoChunks("a   b\t\tc", {
      separator: "\n",
      maxLength: 1000,
      overlap: 0,
      replaceWhitespace: true,
      removeUrls: false,
      useQaSplit: false,
    });

    expect(chunks[0].text).toBe("a b c");
  });

  it("returns empty array for empty input", () => {
    const chunks = splitTextIntoChunks("", {
      separator: "\n",
      maxLength: 100,
      overlap: 0,
      replaceWhitespace: false,
      removeUrls: false,
      useQaSplit: false,
    });

    expect(chunks).toHaveLength(0);
  });
});
