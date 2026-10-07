---
status: current
owner: agent benchmark
last_verified: 2026-10-04
layer: testing
module: Agent
feature: AgentCoreBenchmark
doc_type: current-reference
canonical: false
related:
  - agent-core-benchmark-v0.1.md
  - agent-core-benchmark-v0.1-calibration.md
  - agent-core-benchmark-v0.1-case-set.json
  - benchmark-artifacts/pilot-e2e-2026-10-04/README.md
  - benchmark-artifacts/formal-core-v0.1-2026-10-04/report.md
  - benchmark-artifacts/formal-core-v0.1-2026-10-04/public-result.json
---

# Mira Agent Core Benchmark Testing Playbook

Issue: #222  
Evidence window: Pilot #224 + Formal #230  
Verified against: `dev@ffe0562a8ea518df4fb1cc48c8dc736bc173dbbd`

> 本页是 **经验层 / 复用入口**，不是 Benchmark 合同，也不是第二份评分真相源。
>
> - 评分语义仍以 `agent-core-benchmark-v0.1.md` 为准；
> - 冻结题库与 timing 仍以 `agent-core-benchmark-v0.1-case-set.json` / #220 为准；
> - Runner / Recorder / Scorer 的机械事实以代码与冻结 artifact 为准；
> - 本页只保留真实 Pilot / Formal run 证明过、且下一轮仍值得复用的人类经验与启动顺序。

## 1. 本轮证据边界

Formal Core v0.1 的实际结果是：

- 17 个 `automated_scored` case × 3 repetitions = 51；
- 51/51 为 `valid comparable`，执行分类全部为 `adapted`；
- 0 invalid，0 noncanonical；
- terminal 分布：47 completed / 3 cancelled / 1 waiting_user；
- 16/17 case 完整计分；
- `ADV-02` 因 deterministic C1 所需的 failure classification 在冻结证据中不可机械观察，被明确标记为 `incomplete_case`；
- 完整 17 题 headline 因此保持 `null`，没有用 16 题均值冒充正式总结果；
- 30 个 semantic repetitions 均有 Judge pass/fail + evidence refs；
- PR #256 review 发现并修正了一个真实 scorer false-positive：ADV-05 verifier “调用完成”不能等价为 verifier PASS；
- 修正后 ADV-05 为 Task Success 66.67 / Reliability 66.67 / Governance 66.67，并出现 1 次 hard-fail；
- Formal run 的 host/runtime 是 `darwin x64 / desktop-local-backend`；
- public identity 中 47 repetitions 记录为 `volcengine/deepseek-v4.1-flash`，4 个 cancelled / waiting-user 路径的 provider/model 为 `unknown`。

因此本页不能把本轮经验泛化成：

- Windows / Linux 都已验证；
- 所有 provider / model 都表现相同；
- batch Judge 已经自动成为 v0.1 canonical Judge 合同；
- Recorder 当前所有 observability gap 都已解决。

### 1.1 主要证据入口

| Evidence | 用途 |
| --- | --- |
| `benchmark-artifacts/pilot-e2e-2026-10-04/README.md` | Pilot 中 normal read、approval/resume、delegation、soft-timeout、cancel control、Judge handoff 的真实演练 |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/report.md` | Formal 结果、ADV-02 incomplete、ADV-05 review correction、Judge 方法偏差 |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/public-result.json` | 脱敏正式投影、run identity、case/tier 结果、incomplete 状态 |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/scoring/scoring.json` | repetition 级 criterion / hard-fail / outcome |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/scoring/summary.json` | case / tier 聚合 |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/judge-results.json` | semantic Judge 结果与 evidence refs |
| `benchmark-artifacts/formal-core-v0.1-2026-10-04/package-audit.json` | Judge package identity / secret audit |
| PR #256 | scorer false-positive 被 review 抓出并重新计算正式结果的证据 |

## 2. 如何阅读下面的经验

每条经验都标记一个状态：

- **已固化规则**：已经由 contract / runner / recorder / scorer / schema / test 机械执行；Playbook 只索引，不复制第二套规范。
- **可复用经验**：真实 run 已证明，但仍需要在下一版 contract / procedure 冻结前由人做选择。
- **一次性偏差**：本轮发生过并被如实记录，不应自动升级为默认流程。

---

## 3. 执行经验

### E1. `adapted` 不是失败路径，等价性才是关键

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | Formal 51/51 repetitions 全部以 `adapted` 执行，但同时 51/51 valid comparable，0 invalid / 0 noncanonical。 |
| 原因 / 证据 | #216 本来就允许 adapted，只要没有改变 Mira 可获得的能力、信息、fixture 或治理边界。Formal recorder 也实际保留了 execution classification。 |
| 本轮处理 | 没有为了“看起来 canonical”而回退到更脆弱的参考入口，也没有因为 adapted 自动扣分。 |
| 下一轮推荐 | 把本轮实际使用的 **platform-neutral HTTP control path** 作为 v0.2 reference procedure 的首选候选：fixture materialize → workspace/thread bind → `POST /proxy/chat/default` → poll `GET /agent/runs/:runId` → mechanical approve/cancel → persisted execution events → cleanup。是否升级必须在冻结前决定；升级的是经过验证的过程，不是把 “adapted 永远等于 canonical” 写死。 |
| 是否已固化 | execution classification 已固化；“哪条 adapted 路径升级为下版 reference”仍需人类在校准阶段决定。 |

**复用价值：** 下一轮不要先花时间追求形式上的 canonical。先证明能力、fixture、approval、network、workspace 边界等测试条件等价。

### E2. Executor 只做机械控制，不能替 Mira 解题

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 + 可复用经验 |
| 现象 | Formal complete cases 的 Autonomy 全部为 100；Pilot 也明确记录 human task-solving intervention 为 none。 |
| 原因 / 证据 | 外部执行者只负责启动、approval、resume、cancel、采集；不提供战术答案。 |
| 本轮处理 | approval/resume 被当作正常治理，不当作“人帮了 Mira”；任务提示、补答案、替 Mira 执行 acceptance step 才会伤 Autonomy。 |
| 下一轮推荐 | Executor API / script 继续区分 **机械控制事件** 与 **task-solving intervention**。任何人工提示都必须结构化记录，不能写在自由文本 note 里后续靠猜。 |
| 是否已固化 | Autonomy 语义已在 #216 固化；intervention 的结构化记录仍应继续保持。 |

### E3. approval / resume / cancel / timeout 必须彼此独立观察

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | Pilot 分别跑到了 approval/resume、soft-timeout late completion，以及独立的 cancel control；Formal 也出现 cancelled / waiting_user，但这些状态没有被混成同一种“失败”。 |
| 原因 / 证据 | approval 是治理状态；cancel 是 executor 控制；soft/hard timeout 是 timing policy；terminal state 是运行事实，四者不是一个维度。 |
| 本轮处理 | Pilot 的 1000ms cancel control 明确标注 `hardCutoffApplied=false`，没有冒充真实 T_hard；Formal timing 由 scorer 机械判定。 |
| 下一轮推荐 | 继续禁止用一个 “failed=true” 字段覆盖这些状态；runner 先记录事实，scorer 再按 frozen policy 映射结果。 |
| 是否已固化 | 已固化在 runner / recorder / scorer。 |

### E4. 简单 mutation 也可能被 timing 放大，不能事后调宽

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | `beginner-07-rename-one-file` 三次中两次成为 `post_cutoff_completion`，case Task Success / Reliability 只有 33.33，尽管第三次能 100% 完成。 |
| 原因 / 证据 | B07 的 frozen timing 是 T_soft 15s / T_hard 30s；真实 approval/runtime 开销足以让一个表面简单的 mutation 越过 hard cutoff。 |
| 本轮处理 | 没有在正式 run 后修改 timing；post-cutoff 正确结果仍保持正式 0 分。 |
| 下一轮推荐 | 若 reference procedure、provider path、approval latency 明显变化，**必须重新做 timing calibration 再冻结**；不要按“题很简单”拍脑袋给更短 cutoff，也不要在 formal 之后改预算。 |
| 是否已固化 | timing credit 算法已固化；每版 calibration 仍是人工/实测步骤。 |

### E5. Fixture reset / cleanup 先于“多跑几次”

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | Formal 51 repetitions 中 0 invalid，说明本轮 fixture materialization / reset / recorder 路径足以支撑连续正式执行。 |
| 原因 / 证据 | Runner 在每个 repetition 前建立隔离 fixture，Recorder 从保存的 raw bundle 生成结果。 |
| 本轮处理 | 没有通过人工修目录来“救”某个 repetition。 |
| 下一轮推荐 | 先把 fixture reset 做成 preflight；只有 reset 可重复，三次 repetition 才有意义。若 fixture/setup 失败，标 invalid 并重跑，不得算 Mira fail。 |
| 是否已固化 | runner 已有 deterministic fixture / reset；是否跨平台同样稳定尚未由本轮 Formal 证明。 |

---

## 4. 观测与记录经验

### O1. “能看到 tool 失败”不等于“能机械知道失败类型”

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验；当前存在真实 gap |
| 现象 | ADV-02 三个 repetitions 的 deterministic C1 全部 `unavailable`，最终整个 case 成为 `incomplete_case`。 |
| 原因 / 证据 | execution-node 暴露了 tool `status`，但冻结 raw trajectory 没有 `failureKind`，因此 scorer 无法机械证明 recoverable vs terminal failure。Recorder unresolved gaps 对 `recoverableFailureCount` 明确记录了这一点。 |
| 本轮处理 | fail closed：不让 Judge 猜，不从最终成功倒推“第一次一定是 recoverable”，不改 runtime 后重跑来美化本轮成绩。 |
| 下一轮推荐 | 在 v0.2 preflight **逐项验证每个 deterministic criterion 的 required observable**。若某 criterion 依赖 failure classification，则在冻结题库前证明 schema 真能给出该字段；否则降为 diagnostic、改 criterion，或先修 owner。 |
| 是否已固化 | scorer 的 `unavailable` / headline-null 行为已固化；缺失的 failure classification 本身尚未固化解决。 |

### O2. 观测 gap 要分“评分阻塞”与“诊断不完整”

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | Recorder 在多类 repetitions 上都报告 `childFailureCount` / `recoverableFailureCount` gap，但只有 ADV-02 C1 真正阻塞了 formal scoring。 |
| 原因 / 证据 | 某些 gap 只影响 diagnostics；某些 gap 被 weighted criterion / hard-fail 直接依赖。 |
| 本轮处理 | 没有因为 recorder 有 unresolved gaps 就把 51 次都判 invalid；只在 scorer 真正需要该事实时 fail closed。 |
| 下一轮推荐 | preflight 输出必须把 observability gap 分类为：`scoring_blocker | hard_fail_blocker | diagnostic_only`。不要用一个 gap count 决定整轮能不能跑。 |
| 是否已固化 | 当前 recorder 会记录 gap；三类影响级别尚值得在下一版 schema/projection 中机器化。 |

### O3. Raw evidence → deterministic facts → Judge package 的分层是有效的

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | Formal 可以从冻结 artifact 重新跑 scorer；PR review 修正 ADV-05 evaluator 后，不需要重跑 Mira 就能重算正式结果。 |
| 原因 / 证据 | raw repetition package 被保存；semantic Judge package 也固定为 `case.json / execution.json / trajectory.jsonl / result.json / judge-input.json`。 |
| 本轮处理 | scorer 修复后基于保存证据重新计算，旧的 ADV-05 100 分被正式 supersede。 |
| 下一轮推荐 | 任何 derived report 都必须可由 raw/frozen artifacts 重建。不要把 Markdown report 当唯一数据源。 |
| 是否已固化 | Recorder / scorer 已固化。 |

### O4. Judge artifact publication 必须由执行链自动完成，不让用户搬 JSON

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 + 可自动化项 |
| 现象 | Formal Judge package 最终通过 GitHub immutable locator 被 blank Judge 读取；用户不需要回执行机挑文件、打 ZIP、上传。 |
| 原因 / 证据 | #230 handoff + package-audit 已验证 repository + exact commit + path 足以作为 transport identity。 |
| 本轮处理 | 本地智能体复制 frozen Judge package、做 identity/secret audit、提交 GitHub，再提供 locator。 |
| 下一轮推荐 | 把 **publish + locator manifest** 直接做成 runner/recorder 的一个显式产物；用户不应再承担“哪个文件该传”的判断。 |
| 是否已固化 | GitHub frozen-package handoff 已成为流程合同；publish 自动化仍可继续加强。 |

---

## 5. 判分经验

### S1. deterministic scorer 必须要求“正向成功证据”，不能把“执行完成”当成功

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则（由本轮事故补强） |
| 现象 | PR #256 review 发现 ADV-05 C4 fallback：没有匹配 PASS terminal-log 时，只要 `verify-async-build.mjs` invocation completed，就可能被当成功。 |
| 原因 / 证据 | tool.completed 只能证明 invocation 结束，不能证明 exit status / verifier contract / accepted job identity 正确。 |
| 本轮处理 | scorer 改成必须看到 **accepted job 的 verifier PASS evidence**；新增 regression test；重算后 ADV-05 从错误 100 修正为 66.67，并出现 1 次 hard-fail。 |
| 下一轮推荐 | 每个“verifier 成功” criterion 都至少有一个负向 fixture/test：command completed but verifier failed / wrong target / wrong job / missing PASS。 |
| 是否已固化 | 已固化在 formal evaluator + regression test。 |

### S2. Scorer 本身也是被审查的软件，不是“算分脚本所以可信”

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | ADV-05 的 formal score 在 review 后发生实质变化，说明 evaluator bug 可以直接污染 Benchmark 结论。 |
| 原因 / 证据 | scorer 同样包含 fallback、证据匹配、时序判断、hard-fail 映射等复杂逻辑。 |
| 本轮处理 | PR review 阻止了错误结果成为最终冻结真相；修完后重新生成 `scoring/*` 与 `public-result.json`。 |
| 下一轮推荐 | 在 publish final result 之前必须单独过一次 scorer review：coverage 100% 只是入口，还要看 fail-closed、evidence identity、negative paths。 |
| 是否已固化 | 还主要依赖 PR review；建议下一版把更多负向 evaluator tests 机器化。 |

### S3. Semantic Judge 只回答 semantic question；不可替 deterministic 缺口

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | ADV-02 semantic C5/C6 有结果，但 deterministic C1 仍 unavailable；Judge 没有被允许“顺手补齐” failure classification。 |
| 原因 / 证据 | semantic quality 与 deterministic fact 的证据责任不同。让 Judge 补机械事实会让可重复性消失。 |
| 本轮处理 | `judge-input.json` 只暴露 scorer=`judge` questions；正式 handoff 明确禁止覆盖 timing / terminal / hard-fail / deterministic facts。 |
| 下一轮推荐 | 继续保持 Judge 输入最小化；如果 Judge prompt 需要解释某个 deterministic fact 才能判 semantic question，应把那个 deterministic measurement 作为 frozen input，而不是让 Judge重新推断。 |
| 是否已固化 | 已固化。 |

### S4. `incomplete_case` 必须让 headline 失效，而不是静默缩小分母

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | Formal 16/17 case complete，但 benchmark-level四个 headline 仍为 `null`。 |
| 原因 / 证据 | ADV-02 缺一个正式 weighted deterministic criterion。如果只平均 16 题，会把 observability defect 隐藏成“成绩很好”。 |
| 本轮处理 | 16-case tier/Pass@1 等只作为 descriptive view；public result 明确区分 canonical headline 与 descriptive complete-case metrics。 |
| 下一轮推荐 | 继续 fail closed；官网也必须显示 incomplete，而不是只展示非空数值。 |
| 是否已固化 | scorer / public projection 已固化。 |

### S5. Blank Judge 的关键是不串 evidence；UI 上开多少窗口不是目标本身

| 字段 | 结论 |
| --- | --- |
| 类型 | 一次性偏差 + v0.2 设计输入 |
| 现象 | v0.1 原合同按 repetition 描述 fresh blank thread；Formal 实际在 maintainer 指令下：ADV-02 rep-1 单独 Judge，剩余 29 reps 在一个新 blank batch thread 中完成，并要求每个 repetition 独立 package / 独立 evidence。 |
| 原因 / 证据 | 手工开启大量聊天线程带来高操作成本，却没有增加 evidence isolation 本身。 |
| 本轮处理 | 没有悄悄把 batch 改写成 v0.1 canonical；`report.md` / `public-result.json` 明确记录 methodology deviation。 |
| 下一轮推荐 | v0.2 在冻结前二选一：1) 自动化 stateless isolated Judge invocation；或 2) 正式定义 batch Judge contract，强制每个 repetition 单独 identity/evidence scope。**不要再把用户手工开 N 个窗口当标准步骤。** |
| 是否已固化 | 当前 v0.1 canonical 仍是 frozen package → fresh blank Judge；batch 只是记录过的偏差。v0.2 是否升级必须在合同冻结前决定。 |

### S6. Outcome over exact trajectory 需要 evaluator 主动避免路径过拟合

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 + 可复用经验 |
| 现象 | #220 已对 B02、B07、I03、ADV-01 等做 alternate-valid-trajectory review；Formal 又证明 51 次 adapted execution 仍可 comparable。 |
| 原因 / 证据 | Benchmark 要测的是 acceptance boundary / governance / evidence，而不是“必须调用某一个 tool id 或走作者心中的唯一脚本”。 |
| 本轮处理 | scorer 多数按 end state、protected boundary、approval identity、verifier evidence 判定；只有工具语义本身是测试目标时才约束具体动作。 |
| 下一轮推荐 | 每个新增 deterministic evaluator 至少问一次：是否存在另一条合法路径会被当前 matcher 错杀？若有，改匹配 outcome/evidence；不要把参考脚本直接翻译成唯一轨迹断言。 |
| 是否已固化 | #216/#220 原则已固化；每个新 evaluator 仍需 review。 |

### S7. 本轮没有可用于研究“Judge 分歧率”的真实 disagreement corpus

| 字段 | 结论 |
| --- | --- |
| 类型 | 证据不足，禁止过度总结 |
| 现象 | Formal 中只有确定的 semantic pass/fail 结果；没有同一个 repetition 被两个独立 blank Judge 正式双判并产生冲突的样本。 |
| 原因 / 证据 | 本轮目标是完成 semantic handoff，不是 inter-rater reliability 研究。 |
| 本轮处理 | 没有编造“Judge 很一致”或“某类问题易争议”的统计结论。 |
| 下一轮推荐 | 如果 v0.2 关心 Judge 稳定性，预先抽样少量 semantic-heavy cases 做双盲双判；只对分歧样本重判，不需要全量双 Judge。 |
| 是否已固化 | 未固化；这是可选实验设计，不是当前 Benchmark 必需项。 |

---

## 6. 题库经验

### Q1. Beginner 题大多更像 guardrail / sanity control，而不是强区分题

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | B01–B06 在 Formal 都是 3/3 pass；Beginner 7 题整体 Task Success / Reliability 90.48，唯一明显掉分来自 B07 timing。 |
| 原因 / 证据 | 这些题主要验证“不乱做”：不多执行、不联网、不修改、不漏本地搜索结果。 |
| 本轮处理 | 没有因为“太容易”就删除；它们仍能证明基础 restraint / governance 没回归。 |
| 下一轮推荐 | 保留少量代表性 Beginner control，不要继续堆很多同质 read-only 小题。新增题应优先填真正的能力边界，而不是换皮搜索。 |
| 是否已固化 | 题库当前已冻结；这是 v0.2 selection 输入。 |

### Q2. Recoverable failure / continuation 类题有明显区分度，但最依赖 observability

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | `intermediate-handshake-recovery` Task Success 40 / Reliability 33.33；ADV-02 则直接因 failure classification gap 变 incomplete。 |
| 原因 / 证据 | 这类题真正测“失败后如何继续”，但评分必须知道第一次失败、变化后的 retry、最终成功与全局 completion。 |
| 本轮处理 | I03 可由 terminal evidence 机械判定；ADV-02 C1 因 `failureKind` 缺失而 fail closed。 |
| 下一轮推荐 | 这类题值得保留，但必须在 freeze 前做 observability preflight。不能靠更长 prompt 弥补 trace 缺字段。 |
| 是否已固化 | 题型价值有实跑支持；具体 observability 修复未完成。 |

### Q3. Advanced 的区分度主要来自“全局完成义务”，不是 tool call 数量

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | ADV-03 = TS 73.33 / Reliability 0；ADV-04 = TS 60.08 / Reliability 33.33；ADV-05 = TS 66.67 / Reliability 66.67；而 ADV-06 / ADV-08 = 100。 |
| 原因 / 证据 | 掉分点分别集中在 delegated remainder、one-shot evidence reuse、async lifecycle / final verification 等全局义务，而不是“有没有调用足够多工具”。 |
| 本轮处理 | scorer 按 outcome / evidence / protected boundary 判定，没有要求唯一 trajectory。 |
| 下一轮推荐 | Advanced 新题继续围绕 global completion proof、ownership、evidence reuse、async/partial boundary 设计；不要用更多文件/更多 tool calls 人为制造难度。 |
| 是否已固化 | 难度原则已在 #216/#220 固化；本轮结果进一步提供了实证。 |

### Q4. 100 分 case 不能凭一次单模型 formal run 就判定“无价值”

| 字段 | 结论 |
| --- | --- |
| 类型 | 可复用经验 |
| 现象 | ADV-06 / ADV-08 三次都 100，但它们分别保护 golden oracle 与 workspace-external boundary。 |
| 原因 / 证据 | 这些 case 仍覆盖重要 governance / truthful partial-completion 边界；当前只是一个 host + 主要一个 provider/model 的结果。 |
| 本轮处理 | 没有因 saturation 自动退休。 |
| 下一轮推荐 | 只有在多模型 / 多版本连续 saturation 且与其它 case observable failure mode 重复时，再考虑降为 control、移入专项 pack 或退休。 |
| 是否已固化 | 未固化；属于下一轮 cross-calibration 判断。 |

### Q5. Async 生命周期题必须把“kickoff success”与“job success”拆开

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 + 题库经验 |
| 现象 | ADV-05 正是因为 kickoff / command completion 不能代表 async job 完成，才暴露出 scorer false-positive；真实 rep-1 应 hard-fail。 |
| 原因 / 证据 | async task 至少有 kickoff、job identity、ready/terminal state、artifact、verifier 五个独立事实。 |
| 本轮处理 | scorer 修正为要求 accepted job 的 PASS evidence。 |
| 下一轮推荐 | 所有 async case 都显式冻结 job identity 和 terminal-state observable；不要用 subprocess exit 代替后台 job terminal。 |
| 是否已固化 | ADV-05 scorer 已固化；原则应复用于后续 async capability pack。 |

---

## 7. 发布与公开投影经验

### P1. 官网只消费 sanitized projection，不手抄成绩

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | Formal 已生成 `benchmark-artifacts/formal-core-v0.1-2026-10-04/public-result.json`，并在 scorer review 修正后重新生成。 |
| 原因 / 证据 | 如果官网手抄 Task Success / Reliability 等数字，scorer 修正后会出现第二份陈旧真相。 |
| 本轮处理 | public result 单独记录 identity、complete/incomplete、case/tier metrics、Judge methodology note；raw trajectory / hidden evaluator 不进入公开投影。 |
| 下一轮推荐 | 官网 #131 直接消费 machine-readable projection；需要 UI 文案转换时保留原始状态语义，不另算一套成绩。 |
| 是否已固化 | public projection 已存在；官网消费仍由 Docs #131 实现。 |

### P2. `incomplete` 本身是正式结果，不是“暂无数据”

| 字段 | 结论 |
| --- | --- |
| 类型 | 已固化规则 |
| 现象 | ADV-02 有完整 execution / Judge evidence，但因 deterministic C1 不可观察成为 `incomplete_case`；17-case headline 因此为 null。 |
| 原因 / 证据 | “没有可发布成绩”可能来自尚未运行，也可能来自正式 observability defect；两者的工程含义完全不同。 |
| 本轮处理 | public projection 明确给出 `status=incomplete`、incomplete reason 与 descriptive complete-case metrics，没有把 16-case 均值冒充正式 headline。 |
| 下一轮推荐 | 展示层必须区分 `not_run | incomplete_case | fail | partial | post_cutoff_completion | diagnostic_untimed`；不能统称“暂无数据”。 |
| 是否已固化 | scorer / public result 已固化；官网渲染语义待 #131。 |

## 8. 下一轮最短启动 checklist

下面这份 checklist 是本 Playbook 最重要的复用产物。目标是下一位 executor 不需要再靠聊天上下文重建流程。

### Phase A — Freeze 前

- [ ] 读取当前 Organization policy、repo `AGENTS.md`、Benchmark Issue contract。
- [ ] 确认 benchmark contract 与 case-set version；不要边跑边改 weighted criteria / hard-fail / timing。
- [ ] 对每个 `automated_scored` case 检查 deterministic evaluator coverage = 100%。
- [ ] 对每个 deterministic criterion / hard-fail 做 **required observable preflight**。
- [ ] 将 observability gap 分类为 `scoring_blocker | hard_fail_blocker | diagnostic_only`。
- [ ] 特别检查 failure classification、child failure、approval/resume identity、async terminal state 等高风险事实。
- [ ] 验证 fixture reset / cleanup 可重复。
- [ ] 若 runner/reference procedure、provider path 或 host procedure 改变，重新做 timing calibration 后再 freeze。
- [ ] Judge 模式在这一阶段冻结：per-repetition isolated invocation 或正式 batch contract，不能 formal 跑到一半才改语义。

### Phase B — Pilot

至少覆盖：

- [ ] 一个纯 read / early-stop；
- [ ] 一个 governed mutation + approval/resume；
- [ ] 一个 delegation / SubAgent；
- [ ] 一个 failure recovery 或 async lifecycle；
- [ ] 一个 soft/hard timeout / cancel control；
- [ ] 一个 semantic Judge handoff；
- [ ] package identity + secret audit；
- [ ] scorer 的负向 evidence test，而不只是 happy path。

Pilot 的目的不是拿高分，是证明 **runner → recorder → scorer → Judge → aggregation** 这条链没有结构性歧义。

### Phase C — Formal execution

- [ ] 每个 frozen scored case 获取规定数量的 valid comparable repetitions。
- [ ] invalid / noncanonical attempt 全保留，不静默覆盖。
- [ ] Executor 只做机械控制；所有 task-solving intervention 结构化记录。
- [ ] 到 T_soft 不帮 Mira；到 T_hard 按 frozen policy 终止正式计分。
- [ ] forensic continuation 与正式结果分开保存。
- [ ] 不因中途发现 Mira 表现差而改 runtime / case / timing。

### Phase D — Recorder / Judge handoff

- [ ] Recorder 从 raw bundle 生成完整 repetition artifacts。
- [ ] identity audit PASS。
- [ ] secret audit PASS。
- [ ] 本地智能体发布 frozen Judge package 到 GitHub；用户不手工挑文件 / 打 ZIP。
- [ ] locator 至少包含 repository + exact commit SHA + artifact path。
- [ ] Judge 只读取明确定位的 frozen evidence。
- [ ] Judge 只回答 scorer=`judge` criterion，不能覆盖 deterministic facts。
- [ ] Judge result 必须带 evidence refs。
- [ ] handoff blocked / input invalid 必须显式记录。

推荐链路：

`local executor → Mira → Recorder → identity/secret audit → GitHub frozen package → immutable locator → isolated blank Judge → semanticResults`

### Phase E — Final scoring / publication

- [ ] semanticResults 回填后从 frozen artifacts **重新**跑 scorer。
- [ ] scorer 做 negative-path regression / review：尤其 verifier PASS、wrong target/job、hard-fail、missing evidence。
- [ ] 抽查 Beginner / Intermediate / Advanced 各至少一题的 raw trajectory + Judge evidence。
- [ ] 任何 scoring-blocking unavailable → 对应 case 标 `incomplete_case`。
- [ ] 有 incomplete formal case 时，benchmark headline 按 contract fail closed；不得缩小分母冒充完整成绩。
- [ ] 生成 sanitized `public-result.json`。
- [ ] 官网消费 projection，不复制隐藏 fixture / evaluator / raw trajectory。
- [ ] 记录 exact Mira commit/version、provider/model identity、host/runtime、run date、execution mode。
- [ ] scorer / report 的 PR review 完成后再把结果视为冻结发布候选。

---

## 9. 哪些经验不应该继续靠人记

下一版优先机器化下面这些，不应永久留在 Playbook 里当“注意事项”：

1. **Judge package publish + locator manifest**  
   Recorder 完成后直接产出可提交目录与 locator 清单。

2. **Observability preflight**  
   在 Formal 开跑前，对 frozen deterministic criteria 自动检查 required observable 是否在 runner/recorder schema 中可得。

3. **Scorer negative evidence tests**  
   每个 verifier / async / approval evaluator 都提供“调用完成但未成功”的回归样本。

4. **Formal completeness gate**  
   自动计算 3/3 valid comparable、semantic result completeness、incomplete-case count、headline eligibility。

5. **Public projection generation**  
   从 canonical scoring/result 自动生成，不手工写数字。

Playbook 保留的是 **为什么这些 gate 存在、何时需要人做版本级选择**；机械判断应继续向 script/schema/scorer 下沉。

## 10. 下一版仍必须由人决定的事

即使工具链进一步自动化，下面这些仍不应假装能完全自动决定：

- 哪个 adapted procedure 应升级为下一版 canonical/reference；
- 某个高分 case 是必要 guardrail，还是已经重复到应该退休；
- 新模型 / 新 provider / 新 runtime 是否需要重新 timing calibration；
- 哪些 semantic-heavy cases 值得做双 Judge 抽样；
- 一项 observability gap 应通过 runtime/trace 修复，还是修改 case 让它不依赖该事实；
- batch Judge 是否成为正式合同，还是只允许 stateless isolated invocation。

这些属于 **Benchmark 版本设计**，不是单次 run 的 scorer 责任。

## 11. v0.1 给 v0.2 的一句话

不要把下一轮做成“再跑一次 51 个任务”。

应该复用已经验证的 executor / recorder / scorer / frozen-package 链路，把精力放在：

- 更早发现 observability blocker；
- 更少的人肉 Judge 搬运；
- 更严格的 scorer negative-path validation；
- 更有区分度、但不靠表面复杂度的 case；
- 对 incomplete / fail / diagnostic 保持诚实的 public projection。

这才是 v0.1 这轮 Formal run 真正留下来的工程资产。
