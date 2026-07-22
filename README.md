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
- **Python dev dependencies** for the schema test (`python -m pip install -r requirements-dev.txt`)
- **Windows** (installer is PowerShell-based; Linux/macOS adaptation is straightforward but not yet scripted)

### Platform and Account Dependencies

The relay itself is **localhost-only transport** — it has no cloud dependency and never contacts GitHub or any remote service. The end-to-end review workflow has two layers of external dependency:

**Layer 1 — Relay transport (always required, zero external dependency):**
The relay process returns transport completion through the MCP channel (`assistant_output` + SHA-256). The formal verdict source depends on the target mode: PR mode requires PR-comment readback; the currently authorized Stage 3 commit-only pilot uses the complete `assistant_output` returned by the reviewer. The relay process itself has no network egress.

**Layer 2 — GitHub PR comment as formal record (optional):**
For PR mode, the PR comment is the formal verdict record and requires the reviewer to publish/read it back. It is optional only for an explicitly authorized commit-only acceptance pilot, where the complete relay `assistant_output` is the formal source for that gate. Auditability without a PR can be achieved by retaining the handoff file and the relay's persisted job record (SQLite).

| Scenario | PR required? | Platform connector required? | Notes |
|----------|-------------|------------------------------|-------|
| Commit-only relay verdict (Stage 3 pilot) | No | Reviewer still needs read access to the reviewed commit/handoff | In an explicitly authorized acceptance handoff, the complete verdict is returned via MCP `assistant_output`; public repositories may be readable on the web, while private repositories need matching access or preloaded trusted material. |
| PR comment (automated, any repo) | Yes | Yes | ChatGPT must have the [GitHub App](https://chatgpt.com/gpts) connector (or equivalent platform connector) bound to read PR content and post comments. Public repos can be read via web, but automated comment posting still requires the connector. |
| PR comment (manual) | Yes | No | Reviewer reads the PR via web and you manually copy the verdict to a PR comment. No connector needed. |

**Availability note:** commit-only relay-only formal verdicts are currently a Maintainer-authorized Stage 3 acceptance-review pilot in this repository. Treat the complete `assistant_output` as formal only for an explicitly authorized acceptance handoff; general repository use begins after Stage 3 acceptance.

**In short:**
- **Minimum transport setup**: no platform account is needed by the localhost relay process. The reviewer still needs to read the remote commit and handoff, unless trusted material is preloaded.
- **Automated PR comment**: bind the appropriate platform connector (e.g. [GitHub App](https://chatgpt.com/gpts)) to the ChatGPT account. Required for both public and private repos when you want the reviewer to post comments automatically.
- **Manual PR comment**: no connector needed. The reviewer responds in the conversation; you copy the verdict to a PR comment yourself.

**Adapting to GitLab/Gitee**: the fixed publication instruction lives in `src/envelope.ts` (not in the repository-side helper). To target a different platform, modify `FORMAL_REVIEW_PUBLICATION_INSTRUCTION` in the companion relay source and ensure the web reviewer has read/write access to that platform.

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

> **Important**: the launcher embeds the absolute path to `src/cli.ts` in the current clone. **Do not move, rename, or delete this repository checkout after installation.** If you need to relocate it, re-run the installer with the new path.

### 3. Configure the relay-export helper

The installer defaults `helperPath` in `relay.config.json` to `scripts/tools/relay_export_helper.py`, a repository-relative path for the generic helper example. Copy that helper into your target repository at this path, pass `-HelperPath` to the installer, or replace the value with your own repository helper.

If you don't have a helper yet, copy the minimal implementation from this repository at `scripts/tools/relay_export_helper.py` into your target repository. The generated config already uses this path:

```json
{
  "helperPath": "scripts/tools/relay_export_helper.py"
}
```

The native host invokes the helper as `python <helperPath> relay-export <handoff_path>`. Your helper must:
- Accept `relay-export` as the first argument and a repo-relative handoff path as the second.
- On success: output exactly one JSON object to stdout (the relay-export schema).
- On failure: exit non-zero with a stable error code on stderr.

Or create your own helper following the full contract in the [Integration](#integration-with-your-repository) section below.

### Existing repository migration

The generic default is for new installations. If an existing repository already owns a helper, re-run the installer with that repository-relative path so a reinstall does not replace it with the generic example. For the single-crystal producer, preserve its current helper with:

```powershell
.\scripts\install-native-host.ps1 -InstallRoot <relay-install-root> -RepositoryRoot C:\coding_projet\pwa1483_1d_scan_stress -HelperPath scripts/tools/check_stage_gate_readiness.py
```

An existing `relay.config.json` is not rewritten automatically; treat a reinstall or explicit config edit as a migration that must retain the producer's helper path.

### 4. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory from this repo

The extension ID is fixed: `kkdijpckhlminpolkllmmkldlljakfem`.

### 5. Arm a conversation

1. Open (or create) a ChatGPT conversation you want to use as the reviewer.
2. Click the extension icon and click **Arm**.
3. The popup confirms the session is armed and shows connection status.

During a review, the extension tracks the assistant response by the ChatGPT turn identity and incrementally harvests updates, rather than treating whichever assistant bubble is currently newest as the result. Do not click **Disarm** while a review is active; the popup returns `ACTIVE_JOB_DISARM_FORBIDDEN` until the job reaches a terminal or recovery state. A `TURN_IDLE` result is sent only after the target turn is complete and the native host acknowledges receipt.

### 6. Connect your MCP client

> **Important**: the installer sets a **user-level** environment variable (`CODEX_WEB_REVIEW_RELAY_TOKEN`). Already-running terminals, IDEs, or Codex sessions will **not** see it until you open a new terminal or restart the client.

**Codex CLI** (`~/.codex/config.toml` or project-level `.codex/config.toml`):

```toml
[mcp_servers.review-relay]
url = "http://127.0.0.1:43127/mcp"

[mcp_servers.review-relay.headers]
Authorization = "Bearer <paste-your-token-here>"
```

Replace `<paste-your-token-here>` with the value of `$env:CODEX_WEB_REVIEW_RELAY_TOKEN` (PowerShell) or `%CODEX_WEB_REVIEW_RELAY_TOKEN%` (cmd). Codex TOML does not support environment variable interpolation.

**Generic MCP client** (field names vary by client; this is a schema illustration, not a copy-paste config):

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

**Verify connectivity** before triggering a review:

```powershell
$token = $env:CODEX_WEB_REVIEW_RELAY_TOKEN
Invoke-WebRequest -Uri "http://127.0.0.1:43127/health" -Headers @{Authorization="Bearer $token"}
```

A `200 OK` with `{"status":"ok",...}` confirms the relay is reachable. If you get a connection error, the native host is not running — check that the extension is loaded and a ChatGPT tab is armed.

### 7. Create a handoff file and trigger a review

Before calling the relay, create a handoff file at the expected path. Minimum content:

```markdown
# Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#1`
Review scope: <what the reviewer should look at>

## Findings to review

<your content here>
```

Commit the handoff file (the helper verifies it is tracked and matches HEAD), then from your coding agent:

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

Phases are grouped into three categories:

| Category | Phases | Description |
|----------|--------|-------------|
| **Active** | `CREATED`, `DISPATCHED`, `USER_TURN_ACKED`, `ASSISTANT_STARTED` | Normal progression from dispatch to assistant response. |
| **Recovery** | `SESSION_LOST`, `SEND_UNCERTAIN`, `RECONCILING` | Transient states during connection loss or send ambiguity. The relay automatically attempts reconciliation on the next `request_review` call for the same fingerprint. |
| **Terminal** | `TURN_IDLE`, `MISMATCH`, `TIMEOUT`, `BLOCKED` | Final states. `request_review` returns immediately for terminal jobs. |

```
CREATED -> DISPATCHED -> USER_TURN_ACKED -> ASSISTANT_STARTED -> TURN_IDLE
       \-> SESSION_LOST (recovery)       \-> RECONCILING (recovery)
       \-> SEND_UNCERTAIN (recovery)
       \-> MISMATCH (terminal)  \-> TIMEOUT (terminal)  \-> BLOCKED (terminal)
```

**Returnable phases**: `request_review` may return any terminal phase plus `SESSION_LOST` and `SEND_UNCERTAIN` (when the wait slice expires before recovery completes). Callers should treat `SESSION_LOST` and `SEND_UNCERTAIN` as retriable — calling `request_review` again with the same handoff will trigger automatic reconciliation.

**Same-fingerprint retry**: idempotent. If the job is still active, the call joins the existing wait. If terminal, the stored result is returned immediately.

**Manual recovery**: only `recover_review(handoff_path, confirm_unsent=true)` can re-dispatch after a terminal `MISMATCH`. This is a one-shot, audited operation — use it only after confirming the original message was never sent.

`TURN_IDLE` means the browser transport finished. Branch formal-verdict handling by `target_kind`: for `pr`, `assistant_output` is only a short transport confirmation and the agent must read back the PR comment, checking actor, reviewed head, and scope; for `commit`, an explicitly authorized Stage 3 acceptance pilot treats `assistant_output` as the complete formal verdict and its SHA-256 as the integrity check. Do not parse PR-mode `assistant_output` as the formal verdict.

## Review-Fix Round Limiting

The relay itself is round-agnostic — it transports whatever handoff you give it. Round limiting is a **caller-side policy**:

```python
MAX_REVIEW_ROUNDS = 5

for round_num in range(1, MAX_REVIEW_ROUNDS + 1):
    handoff = create_handoff(round_num, kind="review-request" if round_num == 1 else "review-fix")
    result = mcp_call("request_review", handoff_path=handoff)
    if result["phase"] == "TURN_IDLE":
        if handoff.target_kind == "pr":
            verdict = read_github_verdict(pr=handoff.target_pr, reviewed_head=handoff.reviewed_head)
        else:
            verdict = parse_verdict(result["assistant_output"])
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
  "schema_version": {"major": 1, "minor": 1},
  "repository": "owner/repo",
  "target_kind": "pr",
  "target_id": "pr-42",
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

The native host invokes the helper as:

```
python <helperPath> relay-export <handoff_path>
```

The helper must output exactly one JSON object to stdout on success, or exit non-zero with a stable error message on stderr on failure.

See `scripts/tools/check_stage_gate_readiness.py relay-export` in the [producer repository](https://github.com/David-JA/single-crystal-stress) for a full reference implementation. This repository also includes a minimal helper at `scripts/tools/relay_export_helper.py`. The minimum contract:

1. Validate the handoff path matches `.agent/review_handoffs/pr-<N>/<stream>/round-<NN>-<kind>.md` (PR mode) or `.agent/review_handoffs/review-<id>/<stream>/round-<NN>-<kind>.md` (commit-only mode).
2. Verify the file is tracked, committed, and worktree matches HEAD.
3. Read and require the stable headers. PR mode requires `Target PR`; commit-only mode requires `Target kind: commit` and `Target ID` and rejects a PR target. `Review stream`, `Effective round`, and `Package kind` must match the canonical path; missing, duplicate, malformed, or mismatched values are rejected. Scope has no fallback.
4. Compute SHA-256 hashes and output the JSON.
5. Exit non-zero with a stable error code on any failure (fail closed).

**Responsibility boundary**: the native host does **not** parse handoff Markdown — it only consumes the validated relay-export JSON from the helper. The repository-side helper is responsible for parsing handoff header fields, validating path/header consistency, checking Git state, and computing hashes.

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

The **native host** does not parse the handoff body — it only consumes the validated relay-export JSON produced by the helper. The **helper** is responsible for parsing and validating the handoff header fields. PR mode keeps the six-field envelope and PR-comment instruction. The Stage 3 commit-only acceptance pilot adds `Target kind` / `Target ID` and instructs the reviewer to return the complete formal verdict in `assistant_output` without a PR comment; this becomes generally available only after Stage 3 acceptance.

Commit-only handoff format:

```markdown
# Commit Review Request

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target kind: `commit`
Target ID: `review-security-audit`
Review scope: <what the reviewer should look at>

## Findings to review

<your content here>
```

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
  "turnDeadlineMs": 1800000
}
```

Key fields:
- `repositoryRoot`: your repo's absolute path. The helper runs with this as cwd.
- `helperPath`: repo-relative path to your relay-export helper. The installer and native runtime reject absolute paths, parent traversal, and symlink-resolved paths outside `repositoryRoot`.
- `requestWaitSliceMs`: max time one MCP call waits before returning in-progress (default 5 min).
- `turnDeadlineMs`: hard deadline for the entire review turn (default 30 min).

## Optional: Stage Gate Governance

The [producer repository](https://github.com/David-JA/single-crystal-stress) uses a formal Stage Gate workflow with authorization classifications, tracked handoffs, and multi-stream review budgets. **None of this is required to use the relay.** The relay is transport-only; governance policy lives entirely in your caller-side logic.

If you want similar structure, see:
- `docs/workflows/web_agent_stage_gate.md` in the producer repo
- The `authorization_class` / `advance_target` pattern for unattended review budgets

## Security Model

- **Localhost only**: server binds `127.0.0.1`; remote connections are rejected at the socket level.
- **Bearer token**: 48-byte random token, stored in a user-local file with restricted ACL.
- **No credentials stored**: the relay never holds GitHub tokens, browser cookies, or full conversation history.
- **Persisted data**: the SQLite job store (`stateDbPath`) saves transport job metadata, conversation identity, and the **last captured assistant response** (`assistant_output` + SHA-256) for each completed job. This is the web reviewer's reply text, not the full chat history. The database is deleted on uninstall.
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
# Install the pinned Python dependency used by the published-schema test
python -m pip install -r requirements-dev.txt

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
