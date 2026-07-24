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
import { relayFingerprint } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";

function config(root: string, waitSlice = 1_000, turnDeadline = 60_000): RelayConfig {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: ["http://127.0.0.1:43127"],
    bearerTokenPath: join(root, "token"), stateDbPath: join(root, "state.sqlite"),
    pythonExecutable: "python", exporterPath: join(root, "relay_export_helper.py"), trustedInstallRoot: root,
    nativeHostName: "dev.test.relay", extensionId: "a".repeat(32), requestWaitSliceMs: waitSlice, turnDeadlineMs: turnDeadline,
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

function lifecycle(bridge: NativeBridge, type: string, jobId: string, assistantOutput?: string): void {
  const job = bridge.coordinator.store.getJob(jobId);
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION, type, requestId: `event-${type}`,
    sessionId: "session-1", jobId, ownershipGeneration: job.ownership_generation,
    ...(assistantOutput !== undefined ? {assistantOutput} : {}),
  });
}

function acceptOutbound(bridge: NativeBridge, message: Record<string, unknown>): void {
  bridge.handleInbound({
    schemaVersion: NATIVE_SCHEMA_VERSION,
    type: `${message.type}_ACCEPTED`,
    responseToRequestId: message.requestId,
    sessionId: message.sessionId,
    jobId: message.jobId,
    ownershipGeneration: message.ownershipGeneration,
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
    lifecycle(bridge, "TURN_IDLE", jobId, "formal verdict output");
    const [firstResult, retryResult] = await Promise.all([first, retry]);
    assert.equal(firstResult.job_id, retryResult.job_id);
    assert.equal(firstResult.phase, "TURN_IDLE");
    assert.equal(firstResult.result, "completed");
    assert.equal(firstResult.assistant_output, "formal verdict output");
    assert.match(firstResult.assistant_output_sha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal((await service.getStatus({job_id: jobId})).phase, "TURN_IDLE");
  assert.equal((await service.getStatus({job_id: jobId})).job_id, jobId);
  } finally {
    store.close(); rmSync(root, {recursive: true, force: true});
  }
});

test("terminal same-fingerprint retries do not require an armed session", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => setImmediate(() => acceptOutbound(bridge, message)), async () => relayFixture());
  try {
    const pending = service.requestReview(relayFixture().handoff_path);
    await new Promise((resolve) => setImmediate(resolve));
    const job = store.getActiveJob();
    assert.ok(job);
    lifecycle(bridge, "USER_TURN_ACKED", job.job_id);
    lifecycle(bridge, "ASSISTANT_STARTED", job.job_id);
    lifecycle(bridge, "TURN_IDLE", job.job_id, "review complete");
    const completed = await pending;
    store.disarmSession("session-1");
    const retry = await service.requestReview(relayFixture().handoff_path);
    assert.equal(retry.job_id, completed.job_id);
    assert.equal(retry.phase, "TURN_IDLE");
    assert.equal(retry.assistant_output, "review complete");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("mismatch and timeout same-fingerprint retries do not require an armed session", async () => {
  for (const terminal of ["MISMATCH", "TIMEOUT"] as const) {
    const root = mkdtempSync(join(tmpdir(), `review-relay-terminal-${terminal.toLowerCase()}-`));
    const store = new JobStore(join(root, "state.sqlite"));
    const coordinator = new JobCoordinator(store);
    const relay = relayFixture();
    const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
    coordinator.transition(job.job_id, terminal, `TEST_${terminal}`);
    const service = new ReviewTransportService(config(root), store, coordinator, new NativeBridge(coordinator), () => { throw new Error("UNEXPECTED_WRITE"); }, async () => relay);
    try {
      const retry = await service.requestReview(relay.handoff_path);
      assert.equal(retry.job_id, job.job_id);
      assert.equal(retry.phase, terminal);
    } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
  }
});

test("expired created and recovery jobs time out before dispatch or recovery claim", async () => {
  for (const phase of ["CREATED", "SEND_UNCERTAIN"] as const) {
    const {root, store, coordinator, bridge} = fixture();
    const writes: Record<string, unknown>[] = [];
    const relay = relayFixture();
    const fingerprint = relayFingerprint(relay);
    const job = store.createOrGetJob(relay, fingerprint, new Date(Date.now() - 1_000)).job;
    if (phase === "SEND_UNCERTAIN") coordinator.transition(job.job_id, "SEND_UNCERTAIN", "TEST_RECOVERY");
    const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => writes.push(message), async () => relay);
    try {
      const result = await service.requestReview(relay.handoff_path);
      assert.equal(result.phase, "TIMEOUT");
      assert.equal(writes.length, 0);
      assert.equal(store.getJob(job.job_id).recovery_send_used, 0);
    } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
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

test("operator-authorized recovery retries one terminal mismatch exactly once", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  let dispatchWrites = 0;
  let reconcileWrites = 0;
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    if (message.type === "DISPATCH_TRIGGER") {
      dispatchWrites += 1;
      throw new Error("write failed");
    }
    reconcileWrites += 1;
    setImmediate(() => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
      lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
      lifecycle(bridge, "TURN_IDLE", message.jobId as string, "recovered verdict");
    });
  }, async () => relay);
  try {
    await assert.rejects(service.requestReview(relay.handoff_path), /write failed/);
    const mismatchService = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "RECONCILE_MISMATCH", message.jobId as string);
    }, async () => relay);
    assert.equal((await mismatchService.requestReview(relay.handoff_path)).phase, "MISMATCH");
    const recovered = await service.recoverReview(relay.handoff_path, true);
    assert.equal(recovered.phase, "TURN_IDLE");
    assert.equal(recovered.assistant_output, "recovered verdict");
    assert.equal(dispatchWrites, 1);
    assert.equal(reconcileWrites, 1);
    await assert.rejects(service.recoverReview(relay.handoff_path, true), /MANUAL_RECOVERY_ALREADY_USED/);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("manual recovery requires explicit confirmation and respects the deadline", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  coordinator.transition(job.job_id, "MISMATCH", "TEST_MISMATCH");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => { throw new Error("UNEXPECTED_WRITE"); }, async () => relay);
  try {
    await assert.rejects(service.recoverReview(relay.handoff_path, false), /MANUAL_RECOVERY_CONFIRMATION_REQUIRED/);
    store.db.prepare("UPDATE jobs SET deadline = ? WHERE job_id = ?").run(new Date(Date.now() - 1_000).toISOString(), job.job_id);
    await assert.rejects(service.recoverReview(relay.handoff_path, true), /MANUAL_RECOVERY_DEADLINE_EXPIRED/);
    assert.equal(store.getJob(job.job_id).phase, "MISMATCH");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("manual recovery rejects a changed fingerprint after reviewed head drift", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  coordinator.transition(job.job_id, "MISMATCH", "TEST_MISMATCH");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    setImmediate(() => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
      lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
      lifecycle(bridge, "TURN_IDLE", message.jobId as string, "historical recovery");
    });
  }, async () => ({...relay, reviewed_head: "b".repeat(40)}));
  try {
    await assert.rejects(service.recoverReview(relay.handoff_path, true), /JOB_NOT_FOUND/);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("ordinary request_review fails closed instead of creating a second job after head drift", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  coordinator.transition(job.job_id, "MISMATCH", "TEST_MISMATCH");
  const writes: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => writes.push(message), async () => ({...relay, reviewed_head: "c".repeat(40)}));
  try {
    await assert.rejects(service.requestReview(relay.handoff_path), new RegExp(`MISMATCH_EXISTING_JOB:${job.job_id}`));
    assert.equal(writes.length, 0);
    assert.equal(store.getJobByHandoff(relay.repository, relay.handoff_path).job_id, job.job_id);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("manual recovery rejects a pre-migration job without historical relay export", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  store.db.prepare("UPDATE jobs SET relay_json = NULL WHERE job_id = ?").run(job.job_id);
  coordinator.transition(job.job_id, "MISMATCH", "TEST_MISMATCH");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => { throw new Error("UNEXPECTED_WRITE"); }, async () => relay);
  try {
    await assert.rejects(service.recoverReview(relay.handoff_path, true), /HISTORICAL_RELAY_UNAVAILABLE/);
    assert.equal(store.getJob(job.job_id).phase, "MISMATCH");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("commit-only capability preflight creates no job and does not block a later PR review", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const commitRelay = relayFixture({
    schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-capability-preflight", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-capability-preflight/main/round-01-review-request.md",
  });
  const prRelay = relayFixture();
  const writes: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    writes.push(message);
    setImmediate(() => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
      lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
      lifecycle(bridge, "TURN_IDLE", message.jobId as string, "PR confirmation");
    });
  }, async (_config, handoffPath) => handoffPath.includes("review-capability-preflight") ? commitRelay : prRelay);
  try {
    await assert.rejects(service.requestReview(commitRelay.handoff_path), /RELAY_ONLY_EXTENSION_UNSUPPORTED/);
    assert.equal(store.getActiveJob(), null);
    const prResult = await service.requestReview(prRelay.handoff_path);
    assert.equal(prResult.phase, "TURN_IDLE");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].reviewMode, "pr-comment");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("capability failure leaves an existing recovery job unchanged", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const commitRelay = relayFixture({
    schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-capability-recovery", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-capability-recovery/main/round-01-review-request.md",
  });
  const recoveryJob = store.createOrGetJob(commitRelay, relayFingerprint(commitRelay), new Date(Date.now() + 60_000)).job;
  coordinator.transition(recoveryJob.job_id, "MISMATCH", "TEST_MISMATCH");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => {}, async () => commitRelay);
  try {
    const before = store.getJob(recoveryJob.job_id);
    await assert.rejects(service.recoverReview(commitRelay.handoff_path, true), /RELAY_ONLY_EXTENSION_UNSUPPORTED/);
    const after = store.getJob(recoveryJob.job_id);
    assert.equal(after.phase, before.phase);
    assert.equal(after.recovery_send_used, before.recovery_send_used);
    assert.equal(after.manual_recovery_used, before.manual_recovery_used);

  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("unsupported commit retries leave CREATED and RECONCILING rows unchanged", async () => {
  for (const initialPhase of ["CREATED", "RECONCILING"] as const) {
    const {root, store, coordinator, bridge} = fixture();
    const commitRelay = relayFixture({
      schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: `review-capability-${initialPhase.toLowerCase()}`, target_pr: null,
      handoff_path: `.agent/review_handoffs/review-capability-${initialPhase.toLowerCase()}/main/round-01-review-request.md`,
    });
    const fingerprint = relayFingerprint(commitRelay);
    const job = store.createOrGetJob(commitRelay, fingerprint, new Date(Date.now() + 60_000)).job;
    if (initialPhase === "RECONCILING") {
      coordinator.transition(job.job_id, "DISPATCHED");
      coordinator.transition(job.job_id, "RECONCILING");
    }
    const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => {
      throw new Error("UNEXPECTED_WRITE");
    }, async () => commitRelay);
    try {
      const before = store.getJob(job.job_id);
      await assert.rejects(service.requestReview(commitRelay.handoff_path), /RELAY_ONLY_EXTENSION_UNSUPPORTED/);
      const after = store.getJob(job.job_id);
      assert.equal(after.phase, initialPhase);
      assert.equal(after.recovery_send_used, before.recovery_send_used);
    } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
  }
});

test("legacy unsupported commit rows are blocked before a later PR dispatch", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const staleRelay = relayFixture({
    schema_version: {major: 1, minor: 1}, target_kind: "commit", target_id: "review-capability-stale", target_pr: null,
    handoff_path: ".agent/review_handoffs/review-capability-stale/main/round-01-review-request.md",
  });
  const prRelay = relayFixture();
  const stale = store.createOrGetJob(staleRelay, relayFingerprint(staleRelay), new Date(Date.now() + 60_000)).job;
  const writes: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    writes.push(message);
    setImmediate(() => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
      lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
      lifecycle(bridge, "TURN_IDLE", message.jobId as string, "PR confirmation");
    });
  }, async (_config, handoffPath) => handoffPath === prRelay.handoff_path ? prRelay : staleRelay);
  try {
    const result = await service.requestReview(prRelay.handoff_path);
    assert.equal(result.phase, "TURN_IDLE");
    assert.equal(store.getJob(stale.job_id).phase, "BLOCKED");
    assert.equal(store.getJob(stale.job_id).error_code, "RELAY_ONLY_EXTENSION_UNSUPPORTED");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].reviewMode, "pr-comment");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("legacy PR rows with review-* streams are never classified as commit rows", async () => {
  for (const relayJson of [null, "{invalid-json"] as const) {
    const {root, store, coordinator, bridge} = fixture();
    const legacyPr = relayFixture({
      handoff_path: ".agent/review_handoffs/pr-41/review-main/round-01-review-request.md",
      review_stream: "review-main",
    });
    const nextPr = relayFixture({
      handoff_path: ".agent/review_handoffs/pr-41/review-main/round-02-review-request.md",
      review_stream: "review-main",
      handoff_sha256: "c".repeat(64),
    });
    const oldJob = store.createOrGetJob(legacyPr, relayFingerprint(legacyPr), new Date(Date.now() + 60_000)).job;
    coordinator.transition(oldJob.job_id, "DISPATCHED");
    store.db.prepare("UPDATE jobs SET relay_json = ? WHERE job_id = ?").run(relayJson, oldJob.job_id);
    const writes: Record<string, unknown>[] = [];
    const service = new ReviewTransportService(
      config(root), store, coordinator, bridge,
      (message) => writes.push(message),
      async (_config, handoffPath) => handoffPath === nextPr.handoff_path ? nextPr : legacyPr,
    );
    try {
      await assert.rejects(service.requestReview(nextPr.handoff_path), /ACTIVE_JOB_EXISTS/);
      assert.equal(store.getJob(oldJob.job_id).phase, "DISPATCHED");
      assert.equal(store.getJob(oldJob.job_id).error_code, null);
      assert.equal(writes.length, 0);
    } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
  }
});

test("pre-Stage-3 PR rows keep terminal idempotency, mismatch recovery, and status readability", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const currentRelay = relayFixture();
  const oldRelay: any = {...currentRelay};
  delete oldRelay.target_kind;
  delete oldRelay.target_id;
  const fingerprint = relayFingerprint(oldRelay);
  const job = store.createOrGetJob(oldRelay, fingerprint, new Date(Date.now() + 60_000)).job;
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, (message) => {
    setImmediate(() => {
      acceptOutbound(bridge, message);
      lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
      lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
      lifecycle(bridge, "TURN_IDLE", message.jobId as string, "legacy-compatible verdict");
    });
  }, async () => currentRelay);
  try {
    coordinator.transition(job.job_id, "TIMEOUT", "OLD_TIMEOUT");
    const terminal = await service.requestReview(currentRelay.handoff_path);
    assert.equal(terminal.job_id, job.job_id);
    assert.equal(terminal.phase, "TIMEOUT");

    store.db.prepare("UPDATE jobs SET phase = 'MISMATCH', result = 'mismatch', error_code = 'OLD_MISMATCH', deadline = ? WHERE job_id = ?")
      .run(new Date(Date.now() + 60_000).toISOString(), job.job_id);
    const recovered = await service.recoverReview(currentRelay.handoff_path, true);
    assert.equal(recovered.job_id, job.job_id);
    assert.equal(recovered.phase, "TURN_IDLE");

    store.db.prepare("UPDATE jobs SET relay_json = NULL WHERE job_id = ?").run(job.job_id);
    const byId = await service.getStatus({job_id: job.job_id});
    assert.equal(byId.target_kind, "pr");
    assert.equal(byId.target_id, "pr-41");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("soft wait slice returns in-progress and same-fingerprint retry completes without redispatch", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const dispatches: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root, 10, 100), store, coordinator, bridge, (message) => setImmediate(() => {
    dispatches.push(message);
    acceptOutbound(bridge, message);
    lifecycle(bridge, "USER_TURN_ACKED", message.jobId as string);
    lifecycle(bridge, "ASSISTANT_STARTED", message.jobId as string);
  }), async () => relay);
  try {
    const firstSlice = await service.requestReview(relay.handoff_path);
    assert.equal(firstSlice.phase, "ASSISTANT_STARTED");
    assert.equal(firstSlice.result, null);
    assert.equal(dispatches.length, 1);
    setTimeout(() => lifecycle(bridge, "TURN_IDLE", firstSlice.job_id, "slow formal verdict"), 5);
    const completed = await service.requestReview(relay.handoff_path);
    assert.equal(completed.phase, "TURN_IDLE");
    assert.equal(completed.assistant_output, "slow formal verdict");
    assert.equal(dispatches.length, 1);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("hard turn deadline alone persists timeout and path lookup rejects drift", async () => {
  const {root, store, coordinator, bridge} = fixture();
  let relay = relayFixture();
  const dispatches: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root, 10, 500), store, coordinator, bridge, (message) => {
    dispatches.push(message);
    setImmediate(() => acceptOutbound(bridge, message));
  }, async () => relay);
  try {
    const firstSlice = await service.requestReview(relay.handoff_path);
    assert.equal(firstSlice.phase, "DISPATCHED");
    assert.equal(firstSlice.result, null);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const timedOut = await service.requestReview(relay.handoff_path);
    assert.equal(timedOut.phase, "TIMEOUT");
    assert.equal(timedOut.error_code, "TURN_DEADLINE_EXCEEDED");
    assert.equal(dispatches.length, 1);
    relay = relayFixture({handoff_sha256: "d".repeat(64)});
    assert.equal((await service.getStatus({job_id: timedOut.job_id})).phase, "TIMEOUT");
    await assert.rejects(service.getStatus({}), /STATUS_LOOKUP_KEY_INVALID/);
    await assert.rejects(service.getStatus({job_id: timedOut.job_id, handoff_file: "C:\\repo\\handoff.md"}), /STATUS_LOOKUP_KEY_INVALID/);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("expired unresolved job is terminalized before a new fingerprint claims the active slot", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const oldRelay = relayFixture({handoff_path: ".agent/review_handoffs/pr-1/old/round-01-review-request.md"});
  const oldFingerprint = relayFingerprint(oldRelay);
  const old = store.createOrGetJob(oldRelay, oldFingerprint, new Date(Date.now() - 1_000)).job;
  coordinator.transition(old.job_id, "DISPATCHED");
  coordinator.transition(old.job_id, "SESSION_LOST", "TURN_IDENTITY_AMBIGUOUS");
  const nextRelay = relayFixture({handoff_path: ".agent/review_handoffs/pr-1/new/round-01-review-request.md", handoff_sha256: "e".repeat(64)});
  const dispatches: Record<string, unknown>[] = [];
  const service = new ReviewTransportService(config(root, 5, 50), store, coordinator, bridge, (message) => {
    dispatches.push(message);
    setImmediate(() => acceptOutbound(bridge, message));
  }, async () => nextRelay);
  try {
    const status = await service.requestReview(nextRelay.handoff_path);
    assert.equal(store.getJob(old.job_id).phase, "TIMEOUT");
    assert.equal(store.getJob(old.job_id).error_code, "TURN_DEADLINE_EXCEEDED");
    assert.equal(status.handoff_path, nextRelay.handoff_path);
    assert.equal(dispatches.length, 1);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("job-id status lookup terminalizes an expired unresolved job", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() - 1_000)).job;
  coordinator.transition(job.job_id, "DISPATCHED");
  coordinator.transition(job.job_id, "SESSION_LOST", "TURN_IDENTITY_AMBIGUOUS");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => {}, async () => relay);
  try {
    const status = await service.getStatus({job_id: job.job_id});
    assert.equal(status.phase, "TIMEOUT");
    assert.equal(status.error_code, "TURN_DEADLINE_EXCEEDED");
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("job-id and canonical handoff status apply identical deadline expiry", async () => {
  const {root, store, coordinator, bridge} = fixture();
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() - 1_000)).job;
  coordinator.transition(job.job_id, "DISPATCHED");
  coordinator.transition(job.job_id, "SESSION_LOST", "TURN_IDENTITY_AMBIGUOUS");
  const service = new ReviewTransportService(config(root), store, coordinator, bridge, () => {}, async () => relay);
  try {
    const byId = await service.getStatus({job_id: job.job_id});
    assert.equal(byId.phase, "TIMEOUT");
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
    lifecycle(bridge, "TURN_IDLE", jobId, "recovered review output");
    const results = await Promise.all([original, recovered, recoveredAgain]);
    assert.ok(results.every((result) => result.phase === "TURN_IDLE"));
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});
