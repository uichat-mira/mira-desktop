import { markdownTable } from "markdown-table";
import type {
  EvaluationDatasetValidationItem,
  EvaluationMetricSummary,
  EvaluationRunRecord,
  EvaluationSampleAttempt,
  EvaluationSampleResult,
} from "@/shared/api/evaluation";
import i18n, { getAppLanguage } from "@/shared/i18n";

type TableRow = Array<string | number | boolean>;

type MetricDefinition = {
  key: keyof EvaluationMetricSummary;
  label: string;
  chartLabel?: string;
  description: string;
  weight: number;
  normalizeForScore?: (value: number) => number;
  format: (value: number) => string;
};

type RunFieldDefinition = {
  label: string;
  getValue: (run: EvaluationRunRecord) => string;
};

type ConfigFieldDefinition = {
  label: string;
  description: string;
  getValue: (run: EvaluationRunRecord) => string;
};

type SampleOverviewDefinition = {
  label: string;
  getValue: (sample: EvaluationSampleResult) => string;
};

type MermaidCandidate = {
  title: string;
  description: string;
  source: string;
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const formatDateTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString(getAppLanguage(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--";

const formatSeconds = (value: number) => `${(value / 1000).toFixed(1)}s`;

const sanitizeFileName = (value: string) =>
  value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "_");

const getReportT = () => i18n.getFixedT(getAppLanguage());

const joinList = (items: string[]) => {
  const t = getReportT();
  return items.length > 0
    ? items.join("、")
    : t("settings.evaluation.shared.noValue");
};

const getRunFields = (): RunFieldDefinition[] => {
  const language = getAppLanguage();
  const modeRetrieve = language === "en-US" ? "Retrieve Only" : "仅检索";
  const modeRetrieveGenerate =
    language === "en-US" ? "Retrieve + Generate" : "检索+生成";

  return [
    {
      label: language === "en-US" ? "Run Name" : "任务名",
      getValue: (run) => run.name,
    },
    {
      label: language === "en-US" ? "Status" : "状态",
      getValue: (run) => run.status,
    },
    {
      label: language === "en-US" ? "Dataset" : "数据集",
      getValue: (run) => run.dataset.datasetName,
    },
    {
      label: language === "en-US" ? "Sample Count" : "样本数",
      getValue: (run) => `${run.dataset.summary.sampleCount}`,
    },
    {
      label: language === "en-US" ? "Document Count" : "文档数",
      getValue: (run) => `${run.dataset.summary.documentCount}`,
    },
    {
      label: language === "en-US" ? "Mode" : "模式",
      getValue: (run) =>
        run.dataset.config.mode === "retrieve"
          ? modeRetrieve
          : modeRetrieveGenerate,
    },
    {
      label: language === "en-US" ? "Started At" : "开始时间",
      getValue: (run) => formatDateTime(run.startedAt),
    },
    {
      label: language === "en-US" ? "Completed At" : "完成时间",
      getValue: (run) => formatDateTime(run.completedAt),
    },
  ];
};

const getConfigFields = (): ConfigFieldDefinition[] => {
  const language = getAppLanguage();

  return [
    {
      label: "topK",
      description:
        language === "en-US"
          ? "How many candidate chunks are recalled first. Larger values improve coverage but may introduce more noise."
          : "召回阶段先取多少个候选片段，值越大，覆盖面通常越广，但噪声也可能越多。",
      getValue: (run) => `${run.dataset.config.topK}`,
    },
    {
      label: "topN",
      description:
        language === "en-US"
          ? "How many results are finally kept for downstream evaluation or generation."
          : "最终真正送进后续评测或生成阶段的结果条数，可以理解为最终保留数。",
      getValue: (run) => `${run.dataset.config.topN}`,
    },
    {
      label: "repeat",
      description:
        language === "en-US"
          ? "How many times each sample is repeated to observe result stability."
          : "同一个样本会重复跑多少次，用来观察结果是否稳定。",
      getValue: (run) => `${run.dataset.config.repeat}`,
    },
    {
      label: "concurrency",
      description:
        language === "en-US"
          ? "How many sample workers run in parallel."
          : "并发 worker 数，表示同时跑多少条样本。",
      getValue: (run) => `${run.dataset.config.concurrency}`,
    },
    {
      label: "timeoutSeconds",
      description:
        language === "en-US"
          ? "Maximum time allowed for a single sample before it is treated as a timeout failure."
          : "单条样本最长允许执行多久，超过就算超时失败。",
      getValue: (run) => `${run.dataset.config.timeoutSeconds}`,
    },
  ];
};

const getMetricDefinitions = (language: string): MetricDefinition[] => [
  {
    key: "hitAtK",
    label: "Hit@K",
    chartLabel: "Hit@K",
    description:
      language === "en-US"
        ? "Whether the correct material was found in the top K results.<br>A sample is counted as a hit if at least 1 gold source appears in its top K recalled results; the final statistic is the proportion of hit samples."
        : "前 K 个结果里有没有找对过资料<br>若某条样本前 K 个召回结果中至少命中 1 个 gold source，则该样本记为命中，最后统计命中样本占比。",
    weight: 0.16,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "recallAtK",
    label: "Recall@K",
    chartLabel: "Recall@K",
    description:
      language === "en-US"
        ? "How many of the correct materials that should have been retrieved were actually retrieved.<br>For each sample, calculate 'number of hit gold sources / total number of gold sources for that sample', then average across all samples."
        : "该找回来的正确资料找回来了多少<br>每条样本用“命中的 gold sources 数 / 该样本 gold sources 总数”计算，再对所有样本取平均。",
    weight: 0.16,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "mrr",
    label: "MRR",
    chartLabel: "MRR",
    description:
      language === "en-US"
        ? "How high the first correct result is ranked.<br>For each sample, take the reciprocal of the rank of the first correct source (e.g., rank 1 = 1, rank 2 = 0.5), then average across all samples."
        : "第一个正确结果排得靠不靠前<br>每条样本取第一个正确来源排名的倒数（例如排第 1 名记 1，排第 2 名记 0.5），再对所有样本取平均。",
    weight: 0.12,
    normalizeForScore: (value) => value * 100,
    format: (value) => value.toFixed(3),
  },
  {
    key: "faithfulness",
    label: "Faithfulness",
    chartLabel: "Faithful",
    description:
      language === "en-US"
        ? "Whether the AI answered honestly based on the retrieved content.<br>Compare term overlap between the answer text and the recalled content; higher overlap means less likelihood of making things up."
        : "AI 有没有按检索到的内容老实回答<br>比较答案文本与召回内容的词项重合程度，重合越高，说明越不容易脱离资料胡编。",
    weight: 0.16,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "answerRelevance",
    label: "Answer Relevance",
    chartLabel: "Relevant",
    description:
      language === "en-US"
        ? "Whether the answer is actually addressing the question.<br>Compare keyword overlap between the question and the answer, using reference answer keywords as auxiliary judgment."
        : "回答是不是在回答这个问题本身<br>比较问题关键词与回答关键词的重合情况，并结合参考答案关键词做辅助判断。",
    weight: 0.12,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "answerCompleteness",
    label: "Answer Completeness",
    chartLabel: "Complete",
    description:
      language === "en-US"
        ? "Whether all key points that should have been mentioned were covered.<br>Compare keyword coverage between the answer and the reference answer; more complete coverage yields a higher score."
        : "该说到的关键点有没有说全<br>将回答与参考答案的关键词做覆盖比对，覆盖越完整，分数越高。",
    weight: 0.14,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "sourceHitRate",
    label: "Source Hit Rate",
    chartLabel: "SourceHit",
    description:
      language === "en-US"
        ? "How reliable are the sources cited in the final answer.<br>Calculate the proportion of sources returned or cited that overlap with gold sources."
        : "最终给出的来源靠不靠谱<br>统计样本最终返回或引用的来源中，与 gold sources 重合的比例。",
    weight: 0.08,
    normalizeForScore: (value) => value * 100,
    format: formatPercent,
  },
  {
    key: "averageLatencyMs",
    label: "Average Latency",
    chartLabel: "Latency",
    description:
      language === "en-US"
        ? "How long each sample takes on average.<br>Calculate the average end-to-end latency across all samples. This metric is not a percentage; lower is better."
        : "平均每条样本要等多久<br>对所有样本的端到端耗时取平均。这个指标本身不是百分比，越低越好。",
    weight: 0.04,
    normalizeForScore: (value) => {
      if (value <= 1000) return 100;
      if (value >= 15000) return 0;
      return Math.max(0, Math.round(100 - ((value - 1000) / 14000) * 100));
    },
    format: formatSeconds,
  },
  {
    key: "failedCount",
    label: "Failed Count",
    chartLabel: "Failed",
    description:
      language === "en-US"
        ? "How many samples failed to run successfully.<br>Directly count the number of failed or timed-out samples. This metric is a count; fewer is better."
        : "有多少条样本根本没跑成功<br>直接统计失败或超时的样本数。这个指标本身是计数，越少越好。",
    weight: 0.02,
    normalizeForScore: (value) => Math.max(0, 100 - value * 20),
    format: (value) => `${value}`,
  },
];

const getSampleOverviewFields = (): SampleOverviewDefinition[] => {
  const t = getReportT();

  return [
    {
      label: t("settings.evaluation.report.sample"),
      getValue: (sample) => sample.id,
    },
    {
      label: t("settings.evaluation.report.question"),
      getValue: (sample) => sample.question,
    },
    {
      label: t("settings.evaluation.report.status"),
      getValue: (sample) =>
        sample.status === "success"
          ? t("settings.evaluation.detailDrawer.success")
          : t("settings.evaluation.detailDrawer.failure"),
    },
    { label: "Recall", getValue: (sample) => formatPercent(sample.recall) },
    {
      label: "Faithfulness",
      getValue: (sample) => formatPercent(sample.faithfulness),
    },
    {
      label: "Relevance",
      getValue: (sample) => formatPercent(sample.answerRelevance),
    },
    {
      label: "Completeness",
      getValue: (sample) => formatPercent(sample.answerCompleteness),
    },
    { label: "Latency", getValue: (sample) => formatSeconds(sample.latencyMs) },
    {
      label: "Matched Sources",
      getValue: (sample) => joinList(sample.matchedGoldSources),
    },
  ];
};

const getReportSections = () =>
  getAppLanguage() === "en-US"
    ? ([
        "Run Summary",
        "Run Configuration",
        "Dataset Validation",
        "Metric Interpretation",
        "Sample Overview",
        "Sample Details",
        "Risks and Suggestions",
        "Run Logs",
      ] as const)
    : ([
        "运行摘要",
        "运行配置",
        "数据集校验",
        "核心指标解读",
        "样本概览",
        "样本详情",
        "风险与建议",
        "运行日志",
      ] as const);

const createTable = (header: string[], rows: TableRow[]) =>
  markdownTable([
    header,
    ...rows.map((row) => row.map((cell) => String(cell))),
  ]);

const buildValidationTable = (items: EvaluationDatasetValidationItem[]) =>
  createTable(
    getAppLanguage() === "en-US"
      ? ["Check", "Status", "Description"]
      : ["检查项", "状态", "说明"],
    items.map((item) => [item.label, item.status, item.detail]),
  );

const buildMetricTable = (metrics: EvaluationMetricSummary) => {
  const language = getAppLanguage();
  return createTable(
    language === "en-US"
      ? ["Metric", "Current Value", "Description"]
      : ["指标", "当前值", "说明"],
    getMetricDefinitions(language).map((metric) => [
      metric.label,
      metric.format(metrics[metric.key] as number),
      metric.description,
    ]),
  );
};

const buildConfigTable = (run: EvaluationRunRecord) =>
  createTable(
    getAppLanguage() === "en-US"
      ? ["Field", "Current Value", "Description"]
      : ["字段", "当前值", "说明"],
    getConfigFields().map((field) => [
      field.label,
      field.getValue(run),
      field.description,
    ]),
  );

const buildOverviewTable = (run: EvaluationRunRecord) => {
  const language = getAppLanguage();
  const runFields = getRunFields();
  return createTable(
    [
      language === "en-US" ? "Field" : "字段",
      language === "en-US" ? "Value" : "值",
    ],
    [
      ...runFields.map((field) => [field.label, field.getValue(run)]),
      [
        language === "en-US" ? "Exported At" : "导出时间",
        formatDateTime(new Date().toISOString()),
      ],
    ],
  );
};

const buildSampleOverviewTable = (run: EvaluationRunRecord) =>
  createTable(
    getSampleOverviewFields().map((field) => field.label),
    run.sampleResults.map((sample) =>
      getSampleOverviewFields().map((field) => field.getValue(sample)),
    ),
  );

const buildTableOfContents = () =>
  getReportSections()
    .map((title, index) => `${index + 1}. [${title}](#${title})`)
    .join("\n");

const buildAttemptBullets = (attempts: EvaluationSampleAttempt[]) =>
  attempts
    .map((attempt) => {
      const t = getReportT();
      const base = [
        `- ${t("settings.evaluation.report.attempt", { index: attempt.attempt })}`,
        attempt.status === "success"
          ? t("settings.evaluation.detailDrawer.success")
          : t("settings.evaluation.detailDrawer.failure"),
        `${t("settings.evaluation.report.latency")} ${formatSeconds(attempt.latencyMs)}`,
        `Recall ${formatPercent(attempt.recall)}`,
        `Faithfulness ${formatPercent(attempt.faithfulness)}`,
        `Relevance ${formatPercent(attempt.answerRelevance)}`,
        `Completeness ${formatPercent(attempt.answerCompleteness)}`,
      ].join(" · ");

      const answerLine = attempt.answerText?.trim()
        ? `  - ${t("settings.evaluation.report.answer")}：${attempt.answerText.trim()}`
        : null;
      const errorLine = attempt.errorMessage
        ? `  - ${t("settings.evaluation.report.error")}：${attempt.errorMessage}`
        : null;

      return [base, answerLine, errorLine].filter(Boolean).join("\n");
    })
    .join("\n");

const buildRetrievedSourceBullets = (sample: EvaluationSampleResult) =>
  sample.retrievedSources
    .map((source) => {
      const t = getReportT();
      const meta = [
        source.documentName,
        source.chunkId === undefined ? null : `chunk ${source.chunkId}`,
        source.score === undefined ? null : `score ${source.score.toFixed(3)}`,
      ]
        .filter(Boolean)
        .join(" · ");

      const preview = source.contentPreview
        ? `\n  - ${t("settings.evaluation.report.preview")}：${source.contentPreview}`
        : "";
      return `- ${meta}${preview}`;
    })
    .join("\n");

const buildSampleKeyPoints = (sample: EvaluationSampleResult) => {
  const t = getReportT();
  const yes = t("settings.evaluation.shared.yes");
  const no = t("settings.evaluation.shared.no");
  return [
    `- ${t("settings.evaluation.report.status")}：${
      sample.status === "success"
        ? t("settings.evaluation.detailDrawer.success")
        : t("settings.evaluation.detailDrawer.failure")
    }`,
    `- ${t("settings.evaluation.report.latency")}：${formatSeconds(sample.latencyMs)}`,
    `- Hit：${sample.hit ? yes : no}；Source Hit：${sample.sourceHit ? yes : no}`,
    `- Recall：${formatPercent(sample.recall)}；Faithfulness：${formatPercent(sample.faithfulness)}；Relevance：${formatPercent(sample.answerRelevance)}；Completeness：${formatPercent(sample.answerCompleteness)}`,
    `- Gold Sources：${joinList(sample.goldSources)}`,
    `- Matched Sources：${joinList(sample.matchedGoldSources)}`,
  ].join("\n");
};

const buildSampleSections = (run: EvaluationRunRecord) =>
  run.sampleResults
    .map((sample) => {
      const language = getAppLanguage();
      const sections = [`### ${sample.id}`];

      sections.push(
        "",
        `#### ${language === "en-US" ? "Test Question" : "测试问题"}`,
        "",
        sample.question,
      );

      sections.push(
        "",
        `#### ${language === "en-US" ? "AI Answer" : "AI 回答"}`,
        "",
        sample.answerText?.trim() ||
          (language === "en-US"
            ? "The current record does not contain the AI answer. If this is a historical run, rerun the evaluation and export again."
            : "当前记录未保存 AI 回答内容。若这是历史评测记录，请重新运行一次评测后再导出。"),
      );

      sections.push(
        "",
        `#### ${language === "en-US" ? "Reference Answer" : "参考答案"}`,
        "",
        sample.referenceAnswer?.trim() ||
          (language === "en-US"
            ? "The current record does not contain the reference answer. If the dataset includes one, rerun the evaluation and export again."
            : "当前记录未保存参考答案。若数据集本身包含 reference answer，请重新运行一次评测后再导出。"),
      );

      if (sample.retrievedSources.length > 0) {
        sections.push(
          "",
          "#### Retrieved Sources",
          "",
          buildRetrievedSourceBullets(sample),
        );
      }

      if (sample.errorMessage) {
        sections.push(
          "",
          `> ${language === "en-US" ? "Error" : "错误"}：${sample.errorMessage}`,
        );
      }

      return sections.join("\n");
    })
    .join("\n\n");

const buildSummaryParagraph = (run: EvaluationRunRecord) => {
  const language = getAppLanguage();
  const successCount = run.sampleResults.filter(
    (item) => item.status === "success",
  ).length;
  const totalCount = run.sampleResults.length;
  const successRate =
    totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  return language === "en-US"
    ? [
        `This evaluation executed **${totalCount}** samples, with **${successCount}** succeeded and a success rate of **${successRate}%**.`,
        `From the retrieval perspective, **Hit@K = ${formatPercent(run.metrics.hitAtK)}** and **Recall@K = ${formatPercent(run.metrics.recallAtK)}**;`,
        `from the generation perspective, **Faithfulness = ${formatPercent(run.metrics.faithfulness)}** and **Answer Completeness = ${formatPercent(run.metrics.answerCompleteness)}**.`,
        `If this is your first time reading the report, start by checking whether the system found the right material (Hit/Recall) and whether the answer stayed faithful and complete (Faithfulness/Completeness).`,
      ].join(" ")
    : [
        `本次评测共执行 **${totalCount}** 条样本，成功 **${successCount}** 条，成功率 **${successRate}%**。`,
        `从检索角度看，**Hit@K = ${formatPercent(run.metrics.hitAtK)}**，**Recall@K = ${formatPercent(run.metrics.recallAtK)}**；`,
        `从生成角度看，**Faithfulness = ${formatPercent(run.metrics.faithfulness)}**，**Answer Completeness = ${formatPercent(run.metrics.answerCompleteness)}**。`,
        `如果你第一次看这份报告，可以优先关注：是否“找对资料”（Hit/Recall），以及答案是否“忠于资料且说全重点”（Faithfulness/Completeness）。`,
      ].join("");
};

const buildRiskAndSuggestions = (run: EvaluationRunRecord) => {
  const language = getAppLanguage();
  const items: string[] = [];

  if (run.metrics.hitAtK < 0.8) {
    items.push(
      language === "en-US"
        ? "Retrieval hit rate is low: check chunking strategy, topK/topN retrieval parameters, and whether the knowledge base actually covers the phrasing of the questions."
        : "检索命中率偏低：优先检查分段策略、召回参数 topK/topN，以及知识库内容是否覆盖问题表达。",
    );
  }
  if (run.metrics.faithfulness < 0.6) {
    items.push(
      language === "en-US"
        ? "Answer faithfulness is low: first inspect whether the retrieved content contains too much noise, then verify that the generation prompt strongly constrains answers to retrieved content only."
        : "答案忠实度偏低：建议先看召回内容是否噪声过多，再检查生成提示词是否强约束“只能依据已召回内容回答”。",
    );
  }
  if (run.metrics.answerCompleteness < 0.6) {
    items.push(
      language === "en-US"
        ? "Answer completeness is low: consider providing more complete reference material or explicitly requiring key points to be covered during generation."
        : "答案完整度偏低：可以增加更完整的参考材料，或在生成阶段明确要求覆盖关键要点。",
    );
  }
  if (run.metrics.failedCount > 0) {
    items.push(
      language === "en-US"
        ? `${run.metrics.failedCount} samples failed: investigate timeouts, model stability, and error logs first.`
        : `存在失败样本 ${run.metrics.failedCount} 条：建议优先排查超时、模型稳定性和异常日志。`,
    );
  }
  if (items.length === 0) {
    items.push(
      language === "en-US"
        ? "There are no obvious high-risk signals right now. Next, expand sample coverage and watch for stability differences across question types."
        : "当前没有明显的高风险信号。下一步建议扩大样本覆盖面，并关注不同问题类型下的稳定性差异。",
    );
  }

  return items.map((item) => `- ${item}`).join("\n");
};

const computeWeightedOverview = (metrics: EvaluationMetricSummary) => {
  const language = getAppLanguage();
  const weightedItems = getMetricDefinitions(language).map((metric) => {
    const rawValue = metrics[metric.key] as number;
    const score = metric.normalizeForScore
      ? metric.normalizeForScore(rawValue)
      : rawValue * 100;

    return {
      ...metric,
      rawValue,
      score: Math.max(0, Math.min(100, Math.round(score))),
    };
  });

  const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);
  const weightedAverage =
    totalWeight > 0
      ? Math.round(
          weightedItems.reduce(
            (sum, item) => sum + item.score * item.weight,
            0,
          ) / totalWeight,
        )
      : 0;

  return {
    weightedItems,
    weightedAverage,
  };
};

const buildMermaidCandidates = (
  run: EvaluationRunRecord,
): MermaidCandidate[] => {
  const overview = computeWeightedOverview(run.metrics);

  return [
    {
      title: "全指标加权平均概览",
      description: "",
      source: [
        "%%{init: {",
        "  'theme': 'base',",
        "  'radar': {",
        "    'width': 1300,",
        "    'height': 980,",
        "    'axisLabelFontSize': 18,",
        "    'curveOpacity': 0.28,",
        "    'curveStrokeWidth': 3,",
        "    'legendFontSize': 15,",
        "    'graticuleOpacity': 0.2,",
        "    'axisStrokeWidth': 2",
        "  },",
        "  'themeVariables': {",
        "    'cScale0': '#2563EB',",
        "    'cScale1': '#F59E0B'",
        "  }",
        "} }%%",
        "radar-beta",
        `  axis ${overview.weightedItems
          .map((item) => `${item.key}["${item.label}"]`)
          .concat('weighted["Weighted Avg"]')
          .join(", ")}`,
        `  curve current["当前得分"]{${overview.weightedItems
          .map((item) => item.score)
          .concat(overview.weightedAverage)
          .join(",")}}`,
        `  curve baseline["满分基线"]{${overview.weightedItems
          .map(() => 100)
          .concat(100)
          .join(",")}}`,
        "  showLegend true",
        "  max 100",
        "  ticks 5",
        "  graticule polygon",
      ].join("\n"),
    },
  ];
};

const validateMermaid = async (source: string) => {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
  });

  return mermaid.parse(source, { suppressErrors: true });
};

const buildValidatedMermaidSection = async (run: EvaluationRunRecord) => {
  const candidates = buildMermaidCandidates(run);
  const validBlocks: string[] = [];

  for (const candidate of candidates) {
    const isValid = await validateMermaid(candidate.source);
    if (!isValid) {
      continue;
    }

    validBlocks.push(
      `### ${candidate.title}`,
      "",
      "```mermaid",
      candidate.source,
      "```",
    );
  }

  if (validBlocks.length === 0) {
    return getAppLanguage() === "en-US"
      ? [
          "No weighted-average chart passed Mermaid syntax validation, so chart export was skipped automatically.",
          "",
          "> You can still review the complete results in the sample overview table below.",
        ].join("\n")
      : [
          "当前没有生成可通过 Mermaid 语法校验的加权平均图，已自动跳过图表导出。",
          "",
          "> 你仍然可以通过下方的样本概览表查看完整结果。",
        ].join("\n");
  }

  return validBlocks.join("\n\n");
};

const buildLogBlock = (run: EvaluationRunRecord) =>
  run.logs.length
    ? run.logs
        .map((log) => `[${log.timestamp}] [${log.level}] ${log.text}`)
        .join("\n")
    : getAppLanguage() === "en-US"
      ? "No logs available"
      : "暂无日志";

export const buildEvaluationRunMarkdown = async (run: EvaluationRunRecord) => {
  const language = getAppLanguage();
  const mermaidSection = await buildValidatedMermaidSection(run);

  return language === "en-US"
    ? [
        `# Evaluation Report - ${run.name}`,
        "",
        "> This report is intended to be readable by business, algorithm, and product teammates alike. Start with the run summary, then review metric interpretation and sample details.",
        "",
        "## Basic Information",
        "",
        buildOverviewTable(run),
        "",
        "## Table of Contents",
        "",
        buildTableOfContents(),
        "",
        "---",
        "",
        "## Run Summary",
        "",
        buildSummaryParagraph(run),
        "",
        "---",
        "",
        "## Run Configuration",
        "",
        buildConfigTable(run),
        "",
        "---",
        "",
        "## Dataset Validation",
        "",
        buildValidationTable(run.dataset.validations),
        "",
        "---",
        "",
        "## Metric Interpretation",
        "",
        "This table gives the current values and explains what each metric is actually measuring, making it suitable for first-time readers.",
        "",
        buildMetricTable(run.metrics),
        "",
        "---",
        "",
        "## Sample Overview",
        "",
        mermaidSection,
        "",
        buildSampleOverviewTable(run),
        "",
        "---",
        "",
        "## Sample Details",
        "",
        buildSampleSections(run) || "No sample results available",
        "",
        "---",
        "",
        "## Risks and Suggestions",
        "",
        buildRiskAndSuggestions(run),
        "",
        "---",
        "",
        "## Run Logs",
        "",
        "```text",
        buildLogBlock(run),
        "```",
        "",
      ].join("\n")
    : [
        `# 评测报告 - ${run.name}`,
        "",
        "> 这是一份面向业务同学、算法同学和产品同学都能阅读的评测报告。你可以先看运行摘要，再看核心指标解读和样本详情。",
        "",
        "## 基本信息",
        "",
        buildOverviewTable(run),
        "",
        "## 目录",
        "",
        buildTableOfContents(),
        "",
        "---",
        "",
        "## 运行摘要",
        "",
        buildSummaryParagraph(run),
        "",
        "---",
        "",
        "## 运行配置",
        "",
        buildConfigTable(run),
        "",
        "---",
        "",
        "## 数据集校验",
        "",
        buildValidationTable(run.dataset.validations),
        "",
        "---",
        "",
        "## 核心指标解读",
        "",
        "下面这张表除了给出当前值，也会解释“这个字段到底在看什么”，适合第一次接触评测报告的人直接阅读。",
        "",
        buildMetricTable(run.metrics),
        "",
        "---",
        "",
        "## 样本概览",
        "",
        mermaidSection,
        "",
        buildSampleOverviewTable(run),
        "",
        "---",
        "",
        "## 样本详情",
        "",
        buildSampleSections(run) || "暂无样本结果",
        "",
        "---",
        "",
        "## 风险与建议",
        "",
        buildRiskAndSuggestions(run),
        "",
        "---",
        "",
        "## 运行日志",
        "",
        "```text",
        buildLogBlock(run),
        "```",
        "",
      ].join("\n");
};

export const downloadEvaluationRunMarkdown = async (
  run: EvaluationRunRecord,
) => {
  const content = await buildEvaluationRunMarkdown(run);
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const fileName = `${sanitizeFileName(run.name)}.md`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};
