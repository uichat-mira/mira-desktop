# Context Read Bench

这个 bench 只验证 canonical Context / Read 路径，不跑 terminal command。

它集中覆盖：

- `list`
- `glob` / `grep` 的候选发现与正文定位语义
- `read`
- `read(offset, limit)` 大文件窗口与 continuation
- list / grep → read 组合
- inspect 预算内 context 构建
- 中文路径、BOM、GBK、二进制和大文件边界

## 运行

```bash
pnpm --filter @ui-chat-mira/server exec tsx src/harness/context/bench/runner.ts
```

## 输出

bench 输出固定包含：

- `caseId`
- `operation`
- `input`
- `status`
- `filesRead`
- `charsRead`
- `encoding`
- `truncated`
- `diagnostics`
