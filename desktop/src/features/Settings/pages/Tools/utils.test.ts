import { describe, expect, it } from "vitest";
import {
  buildToolDraft,
  compactJson,
  findPrimaryArtifact,
  getToolGroups,
  getTerminalResultSummary,
} from "./utils";
import type { HarnessToolDefinition, ToolArtifact } from "@/shared/api/tools";
import type { WorkbenchToolDefinition } from "./types";

const createArtifact = (kind: ToolArtifact["kind"]): ToolArtifact => ({
  id: `${kind}-1`,
  kind,
  title: kind,
});

const createTool = (
  id: HarnessToolDefinition["id"],
  groupId = "read",
  groupOrder = 10,
): WorkbenchToolDefinition => ({
  id,
  title: id,
  description: "",
  domain: "read",
  source: "internal",
  mode: "sync",
  inputSchema: {},
  tags: [],
  capabilities: {
    sideEffect: "none",
    requiresApproval: false,
  },
  workbench: {
    groupId,
    groupLabel: groupId,
    groupDescription: groupId,
    groupOrder,
    icon: "wrench",
  },
});

describe("getToolGroups", () => {
  it("keeps different product groups separate when their runtime domain is the same", () => {
    expect(getToolGroups([
      createTool("browser_observe", "browser_computer_use", 50),
      createTool("browser_attached_look", "browser_attached", 60),
      createTool("browser_act", "browser_computer_use", 50),
    ])).toEqual(["browser_computer_use", "browser_attached"]);
  });
});

describe("compactJson", () => {
  it("formats JSON with 2-space indentation", () => {
    expect(compactJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("getTerminalResultSummary", () => {
  it("returns null for non-object values", () => {
    expect(getTerminalResultSummary(null)).toBeNull();
    expect(getTerminalResultSummary("text")).toBeNull();
    expect(getTerminalResultSummary([])).toBeNull();
  });

  it("returns null when required fields are missing or invalid", () => {
    expect(getTerminalResultSummary({})).toBeNull();
    expect(
      getTerminalResultSummary({ command: 123, cwd: "/tmp", streamMode: "split" }),
    ).toBeNull();
  });

  it("extracts known terminal result fields", () => {
    const result = getTerminalResultSummary({
      command: "ls",
      cwd: "/tmp",
      streamMode: "merged",
      exitCode: 0,
      timedOut: false,
      stdout: "file.txt",
      state: "running",
      continuationId: "continuation-1",
      continuationAvailable: true,
      nextOutputOffset: 12,
      outputBytesAvailable: 24,
      outputLimitBytes: 12,
      commandCompleted: false,
    });

    expect(result).toEqual({
      command: "ls",
      cwd: "/tmp",
      streamMode: "merged",
      exitCode: 0,
      timedOut: false,
      stdout: "file.txt",
      state: "running",
      continuationId: "continuation-1",
      continuationAvailable: true,
      nextOutputOffset: 12,
      outputBytesAvailable: 24,
      outputLimitBytes: 12,
      commandCompleted: false,
    });
  });

  it("ignores unknown streamMode values", () => {
    const result = getTerminalResultSummary({
      command: "ls",
      cwd: "/tmp",
      streamMode: "invalid",
    });

    expect(result).toEqual({
      command: "ls",
      cwd: "/tmp",
      streamMode: undefined,
    });
  });
});

describe("findPrimaryArtifact", () => {
  it("returns null for empty artifacts", () => {
    expect(findPrimaryArtifact([])).toBeNull();
  });

  it("prefers search-results over others", () => {
    const artifacts = [createArtifact("text"), createArtifact("search-results")];
    expect(findPrimaryArtifact(artifacts)).toEqual(createArtifact("search-results"));
  });

  it("falls back to the first available kind by priority", () => {
    const artifacts = [createArtifact("text"), createArtifact("code")];
    expect(findPrimaryArtifact(artifacts)).toEqual(createArtifact("text"));
  });
});

describe("buildToolDraft", () => {
  it.each([
    ["read", "{}"],
    ["read_list", "{}"],
    ["web_search", "{}"],
    ["terminal", "{}"],
  ])("builds draft for %s", (id, expected) => {
    expect(buildToolDraft(createTool(id as HarnessToolDefinition["id"]))).toBe(expected);
  });

  it("returns empty JSON for unknown tool ids", () => {
    expect(buildToolDraft(createTool("unknown" as HarnessToolDefinition["id"]))).toBe(
      "{}",
    );
  });
});
