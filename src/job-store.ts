import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { RelayExport } from "./relay-contract.ts";

export const JOB_PHASES = [
  "CREATED", "DISPATCHED", "USER_TURN_ACKED", "ASSISTANT_STARTED", "TURN_IDLE",
  "SESSION_LOST", "SEND_UNCERTAIN", "RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT",
] as const;
export type JobPhase = typeof JOB_PHASES[number];

const TERMINAL_PHASES = new Set<JobPhase>(["TURN_IDLE", "BLOCKED", "MISMATCH", "TIMEOUT"]);
const TRANSITIONS: Record<JobPhase, ReadonlySet<JobPhase>> = {
  CREATED: new Set(["DISPATCHED", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  DISPATCHED: new Set(["USER_TURN_ACKED", "SESSION_LOST", "SEND_UNCERTAIN", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  USER_TURN_ACKED: new Set(["ASSISTANT_STARTED", "SESSION_LOST", "TIMEOUT"]),
  ASSISTANT_STARTED: new Set(["TURN_IDLE", "SESSION_LOST", "TIMEOUT"]),
  TURN_IDLE: new Set(),
  SESSION_LOST: new Set(["RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  SEND_UNCERTAIN: new Set(["RECONCILING", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  RECONCILING: new Set(["DISPATCHED", "USER_TURN_ACKED", "ASSISTANT_STARTED", "BLOCKED", "MISMATCH", "TIMEOUT"]),
  BLOCKED: new Set(),
  MISMATCH: new Set(),
  TIMEOUT: new Set(),
};

export interface StoredJob {
  job_id: string;
  fingerprint: string;
  handoff_path: string;
  handoff_sha256: string;
  reviewed_head: string;
  phase: JobPhase;
  recovery_from: JobPhase | null;
  result: "completed" | "blocked" | "timeout" | "mismatch" | null;
  error_code: string | null;
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

export class JobStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        handoff_path TEXT NOT NULL,
        handoff_sha256 TEXT NOT NULL,
        reviewed_head TEXT NOT NULL,
        phase TEXT NOT NULL,
        recovery_from TEXT,
        result TEXT,
        error_code TEXT,
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
        armed_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL
      );
    `);
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
      const now = new Date().toISOString();
      const jobId = randomUUID();
      this.db.prepare(`
        INSERT INTO jobs (
          job_id, fingerprint, handoff_path, handoff_sha256, reviewed_head,
          phase, recovery_from, result, error_code, deadline, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'CREATED', NULL, NULL, NULL, ?, ?, ?)
      `).run(
        jobId, fingerprint, relay.handoff_path, relay.handoff_sha256, relay.reviewed_head,
        deadline.toISOString(), now, now,
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
    const recoveryFrom = next === "SESSION_LOST" || next === "SEND_UNCERTAIN"
      ? current.phase
      : current.recovery_from;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs
      SET phase = ?, recovery_from = ?, result = ?, error_code = ?, updated_at = ?
      WHERE job_id = ?
    `).run(next, recoveryFrom, resultForPhase(next), errorCode, now, jobId);
    return this.getJob(jobId);
  }

  armSession(input: {
    sessionId: string;
    conversationIdentity: string;
    extensionVersion: string;
    schemaMajor: number;
    schemaMinor: number;
    leaseMs: number;
    now?: Date;
  }): StoredSession {
    const now = input.now ?? new Date();
    const current = this.getActiveSession(now);
    if (current && (current.session_id !== input.sessionId || current.conversation_identity !== input.conversationIdentity)) {
      throw new Error("SESSION_ALREADY_ARMED");
    }
    const nowText = now.toISOString();
    const leaseExpires = new Date(now.getTime() + input.leaseMs).toISOString();
    this.db.prepare(`
      INSERT INTO active_session (
        singleton, session_id, conversation_identity, extension_version,
        schema_major, schema_minor, armed_at, heartbeat_at, lease_expires_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        session_id = excluded.session_id,
        conversation_identity = excluded.conversation_identity,
        extension_version = excluded.extension_version,
        schema_major = excluded.schema_major,
        schema_minor = excluded.schema_minor,
        armed_at = excluded.armed_at,
        heartbeat_at = excluded.heartbeat_at,
        lease_expires_at = excluded.lease_expires_at
    `).run(
      input.sessionId, input.conversationIdentity, input.extensionVersion,
      input.schemaMajor, input.schemaMinor, nowText, nowText, leaseExpires,
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
