# v0.3.0

This is the first formal public GitHub Release of `codex-web-review-relay`.

## Highlights

- Installation is user-scoped instead of repository-scoped.
- MCP tools contract v2 uses an absolute `handoff_file`; the old `handoff_path` request input is not supported.
- Producer repositories no longer copy, register, or maintain a helper.
- The relay-owned exporter is installed automatically and resolves the repository from each handoff.
- One installation can be reused by different repositories sequentially.
- The relay still supports one manually armed reviewer conversation and one active job; queues and concurrent jobs remain unsupported.

## Breaking migration notes

- Re-run the v0.3.0 installer for every old repository-bound installation.
- Reinstalling rotates `CODEX_WEB_REVIEW_RELAY_TOKEN`; replace saved Authorization headers and restart existing client sessions.
- The Windows installer requires PowerShell 7, Node.js `>=24`, Python `>=3.10`, Git CLI, Chrome, and a system `csc.exe`.
- GitHub-generated source archives are not formal installation assets. Use the two release ZIPs and `SHA256SUMS.txt`.

## Assets

- `codex-web-review-relay-extension-v0.3.0.zip`
- `codex-web-review-relay-native-host-windows-v0.3.0.zip`
- `SHA256SUMS.txt`
