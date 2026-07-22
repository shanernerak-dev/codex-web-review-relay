import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import type { RelayExport } from "./relay-contract.ts";

export const JOB_PHASES = [
  "CREATED", "DISPATCHED", "USER_TURN_ACKED", "ASSISTANT_STARTED", "TURN_IDLE",
  "SESSION_LOST", "SEND_UNCERTAIN", "RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT",
] as const;
export type JobPhase = typeof JOB_PHASES[number];

const TERMINAL_PHASES = new Set<JobPhase>(["TURN_IDLE", "BLOCKED", "MISMATCH", "TIMEOUT"]);
const TRANSITIONS: Record<JobPhase, ReadonlySet<JobPhase>> = {
  CREATED: new Set(["DISPATCHED", "SEND_UNCERTAIN", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  DISPATCHED: new Set(["USER_TURN_ACKED", "SESSION_LOST", "SEND_UNCERTAIN", "RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  USER_TURN_ACKED: new Set(["ASSISTANT_STARTED", "SESSION_LOST", "RECONCILING", "TIMEOUT"]),
  ASSISTANT_STARTED: new Set(["TURN_IDLE", "SESSION_LOST", "RECONCILING", "TIMEOUT"]),
  TURN_IDLE: new Set(),
  SESSION_LOST: new Set(["RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  SEND_UNCERTAIN: new Set(["RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  RECONCILING: new Set(["DISPATCHED", "USER_TURN_ACKED", "ASSISTANT_STARTED", "SEND_UNCERTAIN", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  BLOCKED: new Set(),
  MISMATCH: new Set(),
  TIMEOUT: new Set(),
};

export interface StoredJob {
  job_id: string;
  fingerprint: string;
  handoff_path: string;
  handoff_sha256: string;
  relay_json: string | null;
  reviewed_head: string;
  session_id: string | null;
  conversation_identity: string | null;
  phase: JobPhase;
  recovery_from: JobPhase | null;
  recovery_send_used: number;
  manual_recovery_used: number;
  result: "completed" | "blocked" | "timeout" | "mismatch" | null;
  error_code: string | null;
  assistant_output: string | null;
  assistant_output_sha256: string | null;
  deadline: string;
  created_at: string;
  updated_at: string;
}

export interface StoredSession {
  session_id: string;
  conversation_identity: string;
  extension_version: string;
  schema_major: number;
  schema_minor: number;
  capabilities_json: string;
  armed_at: string;
  heartbeat_at: string;
  lease_expires_at: string;
}

function resultForPhase(phase: JobPhase): StoredJob["result"] {
  if (phase === "TURN_IDLE") return "completed";
  if (phase === "BLOCKED") return "blocked";
  if (phase === "MISMATCH") return "mismatch";
  if (phase === "TIMEOUT") return "timeout";
  return null;
}

export class JobStore extends EventEmitter {
  readonly db: DatabaseSync;

  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        handoff_path TEXT NOT NULL,
        handoff_sha256 TEXT NOT NULL,
        relay_json TEXT,
        reviewed_head TEXT NOT NULL,
        session_id TEXT,
        conversation_identity TEXT,
        phase TEXT NOT NULL,
        recovery_from TEXT,
        recovery_send_used INTEGER NOT NULL DEFAULT 0,
        manual_recovery_used INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        error_code TEXT,
        assistant_output TEXT,
        assistant_output_sha256 TEXT,
        deadline TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job
        ON jobs ((1))
        WHERE phase NOT IN ('TURN_IDLE', 'BLOCKED', 'MISMATCH', 'TIMEOUT');
      CREATE TABLE IF NOT EXISTS active_session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL UNIQUE,
        conversation_identity TEXT NOT NULL,
        extension_version TEXT NOT NULL,
        schema_major INTEGER NOT NULL,
        schema_minor INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        armed_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL
      );
    `);
    for (const statement of [
      "ALTER TABLE jobs ADD COLUMN session_id TEXT",
      "ALTER TABLE jobs ADD COLUMN relay_json TEXT",
      "ALTER TABLE jobs ADD COLUMN conversation_identity TEXT",
      "ALTER TABLE jobs ADD COLUMN recovery_send_used INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN manual_recovery_used INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN assistant_output TEXT",
      "ALTER TABLE jobs ADD COLUMN assistant_output_sha256 TEXT",
      "ALTER TABLE active_session ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'",
    ]) {
      try { this.db.exec(statement); } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  createOrGetJob(relay: RelayExport, fingerprint: string, deadline: Date): {job: StoredJob; created: boolean} {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM jobs WHERE fingerprint = ?").get(fingerprint) as StoredJob | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return {job: existing, created: false};
      }
      const active = this.db.prepare(`
        SELECT job_id FROM jobs
        WHERE phase NOT IN ('TURN_IDLE', 'BLOCKED', 'MISMATCH', 'TIMEOUT')
        LIMIT 1
      `).get() as {job_id: string} | undefined;
      if (active) {
        throw new Error(`ACTIVE_JOB_EXISTS:${active.job_id}`);
      }
      const mismatches = this.db.prepare(`
        SELECT job_id FROM jobs
        WHERE handoff_path = ? AND handoff_sha256 = ? AND phase = 'MISMATCH'
        LIMIT 2
      `).all(relay.handoff_path, relay.handoff_sha256) as unknown as Array<{job_id: string}>;
      if (mismatches.length > 0) {
        throw new Error(`MISMATCH_EXISTING_JOB:${mismatches[0].job_id}`);
      }
      const now = new Date().toISOString();
      const jobId = randomUUID();
      this.db.prepare(`
        INSERT INTO jobs (
          job_id, fingerprint, handoff_path, handoff_sha256, reviewed_head,
          relay_json, phase, recovery_from, result, error_code, deadline, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREATED', NULL, NULL, NULL, ?, ?, ?)
      `).run(
        jobId, fingerprint, relay.handoff_path, relay.handoff_sha256, relay.reviewed_head,
        JSON.stringify(relay), deadline.toISOString(), now, now,
      );
      const job = this.getJob(jobId);
      this.db.exec("COMMIT");
      return {job, created: true};
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getJob(jobId: string): StoredJob {
    const job = this.db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId) as StoredJob | undefined;
    if (!job) throw new Error("JOB_NOT_FOUND");
    return job;
  }

  getJobByHandoff(handoffPath: string): StoredJob {
    const jobs = this.db.prepare("SELECT * FROM jobs WHERE handoff_path = ? ORDER BY created_at DESC LIMIT 2").all(handoffPath) as unknown as StoredJob[];
    if (jobs.length === 0) throw new Error("JOB_NOT_FOUND");
    if (jobs.length > 1) throw new Error("HANDOFF_LOOKUP_AMBIGUOUS");
    return jobs[0];
  }

  getActiveJob(): StoredJob | null {
    return (this.db.prepare(`
      SELECT * FROM jobs
      WHERE phase NOT IN ('TURN_IDLE', 'BLOCKED', 'MISMATCH', 'TIMEOUT')
      LIMIT 1
    `).get() as StoredJob | undefined) ?? null;
  }

  transitionJob(jobId: string, next: JobPhase, errorCode: string | null = null): StoredJob {
    const current = this.getJob(jobId);
    if (!TRANSITIONS[current.phase].has(next)) {
      throw new Error(`PHASE_TRANSITION_INVALID:${current.phase}->${next}`);
    }
    const recoveryFrom = next === "SESSION_LOST" || next === "SEND_UNCERTAIN" || next === "RECONCILING"
      ? current.phase
      : current.recovery_from;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs
      SET phase = ?, recovery_from = ?, result = ?, error_code = ?, updated_at = ?
      WHERE job_id = ?
    `).run(next, recoveryFrom, resultForPhase(next), errorCode, now, jobId);
    const job = this.getJob(jobId);
    this.emit("job-transition", job);
    return job;
  }

  claimRecoverySend(jobId: string): boolean {
    const result = this.db.prepare(`
      UPDATE jobs SET recovery_send_used = 1, updated_at = ?
      WHERE job_id = ? AND recovery_send_used = 0
    `).run(new Date().toISOString(), jobId);
    return result.changes === 1;
  }

  authorizeManualRecovery(jobId: string, now = new Date()): StoredJob {
    const current = this.getJob(jobId);
    if (current.manual_recovery_used !== 0) throw new Error("MANUAL_RECOVERY_ALREADY_USED");
    if (current.phase !== "MISMATCH") throw new Error("MANUAL_RECOVERY_PHASE_INVALID");
    if (Date.parse(current.deadline) <= now.getTime()) throw new Error("MANUAL_RECOVERY_DEADLINE_EXPIRED");
    const updatedAt = now.toISOString();
    const result = this.db.prepare(`
      UPDATE jobs
      SET phase = 'RECONCILING', recovery_from = 'MISMATCH', recovery_send_used = 0,
          manual_recovery_used = 1, result = NULL, error_code = 'MANUAL_RECOVERY_AUTHORIZED', updated_at = ?
      WHERE job_id = ? AND phase = 'MISMATCH' AND manual_recovery_used = 0
    `).run(updatedAt, jobId);
    if (result.changes !== 1) throw new Error("MANUAL_RECOVERY_ALREADY_USED");
    const job = this.getJob(jobId);
    this.emit("job-transition", job);
    return job;
  }

  recordAssistantOutput(jobId: string, output: string, outputSha256: string): StoredJob {
    this.db.prepare(`
      UPDATE jobs SET assistant_output = ?, assistant_output_sha256 = ?, updated_at = ?
      WHERE job_id = ?
    `).run(output, outputSha256, new Date().toISOString(), jobId);
    return this.getJob(jobId);
  }

  getJobByFingerprint(fingerprint: string): StoredJob | null {
    return (this.db.prepare("SELECT * FROM jobs WHERE fingerprint = ?").get(fingerprint) as StoredJob | undefined) ?? null;
  }

  getRelayExport(jobId: string): RelayExport {
    const job = this.getJob(jobId);
    if (typeof job.relay_json !== "string" || job.relay_json.length === 0) {
      throw new Error("HISTORICAL_RELAY_UNAVAILABLE");
    }
    try { return JSON.parse(job.relay_json) as RelayExport; }
    catch { throw new Error("HISTORICAL_RELAY_INVALID"); }
  }

  armSession(input: {
    sessionId: string;
    extensionVersion: string;
    schemaMajor: number;
    schemaMinor: number;
    capabilities?: string[];
    leaseMs: number;
    now?: Date;
  }): StoredSession {
    const now = input.now ?? new Date();
    const current = this.getActiveSession(now);
    if (current && current.session_id !== input.sessionId) {
      throw new Error("SESSION_ALREADY_ARMED");
    }
    const nowText = now.toISOString();
    const leaseExpires = new Date(now.getTime() + input.leaseMs).toISOString();
    this.db.prepare(`
      INSERT INTO active_session (
        singleton, session_id, conversation_identity, extension_version,
        schema_major, schema_minor, capabilities_json, armed_at, heartbeat_at, lease_expires_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        session_id = excluded.session_id,
        conversation_identity = excluded.conversation_identity,
        extension_version = excluded.extension_version,
        schema_major = excluded.schema_major,
        schema_minor = excluded.schema_minor,
        capabilities_json = excluded.capabilities_json,
        armed_at = excluded.armed_at,
        heartbeat_at = excluded.heartbeat_at,
        lease_expires_at = excluded.lease_expires_at
    `).run(
      input.sessionId, "", input.extensionVersion,
      input.schemaMajor, input.schemaMinor, JSON.stringify(input.capabilities ?? []), nowText, nowText, leaseExpires,
    );
    return this.getActiveSession(now) as StoredSession;
  }


  heartbeat(sessionId: string, leaseMs: number, now = new Date()): StoredSession {
    const result = this.db.prepare(`
      UPDATE active_session SET heartbeat_at = ?, lease_expires_at = ?
      WHERE singleton = 1 AND session_id = ?
    `).run(now.toISOString(), new Date(now.getTime() + leaseMs).toISOString(), sessionId);
    if (result.changes !== 1) throw new Error("SESSION_NOT_FOUND");
    return this.getActiveSession(now) as StoredSession;
  }

  getActiveSession(now = new Date()): StoredSession | null {
    const session = this.db.prepare("SELECT * FROM active_session WHERE singleton = 1").get() as StoredSession | undefined;
    if (!session || Date.parse(session.lease_expires_at) <= now.getTime()) return null;
    return session;
  }

  disarmSession(sessionId: string): void {
    this.db.prepare("DELETE FROM active_session WHERE singleton = 1 AND session_id = ?").run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}
