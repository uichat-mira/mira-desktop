import { describe, expect, it } from "vitest";
import * as computerUse from "@/microapps/computer-use/index.js";

// Regression guard for AGT-020: the dedicated Computer Use task service was
// retired together with the task/model route surface.
describe("retired Computer Use task service", () => {
  it("no longer exports the dedicated task orchestration service", () => {
    expect("createComputerUseService" in computerUse).toBe(false);
    expect("createInMemoryComputerUseTaskStore" in computerUse).toBe(false);
  });
});
