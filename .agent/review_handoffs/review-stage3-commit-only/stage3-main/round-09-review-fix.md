# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `9`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-09 fix for round-08 trigger timing, expired-session abandonment, reconcile metadata, diagnostic persistence ACK, and grouped user-turn receipt
Previous reviewed head: `36bbfff58fd2ad57a2d4e53f42b2ea7c25a18e93`
Implementation commit: `bdec54fd545af7b92b7a37a9dc8d09d526c9ddc9`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-08 transport split

- Round 08 job `5af991b6-4f4f-480c-a40a-c14800de7425` entered `SEND_UNCERTAIN / NATIVE_DISPATCH_WRITE_FAILED` after the native 5-second trigger-acceptance timeout, while the content receipt gate continued and the Web reviewer completed a full `REQUEST CHANGES` verdict. The Maintainer transferred that verdict; transport acceptance failed.
- Diagnostics prove two new user DOM candidates existed with no individual full-envelope match. The grouped-receipt fix combines only fragments with the same stable turn identity and compares their ordered canonical text; distinct identities remain separate.
- Trigger acceptance is now independent of receipt and model latency: content synchronously validates/reserves the job and returns acceptance, while exact receipt remains `USER_TURN_ACKED`. Defensive bounds are 30 seconds for native acceptance and 60 seconds for DOM receipt.

## Round-08 finding fixes

- `RGEN-S3-015`: `DISPATCH_TRIGGER_ACCEPTED` / `RECONCILE_TRIGGER_ACCEPTED` no longer wait for exact receipt or initial lifecycle ACK. Async failures report `SEND_UNCERTAIN`. Tests prove acceptance returns before a delayed lifecycle ACK.
- `RGEN-S3-016`: dispatch atomically records owning `session_id` on the job. A matching expired owner may submit one `SESSION_LOST`, decoupling abandonment from the 30-second active lease; unrelated sessions remain rejected.
- `RGEN-S3-017`: `RECONCILE_MISMATCH` now uses the full job context with deadline and binding generation, so background lifecycle admission succeeds.
- `RGEN-S3-018`: native returns `DIAGNOSTIC_ACK` only after a successful JSONL append and includes `persisted=true`; write/rejection failure returns an error so extension retains the queued event. Query deduplicates `event_id` across native restarts in addition to in-process suppression.
- `RGEN-S3-008`: Arm now also requires a non-empty `documentId`. Conversation/document/binding lifecycle correlation and persisted session-loss recovery remain in force.
- `RGEN-S3-009`: canonical spec now uses the complete round-07 chain including `monitor_finished` and records the actual round-08 Web verdict plus failed transport boundary.

## Version and validation

- Extension manifest: `0.2.6`.
- Full suite: `114/114` passed.
- `npm run test:compat`: `{"compatible":true}` for producer v1.0.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Verify the round-08 transport split first, then inspect trigger/receipt decoupling, 30s/60s bounds, expired-owner abandonment, reconcile metadata, persisted diagnostic ACK and restart dedup, grouped user-turn identity, canonical history, and tests. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
