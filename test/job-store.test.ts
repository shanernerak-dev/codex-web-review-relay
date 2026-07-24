import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JobCoordinator } from "../src/job-coordinator.ts";
import { JobStore } from "../src/job-store.ts";
import { relayFingerprint } from "../src/relay-contract.ts";
import { relayFixture } from "./fixtures.ts";

function withDatabase(run: (store: JobStore, path: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "review-relay-store-"));
  const path = join(root, "state.sqlite");
  const store = new JobStore(path);
  return Promise.resolve(run(store, path)).finally(() => {
    try { store.close(); } catch {}
    rmSync(root, {recursive: true, force: true});
  });
}

test("job fingerprint is idempotent and only one active job is allowed", () => withDatabase((store) => {
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  const first = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000));
  const retry = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000));
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.job.job_id, first.job.job_id);
  const secondRelay = relayFixture({handoff_sha256: "c".repeat(64)});
  assert.throws(
    () => store.createOrGetJob(secondRelay, relayFingerprint(secondRelay), new Date(Date.now() + 60_000)),
    /ACTIVE_JOB_EXISTS/,
  );
}));

test("restart recovery preserves phase and reconciles without creating a second job", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-restart-"));
  const path = join(root, "state.sqlite");
  const relay = relayFixture();
  const fingerprint = relayFingerprint(relay);
  let store = new JobStore(path);
  const created = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000)).job;
  store.transitionJob(created.job_id, "DISPATCHED");
  store.close();
  store = new JobStore(path);
  assert.equal(store.getActiveJob()?.phase, "DISPATCHED");
  store.transitionJob(created.job_id, "SESSION_LOST");
  store.transitionJob(created.job_id, "RECONCILING");
  store.transitionJob(created.job_id, "USER_TURN_ACKED");
  const retry = store.createOrGetJob(relay, fingerprint, new Date(Date.now() + 60_000));
  assert.equal(retry.created, false);
  assert.equal(retry.job.job_id, created.job_id);
  store.close();
  rmSync(root, {recursive: true, force: true});
});

test("event-driven wait and session lease are bounded", () => withDatabase(async (store) => {
  const coordinator = new JobCoordinator(store);
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  const wait = coordinator.waitFor(job.job_id, new Set(["DISPATCHED"]), 1_000);
  coordinator.transition(job.job_id, "DISPATCHED");
  assert.equal((await wait).phase, "DISPATCHED");

  const now = new Date("2026-07-20T00:00:00.000Z");
  store.armSession({
    sessionId: "session-1",
    extensionVersion: "0.1.0",
    schemaMajor: 1,
    schemaMinor: 0,
    leaseMs: 1_000,
    now,
  });
  assert.ok(store.getActiveSession(new Date(now.getTime() + 999)));
  assert.equal(store.getActiveSession(new Date(now.getTime() + 1_000)), null);
}));

test("waitFor closes the subscribe/read lost-wakeup window", () => withDatabase(async (store) => {
  const coordinator = new JobCoordinator(store);
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  const originalOn = coordinator.on.bind(coordinator);
  let injected = false;
  coordinator.on = ((event: string, listener: (...args: unknown[]) => void) => {
    const result = originalOn(event, listener);
    if (!injected) {
      injected = true;
      store.transitionJob(job.job_id, "DISPATCHED");
    }
    return result;
  }) as typeof coordinator.on;
  assert.equal((await coordinator.waitFor(job.job_id, new Set(["DISPATCHED"]), 100)).phase, "DISPATCHED");
}));

test("a new manual arm does not inherit or mutate an unresolved job", () => withDatabase(async (store) => {
  const coordinator = new JobCoordinator(store);
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  const start = new Date("2026-07-20T00:00:00.000Z");
  store.armSession({
    sessionId: "session-a", extensionVersion: "0.1.0",
    schemaMajor: 1, schemaMinor: 0, leaseMs: 1_000, now: start,
  });
  coordinator.transition(job.job_id, "DISPATCHED");
  const sessionB = store.armSession({
    sessionId: "session-b", extensionVersion: "0.1.0",
    schemaMajor: 1, schemaMinor: 0, leaseMs: 1_000, now: new Date(start.getTime() + 1_001),
  });
  assert.equal(sessionB.session_id, "session-b");
  assert.equal(store.getJob(job.job_id).phase, "DISPATCHED");
  assert.equal(store.getJob(job.job_id).session_id, null);
}));

test("repository migration is idempotent and tolerates unrecoverable legacy rows", () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-migration-"));
  const path = join(root, "state.sqlite");
  let store = new JobStore(path);
  const relay = relayFixture();
  const job = store.createOrGetJob(relay, relayFingerprint(relay), new Date(Date.now() + 60_000)).job;
  store.db.prepare("UPDATE jobs SET repository = NULL WHERE job_id = ?").run(job.job_id);
  store.close();
  store = new JobStore(path);
  assert.equal(store.getJob(job.job_id).repository, relay.repository);
  store.db.prepare("UPDATE jobs SET repository = NULL, relay_json = NULL WHERE job_id = ?").run(job.job_id);
  store.close();
  assert.doesNotThrow(() => { store = new JobStore(path); });
  assert.equal(store.getJob(job.job_id).repository, null);
  assert.throws(() => store.getJobByHandoff(relay.repository, relay.handoff_path), /HISTORICAL_REPOSITORY_UNAVAILABLE/);
  store.close();
  rmSync(root, {recursive: true, force: true});
});
