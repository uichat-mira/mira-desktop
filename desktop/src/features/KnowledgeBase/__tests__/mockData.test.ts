import { describe, expect, it } from "vitest";
import { formatCompactNumber, getTypeBadge } from "../utils/mockData";

describe("formatCompactNumber", () => {
  it("formats thousands with k suffix", () => {
    expect(formatCompactNumber(1500)).toBe("1.5k");
    expect(formatCompactNumber(2000)).toBe("2k");
  });

  it("returns number as string when less than 1000", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(0)).toBe("0");
  });
});

describe("getTypeBadge", () => {
  it("returns known type config", () => {
    expect(getTypeBadge("pdf").label).toBe("PDF");
    expect(getTypeBadge("xlsx").label).toBe("XLSX");
    expect(getTypeBadge("md").label).toBe("MD");
    expect(getTypeBadge("txt").label).toBe("TXT");
  });

  it("is case insensitive", () => {
    expect(getTypeBadge("PDF").label).toBe("PDF");
    expect(getTypeBadge("Md").label).toBe("MD");
  });

  it("returns uppercase extension for unknown types", () => {
    expect(getTypeBadge("csv").label).toBe("CSV");
  });
});
