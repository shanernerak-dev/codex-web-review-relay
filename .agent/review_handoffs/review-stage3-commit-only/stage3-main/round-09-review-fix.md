# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `9`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-09 review of round-07 findings plus evidence-driven grouped user-turn receipt after the round-08 pre-review dispatch failure
Previous reviewed head: `9c53ce969bcb05880b757a212be87fbf48fe165f`
Implementation commit: `e9b5fe586ae7f03fd7efa1797e09f380a213a9d9`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-08 dispatch failure

- Round 08 job `5af991b6-4f4f-480c-a40a-c14800de7425` never entered Web review. It ended `SEND_UNCERTAIN / NATIVE_DISPATCH_WRITE_FAILED`; therefore no reviewer verdict exists for round 08.
- Diagnostics prove: `trigger_received`, `dispatch_started`, then after 10 seconds `dispatch_receipt_missing` with `baseline_count=0`, `candidate_count=2`, `exact_match_count=0`, `SEND_CLICK_RECEIPT_MISSING`; background then sent and received ACK for `SEND_UNCERTAIN`.
- The evidence establishes that two new user DOM candidates existed but neither individual candidate equalled the complete envelope. It does not, by count alone, assert that both candidates belong to one turn.
- The fix groups only candidates sharing the same stable turn identity, concatenates their canonical text in DOM order, and compares that grouped text with the envelope. Distinct turn identities remain distinct and ambiguous matches still fail closed.
- Extension manifest is `0.2.5`. A regression test covers one user turn split across two same-identity DOM bubbles and verifies grouped exact match.

## Round-07 finding fixes under review

- `RGEN-S3-008`: conversation/document preflight, `bindingGeneration + documentId` lifecycle correlation, persisted/retried `SESSION_LOST`, and lifecycle ACK retry.
- `RGEN-S3-009`: corrected round-05 SHA and canonical round 06–08 history.
- `RGEN-S3-010`: valid unstable append accepted only while every unstable baseline node remains retained; replacement still fails closed.
- `RGEN-S3-011`: diagnostic I/O cannot throw into native transport; inbound chain recovers; fault injection proves `TURN_IDLE` output/SHA/ACK survive an unwritable log.
- `RGEN-S3-012`: v1.2 schema accepts `diagnostics-v1` and real ARM/diagnostic event/ACK fixtures under Draft 2020-12 validation.
- `RGEN-S3-013`: default-info cross-layer boundaries, source chronology/sequence/event identity, binding correlation, stale rejection, idempotent duplicate handling, serialized queue, and MCP query coverage.
- `RGEN-S3-014`: closed primitive field contract and adversarial nested/array privacy rejection.

## Validation evidence

- Full suite after the grouped-turn fix: `110/110` passed.
- `npm run test:compat`: `{"compatible":true}` for producer v1.0.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. First verify the round-08 evidence boundary and same-identity grouping fix without overstating candidate-count evidence. Then review the full round-07 finding fixes listed above. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
