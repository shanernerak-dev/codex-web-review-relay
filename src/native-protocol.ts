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

function validateVersion(message: NativeRecord): {major: number; minor: number} {
  const version = message.schemaVersion as NativeRecord | undefined;
  if (!version || version.major !== NATIVE_SCHEMA_VERSION.major) {
    throw new Error("NATIVE_SCHEMA_MAJOR_UNSUPPORTED");
  }
  if (!Number.isInteger(version.minor) || (version.minor as number) < 0) {
    throw new Error("NATIVE_SCHEMA_MINOR_INVALID");
  }
  if (version.minor !== NATIVE_SCHEMA_VERSION.minor) {
    throw new Error("NATIVE_SCHEMA_MINOR_UNSUPPORTED");
  }
  return {major: version.major as number, minor: version.minor as number};
}

export class NativeBridge {
  readonly coordinator: JobCoordinator;
  readonly leaseMs: number;
  readonly pendingOutbound = new Map<string, {
    expectedType: string;
    sessionId: string;
    jobId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  readonly acknowledgedOutbound = new Set<string>();

  constructor(coordinator: JobCoordinator, leaseMs = 30_000) {
    this.coordinator = coordinator;
    this.leaseMs = leaseMs;
  }

  handleInbound(value: unknown): NativeRecord | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("NATIVE_MESSAGE_INVALID:object");
    }
    const message = value as NativeRecord;
    const peerVersion = validateVersion(message);
    const type = requireText(message, "type");
    const requestId = typeof message.requestId === "string" ? message.requestId : null;
    if (type === "DISPATCH_TRIGGER_ACCEPTED" || type === "RECONCILE_TRIGGER_ACCEPTED") {
      const responseTo = requireText(message, "responseToRequestId");
      const pending = this.pendingOutbound.get(responseTo);
      if (!pending && this.acknowledgedOutbound.has(responseTo)) return null;
      if (!pending) throw new Error("NATIVE_OUTBOUND_ACK_UNKNOWN");
      if (pending.expectedType !== type || pending.sessionId !== requireText(message, "sessionId") || pending.jobId !== requireText(message, "jobId")) {
        throw new Error("NATIVE_OUTBOUND_ACK_MISMATCH");
      }
      clearTimeout(pending.timer);
      this.pendingOutbound.delete(responseTo);
      this.acknowledgedOutbound.add(responseTo);
      if (this.acknowledgedOutbound.size > 128) this.acknowledgedOutbound.delete(this.acknowledgedOutbound.values().next().value as string);
      pending.resolve();
      return null;
    }
    if (type === "ARM_SESSION") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      const session = this.coordinator.store.armSession({
        sessionId: requireText(message, "sessionId"),
        conversationIdentity: requireText(message, "conversationIdentity"),
        extensionVersion: requireText(message, "extensionVersion"),
        schemaMajor: peerVersion.major,
        schemaMinor: peerVersion.minor,
        leaseMs: this.leaseMs,
      });
      return this.ack(requestId, "SESSION_ARMED", session);
    }
    if (type === "RECOVER_SESSION") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      const session = this.coordinator.store.recoverSession({
        conversationIdentity: requireText(message, "conversationIdentity"),
        extensionVersion: requireText(message, "extensionVersion"),
        schemaMajor: peerVersion.major,
        schemaMinor: peerVersion.minor,
        leaseMs: this.leaseMs,
      });
      return this.ack(requestId, "SESSION_RECOVERED", session);
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
    const session = this.requireSession(sessionId);
    const jobId = requireText(message, "jobId");
    this.coordinator.store.requireJobSession(jobId, session);
    const phaseByType = {
      USER_TURN_ACKED: "USER_TURN_ACKED",
      ASSISTANT_STARTED: "ASSISTANT_STARTED",
      TURN_IDLE: "TURN_IDLE",
      TURN_TIMEOUT: "TIMEOUT",
      RECONCILE_MISMATCH: "MISMATCH",
      SESSION_LOST: "SESSION_LOST",
      SEND_UNCERTAIN: "SEND_UNCERTAIN",
    } as const;
    const phase = phaseByType[type as keyof typeof phaseByType];
    if (!phase) throw new Error(`NATIVE_MESSAGE_TYPE_UNSUPPORTED:${type}`);
    const current = this.coordinator.store.getJob(jobId);
    const errorCode = typeof message.errorCode === "string" && message.errorCode.length > 0 ? message.errorCode : null;
    const job = current.phase === phase ? current : this.coordinator.transition(jobId, phase, errorCode);
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
    const session = this.requireSession(input.sessionId);
    const job = this.coordinator.store.getJob(input.jobId);
    if (job.phase !== "CREATED" || job.fingerprint !== input.fingerprint) {
      throw new Error("DISPATCH_PRECONDITION_FAILED");
    }
    this.coordinator.store.bindJobToSession(input.jobId, session);
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

  createReconcile(input: {
    sessionId: string;
    jobId: string;
    fingerprint: string;
    envelope: TriggerEnvelope;
    deadline: string;
    allowUnsentSend: boolean;
  }): NativeRecord {
    const session = this.requireSession(input.sessionId);
    const job = this.coordinator.store.requireJobSession(input.jobId, session);
    if (job.phase !== "RECONCILING" || job.fingerprint !== input.fingerprint) throw new Error("RECONCILE_PRECONDITION_FAILED");
    return {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      type: "RECONCILE_TRIGGER",
      requestId: randomUUID(),
      sessionId: input.sessionId,
      jobId: input.jobId,
      fingerprint: input.fingerprint,
      envelope: input.envelope.text,
      envelopeSha256: input.envelope.sha256,
      deadline: input.deadline,
      allowUnsentSend: input.allowUnsentSend,
    };
  }

  expectOutboundAck(message: NativeRecord, timeoutMs = 5_000): Promise<void> {
    const requestId = requireText(message, "requestId");
    const type = requireText(message, "type");
    const expectedType = `${type}_ACCEPTED`;
    if (this.pendingOutbound.has(requestId)) throw new Error("NATIVE_OUTBOUND_REQUEST_DUPLICATE");
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOutbound.delete(requestId);
        reject(new Error("NATIVE_OUTBOUND_ACK_TIMEOUT"));
      }, timeoutMs);
      this.pendingOutbound.set(requestId, {
        expectedType,
        sessionId: requireText(message, "sessionId"),
        jobId: requireText(message, "jobId"),
        resolve,
        reject,
        timer,
      });
    });
  }

  cancelOutboundAck(message: NativeRecord, errorCode: string): void {
    const requestId = requireText(message, "requestId");
    const pending = this.pendingOutbound.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOutbound.delete(requestId);
    pending.reject(new Error(errorCode));
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
