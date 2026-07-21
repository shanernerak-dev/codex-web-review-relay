import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RelayConfig } from "../src/config.ts";
import { JobCoordinator } from "../src/job-coordinator.ts";
import { JobStore } from "../src/job-store.ts";
import { NativeBridge, NATIVE_SCHEMA_VERSION } from "../src/native-protocol.ts";
import { ReviewTransportService } from "../src/review-transport.ts";
import { relayFixture } from "./fixtures.ts";

function config(root: string, deadline = 1_000): RelayConfig {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: ["http://127.0.0.1:43127"],
    bearerTokenPath: join(root, "token"), stateDbPath: join(root, "state.sqlite"),
    repositoryRoot: root, pythonExecutable: "python", helperPath: "helper.py",
    nativeHostName: "dev.test.relay", extensionId: "a".repeat(32), requestDeadlineMs: deadline,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "review-relay-transport-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator, 60_000);
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "arm",
    sessionId: "session-1", extensionVersion: "0.1.0",
  });
  return {root, store, coordinator, bridge};
}

function lifecycle(bridge: NativeBridge, type: string, jobId: string): void {
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type, requestId: `event-${type}`,
    sessionId: "session-1", jobId,
  });
}

function acceptOutbound(bridge: NativeBridge, message: Record<string, unknown>): void {
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION,
    type: `${message.type}_ACCEPTED`,
    responseToRequestId: message.requestId,
    sessionId: message.sessionId,
    jobId: message.jobId,
  });
}

test("request_review dispatches once and concurrent retry shares the persisted job", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const dispatches: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(
    config(root), store, coordinator, bridge, (message) => { dispatches.push(message); setImmediate(() => acceptOutbound(bridge, message)); },
    async () => relayFixture(),
  );
  try {
    const first = service.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dispatches.length, 1);
    const jobId = dispatches[0].jobId as string;
    const retry = service.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dispatches.length, 1);
    lifecycle(bridge, "USER_TURN_ACKED", jobId);
    lifecycle(bridge, "ASSISTANT_STARTED", jobId);
    lifecycle(bridge, "TURN_IDLE", jobId);
    const [firstResult, retryResult] = await Promise.all([first, retry]);
    assert.equal(firstResult.job_id, retryResult.job_id);
    assert.equal(firstResult.phase, "TURN_IDLE");
    assert.equal(firstResult.result, "completed");
    assert.equal((await service.getStatus({job_id: jobId})).phase, "TURN_IDLE");
    assert.equal((await service.getStatus({handoff_path: relayFixture().handoff_path})).job_id, jobId);
  } finally {
    store.close(); rmSync(root, {recursive: true, force: true});
  }
});

test("request_review fails before job creation when no session is armed", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-offline-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const coordinator = new JobCoordinator(store);
  const service = new ReviewTransportService(config(root), store, coordinator, new NativeBridge(coordinator), () => {}, async () => relayFixture());
  try {
    await assert.rejects(service.requestReview(relayFixture().handoff_path), /SESSION_NOT_ARMED/);
    assert.equal(store.getActiveJob(), null);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("dispatch write failure is persisted and retry performs reconciliation without a second dispatch", async () => {
  const {root, store, coordinator, bridge} = fixture();
  let writes = 0;
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    if (message.type === "DISPATCH_TRIGGER") { writes += 1; throw new Error("write failed"); }
    assert.equal(message.type, "RECONCILE_TRIGGER");
    setImmediate(() => { acceptOutbound(bridge, message); lifecycle(bridge, "RECONCILE_MISMATCH", message.jobId as string); });
  }, async () => relayFixture());
  try {
    await assert.rejects(service.requestReview(relayFixture().handoff_path), /write failed/);
    assert.equal(store.getActiveJob()?.phase, "SEND_UNCERTAIN");
    const retry = await service.requestReview(relayFixture().handoff_path);
    assert.equal(retry.phase, "MISMATCH");
    assert.equal(writes, 1);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("bounded wait persists timeout and path lookup rejects drift", async () => {
  const {root, store, coordinator, bridge} = fixture();
  let relay = relayFixture();
  const service = new ReviewTransportService(config(root, 15), store, coordinator, bridge, (message) => setImmediate(() => acceptOutbound(bridge, message)), async () => relay);
  try {
    const timedOut = await service.requestReview(relay.handoff_path);
    assert.equal(timedOut.phase, "TIMEOUT");
    relay = relayFixture({handoff_sha256: "d".repeat(64)});
    await assert.rejects(service.getStatus({handoff_path: relay.handoff_path}), /HANDOFF_LOOKUP_DRIFT/);
    await assert.rejects(service.getStatus({}), /STATUS_LOOKUP_KEY_INVALID/);
    await assert.rejects(service.getStatus({job_id: timedOut.job_id, handoff_path: relay.handoff_path}), /STATUS_LOOKUP_KEY_INVALID/);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("restart reconciles instead of issuing a second dispatch and permits at most one recovery send", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const firstWrites: Record<string, unknown>[] = [];
  const firstService = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => { firstWrites.push(message); setImmediate(() => acceptOutbound(bridge, message)); }, async () => relayFixture());
  try {
    const original = firstService.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(firstWrites[0].type, "DISPATCH_TRIGGER");
    const jobId = firstWrites[0].jobId as string;

    const recoveryWrites: Record<string, unknown>[] = [];
    const restarted = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => { recoveryWrites.push(message); setImmediate(() => acceptOutbound(bridge, message)); }, async () => relayFixture());
    const recovered = restarted.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(recoveryWrites[0].type, "RECONCILE_TRIGGER");
    assert.equal(recoveryWrites[0].allowUnsentSend, true);
    assert.equal(firstWrites.length, 1);

    const secondRecoveryWrites: Record<string, unknown>[] = [];
    const restartedAgain = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => { secondRecoveryWrites.push(message); setImmediate(() => acceptOutbound(bridge, message)); }, async () => relayFixture());
    const recoveredAgain = restartedAgain.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(secondRecoveryWrites[0].type, "RECONCILE_TRIGGER");
    assert.equal(secondRecoveryWrites[0].allowUnsentSend, false);

    lifecycle(bridge, "USER_TURN_ACKED", jobId);
    lifecycle(bridge, "ASSISTANT_STARTED", jobId);
    lifecycle(bridge, "TURN_IDLE", jobId);
    const results = await Promise.all([original, recovered, recoveredAgain]);
    assert.ok(results.every((result) => result.phase === "TURN_IDLE"));
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});
