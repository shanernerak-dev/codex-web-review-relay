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
- Stage 3 canonical review identity：`stage3-main/round-04-evidence-amendment`，reviewed head `1006a6c983f5cb336f226a0e5972c925431d4d4b`；Stage 3 round 独立从 `round-01` 计数。round-04 formal review 已返回 `REQUEST CHANGES`，但 relay transport 为 `TIMEOUT` 且未持久化 `assistant_output`；该 verdict 来自 Maintainer-attended 浏览器 readback，不构成 Stage 3 acceptance。
- Stage 3 round-03 review handoff：implementation head `9776bd0a6ef374f5046db261f0e0fac147b01a89`，已修复 round-02 的 `RGEN-S3-002` / `RGEN-S3-003` / `RGEN-S3-004` / `RGEN-S3-006`，等待复审。
- Stage 3 round-03 transport：因浏览器绑定 stale 结束为 `SESSION_LOST`，evidence amendment 保持 `Effective round=3`，未产生 formal verdict。
- Stage 3 round-04 review handoff：implementation head `084b588`，补充修复 extension `Disarm` / `Arm` session lifecycle，等待复审。
- Stage 3 round-04 current-head amendment：implementation commit `b5edfe1` 已补齐 round-03 verdict 的 `RGEN-S3-002` / `RGEN-S3-003` / `RGEN-S3-007` residual，并保留 extension lifecycle fix；该 amendment 的 formal review 新增 `RGEN-S3-008`（active job 期间 Disarm 的 lifecycle/recovery 风险）与 `RGEN-S3-009`（canonical round history 与当前 review chain 不一致），历史 handoff 保持 append-only。
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
- turn identity 优先来自稳定的 DOM 属性（例如 `data-turn-id`、`data-message-id`、`data-testid` 或 `id`），并保留 `user`、`assistant`、`tool` 等角色的文档顺序。若网页重渲染导致节点替换，只要 identity 不变，就继续合并该 turn 的新内容。
- capture 层必须支持多次轮询的增量 harvest：按 turn identity 去重、按文档顺序重组，并在延迟 hydration、DOM 重渲染或虚拟化场景下补采未完成的 turn；不能因为某一次轮询暂时只看到部分节点就 terminalize。
- 本次 review 的正式 `assistant_output` 是 dispatch 后新增 assistant review turn（或该 review 产生的连续 assistant turn 集合）的完整文本。capture 层必须保存本次 job 的 turn anchor，避免把历史 assistant 回复或其他并发内容混入结果。
- `TURN_IDLE` 只在目标 turn 已经出现明确的 turn-level completion evidence、内容在连续轮询中保持稳定，并且 native host 对该 job 返回成功 ACK 后成立。普通文本静默、单独消失的 stop button、代码块的 `Copy code` 按钮或“曾经观察到 generating”均不是充分完成证据。
- `assistant_output_sha256` 是完整性、去重和 reconnect/retry 审计字段，不负责判断 turn 属于哪一轮，也不要求把 hash 设计成独立的 completion 状态机。若输出尚未完成，hash 只能描述当前快照，不能作为 formal verdict evidence。
- 如果 lifecycle ACK 返回 `{ok:false}`，extension 必须继续保持可恢复监控或显式进入 recovery；不得把失败响应当作成功并停止 observer。native host 未 ACK 前不得将本次 capture 视为已交付。

该模型将“完整对话分割”和“评审完成确认”明确分层：前者确保 turn、角色、顺序和内容不遗漏；后者确认这些内容确实属于本次 job、已经停止生成，并已被 native host 接收。

## 背景与根因（dry run 结论，作为本 spec 的事实基础）

- 基线 `43c33e4` 的 completion detection 是为"对话只回短确认、verdict 写 PR comment"设计的；该模式下 web agent 对话回复短，1500ms 稳定窗口可正确触发 `TURN_IDLE`。
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
