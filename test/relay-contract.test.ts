import assert from "node:assert/strict";
import test from "node:test";
import { FORMAL_REVIEW_PUBLICATION_INSTRUCTION, renderTriggerEnvelope } from "../src/envelope.ts";
import { relayFingerprint, validateRelayExport } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";

test("relay export accepts v1.0 and ignores optional higher-minor fields", () => {
  const relay = validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 3},
    optional_future_field: "ignored by v1 consumer",
  }));
  assert.equal(relay.schema_version.minor, 3);
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
});

test("fingerprint and six locator fields plus fixed publication instruction are deterministic", () => {
  const relay = validateRelayExport(relayFixture());
  assert.equal(relayFingerprint(relay), relayFingerprint({...relay}));
  const envelope = renderTriggerEnvelope(relay);
  assert.equal(envelope.text.split("\n").length, 7);
  assert.equal(envelope.text.split("\n").at(-1), FORMAL_REVIEW_PUBLICATION_INSTRUCTION);
  assert.match(envelope.text, /^Path: /);
  assert.match(envelope.text, /Reviewed head: a{40}/);
  assert.match(envelope.sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(envelope.text, /normalized_scope|handoff_sha256/);
});
