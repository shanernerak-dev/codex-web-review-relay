# Agent Conventions

> 面向 **agent** 的行为与契约约定，单一权威源。`README.md` / `README.zh-CN.md` 面向**用户**；二者保持一致，细节冲突时以**源码 + 本文件**为准，README 随之更新。本文件只写"红线 + 为什么 + 指针"，不重复 README 的用户向叙述。

## 权威源与受众

- 传输 / 校验行为权威：`src/*`、`contracts/*`。
- 用户向表述权威：`README.md`、`README.zh-CN.md`。
- agent 向契约权威：本文件。
- 流程权威：`docs/workflows/`。

## 传输契约

- **两层依赖**：
  - L1 relay transport：零外部依赖，负责返回 transport completion、`assistant_output` 与 SHA-256。
  - formal verdict source 由 workflow mode 声明：Stage 1/Stage 2 的 v1 PR-comment mode 以目标 PR comment readback 为正式来源，`assistant_output` 只作为非空短确认。Stage 3 acceptance review 期间，只有经 Maintainer 明确授权的 commit-only pilot 才以完整 `assistant_output` 作为本轮验收的 formal source；Stage 3 acceptance 后该规则才对一般调用生效，PR comment 在该模式下不适用。
  - **envelope 构成**：PR mode 保留 6 个动态字段 `handoff_path` / `full_ref` / `reviewed_head` / `review_stream` / `effective_round` / `package_kind` + PR-publication instruction；Stage 3 commit-only mode 在此基础上增加 `target_kind` / `target_id`，并使用 relay-only verdict instruction。两种 mode 都不内嵌 handoff 正文。见 `src/envelope.ts`。
- **native host 不解析 handoff 正文**：只哈希文件并消费 helper 产出的 relay-export JSON。envelope **不提供正文兜底**——reviewer 必须经 `reviewed head` 在远端读 commit 与 handoff。
- **PR fingerprint compatibility**：PR mode 的 fingerprint 保持 Stage 3 之前的字段序列 bit-for-bit；只有 commit-only identity 将 `target_kind` / `target_id` 纳入 fingerprint。升级时旧 PR terminal/active/MISMATCH job 必须继续命中同一 persisted row。
- **relay-only capability**：native host 可接受 v1.0 extension 的 PR mode，但 commit-only request 必须在创建新 job 前、恢复前以及 transition 到 `RECONCILING` / claim recovery send 前要求 `relay-only-v1` capability。缺少 capability 时不得留下新的 job 或改变现有 recovery 计数，并在任何 DOM write/click 前以 `RELAY_ONLY_EXTENSION_UNSUPPORTED` fail closed。

## 角色边界

| 角色 | 职责 | 不做什么 |
|---|---|---|
| repo agent | 写 handoff、commit、**push**、触发 `request_review`、解析 verdict、按 findings 改文档 | 不替 reviewer 下结论 |
| web reviewer | 读 `Path` + target identity + `reviewed head`、评审；PR mode 发布 formal verdict 到目标 PR comment 并回短确认，Maintainer-authorized Stage 3 commit-only pilot 直接回完整 verdict | 不依赖 envelope 内嵌正文 |
| native host | 校验 relay-export、哈希 handoff、dispatch、捕获 `assistant_output`、fail-closed | 不解析 handoff Markdown 语义 |
| repository helper | 解析 handoff header fields、校验 path/header/git 状态、算 hash、输出 relay-export JSON | 不接触浏览器 / 网络 |

## handoff 与 helper 合同

- **handoff 路径正则**（repo 相对，POSIX）：

  ```
  ^\.agent/review_handoffs/(?:pr-[1-9][0-9]*|review-[a-z0-9][a-z0-9-]*)/[a-z0-9][a-z0-9-]*/round-(?:0[1-9]|[1-9][0-9]+)-(review-request|review-fix|evidence-amendment|human-decision)\.md$
  ```

- **relay-export 必填字段**：`schema_version`、`repository`、`handoff_path`、`handoff_sha256`、`full_ref`、`reviewed_head`、`review_stream`、`effective_round`、`package_kind`、`normalized_scope`、`scope_sha256`；Stage 3 schema v1.1 另要求 `target_kind` / `target_id`，`target_pr` 仅在 PR mode 有值。v1.0 PR export 仍可由 consumer 推断 `target_kind=pr` 与 `target_id=pr-<N>`。约束：`scope_sha256 == sha256(canonical_json(normalized_scope))`。见 `src/relay-contract.ts` 与 `contracts/relay-export.schema.json`。
- **helper CLI**：`python <helperPath> relay-export <handoff_path>`，`cwd = repositoryRoot`。成功：stdout **仅一个** JSON 对象；失败：非零退出 + stderr 稳定错误码。见 `src/repo-adapter.ts`。
- **header fields 非 YAML frontmatter**：scope 等取自正文稳定 header 行（如 `Review scope:`），不要写成 frontmatter。

### Stage-scoped review round

- `Effective round` 的计数域是 `(Stage, review stream)`，不是整个 PR 或整个仓库。Stage 发生 transition 后，下一 Stage 必须从 `round-01` 重新开始。
- 同一 Stage 内，`round-01` 是 `review-request`；后续 `round-N`（`N > 1`）是该 Stage 的 `review-fix`。transport retry、same-fingerprint retry 和 readback retry 不增加有效 round。
- 当前 v1 handoff path 没有独立的 Stage segment；因此跨 Stage 必须使用带 Stage 作用域的 `Review stream`（例如 `stage2-main`），避免与上一 Stage 的 `main/round-01` identity 冲突。不得用跨 Stage 累计的 `round-05` 代替 Stage 2 的 `round-01`。
- 历史 handoff identity 保持 append-only；发现 round scope 错误时，创建新的 Stage-scoped handoff，不改写已评审 handoff 或其 GitHub comment。

## job 生命周期

| 类别 | phase |
|---|---|
| active | `CREATED`、`DISPATCHED`、`USER_TURN_ACKED`、`ASSISTANT_STARTED` |
| recovery | `SESSION_LOST`、`SEND_UNCERTAIN`、`RECONCILING` |
| terminal | `TURN_IDLE`、`MISMATCH`、`TIMEOUT`、`BLOCKED` |

- **可返回 phase**：terminal + `SESSION_LOST` + `SEND_UNCERTAIN`（等待切片在 recovery 完成前超时）。后两者视为可重试。
- **同 fingerprint 重试幂等**：active 则加入现有等待；terminal 则立即返回存储结果。
- **手动恢复**：仅 `recover_review(handoff_path, confirm_unsent=true)` 可在 terminal `MISMATCH` 后重 dispatch，一次性，须确认原消息未发送。
- **`TURN_IDLE`**：表示浏览器 transport completion。PR mode 的 `assistant_output` 只应是非空短确认，formal verdict 必须从目标 PR comment readback；commit-only relay-only mode 的 `assistant_output` 是正式结论，且只能在 dispatch 后新增 assistant turn 已按稳定 DOM identity 完整 harvest、存在可在 reconnect 后复核的 turn-level completion evidence（例如该 turn 的 copy action）、内容保持稳定，并收到 native ACK 后 terminalize。仅观察到一段稳定文本、或曾经观察到 generating，都不是充分证据。`assistant_output_sha256` 仅用于完整性与重试审计，不替代 turn identity。
- **commit-only transport gate 不允许 browser-readback 代替**：Stage 3 及其后续 relay-only review test 必须由 MCP result 返回完整 formal verdict（非空 `assistant_output`，并可核对首尾 anchor / SHA-256）。如果 web reviewer 页面已完成但 relay 未传回全文，repo agent 必须停止并请 Maintainer 人工转接；不得把 Chrome 页面 readback 当作该轮 transport acceptance。下一轮 handoff 必须将这次全文传输失败列为首要问题与验收项。
- **单绑定状态机**：extension 全局只允许一个 manually armed ChatGPT tab 和一个 active job。已 armed 时再次 Arm 返回 `SESSION_ALREADY_ARMED`；active job 期间 Arm / Disarm 分别返回 `ACTIVE_JOB_ARM_FORBIDDEN` / `ACTIVE_JOB_DISARM_FORBIDDEN`，不能覆盖或清除 `activeJobId`。armed tab 关闭、导航、conversation identity 改变或 page binding drift 时，旧 binding 立即停止接收 lifecycle；若有 active job则报告 `SESSION_LOST`，随后进入 `DISARMED` 并要求 manual re-arm。native port reconnect 只能恢复同一 persisted binding，不得隐式切换 tab、conversation 或 job。content script 收到 lifecycle `{ok:false}` 时不得停止 observer，必须继续重试或进入 recovery。
- **失败先取日志证据**：transport diagnostic event 由 extension/content script 经 Native Messaging 发送给 native host，并写入 config 指定的固定 JSONL 文件。默认 `info` 保留 request/native delivery/ACK 边界；buffered event 必须携带 source timestamp、sequence、event ID、binding generation 与 document identity。诊断 I/O 严格 best-effort，不得阻断 transport；stale sender 拒绝，重复 event ID 幂等。字段只允许合同声明的 primitive，禁止 nested object/array；不得写 bearer token、cookie、envelope/handoff 正文或完整对话/output。全文传输失败后先调用 `get_review_diagnostics(job_id=...)`，再决定修复；不得仅由 job phase 猜测 DOM、port 或 ACK 失败位置。

## 文档同步

- `README.md` 与 `README.zh-CN.md` **必须同步改**，不得只改英文。
- 术语对齐：helper vs native host；transport completion（`TURN_IDLE`）vs formal verdict；recovery phase vs terminal phase；relay-only verdict vs PR comment。

## 安全与持久化

- localhost 绑定；bearer 48 字节随机，受限 ACL 文件。
- 不存 GitHub token / cookie / 完整聊天历史。
- SQLite 持久化：job metadata、conversation identity、最后捕获的 `assistant_output` + SHA-256；卸载删除。
- fail-closed：path escape / hash mismatch / detached HEAD / 缺 session 均中止于 dispatch 前。
- launcher 内嵌当前 clone 的 `src/cli.ts` 绝对路径 → 安装后**不可移动 / 删除** checkout，迁移须重装。

## 编辑与验证纪律

- 改源不改派生（relay-export 输出是派生，不手改）。
- 最小充分验证：改 envelope / contract → 跑 helper `relay-export` 自检 + targeted tests；改 `extension/content.js` → 扩展重载 + arm 实测。
- 不擅自扩大范围，不顺手重构 / 格式统一。
- commit 保持单一范围。在用户已明确授权的 review/PR workflow 内，agent 可对范围受控且验证完成的改动直接 commit 和 push；merge / tag / branch deletion 仍需单独授权。
- **触发 review 前必须 push** reviewed head 与 handoff 到远端，否则 reviewer 404 → UNVERIFIED。
