import { describe, expect, it } from "vitest";

describe("useAddWizard utils", () => {
  it("resolveStep parses step query", async () => {
    const { resolveStep } = await import("../hooks/useAddWizard");

    expect(resolveStep(null)).toBe(1);
    expect(resolveStep("1")).toBe(1);
    expect(resolveStep("2")).toBe(2);
    expect(resolveStep("3")).toBe(3);
    expect(resolveStep("invalid")).toBe(1);
  });

  it("parseListInput splits by comma and newline", async () => {
    const { parseListInput } = await import("../hooks/useAddWizard");

    expect(parseListInput("a,b\nc")).toEqual(["a", "b", "c"]);
    expect(parseListInput(" a , b ")).toEqual(["a", "b"]);
    expect(parseListInput("")).toEqual([]);
  });
});
