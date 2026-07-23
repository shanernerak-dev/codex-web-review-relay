# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `13`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Round 12 residual fixes for durable terminal recovery, negotiated schema, diagnostics ownership and shell boundaries
Previous reviewed head: `3eaca9f5b2324d37843d39ddf9c409afe39a4384`
Implementation commit: `369aaa42a4adfd94985aedf40aa4b2262ccf4565`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## Round-12 evidence

- Job `e47ffdad-55ff-4d87-bb45-ff7a2965644a` reached `TURN_IDLE / completed`.
- MCP returned one complete current verdict with SHA `fa047f0bd436600b66189f7521618b6e7edc9a013563a408dcdbb13ed53a12a0`, one final current footer and no historical verdict.
- Round 12 returned `REQUEST CHANGES`; this handoff claims no Stage 3 acceptance.

## Fix disposition

- `RGEN-S3-009`: canonical history records the complete Round 12 identity, verdict, job, transport SHA and formal-source boundary.
- `RGEN-S3-013`: diagnostics carry and validate `ownershipGeneration`; structural snapshots are emitted for dispatch, reconcile and monitor parser failures, including unknown and zero-fragment records. Primitive ownership/content fields persist through native JSONL/query.
- `RGEN-S3-016`: post-Arm messages must match the stored negotiated schema version; relay-only generation and exact persisted owner checks no longer depend on a self-declared message minor.
- `RGEN-S3-017`: terminal lifecycle is persisted in extension storage before native delivery, replayed after reconnect/service-worker restoration, and removed only after terminal ACK. The finite content retry can hand off durably rather than leaving cleanup solely in volatile memory.
- `RGEN-S3-020`: shell enumeration and stable identity share support for `data-turn-id`, stable/generic conversation-turn test IDs and constrained `id^=conversation-turn-`; each unhydrated form is a fail-closed boundary.
- `RGEN-S3-022`: published schema includes both trigger-acceptance types, requires generation for v1.3 dispatch/reconcile triggers and acceptances, and declares their correlation/session/job fields.

## Required review focus

1. Re-evaluate all still-open Round 12 findings and the new `RGEN-S3-022`.
2. Verify terminal ACK loss across reconnect/restoration eventually clears background `ACTIVE`.
3. Verify negotiated minor cannot be downgraded by lifecycle or trigger acceptance.
4. Verify stale-generation diagnostics are rejected and parser failures retain bounded structural evidence without message text.
5. Verify all supported unhydrated shell forms stop capture before later assistant content.
6. Confirm PR-comment mode and producer v1.0 compatibility remain intact.
7. Reject the transport gate if this verdict is truncated, contaminated, lacks matching SHA/native `TURN_IDLE`, or has content after the single current footer.

## Version and validation

- Extension manifest: `0.2.10`.
- Full suite: `133/133` passed.
- `npm run test:compat`: `{"compatible":true}`.
- `git diff --check`: passed with only expected LF/CRLF warnings.

## Review request

Read the remote reviewed head and this canonical handoff. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
