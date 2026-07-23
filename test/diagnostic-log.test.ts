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
  logger.write("trace", "content", "ignored", {job_id: "job-a"});
  logger.write("info", "content", "observed", {job_id: "job-a", length: 42, envelope: "secret"});
  logger.write("error", "native", "failed", {job_id: "job-b", error_code: "PORT_CLOSED"});
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
    logger.write("trace", "content", "snapshot", {job_id: "job-a", attempt: index, state: "x".repeat(100)});
  }
  const result = logger.query("job-a", 5);
  assert.equal(result.events.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.events[4].attempt, 699);
  rmSync(root, {recursive: true, force: true});
});
