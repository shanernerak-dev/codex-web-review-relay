# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `7`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-07 evidence-first transport diagnostics following the round-06 full-verdict delivery failure
Previous reviewed head: `8f6eaf9264249e26654167c797eb587ba592b5f0`
Implementation commit: `6990ec4a3af9d7746164d250977bfac0fd8998ac`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-06 full-verdict transfer failure

- Round 06 job `165cb388-4e40-437a-9d48-9ed884725961` remained `DISPATCHED`; the Web reviewer completed a full `REQUEST CHANGES` verdict, but MCP persisted neither `assistant_output` nor `assistant_output_sha256`, and no `TURN_IDLE` reached the repo agent.
- The Maintainer manually transferred that verdict. It kept `RGEN-S3-008`, `RGEN-S3-009`, and `RGEN-S3-010` open. This manual transfer is review evidence, not transport acceptance.
- The repo agent could not prove where the lifecycle stopped because the implementation had no correlated extension/content/native event log. Earlier phase-based root-cause statements were therefore inference, not evidence.
- This round must deliver its complete formal verdict through MCP. If it fails, the repo agent must query the new job-correlated diagnostics first, report the observed event boundary, and stop for Maintainer transfer; Chrome readback remains disallowed as substitute transport evidence.

## Finding → change mapping

- `RGEN-S3-008` / `RGEN-S3-010`: **not claimed fixed in this package**. The package first establishes the evidence needed to distinguish page binding, DOM turn observation, lifecycle request/rejection, Native Messaging delivery, and native ACK failures before further state-machine changes.
- `RGEN-S3-009`: **still requires canonical-history correction**. This package does not rewrite historical handoffs and does not claim Stage 3 acceptance.
- Evidence-first diagnostics:
  - extension/content events travel over the existing Native Messaging port to the native host;
  - the native host writes append-only JSONL at `diagnosticLogPath`, with backward-compatible fallback to `<stateDbPath>.events.jsonl`;
  - levels are `off` / `error` / `info` / `debug` / `trace`, with bounded size rotation and retained-file count;
  - a bounded extension ring buffer retains diagnostic metadata during disconnect and flushes after reconnect;
  - MCP tool `get_review_diagnostics(job_id, limit?)` returns bounded events for one job;
  - logs allow only IDs, event names, phases, errors, counts, lengths, hashes, and booleans. They exclude tokens, cookies, envelope/handoff bodies, full conversation text, and assistant output.
- Native protocol is bumped to `1.2`, extension manifest to `0.2.3`, and capability `diagnostics-v1` identifies the new producer.

## Runtime evidence before this request

- Maintainer removed and reloaded extension `0.2.3`, then manually armed session `fd3338d8-d3c4-4552-abcd-1c6478428be6`.
- The installed legacy config omitted explicit diagnostic fields, so the backward-compatible path was selected:
  `C:\Users\fanmo\AppData\Local\codex-web-review-relay\state.sqlite.events.jsonl`.
- That file contains the correlated event:
  `session_armed` for session `fd3338d8-d3c4-4552-abcd-1c6478428be6` at `2026-07-23T03:28:24.707Z`.
- This proves extension → Native Messaging → native-host JSONL delivery for an Arm event; it does not pre-prove review lifecycle or full-verdict delivery.

## Validation evidence

- `npm test`: `104/104` passed.
- `npm run test:compat`: `{"compatible":true}` for the producer v1.0 fixture.
- `git diff --check`: passed; only expected working-tree LF/CRLF conversion warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Review the diagnostics contract, protocol compatibility, ring-buffer/ACK behavior, privacy boundary, rotation/query implementation, tests, and canonical documentation alignment. Then evaluate the still-open round-06 findings without treating observability as their fix. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
