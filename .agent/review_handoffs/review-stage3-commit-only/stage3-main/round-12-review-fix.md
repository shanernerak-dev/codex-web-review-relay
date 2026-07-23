# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `12`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 ownership isolation, terminal ACK retry, turn boundary and diagnostics contract fixes after round-11
Previous reviewed head: `4b2fafebfdb860b1b5906478f75862433a456b2f`
Implementation commit: `47860753ee98dbf9145f223e777e2f8fe170a5d5`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## Round-11 transport evidence

- Round 11 job `6b5cbe7c-6deb-42bf-9ac5-5f099fdc7e17` reached `TURN_IDLE / completed`.
- MCP returned one complete current verdict with SHA `b3021c33ecde57da2cf7fbf7aeead660cc4c9759e30b090e260216fb20003df6`.
- The output had the correct first anchor, exactly one current Web-agent footer at the end, and no historical verdict appended.
- The complete Round 11 `assistant_output` is therefore the formal finding source.

## Round-11 finding disposition claimed by this fix

### `RGEN-S3-009`

- Canonical history now records Round 11 package identity, implementation commit, reviewed head, job, verdict, transport phase, output SHA and formal-source handling without claiming acceptance.

### `RGEN-S3-013`

- Candidate `turn_index` now comes from the complete tracker document order rather than user-only enumeration.
- A user record with zero extracted fragments emits bounded structural evidence with `fragment_count=0`, content/hydration booleans and hashed keys; no message text is logged.
- Native schema accepts the new primitive evidence fields.

### `RGEN-S3-016`

- Background requires the content-provided `ownershipGeneration` to equal the active trigger generation and forwards that exact value without rewriting it.
- Relay-only requires a schema-minor-3 extension; native v1.3 relay-only lifecycle requires generation and exact persisted owner.
- Dispatch/reconcile trigger acceptance carries generation and is checked against the pending outbound generation, so an old acceptance cannot confirm a newer ownership generation.

### `RGEN-S3-017`

- All idempotent content lifecycle paths now retry to a correlated ACK, including reconcile progress, `RECONCILE_MISMATCH`, `TURN_TIMEOUT` and `SEND_UNCERTAIN`.
- Retry uses a bounded post-deadline ACK window; content does not finish a terminal path until ACK succeeds or that recovery window expires.
- Native same-phase replay remains idempotent and returns the stable persisted phase, allowing cleanup after an ACK was lost.

### `RGEN-S3-018`

- Published schema requires the v1.3 diagnostic persistence fields only for minor 3.
- Historical v1.2 ACK remains valid.
- v1.3 schema enforces `appended|duplicate => persisted=true` and `filtered => persisted=false`, with contradictory combinations rejected.
- Relay-only capability preflight now also requires schema minor 3.

### `RGEN-S3-020`

- Turn identity is derived from the outer turn shell before any inner `data-message-id`; message IDs remain fragment identities.
- Generic outer shells retain node identity and ordered hydration behavior.
- Encountering an unknown/unhydrated shell after the target user is a fail-closed boundary; capture never crosses it to include a later assistant.
- Tests cover an outer turn test ID with multiple inner message IDs and an unknown next-turn shell followed by historical assistant content.

## Required review focus

1. Re-evaluate every still-open Round 11 finding (`RGEN-S3-009`, `013`, `016`, `017`, `018`, `020`) against the remote implementation.
2. Verify stale monitor generation cannot be rewritten or accepted at content, background, native lifecycle or trigger-acceptance boundaries.
3. Verify native-persisted terminal phases recover from a lost ACK without leaving background permanently `ACTIVE`.
4. Verify outer turn identity, inner fragment identity, virtualized order and unknown-shell boundaries form one fail-closed parser model.
5. Verify the native schema compatibility matrix for historical v1.2 and strict v1.3 messages.
6. Confirm PR-comment mode and producer v1.0 contracts remain compatible.
7. Treat Round 12 transport as an acceptance test: reject if MCP output is truncated, contains a historical verdict, lacks matching SHA/native `TURN_IDLE`, or has anything after the single current footer.

## Version and validation

- Extension manifest: `0.2.9`.
- Full suite: `131/131` passed.
- `npm run test:compat`: `{"compatible":true}` for producer v1.0.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Review the Round 11 fixes and all still-open Stage 3 findings. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
