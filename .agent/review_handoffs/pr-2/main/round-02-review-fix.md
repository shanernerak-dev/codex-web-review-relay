# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `2`
Target PR: `#2`
Review scope: PR#2 round-02——核销 round-01 的 3 项 findings

## 评审区间

- **Review base commit**：`76292939b15f341927973249f09ce0bba8560ffa`（PR#2 的 base = main tip）。
- **Review head commit**：以 trigger envelope 的 `Reviewed head` 字段为准。
- **取证命令**：`git diff 76292939b15f341927973249f09ce0bba8560ffa..<Reviewed head>`

## finding → fix 映射

### RGEN-S1-001 — 根因叙述混淆 remote-head 不可读与 PR-comment 作用域

**处置：ACCEPTED（已修复）**

修复 commit：`2e8b256`

修复内容：重写 spec "背景与根因"段落，将此前混淆的单一根因拆为两个独立因素：
1. Remote commit availability：`reviewed_head` 或 handoff 未 push 导致 404。Open PR 不是读取已 push commit 的必要条件。
2. PR-comment target validity：`target_pr` 指向 closed PR 导致 comment 无有效发布/readback 目标。Open PR 是 PR-comment 的必要条件。

新增说明：此前 spec 将两者混淆为"target 与 head 不在同一 open-PR 作用域"，会误导 Stage 2/3。

### RGEN-S1-002 — PR/head 作用域检查被错误写成 transport fail-closed 不变量

**处置：ACCEPTED（已修复）**

修复 commit：`2e8b256`

修复内容：将 spec 不变量中 `target_pr` 必须指向 open PR / `reviewed_head` 落在 diff 作用域的条目，从"跨 stage 必须保持的不变量"改写为 **caller-side orchestration preflight**，并明确注明：
- 当前 `src/relay-contract.ts` 只验证格式，不验证 PR 状态或 commit 归属。
- Remote PR-head equality 由 Repo Agent 经 GitHub API 独立验证。
- 后续 stage 若需自动化此 preflight，应设计为独立的、具有 GitHub read capability 的层，不属于 localhost native host/helper。
- Transport 层 fail-closed 不变量只保留 path escape / hash mismatch / detached HEAD / 缺 session。

### RGEN-S1-003 — PR 当前不是 Draft

**处置：ACCEPTED（已修复）**

修复 commit：`2e8b256`（spec 文本）+ GitHub API 操作（PR#2 转 Draft）

修复内容：
1. Spec 状态新增显式 merge gate："Stage 3 完成且 README/contract 重新对齐前，PR 必须保持 Draft 状态，禁止 merge。"
2. PR#2 已通过 GitHub GraphQL API `convertPullRequestToDraft` 转为 Draft（`isDraft: true` 已确认）。

## 评审任务

请基于上述 finding→fix 映射和 reviewed head 的 diff，逐项确认：

1. RGEN-S1-001 的修复是否准确区分了两个独立根因，且不再混淆。
2. RGEN-S1-002 的修复是否准确将作用域检查归为 caller-side preflight，且 transport 不变量不再包含该检查。
3. RGEN-S1-003 的修复是否包含 spec 文本的 merge gate + PR 实际已转 Draft。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 逐项 disposition：ACCEPTED / STILL_OPEN
- 若全部 ACCEPTED 且无新 blocking finding，verdict 为 `PASS`。

## 注意事项

- 本轮只审 PR#2 的 diff 质量与 spec 修复充分性。
- 你应当经 `Reviewed head` 在远端读取文件与 diff 后再下结论。
- 评审结论经 relay MCP 通道回传即可；PR comment 可选。
