# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `8`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-08 fix for round-07 transport evidence, binding/lifecycle recovery, unstable turn append, and diagnostics contract hardening
Previous reviewed head: `9c53ce969bcb05880b757a212be87fbf48fe165f`
Implementation commit: `d204c843614ef76c919564c87d4849b86b509b11`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-07 full-verdict transfer failure

- Round 07 job `048af8d5-acf9-47c6-9448-2c85918710f7` ended `TIMEOUT / TURN_DEADLINE_EXCEEDED` with no `assistant_output` or SHA.
- Its complete diagnostic chain was `trigger_received → monitor_started → trigger_accepted → monitor_finished`; no `user_turn_observed`, `USER_TURN_ACKED`, `ASSISTANT_STARTED`, or `TURN_IDLE` occurred.
- This proves the failure boundary was after content dispatch acceptance and before exact user-turn recognition. It does not by itself distinguish missing send receipt, selector miss, canonical mismatch, or baseline/identity rejection.
- The Web reviewer returned `REQUEST CHANGES`; the Maintainer manually transferred the complete verdict. Manual transfer is review evidence, not transport acceptance.
- This round must return the complete formal verdict through MCP. If it fails, query the job diagnostics, report the last proven boundary, and stop for Maintainer transfer.

## Finding → fix mapping

- `RGEN-S3-008`: trigger preflight now compares the armed conversation and content-document identity. Lifecycle and diagnostics require `tabId + jobId + bindingGeneration + documentId`. `SESSION_LOST` is persisted in extension storage and retried until ACK instead of one-shot best effort. Non-terminal lifecycle rejection no longer silently stops the content monitor; initial user-turn ACK retries until deadline.
- `RGEN-S3-009`: canonical spec corrects round-05 implementation SHA to `9542ae310dae5c9a719049357e0980a7744c7442` and records round 06 and round 07 identity, verdict, transport result, and formal-source boundary separately.
- `RGEN-S3-010`: unstable baseline nodes are retained by node identity. A legitimate new unstable turn is accepted when every unstable baseline node remains present; replacement/removal still fails closed with `TURN_IDENTITY_UNSTABLE`.
- `RGEN-S3-011`: diagnostic initialization/write/read/rotation failures are contained inside `DiagnosticLogger` and return status instead of throwing. Native protocol handling occurs independently, catch logging is non-throwing, and the inbound chain recovers from prior rejection. Fault-injection coverage proves `TURN_IDLE` still persists complete output/SHA and returns ACK when the log path is unwritable.
- `RGEN-S3-012`: native v1.2 schema includes `diagnostics-v1`; a Draft 2020-12 validator executes real v1.2 `ARM_SESSION`, `DIAGNOSTIC_EVENT`, and `DIAGNOSTIC_ACK` fixtures. Existing v1.0/v1.1 runtime compatibility remains covered.
- `RGEN-S3-013`: default `info` retains content request, background receive/send, native receive, and ACK boundaries. Buffered events carry source timestamp, monotonic sequence, event ID, binding generation, document ID, and tab ID. Queue operations are serialized, event IDs are idempotent, stale senders are rejected, and MCP query is exercised end-to-end through the server.
- `RGEN-S3-014`: logger fields now have per-key primitive type contracts; arrays and nested objects are discarded. Component/event names use closed reviewed sets. Native `details` schema is closed with `additionalProperties:false`; adversarial privacy tests cover nested and malformed values.
- Dispatch evidence: `adapter.dispatch()` now waits for the exact new user turn rather than accepting composer-clear or generating state alone. A missing receipt fails before `trigger_accepted`, and logs candidate count, exact-match count, baseline count, and error code without text.

## Version and compatibility

- Extension manifest: `0.2.4`.
- Native schema remains `1.2`; the change aligns producer, runtime, and published schema rather than introducing another wire version.
- PR fingerprint and producer v1.0 compatibility are unchanged.

## Validation evidence

- `npm test`: `109/109` passed.
- `npm run test:compat`: `{"compatible":true}` for the producer v1.0 fixture.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Verify the round-07 evidence boundary first, then review every finding mapping above, including fault isolation, schema fixtures, primitive privacy enforcement, buffered chronology/correlation, binding generation, lifecycle retry, exact user-turn receipt, unstable append, canonical history, and tests. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
