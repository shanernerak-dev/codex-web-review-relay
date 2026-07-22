# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `5`
Target PR: `#1`
Review scope: 公开仓库 README 文档质量评审（第五轮，含修复前后对比）

## 背景

本仓库（`shanernerak-dev/codex-web-review-relay`）是公开 GitHub 仓库。README 包含英文主体（`README.md`）和完整中文翻译（`README.zh-CN.md`）。

## Round 3 findings 修复验证

以下是 Round 3 的 8 个 findings 及本轮修复的具体内容。请逐项验证修复是否充分。

### F-README-001 — Quick Start 与 helper 合同不闭合

**修复前**：Quick Start 步骤 2 安装后直接跳到加载扩展，未提及 helper 配置。

**修复后**（Quick Start 步骤 3 新增内容）：
```
### 3. Configure the relay-export helper

The installer sets `helperPath` in `relay.config.json` to
`scripts/tools/check_stage_gate_readiness.py` (the producer repository's
helper). **You must update this to point at your own helper.**

...

The native host invokes the helper as
`python <helperPath> relay-export <handoff_path>`. Your helper must:
- Accept `relay-export` as the first argument and a repo-relative
  handoff path as the second.
- On success: output exactly one JSON object to stdout (the relay-export
  schema).
- On failure: exit non-zero with a stable error code on stderr.
```

Integration 章节也新增了 CLI 调用形式和职责边界说明。

### F-README-002 — 平台依赖过度承诺

**修复前**：表格中"公开仓库 PR comment"行标注"Platform connector required? = No"。

**修复后**：
```
| PR comment (automated, any repo) | Yes | Yes | ChatGPT must have the
  GitHub App connector (or equivalent) bound to read PR content and post
  comments. Public repos can be read via web, but automated comment
  posting still requires the connector. |
| PR comment (manual) | Yes | No | Reviewer reads the PR via web and you
  manually copy the verdict to a PR comment. No connector needed. |
```

新增适配说明：
```
**Adapting to GitLab/Gitee**: the fixed publication instruction lives in
`src/envelope.ts` (not in the repository-side helper). To target a
different platform, modify `FORMAL_REVIEW_PUBLICATION_INSTRUCTION` in the
companion relay source and ensure the web reviewer has read/write access
to that platform.
```

### F-README-003 — MCP 配置不可执行

**修复前**：仅提供通用 JSON 示例，声称适用于"Codex project config"。

**修复后**：
- 新增 Codex CLI TOML 示例（`[mcp_servers.review-relay]`）
- JSON 示例标注为"通用示意，字段名因客户端而异"
- 新增环境变量重启说明："已运行的终端、IDE 或 Codex 会话不会自动获取该变量"
- 新增 `/health` 验证步骤

### F-README-004 — Job lifecycle 遗漏恢复状态

**修复前**：仅显示主路径 + 3 个终态的 ASCII 图。

**修复后**：替换为三分类表格：
```
| Active    | CREATED, DISPATCHED, USER_TURN_ACKED, ASSISTANT_STARTED |
| Recovery  | SESSION_LOST, SEND_UNCERTAIN, RECONCILING |
| Terminal  | TURN_IDLE, MISMATCH, TIMEOUT, BLOCKED |
```

新增说明：可返回 phase、同 fingerprint 重试语义、手动恢复约束。

### F-README-005 — Helper 职责边界不准确

**修复前**：使用"frontmatter"一词；"relay does not parse the handoff body"未区分 native host 和 helper。

**修复后**：
- `frontmatter` → `header fields`
- 明确："The **native host** does not parse the handoff body — it only hashes the file and consumes the relay-export JSON produced by the helper. The **helper** is responsible for parsing and validating the handoff header fields."

### F-README-006 — Security Model 未披露持久化内容

**修复前**："No credentials stored: the relay never holds GitHub tokens, cookies, or chat history."

**修复后**：新增条目：
```
- **Persisted data**: the SQLite job store (`stateDbPath`) saves transport
  job metadata, conversation identity, and the **last captured assistant
  response** (`assistant_output` + SHA-256) for each completed job. This
  is the web reviewer's reply text, not the full chat history. The
  database is deleted on uninstall.
```

### F-README-007 — 安装依赖原始 checkout

**修复前**：未提及 launcher 内嵌绝对路径。

**修复后**：安装步骤后新增警告：
```
> **Important**: the launcher embeds the absolute path to `src/cli.ts`
> in the current clone. **Do not move, rename, or delete this repository
> checkout after installation.** If you need to relocate it, re-run the
> installer with the new path.
```

### F-README-008 — Popup lease timer 描述

**修复前**："The popup confirms the session is active with a lease timer."

**修复后**："The popup confirms the session is armed and shows connection status."

## 评审要求

请基于上述修复前后对比和你的预读上下文，逐项确认：

1. 每个 finding 是否已在修复后得到充分解决
2. 修复是否引入了新的不一致或错误
3. 中英一致性是否保持（所有修复均同步应用于 README.md 和 README.zh-CN.md）

## 输出格式

- Verdict: `PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 逐项 disposition（ACCEPTED / STILL_OPEN / NEW_FINDING）
- 如全部 ACCEPTED 且无 NEW_FINDING，verdict 为 PASS

## 注意事项

- 本轮评审**只审 README 文档质量**。
- 评审结论通过 relay MCP 通道回传即可。
- 评审语言：中文或英文均可。
