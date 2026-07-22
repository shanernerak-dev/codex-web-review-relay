# review-fix 闭环工作流

> repo agent 与 web reviewer 经 relay 协作的可复用范例。契约细节见 `docs/agent_conventions.md`，本文件只描述**流程**与**反模式**。

## 角色与通道

```
repo agent --(handoff + commit + push)--> 远端 (GitHub)
repo agent --request_review--> relay --dispatch(envelope)--> Chrome ext --> ChatGPT composer
Stage 1/Stage 2 (v1 PR-comment mode): web reviewer 读远端 commit + handoff --> 评审 --> 完整 verdict 发布到 PR comment
Stage 1/Stage 2: web reviewer --> 短确认 --> relay 捕获 assistant_output --MCP 回传--> repo agent
Stage 3 验收后: assistant_output 可承载完整 verdict；PR comment 可选
```

## 轮次模型

- round 计数按 `(Stage, review stream)` 独立作用域；Stage transition 后从 `round-01` 重新开始，不跨 Stage 累加。
- 同一 Stage 内，round-01 = `review-request`；round-N (N>1) = `review-fix`。路径含 round 编号与 Stage-scoped stream → fingerprint 唯一 → 防重复 dispatch。
- 当前 v1 path 没有独立 Stage segment，因此跨 Stage 的 stream 必须显式带 Stage 作用域，例如 Stage 2 使用 `stage2-main`，不能继续使用上一 Stage 的 `main` 并改成 `round-05`。
- 轮次上限是**调用侧策略**（relay 不限制），示例 `MAX_REVIEW_ROUNDS = 5`；该预算也按 Stage 重新计算。

## repo agent 单轮步骤

1. 按上一轮 findings 改文档（中英同步）。
2. `git add` 仅相关文档 → `git commit`（单一范围）。
3. **`git push` 到远端**（红线：reviewer 经远端读 commit，未 push = 404 = UNVERIFIED）。
4. 写 handoff：当前 Stage 的 round-N、Stage-scoped stream、`package_kind=review-fix`，正文含 **finding → fix 映射**（逐条处置）。
5. `git add` handoff → `git commit`。
6. **`git push`**。
7. 本地校验：`python <helper> relay-export <handoff_path>` 确认 JSON 合法。
8. 触发 `request_review(handoff_path=...)`。
9. Stage 1/Stage 2 的 v1 PR-comment mode：接收 `TURN_IDLE` 的短 `assistant_output` 作为 transport evidence；随后读取目标 PR comment，按当前 `reviewed_head`、`Review scope` 和预期 actor 核验并解析 formal verdict。缺失、无法读取或无法确认时返回 `HUMAN DECISION REQUIRED`，不得从短确认推断 verdict。Stage 3 relay-only mode 完成并验收后，才可切换为直接解析完整 `assistant_output`。
10. Stage 1/Stage 2 的 PR-comment formal verdict 为 `PASS` → 结束，`REQUEST CHANGES` → 回步骤 1，`HUMAN DECISION REQUIRED` / `COMMENT` → 停止并报告，**不擅自继续**。Stage 3 relay-only mode 的 `assistant_output` 分支只能在其 contract 与 completion detection 验收完成后启用。

## web reviewer 契约

- 凭 envelope 的 `Path` + `reviewed head` 在远端读 handoff 与 commit；不依赖内嵌正文。
- 当前 Stage 1/Stage 2 的 v1 PR-comment mode：将完整 formal verdict 发布到目标 PR comment；assistant response 只需返回短确认，relay 的 `assistant_output` 作为 transport evidence。
- Stage 3 relay-only mode 完成并验收后，才可将完整 verdict 通过 `assistant_output` 作为正式来源；该模式下 PR comment 可选。

## 反模式（务必避免）

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 改完不 push 就触发 review | reviewer 读 commit/handoff 404 → UNVERIFIED / HUMAN DECISION REQUIRED | 触发前 push reviewed head + handoff |
| envelope 内嵌 handoff 正文或"读不到就靠摘要"兜底 | 违背"经 commit 取证"设计；reviewer 既无文件又无可靠摘要 | envelope 只给 Path + head，让 reviewer 读远端 |
| 同一 active job 未结束就 dispatch 下一轮 | `ACTIVE_JOB_EXISTS` | 等该 job 到 terminal（deadline 过期自动 TIMEOUT）或走 reconcile |
| review-fix handoff 不含 finding → fix 映射 | reviewer 无法核销上轮 findings → 全 UNVERIFIED | handoff 正文逐条列处置 |
| 只改 README.md 不改 README.zh-CN.md | 中英漂移，产生新 finding | 同步改，术语对齐 |

## handoff 最小模板

```markdown
# Review Request

Package kind: `review-fix`
Review stream: `main`
Effective round: `2`
Target PR: `#1`
Review scope: <本轮范围>

## finding -> fix 映射

- F-XXX-001: <处置：ACCEPTED / 修复说明>
- F-XXX-002: <处置>
```

## 指针

- phase / 重试 / recover 语义：`docs/agent_conventions.md` §job 生命周期。
- 路径正则 / relay-export schema / helper CLI：`docs/agent_conventions.md` §handoff 与 helper 合同。
- 完成检测实现（输出稳定 + 页面空闲 / 时间兜底 + `sendLifecycle` 超时保护）：`extension/content.js`，维护扩展时读。
