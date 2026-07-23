import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiagnosticLogger } from "../src/diagnostic-log.ts";

test("diagnostic log filters levels, redacts unknown fields, and queries by job", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostics-"));
  const path = join(root, "events.jsonl");
  const logger = new DiagnosticLogger(path, "debug", 65_536, 2);
  logger.write("trace", "extension-content", "completion_snapshot", {job_id: "job-a"});
  logger.write("info", "extension-content", "user_turn_observed", {job_id: "job-a", length: 42, envelope: "secret"});
  logger.write("error", "native-host", "message_failed", {job_id: "job-b", error_code: "PORT_CLOSED"});
  const result = logger.query("job-a");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].length, 42);
  assert.equal("envelope" in result.events[0], false);
  assert.doesNotMatch(readFileSync(path, "utf8"), /secret/);
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic log rotates and preserves recent matching events", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostics-"));
  const path = join(root, "events.jsonl");
  const logger = new DiagnosticLogger(path, "trace", 65_536, 2);
  for (let index = 0; index < 700; index += 1) {
    logger.write("trace", "extension-content", "completion_snapshot", {job_id: "job-a", attempt: index, state: "x".repeat(100)});
  }
  const result = logger.query("job-a", 5);
  assert.equal(result.events.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.events[4].attempt, 699);
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic log rejects nested values and never throws on filesystem failure", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostics-"));
  const logger = new DiagnosticLogger(root, "trace", 65_536, 2);
  assert.equal(logger.write("info", "extension-content", "user_turn_observed", {
    job_id: "job-a", state: {assistantOutput: "secret"}, turn_id: ["secret"],
  }), false);
  assert.ok(logger.lastError);
  assert.deepEqual(logger.query("job-a").events, []);
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic query deduplicates event IDs across native restarts", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostics-"));
  const path = join(root, "events.jsonl");
  new DiagnosticLogger(path, "info", 65_536, 2).write("info", "extension-content", "user_turn_observed", {job_id: "job-a", event_id: "event-1"});
  new DiagnosticLogger(path, "info", 65_536, 2).write("info", "extension-content", "user_turn_observed", {job_id: "job-a", event_id: "event-1"});
  assert.equal(new DiagnosticLogger(path, "info", 65_536, 2).query("job-a").events.length, 1);
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic query preserves bounded turn-structure evidence without message text", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostic-turn-"));
  const path = join(root, "events.jsonl");
  const logger = new DiagnosticLogger(path, "info", 65_536, 2);
  assert.equal(logger.write("info", "extension-content", "turn_candidate_observed", {
    job_id: "job-a",
    turn_key_sha256: "a".repeat(64),
    fragment_key_sha256: "b".repeat(64),
    role: "user",
    turn_index: 1,
    fragment_index: 0,
    fragment_count: 2,
    length: 42,
    byte_length: 44,
    sha256: "c".repeat(64),
    classification: "new",
    envelope: "must not persist",
  }), true);
  const [event] = logger.query("job-a").events;
  assert.equal(event.turn_key_sha256, "a".repeat(64));
  assert.equal(event.fragment_count, 2);
  assert.equal(event.envelope, undefined);
  rmSync(root, {recursive: true, force: true});
});
