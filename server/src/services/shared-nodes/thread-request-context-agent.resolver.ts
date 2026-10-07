import type { RequestContextResolver } from "./thread-request-context.types.js";

const buildAgentPromptContent = (executionEnvironment: {
  platform: NodeJS.Platform;
  shellFamily: "powershell" | "cmd" | "posix";
  shellExecutable: string;
  workspaceRoot: string | null;
  cwd: string | null;
  availableTools: string[];
} | null | undefined) =>
  [
    "当前线程已启用智能体模式。",
    "你可以使用当前可用工具，但必须先判断工具是否真的可用，再决定是否调用。",
    executionEnvironment
      ? [
          `当前执行平台：${executionEnvironment.platform}`,
          `当前 shell：${executionEnvironment.shellFamily} (${executionEnvironment.shellExecutable})`,
          `当前 workspaceRoot：${executionEnvironment.workspaceRoot ?? "unknown"}`,
          `当前 cwd：${executionEnvironment.cwd ?? "unknown"}`,
          `当前可用工具：${executionEnvironment.availableTools.join(", ") || "unknown"}`,
        ].join("\n")
      : null,
    "如果问题涉及当前文件夹、目录结构、文件列表、文件内容、路径定位或 workspace 内搜索，优先使用本地文件工具，而不是 web_search。",
    "Windows 环境下优先使用 PowerShell 语义，不要默认 bash/ls/cat/grep。",
    "本地文件工具按意图选择：已知文件用 read，已知目录看直接子项用 list，按路径模式找文件用 glob，按正文查内容用 grep。",
    "如果问题需要最新信息、线程状态、知识库、记忆或外部能力，不要猜测，优先走对应工具或上下文节点。",
    "工具调用结果是证据，不是最终答案；你需要把结果解释成用户能理解的结论。",
    "如果工具不可用、配置缺失或调用失败，要明确说明原因，不要伪造执行结果。",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

export const buildAgentExecutionEnvironmentPrompt = buildAgentPromptContent;

/**
 * Agent resolver:
 * Adds an optional request-only system prompt when the thread-level agent
 * toggle is enabled.
 *
 * This resolver intentionally acts as an override layer on top of the default
 * request context chain:
 * - Role and summary still load first
 * - Agent mode adds an execution-oriented instruction block after them
 * - Visible chat history remains untouched
 */
export const resolveAgentContext: RequestContextResolver = ({ thread }) => {
  if (!thread.agentEnabled) {
    return null;
  }

  return {
    message: {
      role: "system",
      content: buildAgentPromptContent(thread.executionEnvironment),
      requestContextScope: "agent-execution",
    },
    executionNode: {
      nodeId: "request-context-agent",
      nodeType: "context",
      phase: "done",
      label: "智能体模式",
      summary: "已注入智能体执行提示",
      details: {
        agentEnabled: true,
      },
    },
  };
};
