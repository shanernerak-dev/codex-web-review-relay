# Stage 3 Commit-only Review Evidence Amendment

Package kind: `evidence-amendment`
Review stream: `stage3-main`
Effective round: `4`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 round-04 current-head amendment covering the round-03 residual fixes, relay-only completion safety, legacy PR compatibility, schema-test reproducibility, and extension session lifecycle

## Evidence amendment

- Stage 3 `round-04-review-fix` was previously prepared at implementation commit `084b588`, before the formal round-03 residual fixes were completed; that historical handoff remains append-only.
- The current reviewed tree includes the round-04 extension Disarm/Arm lifecycle fix and the follow-up fixes for `RGEN-S3-002`, `RGEN-S3-003`, and `RGEN-S3-007`.
- Legacy PR target-kind fallback now parses the canonical `pr-N` target segment and never classifies a `review-*` stream as commit-only; invalid or unavailable stored identity fails closed.
- Relay-only completion evidence now accepts only turn-level copy controls or exact, non-code-block copy controls. Reconcile tests explicitly run with `reviewMode: relay-only`, including a code-copy negative case.
- The published-schema test dependency is pinned in `requirements-dev.txt`, with README bootstrap instructions and a stable missing-dependency error.
- Full tests passed `92/92` with `node --experimental-strip-types --test --test-force-exit test/*.test.ts`; `npm run test:compat` returned `compatible: true`; `git diff --check` passed.
- This remains a Maintainer-authorized Stage 3 commit-only acceptance-review pilot. Return the complete formal verdict in `assistant_output`; do not publish a GitHub PR comment. The pilot does not imply general commit-only availability before Stage 3 acceptance.

## Review request

Review the current remote reviewed head and the complete Stage 3 contract, including the historical round-04 implementation and the current-head fixes described above. Return the complete formal verdict using the repository's normal `PASS`, `REQUEST CHANGES`, `COMMENT`, or `HUMAN DECISION REQUIRED` convention in `assistant_output`.
