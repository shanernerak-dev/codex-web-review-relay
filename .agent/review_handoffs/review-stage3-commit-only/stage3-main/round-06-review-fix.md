# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `6`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-06 fix for the single-binding session state machine, canonical review history, and ordered turn-aware reconcile capture
Previous reviewed head: `441f21b79b2f59f465104876b52fed987d480754`
Implementation commit: `66085b57a96f3eb2425cd3e5322313ef40725da9`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## Finding → fix mapping

- `RGEN-S3-008`: **fixed by simplifying the binding model**. The extension now permits one manually armed ChatGPT tab and one active job. A duplicate Arm returns `SESSION_ALREADY_ARMED`; active-job Arm / Disarm return `ACTIVE_JOB_ARM_FORBIDDEN` / `ACTIVE_JOB_DISARM_FORBIDDEN` without changing `activeJobId`. The authoritative session state is `ARMED` or `ACTIVE`; `bindingValid` has been removed. Arm persists the exact conversation identity. Tab close, navigation, conversation drift, or adapter drift atomically removes the local binding before reporting `SESSION_LOST` and disarming the native session, so an old monitor receives `SESSION_NOT_ARMED` instead of racing the recovery event. Port reconnect may restore only the same persisted tab/conversation/job binding.
- `RGEN-S3-009`: **fixed**. Canonical spec history now records round 03, 04, and 05 separately with three distinct facts for each: whether a review response existed and its verdict, the transport result and `assistant_output` persistence, and the formal-source handling. Round 03 records its browser-readback `REQUEST CHANGES` despite transport `SESSION_LOST`; round 04 and round 05 record browser-readback `REQUEST CHANGES` with transport `TIMEOUT`. The current round-05 reviewed head and findings are recorded without prewriting Stage 3 acceptance.
- `RGEN-S3-010`: **fixed**. `reconcile()` returns the complete ordered assistant turn set after the exact target user turn and before the next user turn, and its baseline is produced by the same stable-identity `snapshotTurns()` used by dispatch. The content monitor retains the target user anchor and refreshes the entire ordered assistant set on every inspection, so multiple assistant identities are neither dropped nor contaminated by later user turns. Stable identity survives node replacement; arbitrary `closest("[id]")` fallback has been removed; a replaced turn without a stable identity fails closed with `TURN_IDENTITY_UNSTABLE`. Tests cover multi-assistant reconcile, next-user exclusion, stable rerender, unstable generic rerender, shared ancestor IDs, ordered output delivery, duplicate/active Arm, and navigation versus stale lifecycle.

## Design boundary

- The session fix intentionally does not add a binding nonce, document-generation protocol, multi-window arbitration, or automatic conversation migration. `tabId` plus the exact conversation identity is the minimum page binding; user action remains the authority for selecting a new conversation.
- Turn identity and `assistant_output_sha256` remain capture/audit concerns and do not participate in tab/session binding.
- Extension manifest version is bumped to `0.2.2` for this behavior change.

## Required transport acceptance evidence

- Round 04 and round 05 both produced complete review responses in the browser but ended as transport `TIMEOUT` with no persisted `assistant_output`. Browser readback documented those review findings, but it did not prove relay delivery.
- This round must return the complete formal verdict through the MCP result `assistant_output`, with a successful `TURN_IDLE` lifecycle ACK and a persisted `assistant_output_sha256`. The caller must verify the output's first and last anchors and hash.
- If the reviewer page completes but the relay does not return the full text, stop the workflow and request Maintainer transfer. Do not substitute Chrome/browser readback for this transport gate. Any subsequent handoff must list the full-verdict transfer failure as its first finding and acceptance target.

## Validation evidence

- `node --experimental-strip-types --test --test-force-exit test/*.test.ts`: `101/101` passed.
- `npm run test:compat`: `{"compatible":true}` for the producer v1.0 fixture.
- `git diff --check`: passed; only the repository's expected LF/CRLF conversion warnings were emitted before staging.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Review the single-binding lifecycle, active Arm/Disarm and navigation races, ordered assistant-turn capture/reconcile behavior, tests, and README/conventions/spec alignment. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment. This remains a Maintainer-authorized Stage 3 acceptance-review pilot and does not imply general commit-only availability before Stage 3 acceptance.
