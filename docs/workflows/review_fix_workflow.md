# review-fix 闭环工作流

> repo agent 与 web reviewer 经 relay 协作的可复用范例。契约细节见 `docs/agent_conventions.md`，本文件只描述**流程**与**反模式**。

## 角色与通道

```
repo agent --(handoff + commit + push)--> 远端 (GitHub)
repo agent --request_review--> relay --dispatch(envelope)--> Chrome ext --> ChatGPT composer
Stage 1/Stage 2 (v1 PR-comment mode): web reviewer 读远端 commit + handoff --> 评审 --> 完整 verdict 发布到 PR comment
Stage 1/Stage 2: web reviewer --> 短确认 --> relay 捕获 assistant_output --MCP 回传--> repo agent
commit-only relay-only mode：assistant_output 承载完整 verdict；PR comment 不适用
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
8. 若维护 canonical round ledger，trigger 前先记录本轮 identity、implementation commit 及 review/transport pending；精确 `reviewed_head` 以随后包含该记录的 handoff commit 和 relay-export 为准，不在 commit 正文中自引用预写自身 SHA。结果存在后再追加 verdict、job、transport 与 formal-source facts。
9. 触发 `request_review(handoff_file=<absolute handoff file>)`。
10. PR-comment mode：接收 `TURN_IDLE` 的短 `assistant_output` 作为 transport evidence；随后读取目标 PR comment，按当前 `reviewed_head`、`Review scope` 和预期 actor 核验并解析 formal verdict。commit-only relay-only mode：按 `target_kind` / `target_id` 验证无 PR target，并要求 MCP result 直接返回完整 `assistant_output`（核对首尾 anchor 与 SHA-256）。
11. PR-comment formal verdict 为 `PASS` → 结束，`REQUEST CHANGES` → 回步骤 1；commit-only relay-only mode 的完整 `assistant_output` 按同一 verdict parser 处理。如果 web reviewer 页面已完成但 relay 未传回全文，立即停止并请 Maintainer 人工转接，不以 browser readback 替代 transport gate；下一轮 handoff 将该全文传输失败列为首要问题。`HUMAN DECISION REQUIRED` / `COMMENT` → 停止并报告，**不擅自继续**。

### 默认监听节奏

确认 dispatch 已成功、页面已进入 `send-observed` 后，第一次不要在短窗口内判定失败，默认等待 10 分钟；若仍无 formal verdict，再改为每 5 分钟轮询一次。该节奏只控制服务端结果观察，不改变 MCP wait slice、hard deadline、job fingerprint 或 review round；任何 active job 都不得因轮询间隔变化而重复 dispatch。

## web reviewer 契约

- 凭 envelope 的 `Path` + `reviewed head` 在远端读 handoff 与 commit；不依赖内嵌正文。
- PR-comment mode：将完整 formal verdict 发布到目标 PR comment；assistant response 只需返回短确认，relay 的 `assistant_output` 作为 transport evidence。
- commit-only relay-only mode：不要求 PR comment，完整 verdict 通过 `assistant_output` + SHA-256 作为正式来源。

## 反模式（务必避免）

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 改完不 push 就触发 review | reviewer 读 commit/handoff 404 → UNVERIFIED / HUMAN DECISION REQUIRED | 触发前 push reviewed head + handoff |
| envelope 内嵌 handoff 正文或"读不到就靠摘要"兜底 | 违背"经 commit 取证"设计；reviewer 既无文件又无可靠摘要 | envelope 只给 Path + head，让 reviewer 读远端 |
| 同一 active job 未结束就 dispatch 下一轮 | `ACTIVE_JOB_EXISTS` | 等该 job 到 terminal（deadline 过期自动 TIMEOUT）或走 reconcile |
| 已 Arm 或 active job 期间再次 Arm | 覆盖本地 `activeJobId`，造成 native / extension state split | 保持单一 armed tab；先完成当前 job，必要时 Disarm 后在目标 conversation 手动重新 Arm |
| armed tab 导航后继续接收旧 monitor lifecycle | stale 页面可能与 `SESSION_LOST` 竞争提交结果 | 导航即原子失效本地 binding、报告 `SESSION_LOST` 并进入 `DISARMED` |
| relay-only 页面已有完整 verdict，但 MCP result 无全文 | browser readback 掩盖 transport failure，无法证明插件完成交付 | 停止并请 Maintainer 转接；下一轮 handoff 首要记录该 failure，不将 browser readback 计为 transport acceptance |
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

Stage 3 commit-only handoff 将 `Target PR` 替换为：

```markdown
Target kind: `commit`
Target ID: `review-security-audit`
```

## 指针

- phase / 重试 / recover 语义：`docs/agent_conventions.md` §job 生命周期。
- 路径正则 / relay-export schema / helper CLI：`docs/agent_conventions.md` §handoff 与 helper 合同。
- 完成检测实现（turn identity、增量输出稳定、turn-level completion evidence、native ACK 与 `sendLifecycle` 失败重试）：`extension/dom-adapter.js` + `extension/content.js`，维护扩展时读。
