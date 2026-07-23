import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderTriggerEnvelope } from "../src/envelope.ts";
import { sha256 } from "../src/canonical.ts";
import { JobCoordinator } from "../src/job-coordinator.ts";
import { JobStore } from "../src/job-store.ts";
import { NativeMessageDecoder, encodeNativeMessage } from "../src/native-framing.ts";
import { NativeBridge, NATIVE_SCHEMA_VERSION } from "../src/native-protocol.ts";
import { relayFingerprint } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";
import { DiagnosticLogger } from "../src/diagnostic-log.ts";

test("native framing handles partial and multiple messages", () => {
  const first = encodeNativeMessage({value: 1});
  const second = encodeNativeMessage({value: 2});
  const decoder = new NativeMessageDecoder();
  assert.deepEqual(decoder.push(first.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(3), second])), [{value: 1}, {value: 2}]);
});

test("native bridge correlates session and lifecycle events", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator, 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  const armed = bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION,
    type: "ARM_SESSION",
    requestId: "arm-1",
    sessionId: "session-1",
    extensionVersion: "0.1.0",
  });
  assert.equal(armed.responseToRequestId, "arm-1");
  const dispatch = bridge.createDispatch({
    sessionId: "session-1",
    jobId: job.job_id,
    fingerprint,
    envelope: renderTriggerEnvelope(relay),
    deadline: job.deadline,
  });
  assert.equal(dispatch.type, "DISPATCH_TRIGGER");
  assert.equal(dispatch.reviewMode, "pr-comment");
  bridge.markDispatchWritten(job.job_id);
  for (const [type, phase] of [
    ["USER_TURN_ACKED", "USER_TURN_ACKED"],
    ["ASSISTANT_STARTED", "ASSISTANT_STARTED"],
    ["TURN_IDLE", "TURN_IDLE"],
  ]) {
    const assistantOutput = type === "TURN_IDLE" ? "formal verdict output" : undefined;
    const ack = bridge.handleInbound({
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type,
      requestId: `event-${type}`,
      sessionId: "session-1",
      jobId: job.job_id,
      ...(assistantOutput ? {assistantOutput} : {}),
    });
    assert.equal(ack.phase, phase);
  }
  assert.equal(store.getJob(job.job_id).result, "completed");
  assert.equal(store.getJob(job.job_id).assistant_output, "formal verdict output");
  assert.equal(store.getJob(job.job_id).assistant_output_sha256, sha256("formal verdict output"));
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic filesystem failure cannot block TURN_IDLE persistence or ACK", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-log-failure-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const diagnostics = new DiagnosticLogger(root, "trace", 65_536, 2);
  const bridge = new NativeBridge(coordinator, 60_000, diagnostics);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session", extensionVersion: "0.2.4"});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "user", sessionId: "session", jobId: job.job_id});
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ASSISTANT_STARTED", requestId: "assistant", sessionId: "session", jobId: job.job_id});
  assert.equal(diagnostics.write("info", "native-host", "lifecycle_native_received", {job_id: job.job_id}), false);
  const ack = bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "TURN_IDLE", requestId: "idle", sessionId: "session", jobId: job.job_id, assistantOutput: "complete verdict"});
  assert.equal(ack?.type, "EVENT_ACK");
  assert.equal(store.getJob(job.job_id).assistant_output_sha256, sha256("complete verdict"));
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("expired owning session can submit one SESSION_LOST abandonment", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-expired-loss-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  store.armSession({sessionId: "expired-owner", extensionVersion: "0.2.6", schemaMajor: 1, schemaMinor: 2, leaseMs: 1, now: new Date(0)});
  store.bindJobSession(job.job_id, "expired-owner");
  coordinator.transition(job.job_id, "DISPATCHED");
  const ack = bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "SESSION_LOST", requestId: "lost",
    sessionId: "expired-owner", jobId: job.job_id, errorCode: "PAGE_CLOSED",
  });
  assert.equal(ack?.phase, "SESSION_LOST");
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("diagnostic ACK is withheld when persistence fails", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-diagnostic-ack-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const logger = new DiagnosticLogger(root, "info", 65_536, 2);
  const bridge = new NativeBridge(new JobCoordinator(store), 30_000, logger);
  assert.throws(() => bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "DIAGNOSTIC_EVENT", requestId: "diag",
    level: "info", component: "extension-content", event: "user_turn_observed",
    eventId: "event-1", sourceTimestamp: new Date().toISOString(), sequence: 1,
    details: {job_id: "job-a"},
  }), /DIAGNOSTIC_PERSIST_FAILED/);
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("native dispatch carries relay-only mode for commit-only targets", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-commit-mode-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator, 60_000);
  const relay = relayFixture({
    schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-local-run", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-local-run/main/round-01-review-request.md",
  });
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.2.0", capabilities: ["relay-only-v1"]});
  const dispatch = bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), reviewMode: "relay-only", deadline: job.deadline});
  assert.equal(dispatch.reviewMode, "relay-only");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge rejects relay-only dispatch for a legacy extension before DOM work", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-legacy-relay-only-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator, 60_000);
  const relay = relayFixture({
    schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-legacy-check", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-legacy-check/main/round-01-review-request.md",
  });
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: {major: 1, minor: 0}, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  assert.throws(
    () => bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), reviewMode: "relay-only", deadline: job.deadline}),
    /RELAY_ONLY_EXTENSION_UNSUPPORTED/,
  );
  assert.equal(store.getJob(job.job_id).phase, "CREATED");
  bridge.markDispatchWritten(job.job_id);
  coordinator.transition(job.job_id, "RECONCILING");
  assert.throws(
    () => bridge.createReconcile({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), reviewMode: "relay-only", deadline: job.deadline, allowUnsentSend: false}),
    /RELAY_ONLY_EXTENSION_UNSUPPORTED/,
  );
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge rejects oversized assistant output before completing the job", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-output-limit-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "user", sessionId: "session-1", jobId: job.job_id});
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ASSISTANT_STARTED", requestId: "assistant", sessionId: "session-1", jobId: job.job_id});
  assert.throws(() => bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "TURN_IDLE", requestId: "idle", sessionId: "session-1", jobId: job.job_id, assistantOutput: "x".repeat(131_073)}), /ASSISTANT_OUTPUT_TOO_LARGE/);
  assert.equal(store.getJob(job.job_id).phase, "ASSISTANT_STARTED");
  assert.equal(store.getJob(job.job_id).assistant_output, null);
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge requires assistant output for TURN_IDLE", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-output-required-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "user", sessionId: "session-1", jobId: job.job_id});
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ASSISTANT_STARTED", requestId: "assistant", sessionId: "session-1", jobId: job.job_id});
  assert.throws(() => bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "TURN_IDLE", requestId: "idle", sessionId: "session-1", jobId: job.job_id}), /ASSISTANT_OUTPUT_REQUIRED/);
  assert.equal(store.getJob(job.job_id).phase, "ASSISTANT_STARTED");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge rejects unknown schema major", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-version-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store));
  assert.throws(
    () => bridge.handleInbound({schemaVersion: {major: 2, minor: 0}, type: "HEARTBEAT"}),
    /NATIVE_SCHEMA_MAJOR_UNSUPPORTED/,
  );
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("native bridge rejects unsupported minor and records peer version", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-minor-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store));
  assert.throws(
    () => bridge.handleInbound({schemaVersion: {major: 1, minor: 3}, type: "ARM_SESSION"}),
    /NATIVE_SCHEMA_MINOR_UNSUPPORTED/,
  );
  bridge.handleInbound({
    schemaVersion: {major: 1, minor: 0}, type: "ARM_SESSION", requestId: "arm-1",
    sessionId: "session-1", extensionVersion: "0.1.0",
  });
  assert.equal(store.getActiveSession()?.schema_major, 1);
  assert.equal(store.getActiveSession()?.schema_minor, 0);
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("native bridge maps extension deadline to TIMEOUT", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-timeout-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "TURN_TIMEOUT", requestId: "timeout", sessionId: "session-1", jobId: job.job_id});
  assert.equal(store.getJob(job.job_id).phase, "TIMEOUT");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge persists the extension send failure code", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-send-error-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "SEND_UNCERTAIN", requestId: "send-error", sessionId: "session-1", jobId: job.job_id, errorCode: "SEND_BUTTON_ENABLE_TIMEOUT"});
  assert.equal(store.getJob(job.job_id).phase, "SEND_UNCERTAIN");
  assert.equal(store.getJob(job.job_id).error_code, "SEND_BUTTON_ENABLE_TIMEOUT");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge accepts fail-closed reconciliation mismatch", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-reconcile-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator, 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  coordinator.transition(job.job_id, "RECONCILING");
  bridge.createReconcile({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline, allowUnsentSend: false});
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "RECONCILE_MISMATCH", requestId: "mismatch", sessionId: "session-1", jobId: job.job_id});
  assert.equal(store.getJob(job.job_id).phase, "MISMATCH");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("a newly manually armed session can continue the unresolved job", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-binding-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm-a",
    sessionId: "session-a", extensionVersion: "0.1.0",
  });
  bridge.createDispatch({
    sessionId: "session-a", jobId: job.job_id, fingerprint,
    envelope: renderTriggerEnvelope(relay), deadline: job.deadline,
  });
  bridge.markDispatchWritten(job.job_id);
  store.disarmSession("session-a");
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm-b",
    sessionId: "session-b", extensionVersion: "0.1.0",
  });
  const ack = bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "event-b",
    sessionId: "session-b", jobId: job.job_id,
  });
  assert.equal(ack.phase, "USER_TURN_ACKED");
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("native bridge requires correlated dispatch acceptance and tolerates duplicate acknowledgements", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-ack-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  const dispatch = bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  const accepted = bridge.expectOutboundAck(dispatch, 100);
  const acknowledgement = {
    schemaVersion: NATIVE_SCHEMA_VERSION,
    type: "DISPATCH_TRIGGER_ACCEPTED",
    responseToRequestId: dispatch.requestId,
    sessionId: "session-1",
    jobId: job.job_id,
  };
  assert.equal(bridge.handleInbound(acknowledgement), null);
  await accepted;
  assert.equal(bridge.handleInbound(acknowledgement), null);

  bridge.markDispatchWritten(job.job_id);
  const event = {schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "user-event", sessionId: "session-1", jobId: job.job_id};
  assert.equal(bridge.handleInbound(event)?.phase, "USER_TURN_ACKED");
  assert.equal(bridge.handleInbound({...event, requestId: "user-event-retry"})?.phase, "USER_TURN_ACKED");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("native bridge fails a dropped dispatch acknowledgement within the bound", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-ack-timeout-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", extensionVersion: "0.1.0"});
  const dispatch = bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  await assert.rejects(bridge.expectOutboundAck(dispatch, 5), /NATIVE_OUTBOUND_ACK_TIMEOUT/);
  store.close(); rmSync(root, {recursive: true, force: true});
});
