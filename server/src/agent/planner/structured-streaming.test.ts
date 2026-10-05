import { describe, expect, it } from "vitest";

import { extractPlannerVisibleThought } from "./node.js";
import { parseNextActionPlannerOutput } from "./parse.js";

describe("streamed planner structured output", () => {
  it("extracts the public reason while the structured JSON is still streaming", () => {
    expect(
      extractPlannerVisibleThought(
        '{"type":"use_tool","reason":"正在检查 CodeGraph 当前工作区绑定',
      ),
    ).toBe("正在检查 CodeGraph 当前工作区绑定");

    expect(
      extractPlannerVisibleThought(
        '{"type":"use_tool","reason":"正在检查 CodeGraph 当前工作区绑定，接下来确认 manager 创建路径。","query":null',
      ),
    ).toBe("正在检查 CodeGraph 当前工作区绑定，接下来确认 manager 创建路径。");
  });

  it("strips strict-schema synthetic null fields from streamed tool args before Harness validation", () => {
    const rawEnvelope = JSON.stringify({
      type: "use_tool",
      reason: "先搜索 Planner 的引用。",
      query: null,
      toolId: "grep",
      args: {
        pattern: "Planner",
        path: null,
        include: null,
        literal: null,
        caseSensitive: null,
        context: null,
        offset: null,
        limit: null,
        includeIgnored: null,
        nested: {
          keep: "value",
          optional: null,
        },
      },
      question: null,
      planPatch: {
        addItems: [],
        completeIds: [],
      },
    });

    expect(parseNextActionPlannerOutput(rawEnvelope)).toEqual({
      type: "use_tool",
      toolId: "grep",
      args: {
        pattern: "Planner",
        nested: {
          keep: "value",
        },
      },
      reason: "先搜索 Planner 的引用。",
    });
  });
});
