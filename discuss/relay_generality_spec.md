# Relay 通用化 Spec（codex-web-review-relay）

> 轻量 spec，结构参考 producer 仓库 `docs/workflows/web_agent_stage_gate.md` / `docs/workflows/agent_conventions.md`，不照搬其重量，不计较格式。本文是 companion 仓库"插件通用化"改造的 canonical 计划与验收锚点。

## 状态

- 当前阶段：Stage 3（进行中）。
- Stage 1 acceptance：已由 Maintainer 批准进入 Stage 2；round-04 review-fix 在 reviewed head `09c0e063214646542666c5dda8057cd46b404d59` 返回 `PASS`，并确认 `RGEN-S1-005` / `RGEN-S1-006` 为 `ACCEPTED`。该记录不等同于 Ready、Issue acceptance 或 merge authorization。
- Stage 2 canonical review identity：`stage2-main/round-01-review-request`。此前 `main/round-05` 仅作为 Stage 2 初次尝试的历史评审记录保留；按 Stage-scoped round convention，当前 Stage 2 从 `round-01` 重新计数。
- Stage 2 review gate：`stage2-main/round-02` 在 reviewed head `7d7eacb46adf96f09ccbe1f9a8b0a2019c6146be` 返回 `PASS`，`RGEN-S2-001` / `RGEN-S2-004` 为 `ACCEPTED`，既有 `RGEN-S2-002` / `RGEN-S2-003` 保持锁定；`round-03` 的 producer compatibility evidence amendment 也返回 `PASS`。
- Stage 2 acceptance：Maintainer 于 2026-07-22 明确批准进入 Stage 3。该 acceptance 不等同于 Stage 3 acceptance、Ready、merge authorization 或 producer Issue closeout。
- Stage 3 round-01 review：reviewed head `4e77def8253c013e1911c1630060a32f20390867` 返回 `REQUEST CHANGES`，`RGEN-S3-001` 至 `RGEN-S3-005` 已记录；该 handoff 保持 append-only。
- Stage 3 round-02 review：reviewed head `981c7ce` 返回 `REQUEST CHANGES`；`RGEN-S3-001` / `RGEN-S3-005` 已 `ACCEPTED`，`RGEN-S3-002` / `RGEN-S3-003` / `RGEN-S3-004` / `RGEN-S3-006` 保持开放。
- Stage 3 round-03（`stage3-main/round-03-review-fix`）：implementation commit `9776bd0a6ef374f5046db261f0e0fac147b01a89`，reviewed head `dc7a4d0f383c82f01cbc5a33a7fa91b1b22f11f3`。Review response 已存在并返回 `REQUEST CHANGES`，处置结果包含 `RGEN-S3-002` / `RGEN-S3-003` / `RGEN-S3-007` residual；transport 结果为 `SESSION_LOST`，未持久化 `assistant_output`，formal source 为 Maintainer-attended browser readback。该记录不构成 Stage 3 acceptance。
- Stage 3 round-04（`stage3-main/round-04-evidence-amendment`）：implementation commit `b5edfe1`，reviewed head `1006a6c983f5cb336f226a0e5972c925431d4d4b`。Review response 已存在并返回 `REQUEST CHANGES`，新增 `RGEN-S3-008`（active session lifecycle）与 `RGEN-S3-009`（canonical round history）；transport 结果为 `TIMEOUT`，未持久化 `assistant_output`，formal source 为 Maintainer-attended browser readback。历史 handoff 保持 append-only。
- Stage 3 round-05（`stage3-main/round-05-review-fix`）：implementation commit `9542ae310dae5c9a719049357e0980a7744c7442`，reviewed head `441f21b79b2f59f465104876b52fed987d480754`。Review response 已存在并返回 `REQUEST CHANGES`，`RGEN-S3-008` / `RGEN-S3-009` 保持开放并新增 `RGEN-S3-010`（reconcile / turn identity）；transport 结果为 `TIMEOUT / TURN_DEADLINE_EXCEEDED`，未持久化 `assistant_output`，formal source 为 Maintainer-attended browser readback。
- Stage 3 round-06（`stage3-main/round-06-review-fix`）：implementation commit `66085b57a96f3eb2425cd3e5322313ef40725da9`，reviewed head `8f6eaf9264249e26654167c797eb587ba592b5f0`。Review response 已存在并返回 `REQUEST CHANGES`；transport 停留在 `DISPATCHED`，未持久化 `assistant_output` / SHA，formal source 为 Maintainer transfer。
- Stage 3 round-07（`stage3-main/round-07-review-fix`）：implementation commit `6990ec4a3af9d7746164d250977bfac0fd8998ac`，reviewed head `9c53ce969bcb05880b757a212be87fbf48fe165f`。Review response 已存在并返回 `REQUEST CHANGES`，新增 `RGEN-S3-011` 至 `RGEN-S3-014`；transport 结果为 `TIMEOUT / TURN_DEADLINE_EXCEEDED`。完整 diagnostics 事件链为 `trigger_received → monitor_started → trigger_accepted → monitor_finished`，从未出现 `user_turn_observed`，formal source 为 Maintainer transfer。当前修复不得预写 Stage 3 acceptance。
- Stage 3 round-08（`stage3-main/round-08-review-fix`）：implementation commit `d204c843614ef76c919564c87d4849b86b509b11`，reviewed head `36bbfff58fd2ad57a2d4e53f42b2ea7c25a18e93`。Review response 已存在并返回 `REQUEST CHANGES`，新增 `RGEN-S3-015` 至 `RGEN-S3-018`。Job `5af991b6-4f4f-480c-a40a-c14800de7425` 先在 native 5 秒 acceptance window 内进入 `SEND_UNCERTAIN / NATIVE_DISPATCH_WRITE_FAILED`，但 Web review 随后继续并完成；diagnostics 另记录 `baseline_count=0`、`candidate_count=2`、`exact_match_count=0` 与 `SEND_CLICK_RECEIPT_MISSING`。完整 verdict 由 Maintainer transfer，transport acceptance 失败。后续修复只组合具有同一 stable turn identity 的 user fragments，并将 trigger acceptance 与 exact receipt lifecycle 解耦。
- Stage 3 round-09（`stage3-main/round-09-review-fix`）：implementation commit `bdec54fd545af7b92b7a37a9dc8d09d526c9ddc9`，reviewed head `8d3792e0b12e4aeed6be04b6b4d21b7db9cb903a`。Job `b9fa3ded-fbc0-401a-bb6a-da68895157c1` 已证明 trigger acceptance 与 receipt wait 成功解耦：`trigger_received → dispatch_started → DISPATCH_TRIGGER_ACCEPTED → trigger_accepted`。但 60 秒后 exact user-turn receipt 仍以 `baseline_count=0`、`candidate_count=2`、`exact_match_count=0` 进入 `SEND_UNCERTAIN / SEND_CLICK_RECEIPT_MISSING`；本轮未形成可由 relay 取回的 formal verdict。该证据将下一步根因收窄到 conversation/turn parser 与 user-turn reconstruction，而非 model 首 token 或 review 思考耗时。
- Stage 3 round-10（`stage3-main/round-10-review-fix`）：implementation commit `651ef59b83d72f1607139e86daab64ed8f3168a5`，reviewed head `54550b3cc95d80c3ecdf08a0b8306d65d931b5da`，job `f1927ec5-2fbd-4e68-a208-cbede086ee25`。Review response 返回 `REQUEST CHANGES`，新增 `RGEN-S3-019` 至 `RGEN-S3-021`，并保留 `RGEN-S3-009` / `013` / `016` / `017` / `018`。Transport 达到 `TURN_IDLE / completed`，持久化 SHA `11d4e68a5446730c4a1e6a8bf594de30a5ba5405d4b31685592aeeb22415c8a4`；但 `assistant_output` 在本轮 Web-agent footer 后错误拼接 round-07 历史 verdict，因此完整性 anchor gate 失败。正式 finding source 采用 Maintainer 提供的无污染全文；该 transport 结果只证明长输出 delivery/ACK 已闭合，不构成 parser acceptance。
- Stage 3 round-11（`stage3-main/round-11-review-fix`）：implementation commit `030406d0500818631c81863d6924acbc8cfa904a`，reviewed head `4b2fafebfdb860b1b5906478f75862433a456b2f`，job `6b5cbe7c-6deb-42bf-9ac5-5f099fdc7e17`。Review response 返回 `REQUEST CHANGES`；`RGEN-S3-019` / `021` 已 `ACCEPTED`，`RGEN-S3-009` / `013` / `016` / `017` / `018` / `020` 保持开放。Transport 达到 `TURN_IDLE / completed`，持久化 SHA `b3021c33ecde57da2cf7fbf7aeead660cc4c9759e30b090e260216fb20003df6`；MCP 全文具有正确首锚点、唯一且位于末尾的当前 Web-agent footer，且未拼接历史 verdict，因此本轮完整 `assistant_output` 是正式 finding source。该结果证明单一目标 assistant turn 的长输出 delivery/ACK 路径本轮成功，但不构成 Stage 3 acceptance。
- Stage 3 round-12（`stage3-main/round-12-review-fix`）：implementation commit `47860753ee98dbf9145f223e777e2f8fe170a5d5`，reviewed head `3eaca9f5b2324d37843d39ddf9c409afe39a4384`，job `e47ffdad-55ff-4d87-bb45-ff7a2965644a`。Review response 返回 `REQUEST CHANGES`；`RGEN-S3-018` 已 `ACCEPTED`，`RGEN-S3-009` / `013` / `016` / `017` / `020` 保持开放，并新增 `RGEN-S3-022`。Transport 达到 `TURN_IDLE / completed`，持久化 SHA `fa047f0bd436600b66189f7521618b6e7edc9a013563a408dcdbb13ed53a12a0`；MCP 全文具有正确首锚点、唯一末尾 footer 且无历史 verdict，因此本轮完整 `assistant_output` 是正式 finding source。该记录不构成 Stage 3 acceptance。
- 跨仓库适配跟踪：producer `David-JA/single-crystal-stress#44`，用于记录本仓库 generic helper/config 变化对 single-crystal 现有使用方式的影响，并在本 PR 收尾后完成 producer-side readback。
- Producer-side readback：已使用 producer 当前 `scripts/tools/check_stage_gate_readiness.py` 对历史 tracked handoff 做 v1.0 relay-export readback，exit code `0`；证据与迁移命令已记录在 Issue #44 comment `5045654662`。当前 producer checkout 无 active handoff，Issue 保持 open，等待未来 live handoff 与 companion PR closeout。
- 关联 PR：本 spec 与全部 stage 改动进入同一个 PR（Stage 1 段 2 创建）。**Stage 3 完成且 README/contract 重新对齐前，PR 必须保持 Draft 状态，禁止 merge。**
- 分支：`codex/relay-generality`，base = 分支创建时的 main tip（`7629293`）。Stage 1 的 round history 与 Stage 2 的 round history 分开计数。
- transport 基线参照：PR#1 merge 点 `43c33e4`（producer 已验证可用的 completion detection + 单条 PR-comment 指令版本）。

## 目标

让 relay 满足两条通用性，且不破坏已验证流程：

1. 不绑死 producer 仓库：companion 仓库自身、以及任意外部仓库，都能仅凭 README + 本仓库 helper 范例完成安装、配置、首次 review。
2. 不绑死"靠 GitHub PR comment 做 web→repo 交接"：除 PR-comment 模式外，支持"无 PR + 对话内长评审"模式，verdict 经 relay `assistant_output` 回传即为正式结论。

### 通用 target identity 决策

本 spec 保留“真正无 PR + 对话内长评审”目标，采用**扩展 relay-export contract**的路线，不使用虚构 PR 编号、已关闭 PR 或 sentinel 值绕过现有校验。

- 现有 v1.0 PR 形态继续兼容：`target_pr` 为正整数，handoff 使用 `pr-<N>` identity。
- Stage 3 为 commit-only review 增加 `target_kind` / `target_id`：`target_kind=pr` 保留现有 PR 语义，`target_kind=commit` 使用稳定的 repo-local review identity，不要求 `target_pr` 或 open PR。
- commit-only handoff 增加非 PR 路径形态（例如 `.agent/review_handoffs/review-<id>/...`）；`full_ref` 与 `reviewed_head` 仍是远端取证定位字段。
- commit-only fingerprint 必须包含 target kind、target identity、handoff hash、ref、reviewed head、stream、round、package kind 和 scope hash，避免不同 review target 发生幂等碰撞；PR mode 必须继续使用 Stage 3 之前的 fingerprint 字段序列，保证升级兼容。
- Stage 3 必须定义向后兼容的 schema version、validator、helper 输出和 MCP/native contract 迁移；在该 contract 落地前，不得宣称已支持无 PR 模式。

### Assistant turn capture 与 review completion

Stage 3 的完整评审回传采用“结构化 turn 提取 + relay completion ACK”模型，参考本仓库已下载的 `reference/SyncNos-Webclipper`，但不复制其产品层命名或 autosave 语义。

- `jobId` / envelope identity 只负责把 relay transport、native host 和本次 `request_review` 关联起来；它不直接等同于 ChatGPT DOM 中的消息 identity。
- extension 在 dispatch 前记录当前会话已有的 turn identity 集合或最后一个稳定 turn anchor；dispatch 后只收集新增或发生变化的 turn，不以“当前页面最新 assistant bubble”作为唯一依据。
- turn identity 优先来自 outer turn shell 的稳定 DOM 属性（例如 `data-turn-id`、turn-level `data-testid` 或 `id`）；`data-message-id` 只作为 turn 内 fragment identity，只有完全不存在 outer shell 时才可作为受限 fallback。解析器保留 `user`、`assistant`、`tool` 等角色的文档顺序；目标 turn 之后出现未 hydration 的 unknown shell时必须等待或 fail closed，不得跨越它收集后续 assistant。若网页重渲染导致节点替换，只要 identity 不变，就继续合并该 turn 的新内容。
- capture 层必须支持多次轮询的增量 harvest：按 turn identity 去重、按文档顺序重组，并在延迟 hydration、DOM 重渲染或虚拟化场景下补采未完成的 turn；不能因为某一次轮询暂时只看到部分节点就 terminalize。
- 本次 review 的正式 `assistant_output` 是 dispatch 后新增 assistant review turn（或该 review 产生的连续 assistant turn 集合）的完整文本。capture 层必须保存本次 job 的 turn anchor，避免把历史 assistant 回复或其他并发内容混入结果。
- `TURN_IDLE` 只在目标 turn 已经出现明确的 turn-level completion evidence、内容在连续轮询中保持稳定，并且 native host 对该 job 返回成功 ACK 后成立。普通文本静默、单独消失的 stop button、代码块的 `Copy code` 按钮或“曾经观察到 generating”均不是充分完成证据。
- `assistant_output_sha256` 是完整性、去重和 reconnect/retry 审计字段，不负责判断 turn 属于哪一轮，也不要求把 hash 设计成独立的 completion 状态机。若输出尚未完成，hash 只能描述当前快照，不能作为 formal verdict evidence。
- 如果 lifecycle ACK 返回 `{ok:false}`，extension 必须继续保持可恢复监控或显式进入 recovery；不得把失败响应当作成功并停止 observer。native host 未 ACK 前不得将本次 capture 视为已交付。
- relay-only 的 dispatch、reconcile、trigger acceptance 与全部 lifecycle 事件必须携带同一持久化 `ownershipGeneration`。content、background、native 三层均须精确校验并原样转发；任何一层不得把旧 monitor 的 generation 改写为当前值。所有可幂等 lifecycle 在 native 已持久化但 ACK 丢失时必须重放至 correlated ACK，native 对同 phase 重放返回当前稳定 phase。

#### SyncNos reference 审计后的 parser baseline

仓库内 `SyncNos-Webclipper` reference 已提供可验证的设计，不应再把参考范围缩减为“长文本分块”：

- `chatgpt-collector.ts` 的 `turnKeyOf()` 证明可使用页面 identity 拆分轮次；relay 结合自身需求进一步把 outer turn shell identity 与 inner `data-message-id` 分层。这些 identity 不是正文 hash。
- `getTurnSkeleton()` 保存 conversation-turn skeleton 的文档顺序；`getTurnWrappers()` 优先枚举 message-level role nodes，同时保留没有 role node 的 turn shell。
- `harvestMessagesInto()` 以 `(turnKey, message identity / within-turn position)` 跨 pass 去重并保留同一 turn 内的多个 message；`assembleFromCache()` 再按当前 skeleton 顺序重组。
- `harvestInto()` 与 manual scroll/hydration 流程允许 virtualized shell 在后续 pass hydrate 后补采，避免单次 DOM 快照遗漏历史或尚未 hydration 的内容。
- `extractMessageFromWrapper()` 与 `chatgpt-markdown.ts` 负责对已定位 message 做完整 text/Markdown extraction，包括换行、代码块和隐藏源码；该 extraction 层不承担 turn 归属或 completion 判断。
- `runtime-observer.ts` 只提供 DOM 变化触发和 root refresh，不证明某个 turn 已完成；autosave incremental engine 处理 snapshot 增量，不应直接等同于 relay 的 formal completion gate。

因此 relay 必须实现自己的、许可证隔离的最小 `TurnRecord` / `TurnHarvestCache` 数据模型，并让 dispatch receipt、assistant capture 与 reconcile 共用：

```text
conversation identity
→ ordered turn skeleton
→ stable turn identity + role
→ ordered message fragments
→ cross-pass harvest/cache
→ target user turn reconstruction
→ following assistant turn reconstruction
→ turn-level completion evidence
→ complete extraction + native ACK
```

Round 10 之前的 `extension/dom-adapter.js` 只实现了 same-identity 节点分组和局部文本拼接；round 10 首次引入 tracker，但 review 证明其 generic turn key、virtualized skeleton order、strict content selector 与 tracked/legacy fallback 仍不满足本 baseline。Round 09 的两个 candidate 是否属于同一 turn不能由计数证明；后续真实诊断必须记录每个 candidate 的非正文结构元数据：stable turn key、message identity、role、document-order index、fragment count、canonical length/hash。不得记录 envelope 或 conversation 正文。

### Evidence-first transport diagnostics

Stage 3 后续不得仅凭 persisted phase 推断浏览器侧失败位置。先建立以下可查询观测面，再依据一次真实失败的事件序列修复 transport：

- extension / content script 产生不含对话正文的结构化 diagnostic event，经现有 Native Messaging port 交给 native host；extension 不直接写任意本地文件。
- native host 将事件追加到 config 指定的固定 JSONL 路径，支持 `off` / `error` / `info` / `debug` / `trace` 级别、大小轮转和保留文件数。
- 每条事件至少包含 `timestamp`、`level`、`component`、`event`；存在时关联 `session_id`、`job_id`、`request_id`、`message_type`、`phase`、`error_code`。
- 日志不得记录 bearer token、cookie、handoff/envelope 正文、完整 conversation 或 assistant output；文本证据只记录长度、SHA-256、turn identity、计数和布尔状态。
- Native Messaging 断连期间，extension 仅保留有界 diagnostic ring buffer；重连后补发，不能让诊断队列阻塞 review lifecycle。
- MCP 提供按 `job_id` 查询最近事件的只读工具。每次全文传输失败后，repo agent 必须先读取该 job 的日志证据；若日志缺口本身阻止归因，应报告缺口，不得用猜测代替。

该模型将“完整对话分割”和“评审完成确认”明确分层：前者确保 turn、角色、顺序和内容不遗漏；后者确认这些内容确实属于本次 job、已经停止生成，并已被 native host 接收。

### Extension 单绑定状态机

extension 采用单通道、fail-closed 的手动绑定模型，不尝试在多个 tab、conversation 或 document 之间自动选择和迁移 review job：

```text
DISARMED
  -> manual Arm current ChatGPT tab
ARMED(tabId, sessionId)
  -> native dispatch(jobId)
ACTIVE(tabId, sessionId, jobId)
  -> TURN_IDLE / TIMEOUT
ARMED(tabId, sessionId)

ACTIVE 或 ARMED
  -> tab close / navigation / page binding drift
SESSION_LOST -> DISARMED
```

- extension 全局同时只允许一个 armed tab 和一个 active job。使用者不得同时绑定两个窗口；已 armed 时再次 Arm 返回 `SESSION_ALREADY_ARMED`，active job 期间返回 `ACTIVE_JOB_ARM_FORBIDDEN`。
- active job 期间 Disarm 返回 `ACTIVE_JOB_DISARM_FORBIDDEN`。Arm / Disarm 均不得覆盖、清空或重建当前 `jobId`。
- `activeJobId` 只属于单一 authoritative session state；native port reconnect 可以恢复同一个 session 的通讯，但不得隐式 re-arm 页面、切换 tab、重置 job 或把 stale persisted binding 当作当前页面授权。
- lifecycle 只在状态为 `ACTIVE`、`sender.tab.id` 等于 armed `tabId`、且 `message.jobId` 等于 active `jobId` 时接收。不存在“`bindingValid=false` 但 lifecycle 仍可继续提交”的中间状态。
- armed tab 关闭、导航、conversation identity 改变、content script reload 或 adapter drift 时，若有 active job则向 native host 报告一次 `SESSION_LOST`；随后本地 binding 进入 `DISARMED`，必须由使用者在目标页面重新 Arm。旧页面或旧 monitor 的后续 lifecycle 一律返回 `SESSION_NOT_ARMED`。
- `tabId` 是 native port 不能提供的最小页面定位信息；不再为当前单窗口约束增加 `bindingNonce`、自动 document migration 或多窗口仲裁。turn identity 与 `assistant_output_sha256` 属于 capture / audit 层，不参与 tab binding。

## 背景与根因（dry run 结论，作为本 spec 的事实基础）

- 基线 `43c33e4` 的 completion detection 是为“assistant turn 只承载短确认、verdict 写 PR comment”设计的。短确认只降低了最终 assistant payload 的 extraction 压力，不降低 Web agent 的取证、推理或首 token 等待时间；1500ms 稳定窗口仅在当时受控页面与最终短 payload 上曾跑通，不能据此证明深度评审的首 token 或 turn completion 已被可靠建模。
- 此前在 companion 上尝试"无 PR + 对话内长评审"，偏离了上述设计包络：长回复被 1500ms 误截断（round1/2）；为治截断而放大窗口并重写完成块后，又出现"不触发→TIMEOUT"的回归（round3–6，state.sqlite 硬证据：`assistant_output=null`）。
- 此前失败应拆成**两个独立根因**：
  1. **Remote commit availability**：`reviewed_head` 或 handoff 尚未 push 到远端，导致 web agent 经 GitHub connector 做 commit 取证时 404。Open PR 不是读取已 push commit 的必要条件——只要 commit 在远端可达即可。
  2. **PR-comment target validity**：`target_pr` 指向已 merge 的 PR#1（closed），导致 formal PR-comment 没有有效的发布/readback 目标。Open PR 是 PR-comment publication/readback 的必要条件。
- 此前 spec 将两者混淆为"target 与 head 不在同一 open-PR 作用域"，会误导 Stage 2/3 将"GitHub comment anchoring 问题"当成"commit 文件读取问题"。
- 结论：relay 收不到有效 verdict 的主因是**流程姿势**（未 push + target 指向 closed PR + 长评审偏离设计包络），叠加为治截断引入的 transport 回归；不是 envelope 字段错误，也不是单纯窗口大小问题。

## 范围 / 非范围

- 范围：transport 回退到基线以恢复 PR-comment 模式跑通；spec 与三层 agent 约定对齐 producer 范本；helper/README 通用化文档；最后实现并测试"无 PR + 对话内长评审"通用模式。
- 非范围：不引入云端依赖；不动 producer 仓库；不在 Stage 1/2 提前改变已验证的 PR transport 行为。Stage 3 明确包含 relay-export schema、validator、fingerprint 以及 MCP/native contract 的兼容性设计与实现。

## Stage 表

| Stage | 目标 | 主要产物 | 是否动传输代码 | 验收标准 |
|---|---|---|---|---|
| 1 | 用 PR-comment 模式跑通一次 review-fix | 新分支 + draft PR + transport 回退基线 + 本 spec 骨架 + ≥1 轮有效 verdict | 否（回退，不新写） | relay 捕到短确认（`TURN_IDLE` 且 `assistant_output` 非空）+ formal verdict 已发布并可从目标 PR comment readback |
| 2 | 让 companion 成为可照搬范例（框架） | conventions/AGENTS/workflow 对齐 producer 范本 + handoff cleanup 规则 + helper 校验 | 否 | 文档自洽、路由闭合、helper `relay-export` 自检通过、中英 README 同步 |
| 3 | 通用化：commit-only review + 对话内长评审 | target identity/schema 扩展 + 新 envelope 指令 + 重写的 completion detection + targeted tests | 是 | 无 open PR 场景下端到端跑通 + 不回归 v1 PR-comment 模式 + tests 绿 |

### Stage 3 turn capture 验收边界

- 必须有针对真实 ChatGPT conversation DOM 的 turn identity capture 测试：至少覆盖多轮、多角色、代码块、DOM 重渲染、延迟 hydration 和部分 turn 后继续生成。
- 必须证明 dispatch 前已有的 assistant turns 不会进入本次 `assistant_output`，且 dispatch 后新增 turn 的文本按 DOM 顺序完整保留。
- 必须覆盖同一 turn 多次轮询的增量合并，以及 turn 节点替换但 identity 不变时的继续收集。
- 必须覆盖 lifecycle 返回 `{ok:false}` 的情况：observer 不得静默停止，job 不得被错误 terminalize。
- acceptance evidence 应同时记录 `jobId`、目标 turn identity、完整输出首尾 anchor、`assistant_output_sha256` 和 native `TURN_IDLE` ACK；其中 hash 是校验与审计证据，不替代 turn identity 或 completion evidence。
- relay-only review test 只有在 MCP result 的 `assistant_output` 含完整 formal verdict 时才通过 transport gate。页面上已生成全文但 relay 未交付时，repo agent 停止并由 Maintainer 人工转接；browser readback 只可用于诊断，不替代 acceptance evidence，且下一轮 handoff 必须优先记录并复验该全文传输 failure。

## 关键不变量（跨 stage 必须保持）

- PR trigger envelope 仅含 6 个动态定位字段 + 固定指令；commit-only envelope 在此基础上增加 `target_kind` / `target_id`。两种 envelope 都**绝不内嵌 handoff 正文**；reviewer 凭 locator 与 `reviewed head` 在远端读 commit / handoff。开源仓库经 commit 取证是不可动摇的基础。
- PR 模式下，`target_pr` 必须指向**当前 open、正在审的 PR**，`reviewed_head` 落在该 PR 的 diff 作用域内；不得指向已 merge 的 PR。commit-only 模式不要求 `target_pr` 或 open PR，但必须使用已定义的 `target_kind` / `target_id` contract，并以 `full_ref` + `reviewed_head` 完成远端取证。PR 状态和 PR-head equality 检查属于 **caller-side orchestration preflight**（由 Repo Agent 在触发 `request_review` 前经 GitHub API 独立验证），不是 native host / helper / transport 的 fail-closed 不变量。
- fail-closed（transport 层）：path escape / hash mismatch / detached HEAD / 缺 session，均中止于 dispatch 前。
- `TURN_IDLE` 只描述 transport 完成；Stage 1/Stage 2 的 v1 PR-comment mode 以 GitHub readback 为 formal verdict 来源。当前 Stage 3 acceptance review 由 Maintainer 明确授权 commit-only pilot 使用完整 `assistant_output` 作为本轮验收的 formal source；该 pilot 不代表一般可用性，只有 Stage 3 acceptance 后才成为对外契约。commit-only capture 必须遵守本 spec 的“Assistant turn capture 与 review completion”模型。
- v1 PR 模式的 handoff 路径正则、relay-export 字段与 `scope_sha256 == sha256(canonical_json(normalized_scope))` 约束保持兼容；Stage 3 为 commit-only 模式增加对应的路径形态、target identity 字段和 schema version 规则。

## 授权与轮次（按 Stage 独立计数；对齐 producer，不写无条件硬上限）

- 5 轮预算绑定 `authorization_class = preauthorized-dual-agent-gate|closeout`（无人值守防死循环的保护性预算）。
- `maintainer-attended` 模式无该固定上限，是否继续由 Maintainer 逐轮决定。
- `Effective round` 的计数域是 `(Stage, review stream)`；Stage transition 后下一 Stage 从 `round-01` 开始，不得将 Stage 1 的 round-04 累计成 Stage 2 的 round-05。当前 v1 handoff path 没有独立 Stage segment，因此 Stage 2 使用带作用域的 stream（`stage2-main`）避免 path/fingerprint 冲突。
- 更换 review stream 不得绕过同一 unattended Stage 预算；transport retry / same-fingerprint retry / browser readback retry 不增加有效轮次。历史 handoff identity append-only，纠正 round scope 时创建新的 Stage-scoped handoff。

## Stage 1 验收细节

- transport 文件 `extension/content.js`、`src/envelope.ts` 与基线 `43c33e4` 逐字节一致（`git diff 43c33e4 -- <files>` 为空）。
- 存在 open draft PR，`target_pr` = 该 PR 编号，`reviewed_head` = 分支 tip。
- 至少完成一轮：relay 返回 `TURN_IDLE` 且 `assistant_output` 非空（短确认），**并且** web agent 已将完整 formal verdict 发布到目标 PR comment，且该 verdict 能由预期 actor 在当前 `reviewed_head` / `Review scope` 下独立 readback。Stage 1 的短 `assistant_output` 只能作为 transport evidence，不能替代 PR-comment formal gate。
- 若 web agent 给 `REQUEST CHANGES`，在 Stage 1 的同一 stream 上修复并进入该 Stage 的 round-02，最多 5 轮；进入 Stage 2 后 round 重新从 01 计数。

## 风险与回退

- 风险：基线 1500ms 在 PR-comment 模式下若 web agent 对话确认偏长，仍可能截断——若发生，单独诊断，不在 Stage 1 改 content.js。
- 回退：Stage 1 改动全在新分支，main 历史不受影响；若 Stage 3 的 completion detection 重写失败，可保留 PR-comment 模式为唯一支持模式并在 README 标注限制。

## 参考

- producer 仓库 `docs/workflows/web_agent_stage_gate.md`（流程契约，结构参考）。
- producer 仓库 `docs/workflows/agent_conventions.md`（agent 约定范本，结构参考）。
- 本仓库 `docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md`、`AGENTS.md`（Stage 2 将据此对齐 producer 范本）。
- 本仓库已下载的 `reference/SyncNos-Webclipper/SyncNos-SyncNos-Webclipper-534b8cb/src/collectors/chatgpt/chatgpt-collector.ts`（turn identity、角色顺序、跨轮 harvest 与去重参考）。
- 本仓库已下载的 `reference/SyncNos-Webclipper/SyncNos-SyncNos-Webclipper-534b8cb/src/collectors/runtime-observer.ts` 与 `src/services/conversations/content/autosave-incremental-engine.ts`（DOM 变化观察与增量合并参考）。
