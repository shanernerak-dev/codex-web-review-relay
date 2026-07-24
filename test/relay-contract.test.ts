import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256 } from "../src/canonical.ts";
import { FORMAL_REVIEW_PUBLICATION_INSTRUCTION, RELAY_ONLY_VERDICT_INSTRUCTION, renderTriggerEnvelope } from "../src/envelope.ts";
import { relayFingerprint, validateRelayExport } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";

test("relay export rejects unsupported higher minor versions", () => {
  assert.throws(() => validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 3},
  })), /RELAY_SCHEMA_MINOR_UNSUPPORTED/);
});

test("v1.0 is limited to PR paths while v1.1 supports commit-only paths", () => {
  assert.throws(() => validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 0}, target_kind: "commit", target_id: "review-local-run", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-local-run/main/round-01-review-request.md",
  })), /RELAY_COMMIT_SCHEMA_MINOR_UNSUPPORTED/);
});

test("relay target identity must exactly match the handoff path", () => {
  for (const relay of [
    relayFixture({target_pr: 42, target_id: "pr-42"}),
    relayFixture({schema_version: {major: 1, minor: 1}, target_pr: 42, target_id: "pr-42"}),
    relayFixture({
      schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-beta", target_pr: null,
      handoff_path: ".agent/review_handoffs/review-alpha/main/round-01-review-request.md",
    }),
  ]) {
    assert.throws(() => validateRelayExport(relay), /RELAY_TARGET_PATH_MISMATCH/);
  }
});

test("relay export fails closed on unknown major and scope drift", () => {
  assert.throws(
    () => validateRelayExport(relayFixture({schema_version: {major: 2, minor: 0}})),
    /RELAY_SCHEMA_MAJOR_UNSUPPORTED/,
  );
  assert.throws(
    () => validateRelayExport(relayFixture({scope_sha256: "0".repeat(64)})),
    /RELAY_SCOPE_HASH_MISMATCH/,
  );
});

test("accepts attended review rounds beyond the unattended five-round budget", () => {
  const relay = validateRelayExport(relayFixture({
    effective_round: 6,
    handoff_path: ".agent/review_handoffs/pr-41/stage-c-runtime-followup/round-06-evidence-amendment.md",
  }));
  assert.equal(relay.effective_round, 6);
  assert.throws(
    () => validateRelayExport(relayFixture({
      handoff_path: ".agent/review_handoffs/pr-41/stage-c-runtime-followup/round-6-evidence-amendment.md",
    })),
    /RELAY_EXPORT_INVALID:handoff_path/,
  );
  assert.throws(
    () => validateRelayExport(relayFixture({
      handoff_path: ".agent/review_handoffs/pr-41/stage-c-runtime-followup/round-006-evidence-amendment.md",
    })),
    /RELAY_EXPORT_INVALID:handoff_path/,
  );
  for (const alias of [
    ".agent/review_handoffs/pr-41/stage-c-runtime-followup/round-1٢-evidence-amendment.md",
    ".agent/review_handoffs/pr-41/stage-c-runtime-followup/round-１2-evidence-amendment.md",
  ]) {
    assert.throws(
      () => validateRelayExport(relayFixture({handoff_path: alias})),
      /RELAY_EXPORT_INVALID:handoff_path/,
    );
  }
});

test("fingerprint and six locator fields plus fixed publication instruction are deterministic", () => {
  const relay = validateRelayExport(relayFixture());
  assert.equal(relayFingerprint(relay), relayFingerprint({...relay}));
  const envelope = renderTriggerEnvelope(relay);
  assert.equal(envelope.text, "Repository: David-JA/single-crystal-stress\nPath: .agent/review_handoffs/pr-41/stage-b-delivery/round-01-review-request.md\nfull Ref: refs/heads/codex/stage-b-contract\nReviewed head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nReview stream: stage-b-delivery\nEffective round: 1\nPackage kind: review-request\nAfter completing the review, publish the formal verdict as a GitHub PR comment following the repository convention.");
  assert.equal(envelope.sha256, "0fff9fc7c380beb9f57d06634ec73d719a2e9ffa2ba7fea4291f88213ebe2e75");
  assert.equal(envelope.text.split("\n").at(-1), FORMAL_REVIEW_PUBLICATION_INSTRUCTION);
  assert.match(envelope.text, /^Repository: [^\n]+\nPath: /);
  assert.doesNotMatch(envelope.text, /[A-Za-z]:[\\/]|handoff_file|repositoryRoot/);
  assert.match(envelope.text, /Reviewed head: a{40}/);
  assert.notEqual(envelope.sha256, renderTriggerEnvelope(relayFixture({repository: "other/repository"})).sha256);
  assert.doesNotMatch(envelope.text, /normalized_scope|handoff_sha256/);
});

test("PR fingerprint remains identical to the pre-Stage-3 algorithm", () => {
  const relay = validateRelayExport(relayFixture());
  const legacyInput = {
    repository: relay.repository,
    target_pr: relay.target_pr,
    handoff_path: relay.handoff_path,
    handoff_sha256: relay.handoff_sha256,
    full_ref: relay.full_ref,
    reviewed_head: relay.reviewed_head,
    review_stream: relay.review_stream,
    effective_round: relay.effective_round,
    package_kind: relay.package_kind,
    scope_sha256: relay.scope_sha256,
  };
  assert.equal(relayFingerprint(relay), sha256(canonicalJson(legacyInput)));
});

test("commit-only export has a stable target identity and relay-only envelope", () => {
  const relay = validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 1},
    target_kind: "commit",
    target_id: "review-local-run",
    target_pr: null,
    handoff_path: ".agent/review_handoffs/review-local-run/main/round-01-review-request.md",
  }));
  assert.equal(relay.target_kind, "commit");
  assert.equal(relay.target_id, "review-local-run");
  assert.equal(relay.target_pr, null);
  const envelope = renderTriggerEnvelope(relay);
  assert.equal(envelope.text, "Repository: David-JA/single-crystal-stress\nPath: .agent/review_handoffs/review-local-run/main/round-01-review-request.md\nTarget kind: commit\nTarget ID: review-local-run\nfull Ref: refs/heads/codex/stage-b-contract\nReviewed head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nReview stream: stage-b-delivery\nEffective round: 1\nPackage kind: review-request\nThis is a commit-only review. Do not publish a GitHub PR comment. Return the complete formal verdict in your assistant response.");
  assert.equal(envelope.sha256, "65a53b54e36a5ec6298e66b90a2fd4117367b7795e5bd0155ca9971ded0cd9f5");
  assert.equal(envelope.text.split("\n").at(-1), RELAY_ONLY_VERDICT_INSTRUCTION);
  assert.doesNotMatch(envelope.text, /GitHub PR comment following/);
});
