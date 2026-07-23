import { randomUUID } from "node:crypto";
import { sha256 } from "./canonical.ts";
import type { TriggerEnvelope } from "./envelope.ts";
import { JobCoordinator } from "./job-coordinator.ts";
import type { StoredSession } from "./job-store.ts";
import type { DiagnosticLogger, DiagnosticLevel } from "./diagnostic-log.ts";

export const NATIVE_SCHEMA_VERSION = Object.freeze({major: 1, minor: 2});
export const RELAY_ONLY_CAPABILITY = "relay-only-v1";
const MAX_ASSISTANT_OUTPUT_BYTES = 131_072;

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
  if ((version.minor as number) > NATIVE_SCHEMA_VERSION.minor) {
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
  readonly diagnostics?: DiagnosticLogger;

  constructor(coordinator: JobCoordinator, leaseMs = 30_000, diagnostics?: DiagnosticLogger) {
    this.coordinator = coordinator;
    this.leaseMs = leaseMs;
    this.diagnostics = diagnostics;
  }

  handleInbound(value: unknown): NativeRecord | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("NATIVE_MESSAGE_INVALID:object");
    }
    const message = value as NativeRecord;
    const peerVersion = validateVersion(message);
    const type = requireText(message, "type");
    const requestId = typeof message.requestId === "string" ? message.requestId : null;
    if (type === "DIAGNOSTIC_EVENT") {
      if (!requestId) throw new Error("NATIVE_MESSAGE_INVALID:requestId");
      const level = requireText(message, "level") as DiagnosticLevel;
      if (!["error", "info", "debug", "trace"].includes(level)) throw new Error("DIAGNOSTIC_LEVEL_INVALID");
      const component = requireText(message, "component");
      const event = requireText(message, "event");
      const details = message.details !== null && typeof message.details === "object" && !Array.isArray(message.details)
        ? message.details as NativeRecord : {};
      this.diagnostics?.write(level, component, event, {
        ...details,
        session_id: typeof message.sessionId === "string" ? message.sessionId : undefined,
        job_id: typeof message.jobId === "string" ? message.jobId : undefined,
        request_id: requestId,
        event_id: message.eventId,
        source_timestamp: message.sourceTimestamp,
        sequence: message.sequence,
        binding_generation: message.bindingGeneration,
        document_id: message.documentId,
        tab_id: message.tabId,
      });
      return {
        schemaVersion: NATIVE_SCHEMA_VERSION,
        type: "DIAGNOSTIC_ACK",
        responseToRequestId: requestId,
      };
    }
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
        extensionVersion: requireText(message, "extensionVersion"),
        schemaMajor: peerVersion.major,
        schemaMinor: peerVersion.minor,
        capabilities: Array.isArray(message.capabilities)
          ? message.capabilities.filter((entry): entry is string => typeof entry === "string")
          : [],
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
    const session = this.requireSession(sessionId);
    const jobId = requireText(message, "jobId");
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
    let current = this.coordinator.store.getJob(jobId);
    if (type === "TURN_IDLE") {
      if (typeof message.assistantOutput !== "string" || message.assistantOutput.length === 0) throw new Error("ASSISTANT_OUTPUT_REQUIRED");
      const output = message.assistantOutput;
      if (Buffer.byteLength(output, "utf8") > MAX_ASSISTANT_OUTPUT_BYTES) throw new Error("ASSISTANT_OUTPUT_TOO_LARGE");
      const outputSha256 = sha256(output);
      if (current.phase === "TURN_IDLE") {
        if (current.assistant_output_sha256 !== outputSha256 || current.assistant_output !== output) throw new Error("ASSISTANT_OUTPUT_RETRY_MISMATCH");
      } else {
        if (current.phase !== "ASSISTANT_STARTED") throw new Error(`PHASE_TRANSITION_INVALID:${current.phase}->TURN_IDLE`);
        current = this.coordinator.store.recordAssistantOutput(jobId, output, outputSha256);
      }
    }
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
    reviewMode?: "pr-comment" | "relay-only";
    deadline: string;
  }): NativeRecord {
    this.assertReviewModeSupported(input.sessionId, input.reviewMode ?? "pr-comment");
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
      reviewMode: input.reviewMode ?? "pr-comment",
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
    reviewMode?: "pr-comment" | "relay-only";
    deadline: string;
    allowUnsentSend: boolean;
  }): NativeRecord {
    this.assertReviewModeSupported(input.sessionId, input.reviewMode ?? "pr-comment");
    const job = this.coordinator.store.getJob(input.jobId);
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
      reviewMode: input.reviewMode ?? "pr-comment",
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

  assertReviewModeSupported(sessionId: string, reviewMode: "pr-comment" | "relay-only"): void {
    this.requireReviewModeCapability(this.requireSession(sessionId), reviewMode);
  }

  private requireReviewModeCapability(session: StoredSession, reviewMode: "pr-comment" | "relay-only"): void {
    if (reviewMode !== "relay-only") return;
    let capabilities: unknown;
    try { capabilities = JSON.parse(session.capabilities_json); }
    catch { capabilities = null; }
    if (!Array.isArray(capabilities) || !capabilities.includes(RELAY_ONLY_CAPABILITY)) {
      throw new Error("RELAY_ONLY_EXTENSION_UNSUPPORTED");
    }
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
