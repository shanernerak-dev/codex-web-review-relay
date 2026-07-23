# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `10`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 turn-parser replacement after the round-09 exact user-turn receipt failure
Previous reviewed head: `36bbfff58fd2ad57a2d4e53f42b2ea7c25a18e93`
Implementation commit: `651ef59b83d72f1607139e86daab64ed8f3168a5`

Stage 3 pilot authorization: Maintainer-authorized acceptance review; complete commit-only `assistant_output` is formal source for this gate only.

## First acceptance target: round-09 transport failure

- Round 09 attempted head `8d3792e0b12e4aeed6be04b6b4d21b7db9cb903a`, job `b9fa3ded-fbc0-401a-bb6a-da68895157c1`.
- Trigger acceptance succeeded independently of receipt wait: `trigger_received → dispatch_started → DISPATCH_TRIGGER_ACCEPTED → trigger_accepted`.
- Exact user-turn receipt then failed after 60 seconds with `baseline_count=0`, `candidate_count=2`, `exact_match_count=0`, ending `SEND_UNCERTAIN / SEND_CLICK_RECEIPT_MISSING`.
- No Round 09 formal verdict was returned. This handoff must not describe Round 09 as reviewed or accepted.

## Parser replacement

- The canonical spec and architecture audit now record the repository-local SyncNos reference design at a conceptual level while preserving AGPL isolation.
- `extension/dom-adapter.js` introduces a relay-owned `TurnRecord` / tracker model:
  - stable turn identity;
  - role;
  - ordered message fragments;
  - message identity or within-turn position;
  - cross-pass harvest;
  - stable-message replacement;
  - document-order turn assembly.
- User receipt reads the user content node (`.whitespace-pre-wrap`) rather than action labels from the entire role node.
- Assistant extraction reads the assistant Markdown content node rather than controls surrounding the message.
- Dispatch receipt, reconcile, assistant observation and final output extraction now share the same tracker.
- Existing public adapter functions remain for v1 PR-mode compatibility, but Stage 3 tracked dispatch/reconcile uses the new parser path.
- Completion remains a separate target-turn gate: complete extraction does not replace turn-level completion evidence or native `TURN_IDLE` ACK.

## Required review focus

1. Confirm the tracker does not merge distinct stable turn identities.
2. Confirm multiple fragments inside one turn remain in document order across hydration passes.
3. Confirm a stable message replaced during rerender updates rather than duplicates.
4. Confirm historical turns and the next user turn bound the target assistant response.
5. Confirm action labels and code-copy controls cannot enter the formal output or satisfy completion.
6. Confirm PR-comment mode and producer v1.0 contracts remain compatible.
7. The real transport gate passes only if MCP returns this review's complete formal verdict, matching output SHA and native `TURN_IDLE` ACK.

## Version and validation

- Extension manifest: `0.2.7`.
- Full suite: `118/118` passed.
- `npm run test:compat`: `{"compatible":true}` for producer v1.0.
- `git diff --check`: passed; only expected LF/CRLF working-tree warnings were emitted.

## Review request

Read the current remote reviewed head and this canonical handoff from `Path`. Review the parser replacement and all still-open Stage 3 findings. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment.
