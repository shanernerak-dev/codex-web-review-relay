# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `5`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-05 fix for active-session lifecycle safety and turn-aware complete assistant capture
Previous reviewed head: `1006a6c983f5cb336f226a0e5972c925431d4d4b`
Implementation commit: `9542ae310dae5c9a719049357e0980a7744c7442`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## Finding → fix mapping

- `RGEN-S3-008`: **fixed**. `POPUP_DISARM` now checks the persisted/active `activeJobId` before clearing session state and returns stable `ACTIVE_JOB_DISARM_FORBIDDEN`. Lifecycle messages are accepted only from the armed tab and current job. The content monitor validates lifecycle `{ok}` ACKs; a rejected `TURN_IDLE` ACK keeps monitoring and retries instead of silently stopping. Tests cover active-job Disarm refusal and sender/job mismatch.
- `RGEN-S3-009`: **fixed**. Canonical Stage 3 identity and round history in `discuss/relay_generality_spec.md` now point to `stage3-main/round-04-evidence-amendment` at reviewed head `1006a6c`; the round-04 browser-readback verdict and transport `TIMEOUT` distinction are recorded without claiming acceptance. Historical handoffs remain append-only.
- Round-04 completion residual: **addressed in the current implementation**. DOM capture now prefers `data-turn-id`, `data-message-id`, numbered `data-testid`, and element `id`; the dispatch baseline carries stable identities across node replacement; `newTurns()` groups new assistant nodes by identity and preserves DOM order; `rawTurnText()` and completion evidence cover the ordered assistant-turn set. `assistant_output_sha256` remains an audit field, not a completion-state machine.
- Turn capture contract: **added and documented**. The canonical spec, agent conventions, workflow pointer, and both READMEs now separate structured complete-turn extraction from `TURN_IDLE` completion and native ACK. Reference implementation sources are recorded from `reference/SyncNos-Webclipper`.

## Validation evidence

- `node --experimental-strip-types --test --test-force-exit test/*.test.ts`: `96/96` passed.
- `npm run test:compat`: `{"compatible":true}`.
- `git diff --check`: passed; only the repository's existing LF/CRLF conversion warnings were emitted.

## Review request

Read the current remote reviewed head and the canonical handoff from `Path`. Review the implementation, contracts, README/conventions alignment, and the turn-aware capture tests. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment. This remains a Maintainer-authorized Stage 3 acceptance-review pilot and does not imply general commit-only availability before Stage 3 acceptance.
