import { canonicalJson, sha256 } from "../src/canonical.ts";
import type { RelayExport } from "../src/relay-contract.ts";

export function relayFixture(overrides: Partial<RelayExport> = {}): RelayExport {
  const normalizedScope = ["Stage B producer-consumer contract"];
  return {
    schema_version: {major: 1, minor: 0},
    repository: "David-JA/single-crystal-stress",
    target_pr: 41,
    handoff_path: ".agent/review_handoffs/pr-41/stage-b-delivery/round-01-review-request.md",
    handoff_sha256: "b".repeat(64),
    full_ref: "refs/heads/codex/stage-b-contract",
    reviewed_head: "a".repeat(40),
    review_stream: "stage-b-delivery",
    effective_round: 1,
    package_kind: "review-request",
    normalized_scope: normalizedScope,
    scope_sha256: sha256(canonicalJson(normalizedScope)),
    ...overrides,
  };
}
