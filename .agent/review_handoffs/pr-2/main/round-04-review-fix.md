# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `4`
Target PR: `#2`
Review scope: PR#2 round-04——核销 RGEN-S1-005/RGEN-S1-006，完成 Stage 1 verdict path 与 review round identity 修复

## 评审区间

- Review base commit：`76292939b15f341927973249f09ce0bba8560ffa`
- Previous formally reviewed head：`c60a0493e19731a140e778e43dcff3e98c7bb116`
- Review head：以 trigger envelope 的 `Reviewed head` 字段为准。
- 本轮包含上一轮 `c60a049..d47edab` 的 substantive RGEN-S1-005 修复，以及本轮新增的 workflow diagram / round identity 修复。
- 取证命令：`git diff 76292939b15f341927973249f09ce0bba8560ffa..<Reviewed head>`；必要时增量核验 `git diff c60a0493e19731a140e778e43dcff3e98c7bb116..<Reviewed head>`。

## finding → fix 映射

### RGEN-S1-005 — Stage 1 verdict path 混淆

**处置：ACCEPTED（待本轮复审确认）**

修复内容：

- `docs/agent_conventions.md` 的两层依赖、角色边界、envelope、`TURN_IDLE` 语义均改为 mode-qualified。
- 当前 Stage 1 明确以 PR comment readback 作为 formal verdict source；`assistant_output` 只作为非空短确认和 transport evidence。
- `docs/workflows/review_fix_workflow.md` 的 repo agent 步骤 9–10 改为先接收 transport completion，再读取并核验 PR comment；缺失或无法确认时返回 `HUMAN DECISION REQUIRED`。
- Stage 3 relay-only 的完整 `assistant_output` verdict 仅作为未来、完成 contract 与 completion detection 验收后的分支。

### RGEN-S1-006 — substantive review-fix 复用已完成的 round-03 identity

**处置：ACCEPTED（已修复）**

修复内容：

- 不再复用 `round-03-review-fix.md` 触发新的 substantive review。
- 新建本 `round-04-review-fix.md`，`Effective round: 4`。
- `Previous formally reviewed head` 设置为 `c60a0493e19731a140e778e43dcff3e98c7bb116`，保留既有 GitHub comment 的 append-only 审计链。
- 本轮明确包含 `c60a049..d47edab` 的 RGEN-S1-005 修复，以及当前 workflow diagram 的补充修复。

## 评审任务

1. 确认 Stage 1 的 formal verdict 只能来自 PR comment readback，短 `assistant_output` 不能推动 `PASS` / `REQUEST CHANGES`。
2. 确认 workflow 顶部通道图不再把当前 Stage 1 PR comment 写成 optional。
3. 确认 round-04 的 previous formally reviewed head、effective round、handoff path 与 fingerprint 形成新的 append-only review identity。
4. 本轮不要求实现 Stage 3 contract、commit-only schema 或长评审 completion detection。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 分别给出 RGEN-S1-005、RGEN-S1-006 的 `ACCEPTED` / `STILL_OPEN`。
- 如有新 finding，必须给出位置、证据、问题、建议修复和严重度。
- Stage 1 formal verdict 发布到 PR #2 comment；relay assistant response 只需返回短确认。
