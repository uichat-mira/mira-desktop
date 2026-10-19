import { describe, expect, it } from "vitest";

// Regression guard for AGT-020: the dedicated Computer Use model loop was retired.
// The production wiring no longer instantiates ComputerUseModelExecutor, and this
// module must not re-publish that executor.
describe("retired Computer Use model loop", () => {
  it("no longer publishes a dedicated Computer Use model executor", async () => {
    const modelLoop = await import("./model-loop.js");
    expect(Object.keys(modelLoop)).not.toContain("ComputerUseModelExecutor");
    expect(Object.keys(modelLoop)).not.toContain("COMPUTER_USE_TOOL_IDS");
  });
});
