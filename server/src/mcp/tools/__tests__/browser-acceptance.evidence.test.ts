import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clearInvocations, executeInvocation } from "../../core/invocations.js";
import { clearRegistry, registerTool } from "../../core/registry.js";
import { createComputerUseBrowserTools } from "../browser-tools.tool.js";

const evidenceRoot = path.resolve(process.cwd(), "..", ".test-artifact", "computer-use-acceptance", "mcp");
const writeEvidence = (name: string, value: unknown) => {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, name), JSON.stringify(value, null, 2));
};

describe("Computer Use MCP acceptance", () => {
  it("preserves approval and rejects a changed snapshot", async () => {
    clearRegistry();
    clearInvocations();
    const act = createComputerUseBrowserTools({ observe: vi.fn(), act: vi.fn(), assert: vi.fn() } as never).find((tool) => tool.definition.id === "browser_act")!;
    registerTool(act);
    const args = { sessionId: "session-1", pageUrl: "https://example.com/", snapshotHash: "hash-1", action: { kind: "click", ref: "e1" } };
    const pending = await executeInvocation({ toolId: "browser_act", args });
    expect(pending.status).toBe("awaiting_approval");
    const changed = await executeInvocation({ toolId: "browser_act", args: { ...args, snapshotHash: "hash-2" }, approvedInvocations: [{ toolId: "browser_act", inputHash: "stale-hash" }] });
    expect(changed.status).toBe("awaiting_approval");
    writeEvidence("approval-boundary.json", { pending, changed });
  });
});
