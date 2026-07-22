# Stage 3 Commit-only Review Request

Package kind: `review-request`
Review stream: `stage3-main`
Effective round: `1`
Target kind: `commit`
Target ID: `review-stage3-commit-only`
Review scope: Stage 3 commit-only relay contract, backward-compatible PR mode, relay-only envelope, native schema migration, long-response completion detection, generic helper, README/contracts synchronization, and producer compatibility boundary

## Stage transition

- Stage 2 acceptance was explicitly granted by the Maintainer on 2026-07-22.
- Stage 3 round counting restarts at `round-01`; this handoff is the canonical Stage 3 review identity.
- This is a commit-only review. There is no `target_pr` and no PR-comment formal-verdict requirement.

## Implementation under review

- `src/relay-contract.ts` and `contracts/relay-export.schema.json` add `target_kind=commit`, stable `target_id`, nullable `target_pr`, commit-only handoff path validation, schema v1.1 identity rules, and fingerprint separation.
- `scripts/tools/relay_export_helper.py` accepts `.agent/review_handoffs/review-<id>/...` and validates `Target kind` / `Target ID` without weakening v1 PR checks.
- `src/envelope.ts` adds the commit-only locator fields and relay-only instruction while preserving the six-field PR envelope.
- `src/native-protocol.ts`, `src/review-transport.ts`, `extension/background.js`, and `contracts/native-messaging.schema.json` carry an explicit `reviewMode` with native schema minor compatibility for the older extension.
- `extension/content.js` and `extension/dom-adapter.js` use response-idle detection independent of composer identity and a longer output-stability window for relay-only long reviews.
- `README.md`, `README.zh-CN.md`, `AGENTS.md`, `docs/agent_conventions.md`, `docs/workflows/review_fix_workflow.md`, the canonical spec, and contract schemas document the two modes.

## Compatibility and validation evidence

- Targeted TypeScript/extension/helper/native/transport tests: 62 passed.
- `npm run test:compat`: producer `v1.0` fixture remains compatible.
- Current PR-mode handoff readback through the generic helper remains successful and emits inferred `target_kind=pr`, `target_id=pr-2`.
- `git diff --check` passed before commit.
- Producer `David-JA/single-crystal-stress#44` remains open. The Stage 3 changes are designed to preserve its v1 PR helper path; live producer-side commit-only readback is a follow-up boundary, not evidence claimed by this handoff.

## Review request

Please review commit `b9e781c` as a commit-only Stage 3 review. Return the complete formal verdict in `assistant_output`, using the repository's normal `PASS`, `REQUEST CHANGES`, `COMMENT`, or `HUMAN DECISION REQUIRED` convention. Do not publish a GitHub PR comment for this review.
