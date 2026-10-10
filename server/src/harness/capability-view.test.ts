import { afterEach, describe, expect, it } from "vitest";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "./registry.js";
import { resolveToolRuntimeReadiness } from "./runtime-readiness.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import {
  createGenericChildCapabilityScope,
  createMainAgentCapabilityScope,
  createSkillChildCapabilityScope,
  describeAgentCapabilityView,
  getCapabilityViewEntry,
  listCapabilityIdsAtDisclosure,
  projectAgentCapabilityView,
  withCapabilityDisclosure,
  type CapabilityDisclosure,
} from "./capability-view.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { writeTool } from "../mcp/tools/write.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";

const disclosure = (
  capabilityId: string,
  value: CapabilityDisclosure,
): Map<string, CapabilityDisclosure> => new Map([[capabilityId, value]]);

const externalFakeTool = {
  definition: {
    id: "external_fake_tool",
    title: "External Fake Tool",
    description: "external fake",
    domain: "external_mcp" as const,
    source: "external" as const,
    mode: "sync" as const,
    inputSchema: {},
    tags: ["external", "mcp"],
    capabilities: {
      sideEffect: "network" as const,
      requiresApproval: true,
    },
  },
  execute() {
    return {};
  },
};

const project = (
  scope: Parameters<typeof projectAgentCapabilityView>[0]["scope"],
  options: Omit<
    Parameters<typeof projectAgentCapabilityView>[0],
    "scope" | "definitions"
  > = {},
) =>
  projectAgentCapabilityView({
    scope,
    definitions: listToolDefinitions(),
    ...options,
  });

describe("Agent Capability View", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("distinguishes ready and unavailable input from the Harness readiness contract", () => {
    let ready = false;
    registerTool(webSearchTool, {
      resolveReadiness: () =>
        ready
          ? { state: "ready", reason: "Runtime prerequisites are satisfied." }
          : {
              state: "unavailable",
              reason: "Runtime prerequisite is missing.",
              code: "test_runtime_unavailable",
            },
    });

    const unavailableView = project(
      createMainAgentCapabilityScope({ scopeId: "main" }),
      {
        requestedDisclosure: disclosure("web_search", "schema"),
      },
    );
    const unavailableEntry = getCapabilityViewEntry(
      unavailableView,
      "web_search",
    );
    expect(unavailableEntry?.readiness.state).toBe("unavailable");
    expect(unavailableEntry?.eligible).toBe(false);
    expect(unavailableEntry?.discoverable).toBe(false);
    expect(unavailableEntry?.disclosure).toBe("hidden");

    ready = true;
    const recoveredEntry = getCapabilityViewEntry(
      project(createMainAgentCapabilityScope({ scopeId: "main" }), {
        requestedDisclosure: disclosure("web_search", "schema"),
      }),
      "web_search",
    );
    expect(recoveredEntry?.readiness.state).toBe("ready");
    expect(recoveredEntry?.eligible).toBe(true);
    expect(recoveredEntry?.discoverable).toBe(true);
    expect(recoveredEntry?.disclosure).toBe("schema");
  });

  it("never lets a registered-but-unavailable native Tool become discoverable", () => {
    registerTool(webSearchTool, {
      resolveReadiness: () => ({
        state: "unavailable",
        reason: "Runtime prerequisite is missing.",
        code: "test_runtime_unavailable",
      }),
    });

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }), {
      requestedDisclosure: disclosure("web_search", "schema"),
      requestedDiscoverable: new Map([["web_search", true]]),
    });

    expect(listToolDefinitions().map((definition) => definition.id)).toContain(
      "web_search",
    );
    expect(getCapabilityViewEntry(view, "web_search")?.discoverable).toBe(false);
    expect(getCapabilityViewEntry(view, "web_search")?.disclosure).toBe(
      "hidden",
    );
  });

  it("holds independent disclosure state per Agent scope without mutating global readiness", () => {
    registerTool(readTool);

    const mainView = project(
      createMainAgentCapabilityScope({ scopeId: "main" }),
      {
        requestedDisclosure: disclosure("read", "schema"),
      },
    );
    const childView = project(
      createGenericChildCapabilityScope({
        scopeId: "child",
        eligibleCapabilityIds: ["read"],
      }),
      {
        requestedDisclosure: disclosure("read", "metadata"),
      },
    );

    expect(getCapabilityViewEntry(mainView, "read")?.disclosure).toBe("schema");
    expect(getCapabilityViewEntry(childView, "read")?.disclosure).toBe(
      "metadata",
    );
    expect(resolveToolRuntimeReadiness("read").state).toBe("ready");
    expect(listToolDefinitions().map((definition) => definition.id)).toContain(
      "read",
    );
  });

  it("represents a Child capability ceiling independently of the Parent visible Tool IDs", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const parentView = project(
      createMainAgentCapabilityScope({
        scopeId: "main",
        discoverableCapabilityIds: ["read"],
      }),
    );
    const childView = project(
      createGenericChildCapabilityScope({
        scopeId: "child",
        eligibleCapabilityIds: ["read", "write"],
      }),
    );

    expect(getCapabilityViewEntry(parentView, "read")?.discoverable).toBe(true);
    expect(getCapabilityViewEntry(parentView, "write")?.discoverable).toBe(
      false,
    );
    expect(getCapabilityViewEntry(childView, "write")?.eligible).toBe(true);
    expect(getCapabilityViewEntry(childView, "write")?.discoverable).toBe(true);
  });

  it("supports metadata/schema transitions and inspectable traces", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    expect(getCapabilityViewEntry(view, "read")?.disclosure).toBe("metadata");

    const schemaView = withCapabilityDisclosure(view, "read", "schema");
    expect(getCapabilityViewEntry(schemaView, "read")?.disclosure).toBe(
      "schema",
    );
    expect(listCapabilityIdsAtDisclosure(schemaView, "schema")).toEqual([
      "read",
    ]);
    expect(
      listCapabilityIdsAtDisclosure(view, "metadata"),
    ).toEqual(["read"]);

    expect(describeAgentCapabilityView(schemaView)).toEqual({
      scopeId: "main",
      scopeKind: "main_agent",
      capabilityCount: 1,
      entries: [
        {
          capabilityId: "read",
          readiness: "ready",
          eligible: true,
          discoverable: true,
          disclosure: "schema",
        },
      ],
    });
  });

  it("keeps disclosure separate from Harness execution authority", () => {
    registerTool(webSearchTool, {
      resolveReadiness: () => ({
        state: "unavailable",
        reason: "Runtime prerequisite is missing.",
        code: "test_runtime_unavailable",
      }),
    });

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }), {
      requestedDisclosure: disclosure("web_search", "schema"),
    });
    const entry = getCapabilityViewEntry(view, "web_search");

    // The view carries visibility state only. There is no authorization or
    // executable field that a caller could mistake for an execution grant.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "capabilityId",
      "disclosure",
      "discoverable",
      "eligible",
      "readiness",
    ]);

    // A state transition also cannot manufacture visibility.
    expect(
      getCapabilityViewEntry(
        withCapabilityDisclosure(view, "web_search", "schema"),
        "web_search",
      )?.disclosure,
    ).toBe("hidden");

    // The real Harness exposure path is unchanged: disclosure in a view does
    // not make the unavailable Tool runnable or public.
    expect(
      resolveHarnessToolExposure({
        source: "agent_intent",
        query: "search the web",
      }).exposedToolIds,
    ).not.toContain("web_search");
  });

  it("keeps External MCP eligibility semantics compatible and independent of the view", () => {
    registerTool(externalFakeTool);

    const scopedView = project(
      createSkillChildCapabilityScope({
        scopeId: "skill:example",
        eligibleCapabilityIds: ["external_fake_tool"],
      }),
    );
    expect(
      getCapabilityViewEntry(scopedView, "external_fake_tool")?.eligible,
    ).toBe(true);

    const unscopedView = project(
      createMainAgentCapabilityScope({
        scopeId: "main",
        eligibleCapabilityIds: ["read"],
      }),
    );
    expect(
      getCapabilityViewEntry(unscopedView, "external_fake_tool")?.eligible,
    ).toBe(false);

    // Explicit Agent Access remains the authority for external exposure; the
    // view does not duplicate or replace that Harness rule.
    expect(
      resolveHarnessToolExposure({
        source: "agent_intent",
        query: "use external system",
      }).exposedToolIds,
    ).not.toContain("external_fake_tool");
  });
});
