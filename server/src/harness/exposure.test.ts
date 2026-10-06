import { afterEach, describe, expect, it } from "vitest";
import { clearHarnessRegistry, registerTool } from "./registry.js";
import { resolveHarnessToolExposure } from "./exposure.js";
import { terminalSessionCompatibilityTool, terminalTool } from "../mcp/tools/terminal-session.tool.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import { readListTool } from "../mcp/tools/read-list.tool.js";
import { readDiscoverTool } from "../mcp/tools/read-discover.tool.js";
import { readOpenTool } from "../mcp/tools/read-open.tool.js";
import { readSliceTool } from "../mcp/tools/read-slice.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";

const terminalSchemaKeys = [
  "command",
  "cwd",
  "env",
  "timeoutMs",
  "attachSessionId",
  "sessionMode",
];

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

describe("resolveHarnessToolExposure", () => {
  afterEach(() => {
    clearHarnessRegistry();
  });

  it("keeps the full terminal runtime schema", () => {
    registerTool(terminalTool);

    const [definition] = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "anything",
    }).visibleDefinitions;
    const properties = (definition?.inputSchema.properties ?? {}) as Record<string, unknown>;

    expect(Object.keys(properties)).toEqual(terminalSchemaKeys);
    expect(definition?.capabilities.requiresApproval).toBe(true);
  });

  it("hides the legacy terminal_session alias from new Agent exposure", () => {
    registerTool(terminalTool);
    registerTool(terminalSessionCompatibilityTool);

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "run pnpm check",
    });

    expect(decision.exposedToolIds).toContain("terminal");
    expect(decision.exposedToolIds).not.toContain("terminal_session");
  });

  it.each([
    "README.md 里写了什么",
    "你好",
    "打开网页然后保存文件",
    "run pnpm check",
  ])("does not use user wording to hide terminal: %s", (query) => {
    registerTool(terminalTool);
    registerTool(readTool);

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query,
    });

    expect(decision.exposedToolIds).toContain("terminal");
    expect(decision.exposedToolIds).toContain("read");
  });

  it("does not use sandbox profile state to hide registered public tools", () => {
    registerTool(terminalTool);

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "run pnpm check",
      sandboxProfiles: {
        command: false,
      },
    });

    expect(decision.exposedToolIds).toContain("terminal");
    expect(decision.reasons).toEqual([]);
  });

  it("does not use chat_surface domain heuristics to hide registered public tools", () => {
    registerTool(terminalTool);
    registerTool(readTool);
    registerTool(webSearchTool);

    const decision = resolveHarnessToolExposure({
      source: "chat_surface",
      query: "整理网页并保存到本地",
    });

    expect(decision.exposedToolIds).toEqual(
      expect.arrayContaining(["terminal", "read", "web_search"]),
    );
  });

  it("preserves approval metadata but does not use it as an exposure heuristic", () => {
    registerTool({
      ...terminalTool,
      definition: {
        ...terminalTool.definition,
        capabilities: {
          ...terminalTool.definition.capabilities,
          requiresApproval: false,
        },
      },
    });

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "run pnpm check",
    });
    const terminalDefinition = decision.visibleDefinitions.find(
      (definition) => definition.id === "terminal",
    );

    expect(terminalDefinition).toBeDefined();
    expect(terminalDefinition?.capabilities.requiresApproval).toBe(false);
  });

  it("keeps implementation primitives out of the public tool contract", () => {
    registerTool(readTool);
    registerTool(listTool);
    registerTool(readListTool);
    registerTool(readDiscoverTool);
    registerTool(readSliceTool);
    registerTool(readOpenTool);

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "open README.md",
    });

    expect(decision.exposedToolIds).toContain("read");
    expect(decision.exposedToolIds).toContain("list");
    expect(decision.exposedToolIds).not.toContain("read_discover");
    expect(decision.exposedToolIds).not.toContain("read_open");
    expect(decision.exposedToolIds).not.toContain("read_list");
    expect(decision.exposedToolIds).not.toContain("read_slice");
  });

  it("uses only explicit Agent Access to determine whether an external MCP tool is public", () => {
    registerTool(externalFakeTool);

    const hidden = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "use external system",
    });
    expect(hidden.exposedToolIds).not.toContain("external_fake_tool");

    const visible = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "use external system",
      allowExternal: true,
      allowedExternalToolIds: ["external_fake_tool"],
    });
    expect(visible.exposedToolIds).toContain("external_fake_tool");
  });

  it("does not create semantic or runtime policy reasons for public built-in tools", () => {
    registerTool(readTool);
    registerTool(webSearchTool);
    registerTool(terminalTool);

    const decision = resolveHarnessToolExposure({
      source: "agent_intent",
      query: "公众号文章抓取后写入 HTML，需要时使用终端",
      sandboxProfiles: { command: false },
    });

    expect(decision.exposedToolIds).toEqual(
      expect.arrayContaining(["read", "web_search", "terminal"]),
    );
    expect(decision.reasons).toEqual([]);
  });
});
