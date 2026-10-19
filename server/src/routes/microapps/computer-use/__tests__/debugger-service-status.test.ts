import { describe, expect, it } from "vitest";
import { createComputerUseBrowserTools } from "@/mcp/tools/browser-tools.tool.js";

describe("retired Managed Browser legacy Tools", () => {
  it("no longer registers browser_observe or browser_act", () => {
    const toolIds = createComputerUseBrowserTools({} as never).map(
      (tool) => tool.definition.id,
    );

    expect(toolIds).not.toContain("browser_observe");
    expect(toolIds).not.toContain("browser_act");
    expect(toolIds).toEqual(
      expect.arrayContaining([
        "browser_navigate",
        "browser_snapshot",
        "browser_screenshot",
        "browser_click",
        "browser_fill",
        "browser_press_key",
        "browser_select_option",
        "browser_scroll",
        "browser_wait_for",
        "browser_assert",
      ]),
    );
  });
});
