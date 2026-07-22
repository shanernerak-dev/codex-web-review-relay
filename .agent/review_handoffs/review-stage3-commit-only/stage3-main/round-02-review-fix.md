# Stage 3 Commit-only Review Fix

Package kind: `review-fix`
Review stream: `stage3-main`
Effective round: `2`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 fixes for PR fingerprint compatibility, persisted legacy job/status migration, relay-only extension capability negotiation, relay-only completion safety, relay-export/native schema alignment, and README formal-verdict boundaries

## Stage transition

- Stage 2 acceptance was explicitly granted by the Maintainer on 2026-07-22.
- Stage 3 round-01 reviewed head `4e77def8253c013e1911c1630060a32f20390867` returned `REQUEST CHANGES` with findings `RGEN-S3-001` through `RGEN-S3-005`.
- This is Stage 3 `round-02-review-fix`; the round count is stage-scoped and does not accumulate across stages.
- This is a commit-only review. There is no `target_pr` and no PR-comment formal-verdict requirement.

## Implementation under review

- Implementation commit: `4bb6ed678f63378442ac3c7e33fa1d876fa2050c`.
- PR mode restores the pre-Stage-3 fingerprint field sequence; commit-only mode alone includes `target_kind` / `target_id` in the extended fingerprint.
- SQLite active-session capability persistence and explicit `relay-only-v1` negotiation reject commit-only dispatch/reconcile for old extensions before DOM work, while preserving v1.0 PR mode.
- Relay-only completion requires observed generation and includes negative tests for stable partial bubbles and delayed generation.
- Relay-export schema/runtime minor policy is bounded at v1.1, v1.0 is PR-only, and v1.1 PR/commit branches require mode identity with matching runtime constraints.
- Legacy persisted PR rows, terminal/recovery lookup, `relay_json=NULL` status, full test coverage, and README EN/ZH formal-verdict/read-access boundaries are covered by tests and documentation.

## Compatibility and validation evidence

- Full test suite: `79/79` passed with `node --experimental-strip-types --test --test-force-exit test/*.test.ts`.
- `npm run test:compat`: producer v1.0 fixture remains compatible.
- `git diff --check` passed before the implementation commit; only Windows line-ending normalization warnings were emitted.
- Producer `David-JA/single-crystal-stress#44` remains open. No producer-side usage change is claimed by this fix; the existing compatibility boundary remains recorded for post-closeout readback.

## Review request

Please review the changes from the previous Stage 3 reviewed head through commit `4bb6ed6` at this canonical handoff head. Return the complete formal verdict in `assistant_output`, using the repository's normal `PASS`, `REQUEST CHANGES`, `COMMENT`, or `HUMAN DECISION REQUIRED` convention. Do not publish a GitHub PR comment for this review.
