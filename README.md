# Codex Web Review Relay

<div align="right">

[English](README.md) | [中文](README.zh-CN.md)

</div>

A localhost-only MCP server + Chrome extension that lets a coding agent (Codex, or any MCP client) **trigger a formal code review in a ChatGPT conversation with one tool call**, then wait for the result — no manual copy-paste, no browser automation framework, no API key for the reviewer model.

> 本地 MCP 服务器 + Chrome 扩展：让编码 Agent（Codex 或任何 MCP 客户端）**一次工具调用即可触发 ChatGPT 对话中的正式代码评审**并等待结果——无需手动复制粘贴、无需浏览器自动化框架、无需评审模型的 API key。[完整中文文档 →](README.zh-CN.md)

## Why

When you use a powerful web-based model (e.g. GPT-5 Thinking in ChatGPT) as an independent code reviewer, the workflow is usually:

1. Agent writes a review-request document (handoff).
2. You manually open ChatGPT, paste the handoff, wait for the verdict.
3. You copy the verdict back to the agent.

This relay automates steps 2-3 while keeping **you in control**: you manually open the conversation and press "Arm" in the extension popup. The relay only fills the composer, clicks send, and watches for the assistant's response. It never selects conversations, reads history, or acts without your explicit arm.

## Architecture

```
+-----------------------------------------------------------+
|  Your coding agent (Codex / any MCP client)               |
|  calls: request_review(handoff_path)                      |
+-----------------------------+-----------------------------+
                              | Streamable HTTP (localhost, Bearer token)
                              v
+-----------------------------------------------------------+
|  Native Host (single Node.js process)                     |
|  +-------------+  +-----------+  +----------------------+ |
|  | MCP Server  |  | Job Store |  | Native Messaging     | |
|  | /mcp        |  | (SQLite)  |  | Bridge               | |
|  +-------------+  +-----------+  +----------+-----------+ |
+---------------------------------------------+-------------+
                                              | Chrome Native Messaging
                                              v
+-----------------------------------------------------------+
|  Chrome Extension (Manifest V3)                           |
|  +------------+  +----------------+  +------------------+ |
|  | Popup (Arm)|  | Background SW  |  | Content Script   | |
|  +------------+  +----------------+  +------------------+ |
+-----------------------------------------------------------+
                                              |
                                              v
                                  ChatGPT conversation tab
                                  (manually opened by you)
```

**Single process**: Chrome launches the native host via Native Messaging. The same process holds the MCP server, SQLite job store, and native bridge. No daemons, no Docker, no cloud.

## Quick Start

### Prerequisites

- **Node.js >= 24** (uses `--experimental-strip-types` for native TypeScript)
- **Chrome** (any recent version with Manifest V3 + Native Messaging support)
- **Python** (for the repository-side `relay-export` helper; see Integration)
- **Windows** (installer is PowerShell-based; Linux/macOS adaptation is straightforward but not yet scripted)

### 1. Clone this repository

```powershell
git clone https://github.com/shanernerak-dev/codex-web-review-relay.git
cd codex-web-review-relay
```

### 2. Install the native host

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay" `
  -RepositoryRoot "C:\path\to\your\repository"
```

This generates:
- A random 48-byte Bearer token
- A `relay.config.json` pointing at your repository
- A compiled launcher executable
- A Chrome Native Messaging manifest registered for the current user
- The `CODEX_WEB_REVIEW_RELAY_TOKEN` user environment variable

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory from this repo

The extension ID is fixed: `kkdijpckhlminpolkllmmkldlljakfem`.

### 4. Arm a conversation

1. Open (or create) a ChatGPT conversation you want to use as the reviewer.
2. Click the extension icon and click **Arm**.
3. The popup confirms the session is active with a lease timer.

### 5. Connect your MCP client

In your Codex project config (or any MCP client config):

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

### 6. Trigger a review

From your coding agent:

```
request_review(handoff_path=".agent/review_handoffs/pr-1/main/round-01-review-request.md")
```

The relay fills the ChatGPT composer with a trigger envelope, clicks send, waits for the assistant to finish, and returns the response text + SHA-256.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `request_review(handoff_path)` | Create or resume a review job. Idempotent by fingerprint — retrying the same handoff never dispatches twice. |
| `get_review_transport_status(job_id or handoff_path)` | Read current job phase without side effects. Exactly one lookup key. |
| `recover_review(handoff_path, confirm_unsent=true)` | One-shot manual recovery after a terminal `MISMATCH`. Only use after confirming the original message was never sent. |

### Job lifecycle

```
CREATED -> DISPATCHED -> USER_TURN_ACKED -> ASSISTANT_STARTED -> TURN_IDLE (completed)
                                                              \-> MISMATCH (terminal)
                                                              \-> TIMEOUT (terminal)
                                                              \-> BLOCKED (terminal)
```

`TURN_IDLE` means the browser transport finished. It does **not** mean the review verdict is final — your agent must still read the GitHub PR comment/review to get the formal record.

## Review-Fix Round Limiting

The relay itself is round-agnostic — it transports whatever handoff you give it. Round limiting is a **caller-side policy**:

```python
MAX_REVIEW_ROUNDS = 5

for round_num in range(1, MAX_REVIEW_ROUNDS + 1):
    handoff = create_handoff(round_num, kind="review-request" if round_num == 1 else "review-fix")
    result = mcp_call("request_review", handoff_path=handoff)
    if result["phase"] == "TURN_IDLE":
        verdict = read_github_verdict()  # your agent reads the formal record
        if verdict == "PASS":
            break
    # ... fix findings, commit, next round
else:
    raise HumanDecisionRequired("review budget exhausted")
```

Each round gets a unique fingerprint (round number is part of the relay export), so the relay naturally prevents accidental re-dispatch of the same round.

## Integration with Your Repository

The relay needs a **repository-side helper** that produces a `relay-export` JSON from a handoff file. This is the only code you need to add to your repo.

### What the helper must do

Given a `handoff_path` (repo-relative POSIX path), output a JSON object to stdout:

```json
{
  "schema_version": {"major": 1, "minor": 0},
  "repository": "owner/repo",
  "target_pr": 42,
  "handoff_path": ".agent/review_handoffs/pr-42/main/round-01-review-request.md",
  "handoff_sha256": "<sha256 of the handoff file at HEAD>",
  "full_ref": "refs/heads/my-branch",
  "reviewed_head": "<40-char HEAD sha>",
  "review_stream": "main",
  "effective_round": 1,
  "package_kind": "review-request",
  "normalized_scope": ["Stage B delivery"],
  "scope_sha256": "<sha256 of canonical JSON of normalized_scope>"
}
```

### Minimal helper implementation

See `scripts/tools/check_stage_gate_readiness.py relay-export` in the [producer repository](https://github.com/David-JA/single-crystal-stress) for a full reference implementation. The minimum contract:

1. Validate the handoff path matches `.agent/review_handoffs/pr-<N>/<stream>/round-<NN>-<kind>.md`.
2. Verify the file is tracked, committed, and worktree matches HEAD.
3. Read PR number, stream, round, kind from the path; read scope from the handoff frontmatter.
4. Compute SHA-256 hashes and output the JSON.
5. Exit non-zero with a stable error code on any failure (fail closed).

### Handoff file format

The handoff is a Markdown file your agent writes before requesting review. Minimum content:

```markdown
# Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#42`
Review scope: <what the reviewer should look at>

## Findings to review

<your content here>
```

The relay does not parse the handoff body — it only hashes it. The trigger envelope sent to ChatGPT contains the path, ref, head, stream, round, and kind, plus a fixed instruction to publish the verdict as a GitHub PR comment.

### Configuration

Edit the generated `relay.config.json`:

```json
{
  "listenHost": "127.0.0.1",
  "listenPort": 43127,
  "allowedOrigins": ["http://127.0.0.1:43127"],
  "bearerTokenPath": "<path to bearer-token.txt>",
  "stateDbPath": "<path to state.sqlite>",
  "repositoryRoot": "<absolute path to your repo>",
  "pythonExecutable": "python",
  "helperPath": "scripts/tools/your_relay_export_helper.py",
  "nativeHostName": "dev.shanernerak.codex_web_review_relay",
  "extensionId": "kkdijpckhlminpolkllmmkldlljakfem",
  "requestWaitSliceMs": 300000,
  "turnDeadlineMs": 900000
}
```

Key fields:
- `repositoryRoot`: your repo's absolute path. The helper runs with this as cwd.
- `helperPath`: repo-relative path to your relay-export helper.
- `requestWaitSliceMs`: max time one MCP call waits before returning in-progress (default 5 min).
- `turnDeadlineMs`: hard deadline for the entire review turn (default 15 min).

## Optional: Stage Gate Governance

The [producer repository](https://github.com/David-JA/single-crystal-stress) uses a formal Stage Gate workflow with authorization classifications, tracked handoffs, and multi-stream review budgets. **None of this is required to use the relay.** The relay is transport-only; governance policy lives entirely in your caller-side logic.

If you want similar structure, see:
- `docs/workflows/web_agent_stage_gate.md` in the producer repo
- The `authorization_class` / `advance_target` pattern for unattended review budgets

## Security Model

- **Localhost only**: server binds `127.0.0.1`; remote connections are rejected at the socket level.
- **Bearer token**: 48-byte random token, stored in a user-local file with restricted ACL.
- **No credentials stored**: the relay never holds GitHub tokens, cookies, or chat history.
- **No conversation selection**: the relay cannot choose or switch conversations. You arm the current tab manually.
- **Fail closed**: any validation failure (path escape, hash mismatch, detached HEAD, missing session) aborts before dispatch.

## Current Limitations (MVP)

- Single repository per native host instance (config is static).
- Single active session and single active job at a time.
- Windows-only installer (Linux/macOS needs manual Native Messaging manifest registration).
- ChatGPT web only (no API, no other chat platforms).
- Full `npm test` has a known open-handle issue with Node's test runner + Native Messaging stdin; targeted suites pass cleanly.

## Development

```powershell
# Run targeted tests
npx tsx --test test/job-store.test.ts test/review-transport.test.ts

# Compatibility check (requires producer repo checkout)
npm run test:compat

# Smoke test the native host (requires Chrome + extension loaded)
npm run smoke:native
```

## Uninstall

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot "$env:LOCALAPPDATA\codex-web-review-relay" `
  -RepositoryRoot "C:\path\to\your\repository" `
  -Remove
```

Then remove the extension from `chrome://extensions`.

## License

MIT. See [LICENSE](LICENSE) for details.

Third-party architecture references were audited under clean-room / behavior-reference policy. See `docs/reference-architecture-audit.md` for provenance and license boundary conclusions. No AGPL source was copied.
