import { describe, expect, it } from "vitest";
import {
  formatCustomMcpConfig,
  parseCustomMcpConfig,
  removeCustomMcpDraft,
  upsertCustomMcpDrafts,
  type CustomMcpDraft,
} from "./customDrafts";

const localJson = `{"mcpServers":{"docs":{"command":"npx","args":["-y","@example/docs"],"env":{"TOKEN":"abc"}}}}`;
const cloudJson = `{"mcpServers":{"search":{"url":"https://example.test/mcp","headers":{"Authorization":"Bearer token"}}}}`;

describe("custom MCP draft parsing", () => {
  it("parses multiple local services with string args and env", () => {
    expect(parseCustomMcpConfig(localJson, "local")).toEqual({
      ok: true,
      servers: [{ name: "docs", config: { command: "npx", args: ["-y", "@example/docs"], env: { TOKEN: "abc" } } }],
    });
  });

  it("parses cloud services with HTTP URLs and string headers", () => {
    expect(parseCustomMcpConfig(cloudJson, "cloud")).toEqual({
      ok: true,
      servers: [{ name: "search", config: { url: "https://example.test/mcp", headers: { Authorization: "Bearer token" } } }],
    });
  });

  it.each([
    ["invalid json", "{", "local", "invalidJson"],
    ["missing root", "{}", "local", "serversRequired"],
    ["empty server map", `{"mcpServers":{}}`, "local", "serversRequired"],
    ["empty local command", `{"mcpServers":{"docs":{"command":" "}}}`, "local", "localCommandRequired"],
    ["invalid args", `{"mcpServers":{"docs":{"command":"npx","args":[1]}}}`, "local", "localArgsInvalid"],
    ["invalid env", `{"mcpServers":{"docs":{"command":"npx","env":{"TOKEN":1}}}}`, "local", "localEnvInvalid"],
    ["invalid cloud scheme", `{"mcpServers":{"search":{"url":"file:///tmp/mcp"}}}`, "cloud", "cloudUrlInvalid"],
    ["invalid headers", `{"mcpServers":{"search":{"url":"https://example.test","headers":{"x":false}}}}`, "cloud", "cloudHeadersInvalid"],
    ["cloud without a URL", `{"mcpServers":{"search":{"url":""}}}`, "cloud", "cloudUrlRequired"],
    ["mixed transport fields", `{"mcpServers":{"search":{"command":"npx","url":"https://example.test"}}}`, "local", "mixedTransport"],
    ["local configuration in a cloud batch", `{"mcpServers":{"search":{"command":"npx"}}}`, "cloud", "modeMismatch"],
  ] as const)("rejects %s", (_label, raw, mode, error) => {
    expect(parseCustomMcpConfig(raw, mode)).toEqual({ ok: false, error });
  });

  it("formats only valid JSON and preserves invalid text through the caller result", () => {
    expect(formatCustomMcpConfig(localJson, "local")).toEqual({
      ok: true,
      value: JSON.stringify(JSON.parse(localJson), null, 2),
    });
    expect(formatCustomMcpConfig("{", "local")).toEqual({ ok: false, error: "invalidJson" });
  });
});

describe("custom MCP draft collection", () => {
  const first: CustomMcpDraft = { id: "local:docs", mode: "local", name: "docs", config: { command: "npx" } };

  it("upserts by mode and server name while keeping separate modes distinct", () => {
    const replacement: CustomMcpDraft = { ...first, config: { command: "node", args: ["server.js"] } };
    const cloud: CustomMcpDraft = { ...first, id: "cloud:docs", mode: "cloud", config: { url: "https://example.test" } };
    expect(upsertCustomMcpDrafts([first], [replacement, cloud])).toEqual([replacement, cloud]);
  });

  it("removes only the selected session draft", () => {
    const cloud: CustomMcpDraft = { ...first, id: "cloud:docs", mode: "cloud", config: { url: "https://example.test" } };
    expect(removeCustomMcpDraft([first, cloud], first.id)).toEqual([cloud]);
  });
});
