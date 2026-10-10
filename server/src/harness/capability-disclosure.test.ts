import { afterEach, describe, expect, it } from "vitest";
import {
  clearHarnessRegistry,
  listToolDefinitions,
  registerTool,
} from "./registry.js";
import {
  createGenericChildCapabilityScope,
  createMainAgentCapabilityScope,
  projectAgentCapabilityView,
  type AgentCapabilityScope,
  type CapabilityDisclosure,
} from "./capability-view.js";
import {
  describeCapabilityDisclosure,
  discloseCapabilitySchemas,
  materializeCapabilitySchema,
  materializeKnownCapabilitySchema,
  projectCapabilityToolMetadata,
  promoteCapabilitySchema,
} from "./capability-disclosure.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { writeTool } from "../mcp/tools/write.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";

const unavailableReadiness = () => ({
  state: "unavailable" as const,
  reason: "Runtime prerequisite is missing.",
  code: "test_runtime_unavailable",
});

const project = (
  scope: AgentCapabilityScope,
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

const schemaFor = (view: ReturnType<typeof project>, capabilityId: string) =>
  materializeCapabilitySchema(view, capabilityId, listToolDefinitions());

const promote = (view: ReturnType<typeof project>, capabilityId: string) =>
  promoteCapabilitySchema({
    view,
    capabilityId,
    definitions: listToolDefinitions(),
  });

describe("progressive Tool metadata and schema disclosure", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("projects compact metadata as a disclosure stage separate from the full schema", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    const metadata = projectCapabilityToolMetadata(view, listToolDefinitions());

    expect(metadata).toHaveLength(1);
    const entry = metadata[0]!;
    expect(entry.capabilityId).toBe("read");
    expect(entry.disclosure).toBe("metadata");
    // Compact metadata is a materially separate stage: it must not carry the
    // full input schema that only schema disclosure may reveal.
    expect(Object.keys(entry).sort()).toEqual([
      "capabilities",
      "capabilityId",
      "description",
      "disclosure",
      "domain",
      "source",
      "tags",
      "title",
    ]);
    expect("inputSchema" in entry).toBe(false);

    // Metadata stage does not leak the schema.
    expect(schemaFor(view, "read")).toBeUndefined();

    const promoted = promote(view, "read");
    expect(promoted.transition).toEqual({
      capabilityId: "read",
      from: "metadata",
      to: "schema",
      reason: "promoted",
      schemaMaterialized: true,
    });
    expect(promoted.schema?.inputSchema).toBe(readTool.definition.inputSchema);
    expect(schemaFor(promoted.view, "read")?.inputSchema).toBe(
      readTool.definition.inputSchema,
    );
  });

  it("keeps two Tools discoverable while materializing only one full schema", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    expect(projectCapabilityToolMetadata(view, listToolDefinitions())).toHaveLength(
      2,
    );

    const promoted = promote(view, "read");
    expect(promoted.transition.reason).toBe("promoted");

    // Both remain discoverable at the metadata/schema stages.
    const metadata = projectCapabilityToolMetadata(
      promoted.view,
      listToolDefinitions(),
    );
    expect(metadata.map((tool) => tool.capabilityId).sort()).toEqual([
      "read",
      "write",
    ]);

    // Only the promoted Tool has a materialized full schema.
    expect(schemaFor(promoted.view, "read")?.inputSchema).toBe(
      readTool.definition.inputSchema,
    );
    expect(schemaFor(promoted.view, "write")).toBeUndefined();

    const trace = describeCapabilityDisclosure(promoted.view);
    expect(trace.metadataDisclosedCount).toBe(2);
    expect(trace.schemaDisclosedCount).toBe(1);
  });

  it("materializes an exact known Tool schema directly without a scoped view", () => {
    registerTool(readTool);

    const direct = materializeKnownCapabilitySchema({
      capabilityId: "read",
      definitions: listToolDefinitions(),
    });
    expect(direct?.inputSchema).toBe(readTool.definition.inputSchema);
  });

  it("lets an exact known Tool reach schema while it is still at the metadata stage", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    // The scoped view has not promoted the schema yet.
    expect(schemaFor(view, "read")).toBeUndefined();

    const direct = materializeKnownCapabilitySchema({
      capabilityId: "read",
      definitions: listToolDefinitions(),
      view,
    });
    expect(direct?.inputSchema).toBe(readTool.definition.inputSchema);
  });

  it("does not let schema disclosure bypass runtime readiness", () => {
    registerTool(webSearchTool, { resolveReadiness: unavailableReadiness });

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }), {
      requestedDisclosure: new Map<string, CapabilityDisclosure>([
        ["web_search", "schema"],
      ]),
    });

    expect(projectCapabilityToolMetadata(view, listToolDefinitions())).toEqual([]);
    expect(schemaFor(view, "web_search")).toBeUndefined();

    const promoted = promote(view, "web_search");
    expect(promoted.transition.reason).toBe("blocked-unavailable");
    expect(promoted.schema).toBeUndefined();

    expect(
      materializeKnownCapabilitySchema({
        capabilityId: "web_search",
        definitions: listToolDefinitions(),
        view,
      }),
    ).toBeUndefined();
    expect(
      materializeKnownCapabilitySchema({
        capabilityId: "web_search",
        definitions: listToolDefinitions(),
      }),
    ).toBeUndefined();
  });

  it("does not disclose an unavailable Tool that recovers to metadata then schema", () => {
    let ready = false;
    registerTool(webSearchTool, {
      resolveReadiness: () =>
        ready
          ? { state: "ready", reason: "Runtime prerequisites are satisfied." }
          : unavailableReadiness(),
    });

    const hiddenView = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    expect(schemaFor(hiddenView, "web_search")).toBeUndefined();
    expect(projectCapabilityToolMetadata(hiddenView, listToolDefinitions())).toEqual(
      [],
    );
    expect(describeCapabilityDisclosure(hiddenView).hiddenCount).toBe(1);

    ready = true;
    const metadataView = project(
      createMainAgentCapabilityScope({ scopeId: "main" }),
    );
    expect(
      projectCapabilityToolMetadata(metadataView, listToolDefinitions()).map(
        (tool) => tool.capabilityId,
      ),
    ).toEqual(["web_search"]);
    expect(schemaFor(metadataView, "web_search")).toBeUndefined();

    const promoted = promote(metadataView, "web_search");
    expect(promoted.transition.reason).toBe("promoted");
    expect(promoted.schema?.inputSchema).toBe(
      webSearchTool.definition.inputSchema,
    );
  });

  it("does not let disclosure manufacture eligibility outside the scope envelope", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const view = project(
      createMainAgentCapabilityScope({
        scopeId: "main",
        eligibleCapabilityIds: ["read"],
        discoverableCapabilityIds: ["read"],
      }),
    );

    const entry = view.capabilities.get("write");
    expect(entry?.eligible).toBe(false);
    expect(entry?.discoverable).toBe(false);
    expect(entry?.disclosure).toBe("hidden");

    const promoted = promote(view, "write");
    expect(promoted.transition.reason).toBe("blocked-not-discoverable");
    expect(promoted.schema).toBeUndefined();
    expect(schemaFor(view, "write")).toBeUndefined();
    expect(
      projectCapabilityToolMetadata(view, listToolDefinitions()).map(
        (tool) => tool.capabilityId,
      ),
    ).toEqual(["read"]);
  });

  it("keeps eligible and discoverable authority independent of an undisclosed schema", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    const entry = view.capabilities.get("read");

    // Undisclosed full schema does not imply the Tool lacks authority.
    expect(entry?.eligible).toBe(true);
    expect(entry?.discoverable).toBe(true);
    expect(entry?.disclosure).toBe("metadata");
    expect(schemaFor(view, "read")).toBeUndefined();
    expect(
      materializeKnownCapabilitySchema({
        capabilityId: "read",
        definitions: listToolDefinitions(),
        view,
      })?.inputSchema,
    ).toBe(readTool.definition.inputSchema);
  });

  it("preserves a scope disclosure ceiling across promotion attempts", () => {
    registerTool(readTool);

    const view = project(
      createMainAgentCapabilityScope({
        scopeId: "main",
        maxDisclosure: "metadata",
      }),
    );

    const promoted = promote(view, "read");
    expect(promoted.transition.reason).toBe("blocked-ceiling");
    expect(promoted.view.maxDisclosure).toBe("metadata");
    expect(promoted.schema).toBeUndefined();
    expect(schemaFor(view, "read")).toBeUndefined();
  });

  it("reports unknown capability promotion as a no-op transition", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    const promoted = promote(view, "does_not_exist");
    expect(promoted.transition.reason).toBe("unknown-capability");
    expect(promoted.schema).toBeUndefined();
    expect(promoted.view).toBe(view);
  });

  it("treats an already schema-disclosed capability as an idempotent promotion", () => {
    registerTool(readTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }), {
      requestedDisclosure: new Map<string, CapabilityDisclosure>([
        ["read", "schema"],
      ]),
    });

    const promoted = promote(view, "read");
    expect(promoted.transition.reason).toBe("already-disclosed");
    expect(promoted.transition.from).toBe("schema");
    expect(promoted.transition.to).toBe("schema");
    expect(promoted.schema?.inputSchema).toBe(readTool.definition.inputSchema);
  });

  it("applies identical disclosure semantics to Main Agent and Generic Child scopes", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const options = {
      eligibleCapabilityIds: ["read", "write"],
      discoverableCapabilityIds: ["read", "write"],
    } as const;

    const mainView = project(
      createMainAgentCapabilityScope({ scopeId: "main", ...options }),
    );
    const childView = project(
      createGenericChildCapabilityScope({ scopeId: "child", ...options }),
    );

    expect(
      projectCapabilityToolMetadata(mainView, listToolDefinitions()).map(
        (tool) => tool.capabilityId,
      ),
    ).toEqual(
      projectCapabilityToolMetadata(childView, listToolDefinitions()).map(
        (tool) => tool.capabilityId,
      ),
    );

    const mainPromotion = promote(mainView, "read");
    const childPromotion = promote(childView, "read");
    expect(mainPromotion.transition).toEqual(childPromotion.transition);
    expect(mainPromotion.schema?.inputSchema).toBe(
      childPromotion.schema?.inputSchema,
    );

    const mainTrace = describeCapabilityDisclosure(mainPromotion.view);
    const childTrace = describeCapabilityDisclosure(childPromotion.view);
    expect(mainTrace.schemaDisclosedCount).toBe(childTrace.schemaDisclosedCount);
    expect(mainTrace.metadataDisclosedCount).toBe(
      childTrace.metadataDisclosedCount,
    );
    expect(mainTrace.scopeKind).toBe("main_agent");
    expect(childTrace.scopeKind).toBe("generic_child");
  });

  it("keeps External MCP Tools protocol-neutral over the same disclosure stages", () => {
    const externalFakeTool = {
      definition: {
        id: "external_fake_tool",
        title: "External Fake Tool",
        description: "external fake",
        domain: "external_mcp" as const,
        source: "external" as const,
        mode: "sync" as const,
        inputSchema: { type: "object" },
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
    registerTool(externalFakeTool);

    const view = project(
      createGenericChildCapabilityScope({
        scopeId: "child",
        eligibleCapabilityIds: ["external_fake_tool"],
      }),
    );

    const metadata = projectCapabilityToolMetadata(view, listToolDefinitions());
    expect(metadata.map((tool) => tool.capabilityId)).toEqual([
      "external_fake_tool",
    ]);
    expect(metadata[0]?.source).toBe("external");
    expect("inputSchema" in (metadata[0] ?? {})).toBe(false);

    const promoted = promote(view, "external_fake_tool");
    expect(promoted.transition.reason).toBe("promoted");
    expect(promoted.schema?.inputSchema).toEqual({ type: "object" });
  });

  it("distinguishes metadata disclosure from schema disclosure in the trace", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    const promoted = promote(view, "read");

    const trace = describeCapabilityDisclosure(promoted.view);
    const readEntry = trace.entries.find(
      (entry) => entry.capabilityId === "read",
    );
    const writeEntry = trace.entries.find(
      (entry) => entry.capabilityId === "write",
    );

    expect(readEntry?.metadataDisclosed).toBe(true);
    expect(readEntry?.schemaDisclosed).toBe(true);
    expect(writeEntry?.metadataDisclosed).toBe(true);
    expect(writeEntry?.schemaDisclosed).toBe(false);
    expect(trace.metadataDisclosedCount).toBe(2);
    expect(trace.schemaDisclosedCount).toBe(1);
  });

  it("promotes only the selected Tools in one controlled batch and leaves the rest metadata-only", () => {
    registerTool(readTool);
    registerTool(writeTool);

    const view = project(createMainAgentCapabilityScope({ scopeId: "main" }));
    const disclosure = discloseCapabilitySchemas({
      view,
      capabilityIds: ["read"],
      definitions: listToolDefinitions(),
    });

    expect(disclosure.transitions).toEqual([
      {
        capabilityId: "read",
        from: "metadata",
        to: "schema",
        reason: "promoted",
        schemaMaterialized: true,
      },
    ]);
    expect(disclosure.schemas.map((schema) => schema.capabilityId)).toEqual([
      "read",
    ]);
    expect(disclosure.schemas[0]?.inputSchema).toBe(
      readTool.definition.inputSchema,
    );

    const trace = describeCapabilityDisclosure(disclosure.view);
    expect(trace.metadataDisclosedCount).toBe(2);
    expect(trace.schemaDisclosedCount).toBe(1);

    // The unselected Tool keeps compact metadata and no materialized schema, and
    // its undisclosed schema does not remove eligibility.
    expect(
      materializeCapabilitySchema(
        disclosure.view,
        "write",
        listToolDefinitions(),
      ),
    ).toBeUndefined();
    expect(disclosure.view.capabilities.get("write")?.eligible).toBe(true);
  });

  it("batch promotion is clamped by readiness and the scope envelope instead of widening authority", () => {
    registerTool(readTool);
    registerTool(webSearchTool, { resolveReadiness: unavailableReadiness });

    const view = project(
      createMainAgentCapabilityScope({
        scopeId: "main",
        eligibleCapabilityIds: ["read"],
        discoverableCapabilityIds: ["read"],
      }),
    );
    const disclosure = discloseCapabilitySchemas({
      view,
      capabilityIds: ["read", "web_search"],
      definitions: listToolDefinitions(),
    });

    const byId = Object.fromEntries(
      disclosure.transitions.map((transition) => [
        transition.capabilityId,
        transition,
      ]),
    );
    expect(byId.read?.reason).toBe("promoted");
    expect(byId.web_search?.reason).toBe("blocked-unavailable");
    expect(disclosure.schemas.map((schema) => schema.capabilityId)).toEqual([
      "read",
    ]);
  });
});
