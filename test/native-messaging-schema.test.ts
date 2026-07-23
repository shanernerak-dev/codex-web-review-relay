import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const schemaPath = resolve("contracts/native-messaging.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validator = `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding="utf-8"))
value = json.load(sys.stdin)
errors = list(Draft202012Validator(schema).iter_errors(value))
if errors:
    print(errors[0].message, file=sys.stderr)
    raise SystemExit(1)
`;
function validate(value: unknown): void {
  execFileSync("python", ["-c", validator, schemaPath], {input: JSON.stringify(value), stdio: ["pipe", "pipe", "pipe"]});
}

test("native v1.3 schema accepts actual extension diagnostics messages", () => {
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 2}, type: "ARM_SESSION", requestId: "arm",
    sessionId: "session", extensionVersion: "0.2.4", capabilities: ["relay-only-v1", "diagnostics-v1"],
  }));
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 2}, type: "DIAGNOSTIC_EVENT", requestId: "diag",
    sessionId: "session", jobId: "048af8d5-acf9-47c6-9448-2c85918710f7",
    level: "info", component: "extension-content", event: "lifecycle_requested",
    eventId: "event-1", sourceTimestamp: "2026-07-23T04:00:00.000Z", sequence: 1,
    bindingGeneration: "binding-1", documentId: "document-1", tabId: 7,
    details: {job_id: "048af8d5-acf9-47c6-9448-2c85918710f7", message_type: "TURN_IDLE", length: 42},
  }));
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: "diag",
    persisted: true, disposition: "appended",
  }));
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 2}, type: "DIAGNOSTIC_ACK", responseToRequestId: "diag",
  }));
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: "diag",
    persisted: false, disposition: "filtered",
  }));
  assert.throws(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: "diag",
    persisted: false, disposition: "appended",
  }));
  const triggerBase = {
    schemaVersion: {major: 1, minor: 3}, requestId: "trigger", sessionId: "session",
    jobId: "048af8d5-acf9-47c6-9448-2c85918710f7", fingerprint: "a".repeat(64),
    envelope: "Path: x", envelopeSha256: "b".repeat(64), reviewMode: "relay-only",
    deadline: "2026-07-23T08:00:00.000Z", ownershipGeneration: 2,
  };
  assert.doesNotThrow(() => validate({...triggerBase, type: "DISPATCH_TRIGGER"}));
  assert.doesNotThrow(() => validate({...triggerBase, type: "RECONCILE_TRIGGER", allowUnsentSend: false}));
  assert.doesNotThrow(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "DISPATCH_TRIGGER_ACCEPTED",
    responseToRequestId: "trigger", sessionId: "session",
    jobId: "048af8d5-acf9-47c6-9448-2c85918710f7", ownershipGeneration: 2,
  }));
  assert.throws(() => validate({...triggerBase, type: "DISPATCH_TRIGGER", ownershipGeneration: undefined}));
  assert.throws(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: "diag",
  }));
  assert.throws(() => validate({
    schemaVersion: {major: 1, minor: 3}, type: "TURN_IDLE", requestId: "idle",
    sessionId: "session", jobId: "048af8d5-acf9-47c6-9448-2c85918710f7", assistantOutput: "verdict",
  }));
  assert.ok(schema.properties.capabilities.items.enum.includes("diagnostics-v1"));
});
