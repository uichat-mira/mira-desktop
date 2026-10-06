import { ConversationTrimmer } from "@/services/conversation-trimmer.js";
import type { NormalizedChatMessage } from "@/services/provider-proxy.message-protocol";
import type {
  AgentToolExposureState,
  PlannerObservationContext,
} from "../types";
import { GENERIC_TASK_DELEGATE_TOOL_ID } from "../delegation/contract";
import { getRemainingPlannerRecoveryAttempts } from "../recovery";

export const normalizeToolExposure = (
  state: {
    toolExposure?: AgentToolExposureState;
  },
): AgentToolExposureState => {
  return state.toolExposure ?? {
    exposedTools: [],
    toolMeta: [],
  };
};

const summarizeToolSchemas = (toolExposure: AgentToolExposureState) =>
  toolExposure.toolMeta.map((tool) => {
    const capabilities = tool.capabilities;
    const plannerDescription =
      tool.toolId === GENERIC_TASK_DELEGATE_TOOL_ID
        ? "Planner-only protocol: delegate one bounded, independently verifiable work package when it has a clear boundary, requires multiple sequential tool calls, execution-time verification, or local recovery. The child owns that package's tool loop and returns structured evidence; do not split the same package into Main Planner tool-by-tool turns."
        : tool.toolId === "glob"
        ? "Find file paths matching a glob pattern. Does not search file contents."
        : tool.toolId === "list"
        ? "List the direct children of a known directory. Does not recurse."
        : tool.toolId === "read"
        ? "Read a known file. Returns text for text files and image content for supported images. Use glob when the path is unknown; use grep to search text contents."
        : tool.toolId === "grep"
        ? "Search file contents by regex or literal text. Returns paths and line locations; use glob to search filenames."
        : tool.toolId === "read_discover"
        ? "Discover candidate files, directories, symbols, or keyword locations without opening file bodies."
        : tool.toolId === "read_open"
          ? "Legacy known-target read compatibility tool."
          : tool.toolId === "codebase_explore"
            ? "Primary local code-understanding tool. Successful results include bounded workspace-verified source excerpts with paths and line ranges. Those verified excerpts already count as source-body evidence; use read only for a specific unresolved target or missing surrounding context."
            : tool.description;

    return {
      toolId: tool.toolId,
      description: plannerDescription,
      domain: tool.domain ?? null,
      source: tool.source ?? null,
      risk: {
        requiresApproval: capabilities?.requiresApproval ?? false,
        sideEffect: capabilities?.sideEffect ?? "unknown",
        workspaceBound: capabilities?.workspaceBound ?? false,
        longRunning: capabilities?.longRunning ?? false,
      },
      boundaries: {
        workspace:
          capabilities?.workspaceBound === true
            ? "workspace-bound"
            : "not workspace-bound",
        sandbox:
          capabilities?.sideEffect === "none"
            ? "read-only or observation-only"
            : "may mutate state or spawn runtime side effects",
      },
      inputSchema: tool.inputSchema,
    };
  });

const getRemainingRecoveryAttempts = (observationContext: PlannerObservationContext) =>
  getRemainingPlannerRecoveryAttempts(observationContext.recovery);

const PLANNER_HISTORY_LIMIT = 12;
const PLANNER_HISTORY_ITEM_CHAR_LIMIT = 700;

const buildRelevantConversationHistory = (
  messages: NormalizedChatMessage[] | undefined,
  currentRequest: string,
) => {
  if (!messages?.length) {
    return undefined;
  }

  const filtered = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: ConversationTrimmer.trimText(
        message.content,
        PLANNER_HISTORY_ITEM_CHAR_LIMIT,
      ),
    }))
    .filter(
      (message) =>
        !(message.role === "user" && message.content.trim() === currentRequest.trim()),
    );
  const recent = ConversationTrimmer.take(filtered, PLANNER_HISTORY_LIMIT, "tail");

  return recent.length > 0 ? recent : undefined;
};

const buildProgressionRules = (input: {
  observationContext: PlannerObservationContext;
  iteration: number;
  maxIterations: number;
}) => {
  const latestObservation = input.observationContext.latestObservation;
  const remainingRecoveryAttempts = getRemainingRecoveryAttempts(
    input.observationContext,
  );
  const latestStatus = latestObservation?.status;
  const latestToolId = latestObservation?.toolId;
  const latestRecoverable = latestObservation?.recoverable === true;
  const rules = [
    "你必须根据 PlannerObservationContext 决定下一步，而不是忽略最近一次执行结果。",
    "把每次工具或检索结果视为新的 observation；基于完整原始目标和累计执行历史滚动决定下一步。",
    "currentTaskFrame.skillRuntime.requirements 是 Skill 执行返回的结构化缺失条件，只描述缺什么和影响什么；它不是用户问题，也不是 nextAction。只有你可以判断它是否阻塞 globalGoal，并在确实阻塞时输出 ask_user、自己组织面向用户的问题。",
    "Skill requirement 当前不阻塞主线时，不要追问；继续其他可执行工作，并把未解决缺口保留在 remainingWork。不要把 skillRuntime、sessionId 或 stateRef 当作 workspace 文件线索去搜索。",
    "Skill 内部 TaskModel 调用属于 Skill Runtime 的受治理内部执行步骤，不需要你申请、调度或转换成用户追问。",
    "Main Planner owns the complete user goal, task decomposition, dependencies, acceptance, and final answer. A generic subAgent owns one bounded local work package and returns to Main Planner for acceptance and the next decision.",
    "Before applying any tool-specific guidance, first decide whether the entire current unfinished work package qualifies for delegation. Do not judge only the first concrete action inside that package.",
    "When one work package has a clear boundary, can be independently accepted, and is expected to require multiple sequential tool calls, execution-time verification, or local recovery, select one use_tool(delegate_task) for the complete package before considering concrete tools.",
    "delegate_task.goal must state the complete local objective, not one intermediate tool call. acceptanceCriteria must list observable completion conditions, including required reads, comparisons or mutations, verification, and evidence when applicable.",
    'The only valid delegation shape is {"type":"use_tool","toolId":"delegate_task","args":{"goal":"complete local objective","acceptanceCriteria":["observable condition"]},"reason":"..."}. goal and acceptanceCriteria must be inside args, never at the top level.',
    "Only a single concrete tool call that completes the requested action should be selected directly by Main Planner. Do not split one bounded package into multiple Main Planner tool turns.",
    "A pure response task needs answer directly and a trivial one-step read or action may use its normal tool; delegation is not mandatory for simple tasks.",
    "当 active Skill 是 docx、pdf、pptx 或 xlsx 时，禁止通过 terminal 执行 Python、python -m、python3、pip、conda 或手工设置 PYTHONPATH；必须由 Skill 内部 WenShu Runtime invocation 使用受控 runtime/script 标识执行。",
    "answer 是终止动作。只有完整用户目标中的每一项明确要求都已被执行证据覆盖时，才能选择 answer。",
    "不要只看 latestEvidenceSummary；必须同时检查 currentTaskFrame.completionCriteria、累计 executionHistory 和 evidenceHistory。",
    "CodeGraph 的 verifiedSource[...] 是已经重新读取 workspace 原文件后得到的正文证据，包含 path、line range、summary 与 excerpt；它不是普通 discover 候选。",
    "如果 CodeGraph verifiedSource 已覆盖当前问题所需实现细节，不要为了形式验证而逐个 read 同一批文件。只有存在明确 gap、缺失行号、被截断上下文、unverifiable/rejected candidate，或必须展开某个具体函数的相邻上下文时，才针对那个具体目标使用 read。",
    "代码架构/调用链任务优先先用 codebase_explore 缩小并解释搜索空间，再按明确缺口做少量 targeted read；禁止退化成无目标的逐文件 read crawl。",
    "如果上一次工具或检索失败但仍可恢复，不要默认输出 error。",
    "可恢复失败时，你可以：换参数重试同一工具、换另一个工具、先读取辅助文件或目录、ask_user，或在确实无法继续时选择 answer 并明确说明未完成项与失败影响。",
        "任何 use_tool 都只是提出动作，后续仍然必须经过 normalize / policy / approval；不要假装工具已经成功。",
        "不要把 WenShu Runtime invocation 改写成 terminal 命令；文档 Skill 的 Python 解释器、PYTHONPATH、脚本路径和依赖安装都不由 Planner 决定。",
    "不要无理由重复同一个失败调用；相同 toolId 只有在参数明显变化或理由明确时才能重试。",
  ];

  if (latestRecoverable) {
    rules.push(
      `最近一次 observation 是可恢复失败${
        latestToolId ? `（toolId=${latestToolId}）` : ""
      }；优先给出恢复动作，不要直接收成全局 error。`,
    );
  }

  if (latestStatus === "failed_terminal") {
    rules.push(
      "最近一次 observation 已经是终止失败；如果没有新的安全恢复路径，应输出明确终局，而不是继续假装推进。",
    );
  }

  if (remainingRecoveryAttempts <= 0) {
    rules.push(
      "当前恢复预算已经用完；必须给出明确终局，选择 ask_user 补齐关键信息，或 answer/error 清楚说明为什么无法继续，不能无限循环。",
    );
  } else {
    rules.push(
      `当前恢复预算还剩 ${remainingRecoveryAttempts} 次；如果继续恢复，必须说明这次为什么与上次不同。`,
    );
  }

  if (input.maxIterations > 0) {
    rules.push(
      `当前迭代进度为 ${input.iteration}/${input.maxIterations}；接近上限时优先执行最关键的剩余动作。迭代上限不是任务已经完成的证据，不得因此提前 answer。`,
    );
  }

  return rules;
};

const buildSchemaReplanMessages = (input: {
  question: string;
  toolExposure: AgentToolExposureState;
  observationContext: PlannerObservationContext;
}): NormalizedChatMessage[] => [
  {
    role: "system",
    content: [
      "你正在做一次 bounded replan。",
      "只允许返回一个合法的 nextAction JSON。",
      "允许动作只有 answer / retrieve / use_tool / ask_user / error。",
      "不要输出 Markdown，不要输出代码块，不要输出解释。",
      "当前 workspace 已绑定。",
      "如果问题明显在问本地 workspace 或本地文件，不要使用 web_search 代替本地证据路径。",
      "如果选择 use_tool，toolId 必须来自允许工具列表，args 必须严格符合 schema。",
      "toolSelectionHints 表示用户通过 @ 明确选择的工具包偏好；优先考虑其中当前已暴露的工具，但仍由你根据任务判断是否需要调用。",
      "工具包偏好不扩大允许工具列表、不绕过权限，也不保证必须调用。状态为 unavailable 或 unknown 时不得发明工具调用。",
      "Skill requirements 只是缺失条件事实；只有 Planner 可以在判断其阻塞完整目标后选择 ask_user 并组织用户问题。不要把 Skill stateRef 当作 workspace 路径。",
      "CodeGraph verifiedSource 是已重新读取原文件的正文证据；不要机械 read 同一批已验证文件，只补明确缺口。",
      "Main Planner owns the complete user goal, dependencies, acceptance, and final answer; a generic subAgent owns one bounded local work package and returns structured evidence for Main Planner acceptance.",
      "Before applying tool-specific guidance, judge the entire unfinished work package. Select one use_tool(delegate_task) when it has a clear independent acceptance boundary and is expected to need multiple sequential tools, post-execution verification, or local recovery.",
      'Delegation must use {"type":"use_tool","toolId":"delegate_task","args":{"goal":"complete local objective","acceptanceCriteria":["observable condition"]},"reason":"..."}; never put goal or acceptanceCriteria at the top level.',
      "Use a normal tool directly only when one concrete call completes the action. Do not split the same bounded package into Main Planner's separate tool turns; delegation is not mandatory for trivial one-step work or pure answer requests.",
      "这次 replan 的目标是修正上一次失败动作：你可以改参数、换工具、ask_user，或在确实无法继续时输出明确终局。",
      "answer 是终止动作；只有完整用户目标已经覆盖，或确实无法继续且会明确报告未完成项时才能选择。",
      "不要假装上一次工具已经成功，也不要重复同一个错误参数。",
    ].join("\n"),
    parts: [],
  },
  {
    role: "user",
    content: JSON.stringify(
      {
        currentUserRequest: input.question,
        workspaceBound: true,
        previousSchemaError: input.observationContext.recovery.schemaError ?? null,
        previousInvalidAction: input.observationContext.recovery.invalidAction ?? null,
        remainingRecoveryAttempts: getRemainingRecoveryAttempts(
          input.observationContext,
        ),
        allowedTools: summarizeToolSchemas(input.toolExposure),
        toolSelectionHints: input.toolExposure.requestedToolGroups ?? [],
        observationContext: input.observationContext,
        instruction:
          "Return exactly one valid nextAction JSON. Prefer a concrete recovery move; if a missing fact must come from the user, return ask_user; only return answer/error when you can explain why no executable progression remains or why the complete goal is already covered.",
      },
      null,
      2,
    ),
    parts: [],
  },
];

export const buildNextActionPlannerMessages = (input: {
  question: string;
  messages?: NormalizedChatMessage[];
  observationContext: PlannerObservationContext;
  toolExposure: AgentToolExposureState;
  iteration: number;
  maxIterations: number;
}): NormalizedChatMessage[] => {
  if (
    input.observationContext.recovery.source === "schema_replan" &&
    !input.observationContext.recovery.exhausted
  ) {
    return buildSchemaReplanMessages({
      question: input.question,
      toolExposure: input.toolExposure,
      observationContext: input.observationContext,
    });
  }

  return [
    {
      role: "system",
      content: [
        "你是 Agent graph 的 nextAction planner。",
        "你的唯一任务是决定当前这一轮的下一步动作。",
        "你是完整用户任务的唯一语义控制器：Harness 和 Evidence 只报告事实，不能替你宣布任务完成。",
        "DELEGATION DECISION CONTRACT:",
        "Before considering any concrete tool, evaluate the entire current unfinished work package against its completion criteria.",
        "If that package has a clear independent acceptance boundary and completing it is expected to require more than one tool call, a tool call followed by verification, or local recovery, choose one use_tool(delegate_task) now. Do not start with the first concrete tool.",
        "A direct concrete tool is appropriate only when that one call completes the requested action and the next step can be answer without another tool call or execution verification.",
        "Apply that direct-tool rule strictly: if any explicit completion criterion will still require another evidence-producing action after the proposed call returns, do not choose that call; delegate the whole bounded package instead.",
        "Reading multiple inputs before comparing them, or mutating state and then reading or testing it, are multi-action package structures even though their first action is a single read or edit.",
        'The delegation JSON must be {"type":"use_tool","toolId":"delegate_task","args":{"goal":"complete local objective","acceptanceCriteria":["observable condition"]},"reason":"..."}. goal and acceptanceCriteria are always inside args.',
        "When delegating, return that one decision object only. Do not emit a separate planPatch object or additional concrete tool decisions before or after it.",
        "Pure answers and genuinely one-call tasks remain direct; do not delegate them.",
        "currentTaskFrame.globalGoal 是稳定总目标：普通追问回答、补充信息、授权、执行结果和 planPatch 都不能把它改写成当前一句话或当前步骤。",
        "currentUserRequest 必须按用户原文保留；recentConversationHistory 是受限长度的最近对话，只用于你理解本轮请求与未完成任务的关系。",
        "当前请求可能只是对最近具体任务的授权、继续执行指示或执行方式修正。如果有限历史唯一确定了一个尚未完成的具体任务，你必须把当前请求与该任务合并理解，不能仅因本轮省略了目标就要求用户重新描述。",
        "如果有限历史存在多个可能目标或无法唯一确定要继续的任务，才使用 ask_user 澄清；不要自行猜测或继承不明确的任务。",
        "当你从有限历史继承任务语义时，planPatch.addItems 的 text 必须写出完整的语义目标和必要完成条件，不能只记录本轮的授权或方式说明；敏感值只需表述为已由用户提供，不要复制到计划文本；若工具和参数已经齐备，应在同一决策中直接选择 use_tool。",
        "你必须只输出 JSON，不要输出解释性自然语言，不要输出 Markdown，不要输出代码块。",
        "允许输出的 JSON 只有五种：",
        '{"type":"answer","reason":"...","completionProof":[{"criterion":"...","evidenceRefs":["tool:0"]}],"unresolvedGaps":[]}',
        '{"type":"retrieve","query":"...","reason":"..."}',
        '{"type":"use_tool","toolId":"...","args":{},"reason":"..."}',
        '{"type":"ask_user","question":"...","reason":"..."}',
        '{"type":"error","reason":"..."}',
        "如果你选择 use_tool，toolId 必须来自当前暴露的真实工具列表，args 必须是 JSON object。",
        "toolSelectionHints 表示用户通过 @ 明确选择的工具包偏好；任务需要工具时优先考虑其中 exposedToolIds，但是否调用以及调用哪个工具仍由你判断。",
        "工具包偏好不改变 exposedTools，不绕过权限和审批。状态为 unavailable 或 unknown 时，不得声称已经应用或调用该工具包。",
        "不要输出 capabilityId，不要发明未暴露工具，不要输出额外字段。",
        "对 workspace-bound read 工具的 path 参数，当前 workspace 根目录一律用 '.' 表示。",
        "不要输出 '/workspace' 作为 path。",
        "不要把 workspace 根目录下的文件写成 '/README.md' 这类类 Unix 绝对路径；应写成 'README.md'。",
        "如果要读取 workspace 根目录下的嵌套文件，应写成 'docs/README.md' 这类 workspace-relative path。",
        "对 terminal.cwd，只能输出 workspace-relative directory。",
        "如果命令就在 workspace 根目录执行，优先省略 cwd，或把 cwd 写成 '.'。",
        "不要把 terminal.cwd 写成 Windows 绝对路径、POSIX 绝对路径或父级跳转，例如 'D:\\workspace\\rag-demo'、'/workspace'、'..'、'../server'。",
        "先逐项核对完整用户目标，再决定 answer。answer 等于停止整个 Agent Loop，不等于当前步骤完成。",
        "某一条 evidence 可解释，不等于整项任务已经完成。",
        "如果任务有多个目标，只完成一部分时不要提前 answer。",
        "读到一个文件只证明该读取动作完成；如果用户还要求比较、修改、发送、运行或验证，必须继续。",
        "如果最新 evidence 仍有 gaps、missing、truncated、timed_out 或明确 error，不要只因为拿到结果就 answer。",
        "本地文件工具按意图选择：read 读取已知文件，list 查看已知目录的直接子项，glob 按路径模式找文件，grep 按正文查匹配位置。",
        "codebase_explore 不属于普通 discover：其 verifiedSource[...] 是经过 workspace 原文件复读验证的正文证据，已覆盖的文件和行范围不得机械再次 read。",
        "只有当 CodeGraph 明确留下 gap、unverifiable/rejected candidate、缺少所需行范围、excerpt 被截断，或当前任务必须展开一个具体函数的相邻上下文时，才对那个具体目标执行 targeted read。",
        "如果 list / glob / grep 的结构化结果已经足够支撑完整目标，可以直接 answer，不要机械追加 read。",
        "只有关键目标或关键参数确实无法从当前请求、有限历史和证据中推断时，才 ask_user。",
        "如果相同 toolId 和 args 已经有成功 evidence 且没有新 gap，通常应复用证据而不是重复调用。",
        "任何 answer 都必须基于累计 Evidence，不能编造工具执行、检索结果或文件事实。",
        "选择 answer 时，reason 必须逐项说明 completionCriteria 如何被累计 executionHistory/evidenceHistory 覆盖；存在未覆盖项就必须继续行动。",
        "选择 answer 时必须输出 completionProof；每项包含 criterion 和 evidenceRefs。evidenceRefs 只能逐字使用 observationContext.evidenceCatalog 中存在的 ref。",
        "如果某项完成条件只依赖用户原始请求而不依赖执行证据，该项 evidenceRefs 可以为空数组；不得伪造 Evidence ref。",
        "选择 answer 时 unresolvedGaps 必须是空数组；只要仍有 gap，就必须继续行动、ask_user 或 error。",
        "Evidence 只记录工具、检索和策略事实；是否回答、继续、检索或询问用户，必须由 Planner 自主决定。",
        ...buildProgressionRules({
          observationContext: input.observationContext,
          iteration: input.iteration,
          maxIterations: input.maxIterations,
        }),
      ].join("\n"),
      parts: [],
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          currentUserRequest: input.question,
          recentConversationHistory: buildRelevantConversationHistory(
            input.messages,
            input.question,
          ),
          completionContract: {
            originalGoal:
              input.observationContext.currentTaskFrame?.globalGoal ??
              input.observationContext.currentTaskFrame?.currentGoal ??
              input.question,
            completionCriteria:
              input.observationContext.currentTaskFrame?.completionCriteria ?? [
                input.question,
              ],
            rule:
              "Choose answer only after every explicit requirement is covered by accumulated execution evidence. Otherwise choose the next executable action.",
          },
          observationContext: input.observationContext,
          progression: {
            remainingRecoveryAttempts: getRemainingRecoveryAttempts(
              input.observationContext,
            ),
            latestObservationStatus:
              input.observationContext.latestObservation?.status ?? null,
            latestObservationRecoverable:
              input.observationContext.latestObservation?.recoverable ?? false,
          },
          toolExposure: {
            exposedTools: input.toolExposure.exposedTools,
            toolMeta: summarizeToolSchemas(input.toolExposure),
          },
          toolSelectionHints: input.toolExposure.requestedToolGroups ?? [],
          iteration: input.iteration,
          maxIterations: input.maxIterations,
        },
        null,
        2,
      ),
      parts: [],
    },
  ];
};
