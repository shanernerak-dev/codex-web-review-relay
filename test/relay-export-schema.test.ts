import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {validateRelayExport} from "../src/relay-contract.ts";
import {relayFixture} from "./fixtures.ts";

const schema = JSON.parse(readFileSync(resolve("contracts/relay-export.schema.json"), "utf8"));
const schemaPath = resolve("contracts/relay-export.schema.json");
const PYTHON_SCHEMA_VALIDATOR = `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding="utf-8"))
value = json.load(sys.stdin)
errors = sorted(Draft202012Validator(schema).iter_errors(value), key=lambda error: list(error.path))
if errors:
    print(errors[0].message, file=sys.stderr)
    raise SystemExit(1)
`;

function validatePublishedSchema(value: unknown): void {
  execFileSync("python", ["-c", PYTHON_SCHEMA_VALIDATOR, schemaPath], {
    cwd: resolve("."), input: JSON.stringify(value), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}

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
  const v10 = relayFixture({schema_version: {major: 1, minor: 0}});
  const v11Pr = relayFixture({schema_version: {major: 1, minor: 1}});
  const v11Commit = relayFixture({
    schema_version: {major: 1, minor: 1},
    target_kind: "commit", target_id: "review-schema-check", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-schema-check/main/round-01-review-request.md",
  });
  for (const value of [v10, v11Pr, v11Commit]) {
    assert.doesNotThrow(() => validatePublishedSchema(value));
    assert.doesNotThrow(() => validateRelayExport(value));
  }
  const v10Commit = relayFixture({
    schema_version: {major: 1, minor: 0},
    target_kind: "commit", target_id: "review-schema-check", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-schema-check/main/round-01-review-request.md",
  });
  assert.throws(() => validatePublishedSchema(v10Commit));
  assert.throws(() => validateRelayExport(v10Commit), /RELAY_COMMIT_SCHEMA_MINOR_UNSUPPORTED/);

  const v11CommitOnPrPath = {...v11Commit, handoff_path: v11Pr.handoff_path};
  const v11PrOnCommitPath = {...v11Pr, handoff_path: v11Commit.handoff_path};
  assert.throws(() => validatePublishedSchema(v11CommitOnPrPath));
  assert.throws(() => validatePublishedSchema(v11PrOnCommitPath));
  assert.throws(() => validateRelayExport(v11CommitOnPrPath), /RELAY_TARGET_PATH_MISMATCH/);
  assert.throws(() => validateRelayExport(v11PrOnCommitPath), /RELAY_TARGET_PATH_MISMATCH/);

  // JSON Schema validates structure; runtime closes the dynamic cross-field gap.
  const mismatchedPr = relayFixture({target_pr: 42, target_id: "pr-42"});
  assert.doesNotThrow(() => validatePublishedSchema(mismatchedPr));
  assert.throws(() => validateRelayExport(mismatchedPr), /RELAY_TARGET_PATH_MISMATCH/);
});
