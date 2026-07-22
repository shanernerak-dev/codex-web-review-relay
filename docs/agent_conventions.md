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
  - formal verdict source 由 workflow mode 声明：在 Stage 3 relay-only contract 完成并验收前，Stage 1/Stage 2 的 v1 PR-comment mode 均以目标 PR comment readback 为正式来源，`assistant_output` 只作为非空短确认；Stage 3 relay-only mode 完成并验收后，才可将完整 `assistant_output` 作为正式结论，PR comment 在该模式下可选。
  - **envelope 构成**：6 个动态字段 `handoff_path` / `full_ref` / `reviewed_head` / `review_stream` / `effective_round` / `package_kind` + Stage 1/Stage 2 v1 PR-comment mode 的固定 PR-publication instruction。该 instruction 要求 reviewer 将 formal verdict 发布到目标 PR comment；Stage 3 relay-only contract 验收后才可改为或增加对应的 assistant-output instruction。见 `src/envelope.ts`。
- **native host 不解析 handoff 正文**：只哈希文件并消费 helper 产出的 relay-export JSON。envelope **不提供正文兜底**——reviewer 必须经 `reviewed head` 在远端读 commit 与 handoff。

## 角色边界

| 角色 | 职责 | 不做什么 |
|---|---|---|
| repo agent | 写 handoff、commit、**push**、触发 `request_review`、解析 verdict、按 findings 改文档 | 不替 reviewer 下结论 |
| web reviewer | 读 `Path` + `reviewed head`、评审；Stage 1/Stage 2 的 v1 PR-comment mode 发布完整 formal verdict 到目标 PR comment 并回短确认，Stage 3 relay-only mode 验收后才可通过 `assistant_output` 回完整 verdict | 不依赖 envelope 内嵌正文 |
| native host | 校验 relay-export、哈希 handoff、dispatch、捕获 `assistant_output`、fail-closed | 不解析 handoff Markdown 语义 |
| repository helper | 解析 handoff header fields、校验 path/header/git 状态、算 hash、输出 relay-export JSON | 不接触浏览器 / 网络 |

## handoff 与 helper 合同

- **handoff 路径正则**（repo 相对，POSIX）：

  ```
  ^\.agent/review_handoffs/pr-[1-9][0-9]*/[a-z0-9][a-z0-9-]*/round-(?:0[1-9]|[1-9][0-9]+)-(review-request|review-fix|evidence-amendment|human-decision)\.md$
  ```

- **relay-export 必填字段**：`schema_version`、`repository`、`target_pr`、`handoff_path`、`handoff_sha256`、`full_ref`、`reviewed_head`、`review_stream`、`effective_round`、`package_kind`、`normalized_scope`、`scope_sha256`。约束：`scope_sha256 == sha256(canonical_json(normalized_scope))`。见 `src/relay-contract.ts`。
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
- **`TURN_IDLE`**：表示浏览器 transport completion。Stage 1/Stage 2 的 `assistant_output` 只应是非空短确认，formal verdict 必须从目标 PR comment readback；只有 Stage 3 relay-only mode 实现并验收后，`assistant_output` 才可作为正式结论。

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
