import { describe, expect, it } from "vitest";

import { terminalTool } from "../tools/terminal-session.tool.js";
import { normalizeWorkspaceBoundaryArgs } from "../workspace-path-args.js";

describe("terminal host cwd normalization", () => {
  it("preserves Windows absolute cwd for approval and host execution", () => {
    const args = {
      command: "node --version",
      cwd: "D:\\workspace\\other-project",
    };

    expect(
      normalizeWorkspaceBoundaryArgs(terminalTool.definition, args),
    ).toEqual({ args });
  });

  it("preserves parent traversal for downstream boundary approval", () => {
    const args = {
      command: "node --version",
      cwd: "../other-project",
    };

    expect(
      normalizeWorkspaceBoundaryArgs(terminalTool.definition, args),
    ).toEqual({ args });
  });

  it("does not relax sandboxed workspace directory tools", () => {
    const result = normalizeWorkspaceBoundaryArgs(
      {
        capabilities: {
          sideEffect: "process",
          sandboxRequired: true,
          workspaceBound: true,
          workspaceBoundary: {
            argKeys: ["cwd"],
            argTypes: {
              cwd: "directory",
            },
          },
        },
      },
      {
        cwd: "../outside",
      },
    );

    expect(result).toHaveProperty("rejectReason");
  });
});
