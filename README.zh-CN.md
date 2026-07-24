# Codex Web Review Relay

<div align="right">

[English](README.md) | [中文](README.zh-CN.md)

</div>

本地 MCP 服务器 + Chrome 扩展：让编码 Agent（Codex 或任何 MCP 客户端）**一次工具调用即可触发 ChatGPT 对话中的正式代码评审**并等待结果——无需手动复制粘贴、无需浏览器自动化框架、无需评审模型的 API key。

## 为什么需要它

当你使用强大的 Web 端模型（如 ChatGPT 中的 GPT-5 Thinking）作为独立代码评审者时，通常的工作流是：

1. Agent 撰写评审请求文档（handoff）。
2. 你手动打开 ChatGPT，粘贴 handoff，等待评审结论。
3. 你把结论复制回 Agent。

本 relay 自动化了步骤 2-3，同时**你始终掌控全局**：你手动打开对话并在扩展弹窗中点击"Arm"。Relay 只负责填充输入框、点击发送、观察助手回复。它不会选择对话、读取历史，也不会在你未明确 Arm 的情况下执行任何操作。

## 架构

```
+-----------------------------------------------------------+
|  你的编码 Agent（Codex / 任何 MCP 客户端）                  |
|  调用: request_review(handoff_file)                       |
+-----------------------------+-----------------------------+
                              | Streamable HTTP（localhost，Bearer token）
                              v
+-----------------------------------------------------------+
|  Native Host（单 Node.js 进程）                            |
|  +-------------+  +-----------+  +----------------------+ |
|  | MCP Server  |  | Job Store |  | Native Messaging     | |
|  | /mcp        |  | (SQLite)  |  | Bridge               | |
|  +-------------+  +-----------+  +----------+-----------+ |
+---------------------------------------------+-------------+
                                              | Chrome Native Messaging
                                              v
+-----------------------------------------------------------+
|  Chrome 扩展（Manifest V3）                                |
|  +------------+  +----------------+  +------------------+ |
|  | 弹窗 (Arm) |  | Background SW  |  | Content Script   | |
|  +------------+  +----------------+  +------------------+ |
+-----------------------------------------------------------+
                                              |
                                              v
                                  ChatGPT 对话标签页
                                  （由你手动打开）
```

**单进程**：Chrome 通过 Native Messaging 启动 native host。同一进程持有 MCP 服务器、SQLite job store 和 native bridge。无守护进程、无 Docker、无云端。

安装面向本机用户，而不是某个仓库。每次请求提供一个绝对 `handoff_file`，relay 为该请求解析 Git root 和本地 `origin` slug。当前版本仍是 single-active-job：不同仓库可以顺序复用，但不支持队列或并发 reviewer conversation。

Reviewer 可见的 envelope 按 mode 分为两套逐字冻结合同。PR mode 使用：

```text
Repository: owner/name
Path: .agent/review_handoffs/...
full Ref: refs/heads/...
Reviewed head: ...
Review stream: ...
Effective round: ...
Package kind: ...
```

Commit-only mode 在 `Path:` 后立即插入 `Target kind: commit` 与 `Target ID: ...`；其余字段的拼写和顺序保持不变。两套合同都不包含本机绝对路径。

## 快速开始

### 前置条件

- **Node.js >= 24**（使用 `--experimental-strip-types` 原生运行 TypeScript）
- **Chrome**（任何支持 Manifest V3 + Native Messaging 的近期版本）
- **Python**（用于仓库侧的 `relay-export` helper；见“集成”章节）
- **Python dev dependencies**（schema 测试需要，执行 `python -m pip install -r requirements-dev.txt`）
- **Windows**（安装器基于 PowerShell；Linux/macOS 适配直接但尚未脚本化）

### 平台与账号依赖

Relay 本身是**纯 localhost 传输**——无云端依赖，relay 进程从不联系 GitHub 或任何远程服务。端到端评审工作流有两层外部依赖：

**第一层——Relay 传输（始终需要，零外部依赖）：**
Relay 进程通过 MCP 通道（`assistant_output` + SHA-256）返回传输完成结果。正式结论来源取决于 target mode：PR mode 必须从 PR comment readback；commit-only relay-only mode 使用 reviewer 返回的完整 `assistant_output`。Relay 进程本身没有网络出口。

Transport diagnostics 由 native host 写入安装时配置的固定 `diagnosticLogPath`（默认安装为 `review-relay.events.jsonl`）。`diagnosticLogLevel` 可设为 `off`、`error`、`info`、`debug` 或 `trace`；大小与保留数由 `diagnosticLogMaxBytes`、`diagnosticLogRetainedFiles` 控制。默认 `info` 会保留每个 lifecycle request、native delivery 与 ACK 边界。缓冲事件保留 source timestamp、sequence、event ID、binding generation 与 document identity；stale sender 会被拒绝，重复 event ID 在进程内及 query 时去重。Diagnostic queue 只在 correlated `DIAGNOSTIC_ACK` 明确返回 `persisted=true`（`appended` 或已持久化的 `duplicate`），或明确返回 terminal disposition `filtered` 后删除；缺失、false 或错误类型的 ACK 会保留 queued event。Diagnostic I/O 严格 best-effort，不得阻断 review lifecycle。Trigger acceptance 与 exact user-turn receipt 已解耦；防御窗口分别为 native trigger acceptance 30 秒、DOM receipt 60 秒。Review 失败后，应先按其 `job_id` 调用 `get_review_diagnostics` 再判断原因。日志只含经过审查的 primitive metadata、ID、长度和 hash，不记录 token、cookie、handoff/envelope 正文、完整 conversation 或 assistant output。

**第二层——GitHub PR comment 作为正式记录（可选）：**
对于 PR mode，PR comment 是正式结论记录，reviewer 必须发布并 read back。commit-only relay-only mode 不使用 PR comment，完整的 relay `assistant_output` 是其正式来源。无需 PR 的审计可通过保留 handoff 文件和 relay 的持久化 job 记录（SQLite）实现。

| 场景 | 需要 PR？ | 需要平台连接器？ | 说明 |
|------|----------|-----------------|------|
| commit-only relay 结论 | 否 | reviewer 仍需具备 reviewed commit/handoff 的读取权限 | 完整结论通过 MCP `assistant_output` 返回；公开仓库通常可由 Web 读取，私有仓库需要相应权限或预加载可信材料。 |
| PR comment（自动发布，任何仓库） | 是 | 是 | ChatGPT 必须绑定 [GitHub App](https://chatgpt.com/gpts) 连接器（或对应平台连接器）以读取 PR 内容并发布评论。公开仓库可通过网页读取，但自动发布评论仍需连接器。 |
| PR comment（手动） | 是 | 否 | 评审者在对话中回复，你手动将结论复制到 PR comment。无需连接器。 |

**可用性说明：** commit-only relay-only 正式结论现已一般可用。使用 `target_kind=commit`、稳定的 `target_id` 与 commit-only handoff path；完整 `assistant_output` 及其 SHA-256 构成正式结论记录。

**简言之：**
- **最小传输配置**：localhost relay 进程不需要平台账号；但 reviewer 仍需读取远端 commit 和 handoff，除非预先加载可信材料。
- **自动 PR comment**：将对应平台连接器（如 [GitHub App](https://chatgpt.com/gpts)）绑定到 ChatGPT 账号。无论公开/私有仓库，自动发布评论都需要连接器。
- **手动 PR comment**：无需连接器。评审者在对话中回复，你手动将结论复制到 PR comment。

**适配 GitLab/Gitee**：固定发布指令位于 `src/envelope.ts`（而非仓库侧 helper 中）。要适配其他平台，需修改 companion relay 源码中的 `FORMAL_REVIEW_PUBLICATION_INSTRUCTION`，并确保 Web 评审者对该平台具有读写访问能力。

### 1. 克隆本仓库

```powershell
git clone https://github.com/shanernerak-dev/codex-web-review-relay.git
cd codex-web-review-relay
```

### 2. 安装 native host

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay"
```

安装器会生成：
- 随机 48 字节 Bearer token
- 本机用户级 `relay.config.json` 与 relay-owned generic exporter
- 编译后的 launcher 可执行文件
- 注册到当前用户的 Chrome Native Messaging manifest
- `CODEX_WEB_REVIEW_RELAY_TOKEN` 用户环境变量

> **重要**：launcher 内嵌了当前 clone 中 `src/cli.ts` 的绝对路径。**安装后不要移动、重命名或删除本仓库 checkout。** 如需迁移，请在新路径重新运行安装器。

### 3. 使用 relay-owned exporter

安装器会将通用 exporter 复制到本机用户级安装目录。Native host 固定使用 `<config-directory>/relay_export_helper.py`，并且不再绑定某个仓库；每次请求根据绝对 handoff 文件解析仓库。

安装器会将 `scripts/tools/relay_export_helper.py` 的通用实现复制到安装目录。生成配置根据自身目录派生该固定路径：

```json
{
  "stateDbPath": "<USER_LOCAL_INSTALL_ROOT>/state.sqlite"
}
```

Native host 以 `python <config-directory>/relay_export_helper.py relay-export <repository-relative-handoff-path>` 形式调用 exporter，并将解析出的仓库设为 `cwd`。Exporter 必须：
- 接受 `relay-export` 作为第一个参数，仓库相对 handoff 路径作为第二个参数。
- 成功时：向 stdout 输出恰好一个 JSON 对象（relay-export schema）。
- 失败时：以非零退出码退出，并将稳定错误信息写入 stderr。

Exporter 由 relay 所有；仓库特定的 stage-gate 治理仍由 producer agent 负责，不安装到 native host 中。

### 已有仓库迁移

仓库自有 helper 不再属于 native-host 安装合同。重新运行一次安装器即可迁移到 relay-owned exporter：

```powershell
.\scripts\install-native-host.ps1 -InstallRoot <relay-install-root>
```

已有的 `relay.config.json` 不会被自动改写；将重装视为迁移时机。

### 4. 加载扩展

1. 打开 `chrome://extensions`
2. 启用**开发者模式**
3. 点击**加载已解压的扩展程序**，选择本仓库的 `extension/` 目录

扩展 ID 固定为：`kkdijpckhlminpolkllmmkldlljakfem`。

### 5. Arm 一个对话

1. 打开（或新建）你想用作评审者的 ChatGPT 对话。
2. 点击扩展图标，点击 **Arm**。
3. 弹窗确认会话已 Arm，并显示连接状态。

扩展同时只允许一个手动 Arm 的 ChatGPT 标签页和一个 active review job。第二次点击 **Arm** 返回 `SESSION_ALREADY_ARMED`；job active 时点击 **Arm** / **Disarm** 分别返回 `ACTIVE_JOB_ARM_FORBIDDEN` / `ACTIVE_JOB_DISARM_FORBIDDEN`。如果 armed 标签页关闭、导航、切换 conversation 或丢失 page binding，当前 job 报告 `SESSION_LOST`，extension 随即 Disarm；你必须在目标对话中手动重新 Arm。

评审期间，扩展会按 ChatGPT turn identity 增量提取目标 user turn 之后、下一个 user turn 之前的全部有序 assistant turns，而不是把当前页面上“最新的 assistant bubble”直接当作结果。只有目标 turn 集合完整且 native host 确认收到后，才会发送 `TURN_IDLE`。

### 6. 连接你的 MCP 客户端

> **重要**：安装器设置的是**用户级**环境变量（`CODEX_WEB_REVIEW_RELAY_TOKEN`）。已运行的终端、IDE 或 Codex 会话**不会**自动获取该变量——你需要打开新终端或重启客户端。

**Codex CLI**（`~/.codex/config.toml` 或项目级 `.codex/config.toml`）：

```toml
[mcp_servers.review-relay]
url = "http://127.0.0.1:43127/mcp"

[mcp_servers.review-relay.headers]
Authorization = "Bearer <在此粘贴你的 token>"
```

将 `<在此粘贴你的 token>` 替换为 `$env:CODEX_WEB_REVIEW_RELAY_TOKEN`（PowerShell）或 `%CODEX_WEB_REVIEW_RELAY_TOKEN%`（cmd）的值。Codex TOML 不支持环境变量插值。

**通用 MCP 客户端**（字段名因客户端而异；以下为 schema 示意，非可直接复制的配置）：

```json
{
  "mcpServers": {
    "review-relay": {
      "url": "http://127.0.0.1:43127/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**验证连通性**（在触发评审前）：

```powershell
$token = $env:CODEX_WEB_REVIEW_RELAY_TOKEN
Invoke-WebRequest -Uri "http://127.0.0.1:43127/health" -Headers @{Authorization="Bearer $token"}
```

返回 `200 OK` 且包含 `{"status":"ok",...}` 表示 relay 可达。如果连接失败，说明 native host 未运行——检查扩展是否已加载且 ChatGPT 标签页已 Arm。

### 7. 创建 handoff 文件并触发评审

在调用 relay 之前，先在预期路径创建 handoff 文件。最小内容：

```markdown
# Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#1`
Review scope: <评审者应关注的内容>

## Findings to review

<你的内容>
```

提交 handoff 文件（helper 会验证文件已 tracked 且与 HEAD 一致），然后从你的编码 Agent 调用：

```
request_review(handoff_file="C:\\path\\to\\repo\\.agent\\review_handoffs\\pr-1\\main\\round-01-review-request.md")
```

Relay 会将 trigger envelope 填入 ChatGPT 输入框、点击发送、等待助手完成回复，然后返回回复文本 + SHA-256。

## MCP 工具

| 工具 | 用途 |
|------|------|
| `request_review(handoff_file)` | 创建或恢复一个评审 job。按 fingerprint 幂等——重试同一 handoff 不会重复 dispatch。 |
| `get_review_transport_status(job_id 或 handoff_file)` | 无副作用地读取当前 job 阶段。checkout 移动或删除后仍可使用 `job_id` 查询。 |
| `recover_review(handoff_file, confirm_unsent=true)` | 终态 `MISMATCH` 后的一次性手动恢复。仅在确认原始消息确实未发送后使用。 |

### Job 生命周期

Phase 分为三类：

| 类别 | Phase | 说明 |
|------|-------|------|
| **Active** | `CREATED`、`DISPATCHED`、`USER_TURN_ACKED`、`ASSISTANT_STARTED` | 从 dispatch 到助手回复的正常推进。 |
| **Recovery** | `SESSION_LOST`、`SEND_UNCERTAIN`、`RECONCILING` | 连接丢失或发送歧义时的瞬态。Relay 在下一次相同 fingerprint 的 `request_review` 调用时自动尝试 reconciliation。 |
| **Terminal** | `TURN_IDLE`、`MISMATCH`、`TIMEOUT`、`BLOCKED` | 终态。`request_review` 对终态 job 立即返回。 |

```
CREATED -> DISPATCHED -> USER_TURN_ACKED -> ASSISTANT_STARTED -> TURN_IDLE
       \-> SESSION_LOST (recovery)       \-> RECONCILING (recovery)
       \-> SEND_UNCERTAIN (recovery)
       \-> MISMATCH (terminal)  \-> TIMEOUT (terminal)  \-> BLOCKED (terminal)
```

**可返回 phase**：`request_review` 可能返回任何终态 phase 以及 `SESSION_LOST` 和 `SEND_UNCERTAIN`（当等待切片在 recovery 完成前超时）。调用方应将 `SESSION_LOST` 和 `SEND_UNCERTAIN` 视为可重试——使用相同 handoff 再次调用 `request_review` 将触发自动 reconciliation。

**默认 formal-result 轮询**：确认 dispatch 成功且已观察到发送后，先为深度思考 reviewer 保留 10 分钟的结果观察窗口；仍未得到正式 verdict 时，再按每 5 分钟一次轮询服务端结果。这只是观察节奏，不是 timeout，也不允许因此重复 dispatch；必须保持同一 fingerprint 与 review round。

**同 fingerprint 重试**：幂等。如果 job 仍在 active，调用加入现有等待。如果已终态，立即返回存储的结果。

**手动恢复**：只有 `recover_review(handoff_file, confirm_unsent=true)` 才能在终态 `MISMATCH` 后重新 dispatch。这是一次性审计操作——仅在确认原始消息确实未发送后使用。

`TURN_IDLE` 表示浏览器传输结束。必须按 `target_kind` 分支处理正式结论：`pr` 的 `assistant_output` 只是短的 transport confirmation，Agent 必须 read back PR comment，并核对 actor、reviewed head 与 scope；`commit` 的 `assistant_output` 是完整正式结论，SHA-256 用于完整性校验。不要把 PR mode 的 `assistant_output` 当成正式结论解析。

## Review-Fix 轮次限制

Relay 本身不关心轮次——它只传输你给它的 handoff。轮次限制是**调用侧策略**：

```python
MAX_REVIEW_ROUNDS = 5

for round_num in range(1, MAX_REVIEW_ROUNDS + 1):
    handoff = create_handoff(round_num, kind="review-request" if round_num == 1 else "review-fix")
    result = mcp_call("request_review", handoff_file=handoff)
    if result["phase"] == "TURN_IDLE":
        if handoff.target_kind == "pr":
            verdict = read_github_verdict(pr=handoff.target_pr, reviewed_head=handoff.reviewed_head)
        else:
            verdict = parse_verdict(result["assistant_output"])
        if verdict == "PASS":
            break
    # ... 修复 findings，commit，进入下一轮
else:
    raise HumanDecisionRequired("评审预算已用尽")
```

每轮有唯一 fingerprint（轮次编号是 relay export 的一部分），因此 relay 天然防止同一轮的意外重复 dispatch。

## 在你的仓库中集成

Relay 内置一个**relay-owned exporter**，从 handoff 文件生成 `relay-export` JSON。Producer 仓库只需生成规范的 tracked handoff，不需要复制 helper 或注册仓库。

### Helper 必须做什么

给定一个 `handoff_path`（仓库相对 POSIX 路径），向 stdout 输出 JSON 对象：

```json
{
  "schema_version": {"major": 1, "minor": 1},
  "repository": "owner/repo",
  "target_kind": "pr",
  "target_id": "pr-42",
  "target_pr": 42,
  "handoff_path": ".agent/review_handoffs/pr-42/main/round-01-review-request.md",
  "handoff_sha256": "<handoff 文件在 HEAD 处的 sha256>",
  "full_ref": "refs/heads/my-branch",
  "reviewed_head": "<40 字符 HEAD sha>",
  "review_stream": "main",
  "effective_round": 1,
  "package_kind": "review-request",
  "normalized_scope": ["Stage B delivery"],
  "scope_sha256": "<normalized_scope 的 canonical JSON 的 sha256>"
}
```

### 最小 helper 实现

Native host 以如下形式调用 helper：

```
python <config-directory>/relay_export_helper.py relay-export <handoff_path>
```

Helper 成功时必须向 stdout 输出恰好一个 JSON 对象；失败时以非零退出码退出，并将稳定错误信息写入 stderr。

Relay-owned exporter 位于 `scripts/tools/relay_export_helper.py`。最小合同：

1. 验证 handoff 路径匹配 `.agent/review_handoffs/pr-<N>/<stream>/round-<NN>-<kind>.md`（PR mode），或 `.agent/review_handoffs/review-<id>/<stream>/round-<NN>-<kind>.md`（commit-only mode）。
2. 确认文件已 tracked、已 commit、worktree 与 HEAD 一致。
3. 必须读取稳定 headers。PR mode 要求 `Target PR`；commit-only mode 要求 `Target kind: commit` 和 `Target ID`，并拒绝 PR target。`Review stream`、`Effective round`、`Package kind` 必须与 canonical path 一致；缺失、重复、格式错误或 mismatch 都必须拒绝，不能为缺失的 scope 提供 fallback。
4. 计算 SHA-256 哈希并输出 JSON。
5. 任何失败时以稳定 error code 非零退出（fail closed）。

**职责边界**：native host adapter 负责解析仓库并调用受信任的 relay-owned exporter；Exporter 负责解析 handoff header fields、验证 path/header 一致性、检查 Git 状态和计算哈希。Producer 特定的 stage-gate 检查仍在 relay 外部完成。

### Handoff 文件格式

Handoff 是你的 Agent 在请求评审前撰写的 Markdown 文件。最小内容：

```markdown
# Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#42`
Review scope: <评审者应关注的内容>

## Findings to review

<你的内容>
```

**Native host** 不解析 handoff 正文——它只消费 helper 产出的 relay-export JSON。**Helper** 负责解析和验证 handoff header fields。PR mode 保留六个动态字段和 PR-comment instruction；commit-only mode 额外携带 `Target kind` / `Target ID`，并要求将完整正式结论返回到 `assistant_output`，不要求 PR comment。

commit-only mode 的 handoff 格式：

```markdown
# Commit Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target kind: `commit`
Target ID: `review-security-audit`
Review scope: <评审者应关注的内容>

## Findings to review

<你的内容>
```

### 配置

编辑生成的 `relay.config.json`：

```json
{
  "listenHost": "127.0.0.1",
  "listenPort": 43127,
  "allowedOrigins": ["http://127.0.0.1:43127"],
  "bearerTokenPath": "<bearer-token.txt 路径>",
  "stateDbPath": "<state.sqlite 路径>",
  "pythonExecutable": "python",
  "nativeHostName": "dev.shanernerak.codex_web_review_relay",
  "extensionId": "kkdijpckhlminpolkllmmkldlljakfem",
  "requestWaitSliceMs": 300000,
  "turnDeadlineMs": 1800000
}
```

关键字段：
- Exporter 固定为 `<config-directory>/relay_export_helper.py`；runtime 会验证 `lstat`、`realpath` 及其位于 config directory 内。
- 每次请求提供一个绝对 `handoff_file`；relay 在不访问网络的前提下解析 Git root、tracked canonical relative path 和本地 `origin` 的 `owner/name`。
- `requestWaitSliceMs`：单次 MCP 调用最长等待时间，超时返回进行中状态（默认 5 分钟）。
- `turnDeadlineMs`：整个评审 turn 的硬截止时间（默认 30 分钟）。

## 可选：Stage Gate 治理

[Producer 仓库](https://github.com/David-JA/single-crystal-stress) 使用了正式的 Stage Gate 工作流，包含授权分类、tracked handoff 和多 stream 评审预算。**使用 relay 不需要这些。** Relay 只是传输层；治理策略完全在你的调用侧逻辑中。

如果你想要类似结构，参见：
- Producer 仓库的 `docs/workflows/web_agent_stage_gate.md`
- `authorization_class` / `advance_target` 模式（用于无人值守评审预算）

## 安全模型

- **仅 localhost**：服务器绑定 `127.0.0.1`；远程连接在 socket 层被拒绝。
- **Bearer token**：48 字节随机 token，存储在用户本地文件中，ACL 受限。
- **不存储凭据**：relay 从不持有 GitHub token、浏览器 cookie 或完整对话历史。
- **持久化数据**：SQLite job store（`stateDbPath`）保存 transport job 元数据、对话身份，以及每个已完成 job 的**最后一次捕获的助手回复**（`assistant_output` + SHA-256）。这是 Web 评审者的回复文本，不是完整聊天历史。卸载时数据库会被删除。
- **不选择对话**：relay 无法选择或切换对话。你手动 Arm 当前标签页。
- **Fail closed**：任何验证失败（路径逃逸、哈希不匹配、detached HEAD、缺少 session）都在 dispatch 前中止。

## 当前限制（MVP）

- 每个 native host 实例只服务单个仓库（配置是静态的）。
- 同一时间只有一个手动 Arm 的 ChatGPT 标签页和一个 active job；不会自动切换标签页或 conversation。
- 仅 Windows 安装器（Linux/macOS 需手动注册 Native Messaging manifest）。
- 仅 ChatGPT Web 端（无 API、无其他聊天平台）。
- 完整 `npm test` 存在已知的 Node test runner + Native Messaging stdin open-handle 问题；targeted suite 正常通过。

## 开发

```powershell
# 安装 published-schema 测试使用的已固定版本 Python 依赖
python -m pip install -r requirements-dev.txt

# 运行 targeted 测试
npx tsx --test test/job-store.test.ts test/review-transport.test.ts

# 兼容性检查（需要 producer 仓库 checkout）
npm run test:compat

# Native host 冒烟测试（安装后使用实际 compiled launcher）
npm run smoke:native -- --launcher "$env:LOCALAPPDATA\codex-web-review-relay\codex-web-review-relay.exe"
```

## 卸载

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay" -Remove
```

然后从 `chrome://extensions` 移除扩展。

## 许可证

MIT。详见 [LICENSE](LICENSE)。

第三方架构参考在 clean-room / behavior-reference 策略下审计。详见 `docs/reference-architecture-audit.md` 中的来源和许可证边界结论。未复制任何 AGPL 源码。
