import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildAgentExecutionEnvironmentPrompt, resolveAgentContext } from "./thread-request-context-agent.resolver.js";

describe("resolveAgentContext", () => {
  it("injects execution environment details into the agent prompt", () => {
    const prompt = buildAgentExecutionEnvironmentPrompt({
      platform: "win32",
      shellFamily: "powershell",
      shellExecutable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      workspaceRoot: "D:\\workspace\\rag-demo",
      cwd: "D:\\testData",
      availableTools: ["read", "list", "glob", "grep", "terminal"],
    });

    assert.match(prompt, /当前执行平台：win32/);
    assert.match(prompt, /当前 shell：powershell/);
    assert.match(prompt, /workspaceRoot：D:\\workspace\\rag-demo/);
    assert.match(prompt, /当前可用工具：read, list, glob, grep, terminal/);
    assert.match(prompt, /已知文件用 read/);
    assert.match(prompt, /已知目录看直接子项用 list/);
    assert.match(prompt, /按路径模式找文件用 glob/);
    assert.match(prompt, /按正文查内容用 grep/);
    assert.doesNotMatch(
      prompt,
      /read_list|read_locate|read_open|read_extract|read_slice/,
    );
    assert.match(prompt, /terminal/);
  });

  it("returns null when agent is disabled", () => {
    const context = resolveAgentContext({
      thread: {
        roleId: null,
        contextSummary: null,
        contextSummaryUpdatedAt: null,
        agentEnabled: false,
      },
      userId: 1,
    });

    assert.equal(context, null);
  });

  it("marks the agent prompt as execution-only request context", () => {
    const context = resolveAgentContext({
      thread: {
        roleId: null,
        contextSummary: null,
        contextSummaryUpdatedAt: null,
        agentEnabled: true,
      },
      userId: 1,
    });

    assert.equal(context?.message?.requestContextScope, "agent-execution");
  });
});
