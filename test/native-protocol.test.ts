import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderTriggerEnvelope } from "../src/envelope.ts";
import { JobCoordinator } from "../src/job-coordinator.ts";
import { JobStore } from "../src/job-store.ts";
import { NativeMessageDecoder, encodeNativeMessage } from "../src/native-framing.ts";
import { NativeBridge, NATIVE_SCHEMA_VERSION } from "../src/native-protocol.ts";
import { relayFingerprint } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";

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
    conversationIdentity: "conversation-1",
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
  bridge.markDispatchWritten(job.job_id);
  for (const [type, phase] of [
    ["USER_TURN_ACKED", "USER_TURN_ACKED"],
    ["ASSISTANT_STARTED", "ASSISTANT_STARTED"],
    ["TURN_IDLE", "TURN_IDLE"],
  ]) {
    const ack = bridge.handleInbound({
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type,
      requestId: `event-${type}`,
      sessionId: "session-1",
      jobId: job.job_id,
    });
    assert.equal(ack.phase, phase);
  }
  assert.equal(store.getJob(job.job_id).result, "completed");
  store.close();
  rmSync(root, {recursive: true, force: true});
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
    () => bridge.handleInbound({schemaVersion: {major: 1, minor: 1}, type: "ARM_SESSION"}),
    /NATIVE_SCHEMA_MINOR_UNSUPPORTED/,
  );
  bridge.handleInbound({
    schemaVersion: {major: 1, minor: 0}, type: "ARM_SESSION", requestId: "arm-1",
    sessionId: "session-1", conversationIdentity: "conversation-1", extensionVersion: "0.1.0",
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
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", conversationIdentity: "conversation-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "TURN_TIMEOUT", requestId: "timeout", sessionId: "session-1", jobId: job.job_id});
  assert.equal(store.getJob(job.job_id).phase, "TIMEOUT");
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
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm", sessionId: "session-1", conversationIdentity: "conversation-1", extensionVersion: "0.1.0"});
  bridge.createDispatch({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline});
  bridge.markDispatchWritten(job.job_id);
  coordinator.transition(job.job_id, "RECONCILING");
  bridge.createReconcile({sessionId: "session-1", jobId: job.job_id, fingerprint, envelope: renderTriggerEnvelope(relay), deadline: job.deadline, allowUnsentSend: false});
  bridge.handleInbound({schemaVersion: NATIVE_SCHEMA_VERSION, type: "RECONCILE_MISMATCH", requestId: "mismatch", sessionId: "session-1", jobId: job.job_id});
  assert.equal(store.getJob(job.job_id).phase, "MISMATCH");
  store.close(); rmSync(root, {recursive: true, force: true});
});

test("lifecycle event must match persisted job session and conversation binding", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-native-binding-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const bridge = new NativeBridge(new JobCoordinator(store), 60_000);
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm-a",
    sessionId: "session-a", conversationIdentity: "conversation-a", extensionVersion: "0.1.0",
  });
  bridge.createDispatch({
    sessionId: "session-a", jobId: job.job_id, fingerprint,
    envelope: renderTriggerEnvelope(relay), deadline: job.deadline,
  });
  bridge.markDispatchWritten(job.job_id);
  store.disarmSession("session-a");
  assert.throws(() => bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm-b",
    sessionId: "session-b", conversationIdentity: "conversation-b", extensionVersion: "0.1.0",
  }), /ACTIVE_JOB_SESSION_MISMATCH/);
  assert.throws(() => bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "USER_TURN_ACKED", requestId: "event-b",
    sessionId: "session-b", jobId: job.job_id,
  }), /SESSION_NOT_ARMED/);
  assert.equal(store.getJob(job.job_id).phase, "SESSION_LOST");
  store.close();
  rmSync(root, {recursive: true, force: true});
});
