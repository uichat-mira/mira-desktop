import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { agentGraph, langGraphAgent } from "../graph/index";
import { piAgentLoop } from "../pi-loop";
import { resolveAgentRuntimeName } from "../runtime";
import type { AgentGraphInput, AgentGraphOutput } from "../types";

const initialOverride = process.env.MIRA_AGENT_RUNTIME;

afterEach(() => {
  vi.restoreAllMocks();
  if (initialOverride === undefined) delete process.env.MIRA_AGENT_RUNTIME;
  else process.env.MIRA_AGENT_RUNTIME = initialOverride;
});

test("Pi Loop is the implicit default across test, dev and production environments", () => {
  for (const NODE_ENV of ["test", "development", "production", undefined]) {
    assert.equal(resolveAgentRuntimeName({ NODE_ENV }), "pi_loop");
  }
  assert.equal(resolveAgentRuntimeName({
    NODE_ENV: "test", MIRA_AGENT_RUNTIME: " pi_loop ",
  }), "pi_loop");
  assert.equal(resolveAgentRuntimeName({
    NODE_ENV: "production", MIRA_AGENT_RUNTIME: " LANGGRAPH ",
  }), "langgraph");
});

test("the real agentGraph facade dispatches to Pi by default, LangGraph only by explicit opt-in", async () => {
  const output = { status: "completed" } as AgentGraphOutput;
  const pi = vi.spyOn(piAgentLoop, "run").mockResolvedValue(output);
  const legacy = vi.spyOn(langGraphAgent, "run").mockResolvedValue(output);
  const input = { runId: "runtime-selector-no-persisted-run" } as AgentGraphInput;

  delete process.env.MIRA_AGENT_RUNTIME;
  assert.equal(await agentGraph.run(input), output);
  assert.equal(pi.mock.calls.length, 1);
  assert.equal(legacy.mock.calls.length, 0);

  process.env.MIRA_AGENT_RUNTIME = "langgraph";
  assert.equal(await agentGraph.run(input), output);
  assert.equal(pi.mock.calls.length, 1);
  assert.equal(legacy.mock.calls.length, 1);
});
