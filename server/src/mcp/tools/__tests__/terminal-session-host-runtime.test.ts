import { describe, expect, it } from "vitest";

import { normalizeWorkspaceBoundaryArgs } from "../../workspace-path-args.js";
import { terminalSessionCompatibilityTool, terminalTool } from "../terminal-session.tool.js";

type SchemaProperty = {
  description?: string;
  enum?: readonly string[];
};

const getExposedProperties = (exposure: "agent_intent" | "chat_surface") =>
  terminalTool.definition.inputSchemaByExposure?.[exposure]
    ?.properties as Record<string, SchemaProperty>;

describe("terminal host runtime metadata", () => {
  it("uses terminal as the canonical id while preserving the legacy persisted-run alias", () => {
    expect(terminalTool.definition.id).toBe("terminal");
    expect(terminalSessionCompatibilityTool.definition.id).toBe("terminal_session");
    expect(terminalSessionCompatibilityTool.execute).toBe(terminalTool.execute);
  });

  it("keeps approval but no longer requires sandbox execution", () => {
    expect(
      terminalTool.definition.capabilities.requiresApproval,
    ).toBe(true);
    expect(
      terminalTool.definition.capabilities.sandboxRequired,
    ).toBe(false);
    expect(
      terminalTool.definition.capabilities.sandboxProfile,
    ).toBeUndefined();
  });

  it("describes Terminal as process execution and an escape hatch rather than a default semantic API", () => {
    expect(terminalTool.definition.description).toMatch(/process\/shell work/i);
    expect(terminalTool.definition.description).toMatch(/execution escape hatch/i);
    expect(terminalTool.definition.description).toMatch(/prefer an exposed semantic Tool/i);
  });

  it("preserves canonical host-process cwd for downstream approval and runtime authority", () => {
    for (const cwd of ["../outside", "/outside", "C:\\outside"]) {
      expect(
        normalizeWorkspaceBoundaryArgs(terminalTool.definition, {
          command: "pwd",
          cwd,
        }),
      ).toEqual({
        args: {
          command: "pwd",
          cwd,
        },
      });
    }
  });

  it("describes cwd as a host execution directory instead of a workspace-only jail", () => {
    const properties = terminalTool.definition.inputSchema
      .properties as Record<string, SchemaProperty>;

    expect(properties.cwd?.description).toMatch(/absolute paths/i);
    expect(properties.cwd?.description).toMatch(/approval/i);
  });

  it("exposes persistent PTY controls to Planner and chat surfaces", () => {
    for (const exposure of ["agent_intent", "chat_surface"] as const) {
      const properties = getExposedProperties(exposure);
      expect(properties.sessionMode?.enum).toEqual([
        "ephemeral",
        "persistent",
      ]);
      expect(properties.attachSessionId?.description).toMatch(/existing/i);
      expect(properties.env?.description).toMatch(/host environment/i);
      expect(properties.continuationId?.description).toMatch(/without starting another command/i);
      expect(properties.outputOffset?.description).toMatch(/nextOutputOffset/i);
      expect(properties.outputLimitBytes?.description).toMatch(/remains reachable/i);
      expect(properties.operation?.enum).toEqual(["status", "stop"]);
      expect(properties.sessionId?.description).toMatch(/persistent terminal session/i);
    }

    const schema = terminalTool.definition.inputSchema as {
      anyOf?: Array<{ required?: string[] }>;
    };
    expect(schema.anyOf).toEqual([
      { required: ["command"] },
      { required: ["continuationId"] },
      { required: ["operation", "sessionId"] },
    ]);
  });
});
