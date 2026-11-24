import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/mcp/core/definitions.js";
import { withWorkbenchMetadata } from "@/mcp/workbench-metadata.js";
import {
  resolveCoreCapabilityScope,
  resolveCoreCapabilityToolIds,
} from "./core-capability-scope.js";

const definition = (
  id: string,
  domain: ToolDefinition["domain"],
): ToolDefinition => ({
  id,
  title: id,
  description: `${id} tool`,
  domain,
  source: "internal",
  mode: "sync",
  inputSchema: { type: "object" },
  tags: [],
  capabilities: { sideEffect: "none", requiresApproval: false },
});

const definitions: ToolDefinition[] = [
  definition("read", "read"),
  definition("glob", "read"),
  definition("write", "edit"),
  definition("apply_patch", "edit"),
  definition("terminal", "terminal"),
  definition("web_search", "web_search"),
  definition("web_fetch", "web_search"),
  definition("browser_navigate", "browser_action"),
  definition("browser_assert", "browser_action"),
  definition("github_repository", "github"),
  definition("mail_query", "mail"),
  definition("news_search", "web_search"),
  definition("browser_attached_look", "browser_action"),
  definition("ask_external_expert", "external_expert"),
];

describe("core capability scope", () => {
  it("derives the shared scope from authored core profiles only", () => {
    const scope = resolveCoreCapabilityScope(definitions);

    expect(scope.profileIds.sort()).toEqual([
      "browser",
      "terminal_execution",
      "web",
      "workspace_edit",
      "workspace_lookup",
    ]);
    expect([...scope.toolIds].sort()).toEqual([
      "apply_patch",
      "browser_assert",
      "browser_navigate",
      "glob",
      "read",
      "terminal",
      "web_fetch",
      "web_search",
      "write",
    ]);
    expect(scope.toolIds.has("github_repository")).toBe(false);
    expect(scope.toolIds.has("mail_query")).toBe(false);
    expect(scope.toolIds.has("news_search")).toBe(false);
    expect(scope.toolIds.has("browser_attached_look")).toBe(false);
    expect(scope.toolIds.has("ask_external_expert")).toBe(false);
  });

  it("never marks a one-to-one fallback Tool as core", () => {
    expect(resolveCoreCapabilityToolIds([definition("custom_tool", "read")]).size).toBe(0);
  });

  it("exposes the same core mark on the Tool projection consumed by the page", () => {
    const projected = withWorkbenchMetadata(definitions);
    const coreFlags = new Map(
      projected.map((tool) => [tool.id, tool.coreCapability === true]),
    );

    expect(coreFlags.get("read")).toBe(true);
    expect(coreFlags.get("apply_patch")).toBe(true);
    expect(coreFlags.get("browser_navigate")).toBe(true);
    expect(coreFlags.get("github_repository")).toBe(false);
    expect(coreFlags.get("browser_attached_look")).toBe(false);
    expect(coreFlags.get("ask_external_expert")).toBe(false);
  });

  it("does not include acceptance placeholders that are absent from the registry", () => {
    const scope = resolveCoreCapabilityScope(definitions);

    expect(scope.toolIds.has("delete")).toBe(false);
    expect(scope.toolIds.has("move")).toBe(false);
  });
});
