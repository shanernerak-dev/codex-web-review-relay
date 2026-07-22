# Relay 通用化 Spec（codex-web-review-relay）

> 轻量 spec，结构参考 producer 仓库 `docs/workflows/web_agent_stage_gate.md` / `docs/workflows/agent_conventions.md`，不照搬其重量，不计较格式。本文是 companion 仓库"插件通用化"改造的 canonical 计划与验收锚点。

## 状态

- 当前阶段：Stage 1（进行中）。
- 关联 PR：本 spec 与全部 stage 改动进入同一个 PR（Stage 1 段 2 创建）。**Stage 3 完成且 README/contract 重新对齐前，PR 必须保持 Draft 状态，禁止 merge。**
- 分支：`codex/relay-generality`，base = 分支创建时的 main tip（round-06 handoff 提交 `7629293`）。
- transport 基线参照：PR#1 merge 点 `43c33e4`（producer 已验证可用的 completion detection + 单条 PR-comment 指令版本）。

## 目标

让 relay 满足两条通用性，且不破坏已验证流程：

1. 不绑死 producer 仓库：companion 仓库自身、以及任意外部仓库，都能仅凭 README + 本仓库 helper 范例完成安装、配置、首次 review。
2. 不绑死"靠 GitHub PR comment 做 web→repo 交接"：除 PR-comment 模式外，支持"无 PR + 对话内长评审"模式，verdict 经 relay `assistant_output` 回传即为正式结论。

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
- 非范围：不重写 MCP server / job store / native bridge 的核心契约；不改 relay-export schema；不引入云端依赖；不动 producer 仓库。

## Stage 表

| Stage | 目标 | 主要产物 | 是否动传输代码 | 验收标准 |
|---|---|---|---|---|
| 1 | 用 PR-comment 模式跑通一次 review-fix | 新分支 + draft PR + transport 回退基线 + 本 spec 骨架 + ≥1 轮有效 verdict | 否（回退，不新写） | relay 捕到短确认（`TURN_IDLE` 且 `assistant_output` 非空）+ GitHub readback 到 PR comment 或对话 verdict |
| 2 | 让 companion 成为可照搬范例（框架） | conventions/AGENTS/workflow 对齐 producer 范本 + handoff cleanup 规则 + helper 校验 | 否 | 文档自洽、路由闭合、helper `relay-export` 自检通过、中英 README 同步 |
| 3 | 通用化：无 PR + 对话内长评审 | 新 envelope 指令 + 重写的 completion detection + targeted tests | 是 | 无 open PR 场景下端到端跑通 + 不回归 PR-comment 模式 + tests 绿 |

## 关键不变量（跨 stage 必须保持）

- trigger envelope 仅含 6 个动态定位字段 + 固定指令，**绝不内嵌 handoff 正文**；reviewer 凭 `Path` 与 `reviewed head` 在远端读 commit / handoff。开源仓库经 commit 取证是不可动摇的基础。
- `target_pr` 必须指向**当前 open、正在审的 PR**，`reviewed_head` 落在该 PR 的 diff 作用域内；不得指向已 merge 的 PR。**注意**：此检查是 **caller-side orchestration preflight**（由 Repo Agent 在触发 `request_review` 前经 GitHub API 独立验证），**不是** native host / helper / transport 的 fail-closed 不变量。当前 `src/relay-contract.ts` 只验证 `target_pr` 是正整数、`reviewed_head` 是 40 字符 SHA 格式；remote PR-head equality 由 Repo Agent 负责。后续 stage 若需自动化此 preflight，应设计为独立的、具有 GitHub read capability 的层，不属于 localhost native host/helper。
- fail-closed（transport 层）：path escape / hash mismatch / detached HEAD / 缺 session，均中止于 dispatch 前。
- `TURN_IDLE` 只描述 transport 完成；verdict 的正式来源按模式声明——PR-comment 模式以 GitHub readback 为准，无 PR 模式以 `assistant_output` 为准（由 conventions 明确，不混淆）。
- handoff 路径正则、relay-export 必填字段与 `scope_sha256 == sha256(canonical_json(normalized_scope))` 约束不变。

## 授权与轮次（对齐 producer，不写无条件硬上限）

- 5 轮预算绑定 `authorization_class = preauthorized-dual-agent-gate|closeout`（无人值守防死循环的保护性预算）。
- `maintainer-attended` 模式无该固定上限，是否继续由 Maintainer 逐轮决定。
- 更换 review stream 不得绕过同一 unattended Stage 预算；transport retry / same-fingerprint retry / browser readback retry 不增加有效轮次。

## Stage 1 验收细节

- transport 文件 `extension/content.js`、`src/envelope.ts` 与基线 `43c33e4` 逐字节一致（`git diff 43c33e4 -- <files>` 为空）。
- 存在 open draft PR，`target_pr` = 该 PR 编号，`reviewed_head` = 分支 tip。
- 至少完成一轮：relay 返回 `TURN_IDLE` 且 `assistant_output` 非空（短确认），或 web agent 经 PR comment 给出可 readback 的 verdict。
- 若 web agent 给 `REQUEST CHANGES`，在该分支上修复并进入 round-02，最多 5 轮。

## 风险与回退

- 风险：基线 1500ms 在 PR-comment 模式下若 web agent 对话确认偏长，仍可能截断——若发生，单独诊断，不在 Stage 1 改 content.js。
- 回退：Stage 1 改动全在新分支，main 历史不受影响；若 Stage 3 的 completion detection 重写失败，可保留 PR-comment 模式为唯一支持模式并在 README 标注限制。

## 参考

- producer 仓库 `docs/workflows/web_agent_stage_gate.md`（流程契约，结构参考）。
- producer 仓库 `docs/workflows/agent_conventions.md`（agent 约定范本，结构参考）。
- 本仓库 `docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md`、`AGENTS.md`（Stage 2 将据此对齐 producer 范本）。
