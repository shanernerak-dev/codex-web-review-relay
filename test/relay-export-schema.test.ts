import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {validateRelayExport} from "../src/relay-contract.ts";
import {relayFixture} from "./fixtures.ts";

const schema = JSON.parse(readFileSync(resolve("contracts/relay-export.schema.json"), "utf8"));

test("published relay-export schema requires mode identity for v1.1 branches", () => {
  assert.equal(schema.oneOf.length, 3);
  const [v10, v11Pr, v11Commit] = schema.oneOf;
  assert.ok(v10.required.includes("target_pr"));
  assert.deepEqual(v11Pr.required, ["target_kind", "target_id", "target_pr"]);
  assert.deepEqual(v11Commit.required, ["target_kind", "target_id", "target_pr"]);
  assert.equal(v11Pr.properties.target_kind.const, "pr");
  assert.equal(v11Commit.properties.target_kind.const, "commit");
  assert.equal(v11Commit.properties.target_pr.const, null);
});

test("schema branch fixtures and runtime validator agree on PR versus commit identity", () => {
  assert.doesNotThrow(() => validateRelayExport(relayFixture({schema_version: {major: 1, minor: 0}})));
  assert.doesNotThrow(() => validateRelayExport(relayFixture({schema_version: {major: 1, minor: 1}})));
  assert.doesNotThrow(() => validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 1},
    target_kind: "commit", target_id: "review-schema-check", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-schema-check/main/round-01-review-request.md",
  })));
  assert.throws(() => validateRelayExport(relayFixture({
    schema_version: {major: 1, minor: 0},
    target_kind: "commit", target_id: "review-schema-check", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-schema-check/main/round-01-review-request.md",
  })), /RELAY_COMMIT_SCHEMA_MINOR_UNSUPPORTED/);
});
