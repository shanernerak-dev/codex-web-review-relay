# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `3`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 fixes for capability preflight and stale-job cleanup, reconnect-safe relay-only completion evidence, exact target identity validation, published schema/runtime validation, and Stage 3 pilot contract alignment

## Stage transition

- Stage 2 acceptance was explicitly granted by the Maintainer on 2026-07-22.
- Stage 3 round-01 reviewed head `4e77def8253c013e1911c1630060a32f20390867` returned `REQUEST CHANGES`; `RGEN-S3-001` through `RGEN-S3-005` were recorded.
- Stage 3 round-02 reviewed head `981c7ce` returned `REQUEST CHANGES`; `RGEN-S3-001` and `RGEN-S3-005` were accepted, while `RGEN-S3-002`, `RGEN-S3-003`, `RGEN-S3-004`, and `RGEN-S3-006` remained open.
- This is Stage 3 `round-03-review-fix`; the round count is scoped to `(Stage, review stream)` and does not accumulate across stages.
- This is a commit-only acceptance-review pilot explicitly authorized by the Maintainer. For this gate only, the reviewer must return the complete formal verdict in `assistant_output`; this pilot authorization is not a declaration of general availability before Stage 3 acceptance.

## Implementation under review

- Implementation commit: `9776bd0a6ef374f5046db261f0e0fac147b01a89`.
- `ReviewTransportService` now checks `relay-only-v1` before creating a commit-only job, before recovery authorization/claim, and before any transition or native dispatch. Unsupported initial requests create no job; existing `CREATED` / `RECONCILING` rows remain unchanged; later PR requests deterministically block stale unsupported commit rows before dispatching PR mode.
- Relay-only completion no longer treats observed generation as sufficient. It requires a completion marker inside the assistant turn, supports already-complete reconnect/reconcile and fast direct replies, and has negative coverage for stable partial output, delayed generation, and recovery.
- Runtime target identity validation now requires exact path / `target_id` / `target_pr` equality. Published JSON Schema branches are exercised by an actual Draft 2020-12 validator, with the dynamic path cross-field gap explicitly closed by the runtime validator.
- AGENTS, README EN/ZH, conventions, workflow, and canonical spec now distinguish the Maintainer-authorized Stage 3 acceptance pilot from general commit-only availability. The envelope contract is explicitly six dynamic fields for PR mode and eight for commit-only mode.

## Compatibility and validation evidence

- Full test suite: `86/86` passed with `node --experimental-strip-types --test --test-force-exit test/*.test.ts`.
- Targeted residual-finding suites: `48/48` passed.
- `npm run test:compat`: `compatible: true`; producer v1.0 fixture remains compatible.
- `git diff --check` passed; only Windows line-ending normalization warnings were emitted.
- Producer `David-JA/single-crystal-stress#44` remains open. This fix changes no producer-side usage contract; the existing v1 PR helper path remains compatible, so no new producer issue is required for this round.

## Review request

Please review the changes from the previous Stage 3 reviewed head through commit `9776bd0a6ef374f5046db261f0e0fac147b01a89` at this canonical handoff head. Return the complete formal verdict in `assistant_output`, using the repository's normal `PASS`, `REQUEST CHANGES`, `COMMENT`, or `HUMAN DECISION REQUIRED` convention. Do not publish a GitHub PR comment for this commit-only acceptance-review pilot.
