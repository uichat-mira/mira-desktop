import { describe, expect, it, vi } from "vitest";
import { samplePreviewChunks } from "../utils/documentPreview";

describe("samplePreviewChunks", () => {
  it("returns all chunks when count is less than or equal to sample count", () => {
    const chunks = [{ id: "1" }, { id: "2" }, { id: "3" }] as any;
    const result = samplePreviewChunks(chunks);

    expect(result).toHaveLength(3);
    expect(result).toEqual(chunks);
  });

  it("returns exactly sampleCount items when input is larger", () => {
    const chunks = Array.from({ length: 100 }, (_, index) => ({
      id: `${index}`,
    })) as any;

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = samplePreviewChunks(chunks);
    vi.restoreAllMocks();

    expect(result).toHaveLength(10);
  });

  it("returns sorted indices", () => {
    const chunks = Array.from({ length: 50 }, (_, index) => ({
      id: `${index}`,
    })) as any;

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = samplePreviewChunks(chunks);
    vi.restoreAllMocks();

    const indices = result.map((chunk) => chunks.indexOf(chunk));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});
