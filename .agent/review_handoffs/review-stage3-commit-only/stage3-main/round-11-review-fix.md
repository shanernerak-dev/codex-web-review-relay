# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `11`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 parser, lifecycle ownership and diagnostic persistence fixes after round-10
Previous reviewed head: `54550b3cc95d80c3ecdf08a0b8306d65d931b5da`
Implementation commit: `030406d0500818631c81863d6924acbc8cfa904a`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-10 contaminated transport output

- Round 10 reviewed head `54550b3cc95d80c3ecdf08a0b8306d65d931b5da`, job `f1927ec5-2fbd-4e68-a208-cbede086ee25`, reached native `TURN_IDLE`.
- The returned `assistant_output` began with the correct Round 10 verdict but appended a complete historical Round 07 verdict after the current Web-agent footer.
- Therefore the transport result did not satisfy the last-anchor or single-target-turn gate. The Maintainer-provided clean Round 10 text is the formal source for the findings below.
- Round 11 transport acceptance requires: first anchor `Verdict: ...`, exactly one current Web-agent footer as the last anchor, no historical verdict appended, matching `assistant_output_sha256`, and successful native `TURN_IDLE` ACK.

## Round-10 finding disposition claimed by this fix

### `RGEN-S3-009`

- Canonical spec history now records the Round 10 clean formal verdict, the contaminated MCP result, and the formal-source boundary.
- Stale wording that described the pre-fix same-identity implementation as current behavior is explicitly historical.

### `RGEN-S3-013`

- Structural candidate diagnostics now emit bounded primitive metadata for each observed candidate.
- Candidate keys and text are SHA-256 hashes; raw message text is not logged.
- Native schema and query persistence cover these fields and the new closed-set event.

### `RGEN-S3-016`

- Persisted jobs now carry monotonically increasing `ownership_generation`.
- Initial dispatch and every reconcile bind the job to the current session before sending the trigger.
- Lifecycle events carry the ownership generation; delayed loss from an older session is rejected as `JOB_OWNERSHIP_STALE` and removed from the extension retry queue.

### `RGEN-S3-017`

- Terminal cleanup is driven by the native lifecycle ACK phase.
- A native `MISMATCH` ACK clears the extension active job; `SEND_UNCERTAIN` also releases the local active state for audited recovery.

### `RGEN-S3-018`

- Diagnostic writes now distinguish `appended`, `duplicate`, `filtered`, and `failed`.
- `DIAGNOSTIC_ACK` explicitly reports `persisted` and `disposition`.
- The extension removes a queued event only after a persisted ACK or an explicit terminal `filtered` disposition; malformed or missing persistence evidence remains queued.

### `RGEN-S3-019`

- A tracked Stage 3 monitor never falls back to a global legacy assistant selector when the bound target assistant has not appeared.
- Historical or unrelated assistant turns therefore cannot be returned as the tracked review result.

### `RGEN-S3-020`

- Generic containers are keyed by their DOM node rather than a shared null identity.
- Persistent turn shells retain target-user order across hydration and virtualization, including when the target user node temporarily disappears.
- Fragment replacement and append behavior remain deterministic across repeated harvests.

### `RGEN-S3-021`

- Production user extraction requires the user content selector.
- Production assistant extraction requires a Markdown content selector and does not fall back to the full turn wrapper.
- Action controls and code-copy labels are excluded from the captured assistant output.

## Required review focus

1. Re-evaluate every still-open Round 10 finding (`RGEN-S3-009`, `013`, `016` through `021`) against the remote implementation.
2. Verify job ownership migration, stale-session loss, reconcile ownership, and terminal extension cleanup as one state machine rather than isolated unit behavior.
3. Verify tracked capture can return only the assistant turn associated with this request, preserving fragment order without historical fallback or control text.
4. Verify diagnostic ACK semantics cannot silently discard an event after failed or ambiguous persistence.
5. Confirm PR-comment mode and producer v1.0 contracts remain compatible.
6. Treat Round 11 transport itself as an acceptance test: reject the gate if the MCP result contains any historical verdict, lacks either anchor, has a mismatched SHA, or lacks native `TURN_IDLE` ACK.

## Version and validation

- Extension manifest: `0.2.8`.
- Full suite: `127/127` passed.
- `npm run test:compat`: `{"compatible":true}` for producer v1.0.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Review the Round 10 fixes and all still-open Stage 3 findings. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
