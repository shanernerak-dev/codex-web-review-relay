import { randomUUID } from "node:crypto";
import type { TriggerEnvelope } from "./envelope.ts";
import { JobCoordinator } from "./job-coordinator.ts";
import type { StoredSession } from "./job-store.ts";

export const NATIVE_SCHEMA_VERSION = Object.freeze({major: 1, minor: 0});

type NativeRecord = Record<string, unknown>;

function requireText(message: NativeRecord, key: string): string {
  if (typeof message[key] !== "string" || (message[key] as string).length === 0) {
    throw new Error(`NATIVE_MESSAGE_INVALID:${key}`);
  }
  return message[key] as string;
}

function validateVersion(message: NativeRecord): void {
  const version = message.schemaVersion as NativeRecord | undefined;
  if (!version || version.major !== NATIVE_SCHEMA_VERSION.major) {
    throw new Error("NATIVE_SCHEMA_MAJOR_UNSUPPORTED");
  }
  if (!Number.isInteger(version.minor) || (version.minor as number) < 0) {
    throw new Error("NATIVE_SCHEMA_MINOR_INVALID");
  }
}

export class NativeBridge {
  readonly coordinator: JobCoordinator;
  readonly leaseMs: number;

  constructor(coordinator: JobCoordinator, leaseMs = 30_000) {
    this.coordinator = coordinator;
    this.leaseMs = leaseMs;
  }

  handleInbound(value: unknown): NativeRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("NATIVE_MESSAGE_INVALID:object");
    }
    const message = value as NativeRecord;
    validateVersion(message);
    const type = requireText(message, "type");
    const requestId = typeof message.requestId === "string" ? message.requestId : null;
    if (type === "ARM_SESSION") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      const session = this.coordinator.store.armSession({
        sessionId: requireText(message, "sessionId"),
        conversationIdentity: requireText(message, "conversationIdentity"),
        extensionVersion: requireText(message, "extensionVersion"),
        schemaMajor: NATIVE_SCHEMA_VERSION.major,
        schemaMinor: NATIVE_SCHEMA_VERSION.minor,
        leaseMs: this.leaseMs,
      });
      return this.ack(requestId, "SESSION_ARMED", session);
    }
    if (type === "HEARTBEAT") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      const session = this.coordinator.store.heartbeat(requireText(message, "sessionId"), this.leaseMs);
      return this.ack(requestId, "HEARTBEAT_ACK", session);
    }
    if (type === "DISARM_SESSION") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      this.coordinator.store.disarmSession(requireText(message, "sessionId"));
      return this.ack(requestId, "SESSION_DISARMED", null);
    }

    const sessionId = requireText(message, "sessionId");
    this.requireSession(sessionId);
    const jobId = requireText(message, "jobId");
    const phaseByType = {
      USER_TURN_ACKED: "USER_TURN_ACKED",
      ASSISTANT_STARTED: "ASSISTANT_STARTED",
      TURN_IDLE: "TURN_IDLE",
      SESSION_LOST: "SESSION_LOST",
      SEND_UNCERTAIN: "SEND_UNCERTAIN",
    } as const;
    const phase = phaseByType[type as keyof typeof phaseByType];
    if (!phase) throw new Error(`NATIVE_MESSAGE_TYPE_UNSUPPORTED:${type}`);
    const job = this.coordinator.transition(jobId, phase);
    return {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type: "EVENT_ACK",
      responseToRequestId: requestId ?? undefined,
      jobId,
      phase: job.phase,
    };
  }

  createDispatch(input: {
    sessionId: string;
    jobId: string;
    fingerprint: string;
    envelope: TriggerEnvelope;
    deadline: string;
  }): NativeRecord {
    this.requireSession(input.sessionId);
    const job = this.coordinator.store.getJob(input.jobId);
    if (job.phase !== "CREATED" || job.fingerprint !== input.fingerprint) {
      throw new Error("DISPATCH_PRECONDITION_FAILED");
    }
    return {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type: "DISPATCH_TRIGGER",
      requestId: randomUUID(),
      sessionId: input.sessionId,
      jobId: input.jobId,
      fingerprint: input.fingerprint,
      envelope: input.envelope.text,
      envelopeSha256: input.envelope.sha256,
      deadline: input.deadline,
    };
  }

  markDispatchWritten(jobId: string): void {
    this.coordinator.transition(jobId, "DISPATCHED");
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.coordinator.store.getActiveSession();
    if (!session || session.session_id !== sessionId) throw new Error("SESSION_NOT_ARMED");
    return session;
  }

  private ack(requestId: string, type: string, session: StoredSession | null): NativeRecord {
    return {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type,
      responseToRequestId: requestId,
      sessionId: session?.session_id,
      leaseExpiresAt: session?.lease_expires_at,
    };
  }
}
