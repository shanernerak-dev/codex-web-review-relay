# Review Request

Package kind: `review-request`
Review stream: `release-v030`
Effective round: `1`
Target kind: `commit`
Target ID: `review-v030-release`
Review scope: release-hardening, deterministic release packaging, self-contained Windows native-host installation, relay-owned exporter trust boundary, bilingual release documentation, version and protocol contract, asset hygiene, and verification

## Review request

Review the commit at the reviewed head for correctness, security, release-contract fidelity, and regressions. This is a commit-only relay review: do not publish a PR comment. Return the complete formal verdict in the assistant response with findings first, followed by a clear PASS or REQUEST CHANGES conclusion.

Pay particular attention to:

- product version `0.3.0` versus MCP schema/protocol versions;
- exact extension and native-host ZIP inventories and deterministic checksum generation;
- launcher binding to `<InstallRoot>\runtime\src\cli.ts` after the extraction directory is deleted;
- relay-owned exporter containment, symlink/reparse rejection, and repository resolution from absolute `handoff_file`;
- migration wording, Bearer token rotation, and the single-active-job boundary;
- whether the release checks prove the claimed asset hygiene without relying on generated or development-only files.

## Verification evidence

- `npm test` passes for the development tree.
- `npm run test:compat` passes for the existing relay-export compatibility fixture.
- `npm run check:release-version` and `npm run check:release-assets` pass.
- The extracted native-host asset has passed install, ARM_SESSION, authenticated `/health`, MCP `initialize`, `tools/list`, and uninstall smoke.
- Chrome extension Arm and Disarm have been manually exercised against the installed native host.

## Findings to review

Report any release-blocking finding with file path, line or symbol, impact, and a concrete fix. Treat missing remote evidence or an unverifiable contract as a finding rather than assuming the intended behavior.
