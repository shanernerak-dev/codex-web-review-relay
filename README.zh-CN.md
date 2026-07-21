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
|  调用: request_review(handoff_path)                       |
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

## 快速开始

### 前置条件

- **Node.js >= 24**（使用 `--experimental-strip-types` 原生运行 TypeScript）
- **Chrome**（任何支持 Manifest V3 + Native Messaging 的近期版本）
- **Python**（用于仓库侧的 `relay-export` helper；见"集成"章节）
- **Windows**（安装器基于 PowerShell；Linux/macOS 适配直接但尚未脚本化）

### 平台与账号依赖

Relay 本身是**纯 localhost 传输**——无云端依赖，relay 进程从不联系 GitHub 或任何远程服务。但端到端评审工作流有外部依赖：

| 层级 | 依赖 | 说明 |
|------|------|------|
| 正式结论载体 | 具备 **PR + 评论** 功能的代码托管平台 | 默认为 GitHub（trigger envelope 固定指令为"publish as a GitHub PR comment"）。如需适配 GitLab/Gitee，修改 helper 中的固定指令即可。 |
| 评审者读取 PR | Web 评审者（ChatGPT）必须能**访问 PR 内容** | 公开仓库：无需特殊配置，评审者可通过网页读取。私有仓库：ChatGPT 账号必须绑定 **GitHub App 连接器**（或对应平台连接器），使评审者能读取私有 diff 并发布评论。 |
| 评审者发布结论 | 同上 | 评审者将正式结论写为 PR comment，需要对目标仓库 PR 的写权限。 |
| Relay 传输层 | 无（localhost） | 无 API key、无云端账号、relay 进程无网络出口。 |

**简言之：**
- **开源 / 公开仓库**：适用于任何具备 PR + 评论功能的平台（GitHub、GitLab、Gitee 等）。除评审者已有的访问能力外，无需额外账号绑定。
- **GitHub 私有仓库**：需要 ChatGPT/GPT 账号启用 [GitHub App](https://chatgpt.com/gpts) 连接器，使 Web 评审者能访问私有 PR 内容并发布结论评论。
- **其他平台的私有仓库**：需要对应的连接器或评审者的手动访问路径。

### 1. 克隆本仓库

```powershell
git clone https://github.com/shanernerak-dev/codex-web-review-relay.git
cd codex-web-review-relay
```

### 2. 安装 native host

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay" `
  -RepositoryRoot "C:\path\to\your\repository"
```

安装器会生成：
- 随机 48 字节 Bearer token
- 指向你仓库的 `relay.config.json`
- 编译后的 launcher 可执行文件
- 注册到当前用户的 Chrome Native Messaging manifest
- `CODEX_WEB_REVIEW_RELAY_TOKEN` 用户环境变量

### 3. 加载扩展

1. 打开 `chrome://extensions`
2. 启用**开发者模式**
3. 点击**加载已解压的扩展程序**，选择本仓库的 `extension/` 目录

扩展 ID 固定为：`kkdijpckhlminpolkllmmkldlljakfem`。

### 4. Arm 一个对话

1. 打开（或新建）你想用作评审者的 ChatGPT 对话。
2. 点击扩展图标，点击 **Arm**。
3. 弹窗确认会话已激活，并显示 lease 计时器。

### 5. 连接你的 MCP 客户端

在 Codex 项目配置（或任何 MCP 客户端配置）中：

```json
{
  "mcpServers": {
    "review-relay": {
      "url": "http://127.0.0.1:43127/mcp",
      "headers": {
        "Authorization": "Bearer ${CODEX_WEB_REVIEW_RELAY_TOKEN}"
      }
    }
  }
}
```

### 6. 触发评审

从你的编码 Agent 调用：

```
request_review(handoff_path=".agent/review_handoffs/pr-1/main/round-01-review-request.md")
```

Relay 会将 trigger envelope 填入 ChatGPT 输入框、点击发送、等待助手完成回复，然后返回回复文本 + SHA-256。

## MCP 工具

| 工具 | 用途 |
|------|------|
| `request_review(handoff_path)` | 创建或恢复一个评审 job。按 fingerprint 幂等——重试同一 handoff 不会重复 dispatch。 |
| `get_review_transport_status(job_id 或 handoff_path)` | 无副作用地读取当前 job 阶段。只接受一个 lookup key。 |
| `recover_review(handoff_path, confirm_unsent=true)` | 终态 `MISMATCH` 后的一次性手动恢复。仅在确认原始消息确实未发送后使用。 |

### Job 生命周期

```
CREATED -> DISPATCHED -> USER_TURN_ACKED -> ASSISTANT_STARTED -> TURN_IDLE（完成）
                                                              \-> MISMATCH（终态）
                                                              \-> TIMEOUT（终态）
                                                              \-> BLOCKED（终态）
```

`TURN_IDLE` 表示浏览器传输结束。它**不代表**评审结论已最终确认——你的 Agent 仍需读取 GitHub PR comment/review 获取正式记录。

## Review-Fix 轮次限制

Relay 本身不关心轮次——它只传输你给它的 handoff。轮次限制是**调用侧策略**：

```python
MAX_REVIEW_ROUNDS = 5

for round_num in range(1, MAX_REVIEW_ROUNDS + 1):
    handoff = create_handoff(round_num, kind="review-request" if round_num == 1 else "review-fix")
    result = mcp_call("request_review", handoff_path=handoff)
    if result["phase"] == "TURN_IDLE":
        verdict = read_github_verdict()  # 你的 Agent 读取正式记录
        if verdict == "PASS":
            break
    # ... 修复 findings，commit，进入下一轮
else:
    raise HumanDecisionRequired("评审预算已用尽")
```

每轮有唯一 fingerprint（轮次编号是 relay export 的一部分），因此 relay 天然防止同一轮的意外重复 dispatch。

## 在你的仓库中集成

Relay 需要一个**仓库侧 helper**，从 handoff 文件生成 `relay-export` JSON。这是你需要在仓库中添加的唯一代码。

### Helper 必须做什么

给定一个 `handoff_path`（仓库相对 POSIX 路径），向 stdout 输出 JSON 对象：

```json
{
  "schema_version": {"major": 1, "minor": 0},
  "repository": "owner/repo",
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

完整参考实现见 [producer 仓库](https://github.com/David-JA/single-crystal-stress) 的 `scripts/tools/check_stage_gate_readiness.py relay-export`。最小合同：

1. 验证 handoff 路径匹配 `.agent/review_handoffs/pr-<N>/<stream>/round-<NN>-<kind>.md`。
2. 确认文件已 tracked、已 commit、worktree 与 HEAD 一致。
3. 从路径读取 PR 编号、stream、round、kind；从 handoff frontmatter 读取 scope。
4. 计算 SHA-256 哈希并输出 JSON。
5. 任何失败时以稳定 error code 非零退出（fail closed）。

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

Relay 不解析 handoff 正文——只做哈希。发送给 ChatGPT 的 trigger envelope 包含 path、ref、head、stream、round、kind，以及一条要求将结论发布为 GitHub PR comment 的固定指令。

### 配置

编辑生成的 `relay.config.json`：

```json
{
  "listenHost": "127.0.0.1",
  "listenPort": 43127,
  "allowedOrigins": ["http://127.0.0.1:43127"],
  "bearerTokenPath": "<bearer-token.txt 路径>",
  "stateDbPath": "<state.sqlite 路径>",
  "repositoryRoot": "<你的仓库绝对路径>",
  "pythonExecutable": "python",
  "helperPath": "scripts/tools/your_relay_export_helper.py",
  "nativeHostName": "dev.shanernerak.codex_web_review_relay",
  "extensionId": "kkdijpckhlminpolkllmmkldlljakfem",
  "requestWaitSliceMs": 300000,
  "turnDeadlineMs": 900000
}
```

关键字段：
- `repositoryRoot`：你的仓库绝对路径。Helper 以此为 cwd 运行。
- `helperPath`：仓库相对路径，指向你的 relay-export helper。
- `requestWaitSliceMs`：单次 MCP 调用最长等待时间，超时返回进行中状态（默认 5 分钟）。
- `turnDeadlineMs`：整个评审 turn 的硬截止时间（默认 15 分钟）。

## 可选：Stage Gate 治理

[Producer 仓库](https://github.com/David-JA/single-crystal-stress) 使用了正式的 Stage Gate 工作流，包含授权分类、tracked handoff 和多 stream 评审预算。**使用 relay 不需要这些。** Relay 只是传输层；治理策略完全在你的调用侧逻辑中。

如果你想要类似结构，参见：
- Producer 仓库的 `docs/workflows/web_agent_stage_gate.md`
- `authorization_class` / `advance_target` 模式（用于无人值守评审预算）

## 安全模型

- **仅 localhost**：服务器绑定 `127.0.0.1`；远程连接在 socket 层被拒绝。
- **Bearer token**：48 字节随机 token，存储在用户本地文件中，ACL 受限。
- **不存储凭据**：relay 从不持有 GitHub token、cookie 或聊天历史。
- **不选择对话**：relay 无法选择或切换对话。你手动 Arm 当前标签页。
- **Fail closed**：任何验证失败（路径逃逸、哈希不匹配、detached HEAD、缺少 session）都在 dispatch 前中止。

## 当前限制（MVP）

- 每个 native host 实例只服务单个仓库（配置是静态的）。
- 同一时间只有一个活跃 session 和一个活跃 job。
- 仅 Windows 安装器（Linux/macOS 需手动注册 Native Messaging manifest）。
- 仅 ChatGPT Web 端（无 API、无其他聊天平台）。
- 完整 `npm test` 存在已知的 Node test runner + Native Messaging stdin open-handle 问题；targeted suite 正常通过。

## 开发

```powershell
# 运行 targeted 测试
npx tsx --test test/job-store.test.ts test/review-transport.test.ts

# 兼容性检查（需要 producer 仓库 checkout）
npm run test:compat

# Native host 冒烟测试（需要 Chrome + 已加载扩展）
npm run smoke:native
```

## 卸载

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay" `
  -RepositoryRoot "C:\path\to\your\repository" `
  -Remove
```

然后从 `chrome://extensions` 移除扩展。

## 许可证

MIT。详见 [LICENSE](LICENSE)。

第三方架构参考在 clean-room / behavior-reference 策略下审计。详见 `docs/reference-architecture-audit.md` 中的来源和许可证边界结论。未复制任何 AGPL 源码。
