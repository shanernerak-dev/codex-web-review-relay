# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `3`
Target PR: `#2`
Review scope: PR#2 round-03——核销 RGEN-S1-004/RGEN-S1-005，修订 canonical generality spec 与 Stage 1/Stage 3 convention

## 评审区间

- Review base commit：`76292939b15f341927973249f09ce0bba8560ffa`
- Previous reviewed head：`2198536368d8399c91b115cd5663acd12188f8af`
- Review head：以 trigger envelope 的 `Reviewed head` 字段为准。
- 取证命令：`git diff 76292939b15f341927973249f09ce0bba8560ffa..<Reviewed head>`

## finding → fix 映射

### RGEN-S1-004 — “无 PR”目标与强制 PR identity / schema 非范围互相矛盾

**处置：ACCEPTED（已修复）**

修复文件：`discuss/relay_generality_spec.md`、`AGENTS.md`、`docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md`

修复内容：

- 明确保留真正的“无 PR + 对话内长评审”目标。
- 明确选择扩展 relay-export contract 的路线，不使用虚构 PR 编号、已关闭 PR 或 sentinel 值。
- 保留 v1.0 PR 形态兼容。
- 为 commit-only review 定义 `target_kind` / `target_id` 方向、非 PR handoff identity、fingerprint 必须包含的字段。
- 将 Stage 3 的 relay-export schema、validator、fingerprint、MCP/native contract 兼容性设计纳入范围。
- 明确在新 contract 落地前不得宣称无 PR 模式已支持。

### RGEN-S1-005 — Stage 1 验收允许对话 verdict 替代 PR-comment formal source

**处置：ACCEPTED（已修复）**

修复文件：`discuss/relay_generality_spec.md`、`AGENTS.md`、`docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md`

修复内容：

- Stage 1 验收现在要求同时满足：
  - relay 返回 `TURN_IDLE` 且 `assistant_output` 非空短确认；
  - 完整 formal verdict 已发布到目标 PR comment，并可按当前 `reviewed_head` / `Review scope` 独立 readback。
- 明确 Stage 1 的 `assistant_output` 只是 transport evidence，不能替代 PR-comment formal gate。
- 移除 Stage 1 表格中“对话 verdict 可替代 PR comment”的表述。
- 同步修正 agent convention 与 review-fix workflow，避免把 Stage 3 的 relay-only 结论路径误写成当前 Stage 1 行为。
- 将 `docs/agent_conventions.md` 的传输契约、角色边界和 `TURN_IDLE` 语义改为 mode-qualified。
- 将 `docs/workflows/review_fix_workflow.md` 的 repo agent 步骤 9–10 改为 Stage 1 PR-comment readback 分支，并保留 Stage 3 relay-only 作为未来验收后的分支。

## 评审任务

请基于当前 Reviewed head 的远端 diff：

1. 逐项确认 RGEN-S1-004 与 RGEN-S1-005 是否已充分修复。
2. 检查 canonical spec 是否仍存在关于 Stage 1、Stage 3、PR identity、schema 范围的内部矛盾。
3. 本轮只评审上述 spec/convention 修复，不要求实现 Stage 3 contract 或长评审 transport。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 对 RGEN-S1-004、RGEN-S1-005 分别给出 `ACCEPTED` / `STILL_OPEN`。
- 如有新 finding，必须给出位置、问题、证据、建议修复和严重度。
- 评审结论发布到 PR #2 comment；relay assistant response 只需返回短确认。
