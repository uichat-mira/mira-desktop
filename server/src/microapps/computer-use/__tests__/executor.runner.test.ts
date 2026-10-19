import { describe, expect, it } from "vitest";

// Regression guard for AGT-020: the legacy fixed-rule Playwright action runner
// was retired with the dedicated Computer Use task path.
describe("retired Computer Use executor runner", () => {
  it("no longer exports the legacy action runner", async () => {
    const runner = await import("../executor/runner.js");
    expect(Object.keys(runner)).not.toContain("runComputerUseActions");
  });
});
