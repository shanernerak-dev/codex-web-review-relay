import { renderTriggerEnvelope } from "./envelope.ts";
import { JobCoordinator } from "./job-coordinator.ts";
import { JobStore, type JobPhase, type StoredJob } from "./job-store.ts";
import { NativeBridge } from "./native-protocol.ts";
import { relayFingerprint, validateRelayExport, type RelayExport } from "./relay-contract.ts";
import { runRelayExport } from "./repo-adapter.ts";
import type { RelayConfig } from "./config.ts";

export type NativeDispatchWriter = (message: Record<string, unknown>) => void;
export type RelayExporter = (config: RelayConfig, handoffPath: string) => Promise<RelayExport>;

const RETURNABLE_PHASES = new Set<JobPhase>([
  "TURN_IDLE", "SESSION_LOST", "SEND_UNCERTAIN", "BLOCKED", "MISMATCH", "TIMEOUT",
]);
const TERMINAL_PHASES = new Set<JobPhase>(["TURN_IDLE", "BLOCKED", "MISMATCH", "TIMEOUT"]);

export interface TransportStatus {
  job_id: string;
  fingerprint: string;
  target_kind: RelayExport["target_kind"];
  target_id: string;
  target_pr: number | null;
  handoff_path: string;
  handoff_sha256: string;
  reviewed_head: string;
  phase: JobPhase;
  result: StoredJob["result"];
  error_code: string | null;
  assistant_output: string | null;
  assistant_output_sha256: string | null;
  deadline: string;
}

function targetIdentity(job: StoredJob): Pick<TransportStatus, "target_kind" | "target_id" | "target_pr"> {
  if (typeof job.relay_json === "string" && job.relay_json.length > 0) {
    try {
      const relay = validateRelayExport(JSON.parse(job.relay_json));
      return {target_kind: relay.target_kind, target_id: relay.target_id, target_pr: relay.target_pr};
    } catch { /* Fall through to the durable handoff path identity. */ }
  }
  return pathTargetIdentity(job.handoff_path);
}

function pathTargetIdentity(handoffPath: string): Pick<TransportStatus, "target_kind" | "target_id" | "target_pr"> {
  const match = handoffPath.match(/^\.agent\/review_handoffs\/(pr-([1-9][0-9]*)|review-[a-z0-9][a-z0-9-]*)\//);
  if (!match) throw new Error("RELAY_STORED_TARGET_IDENTITY_UNAVAILABLE");
  if (match[2]) return {target_kind: "pr", target_id: match[1], target_pr: Number(match[2])};
  return {target_kind: "commit", target_id: match[1], target_pr: null};
}

function publicStatus(job: StoredJob): TransportStatus {
  const identity = targetIdentity(job);
  return {
    job_id: job.job_id,
    fingerprint: job.fingerprint,
    ...identity,
    handoff_path: job.handoff_path,
    handoff_sha256: job.handoff_sha256,
    reviewed_head: job.reviewed_head,
    phase: job.phase,
    result: job.result,
    error_code: job.error_code,
    assistant_output: job.assistant_output,
    assistant_output_sha256: job.assistant_output_sha256,
    deadline: job.deadline,
  };
}

export class ReviewTransportService {
  readonly config: RelayConfig;
  readonly store: JobStore;
  readonly coordinator: JobCoordinator;
  readonly bridge: NativeBridge;
  readonly writeDispatch: NativeDispatchWriter;
  readonly exportRelay: RelayExporter;
  readonly ownedJobs = new Set<string>();
  readonly reconciledJobs = new Set<string>();
  readonly inFlight = new Map<string, Promise<TransportStatus>>();

  constructor(
    config: RelayConfig,
    store: JobStore,
    coordinator: JobCoordinator,
    bridge: NativeBridge,
    writeDispatch: NativeDispatchWriter,
    exportRelay: RelayExporter = runRelayExport,
  ) {
    this.config = config;
    this.store = store;
    this.coordinator = coordinator;
    this.bridge = bridge;
    this.writeDispatch = writeDispatch;
    this.exportRelay = exportRelay;
  }

  private markSendUncertain(jobId: string, errorCode: string): void {
    const current = this.store.getJob(jobId);
    if (current.phase === "SEND_UNCERTAIN") return;
    if (["TURN_IDLE", "BLOCKED", "MISMATCH", "TIMEOUT"].includes(current.phase)) return;
    this.coordinator.transition(jobId, "SEND_UNCERTAIN", errorCode);
  }

  private expirePastDeadline(job: StoredJob): StoredJob {
    if (TERMINAL_PHASES.has(job.phase) || Date.now() < Date.parse(job.deadline)) return job;
    return this.coordinator.transition(job.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED");
  }

  private relayOnlySupported(sessionId: string): boolean {
    try {
      this.bridge.assertReviewModeSupported(sessionId, "relay-only");
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "RELAY_ONLY_EXTENSION_UNSUPPORTED") return false;
      throw error;
    }
  }

  private persistedTargetKind(job: StoredJob): RelayExport["target_kind"] {
    if (typeof job.relay_json === "string" && job.relay_json.length > 0) {
      try { return validateRelayExport(JSON.parse(job.relay_json)).target_kind; } catch { /* use path */ }
    }
    return pathTargetIdentity(job.handoff_path).target_kind;
  }

  private cleanupUnsupportedActiveCommit(active: StoredJob, relay: RelayExport, sessionId: string): void {
    if (relay.target_kind !== "pr" || this.persistedTargetKind(active) !== "commit") return;
    if (this.relayOnlySupported(sessionId)) return;
    this.coordinator.transition(active.job_id, "BLOCKED", "RELAY_ONLY_EXTENSION_UNSUPPORTED");
  }

  async requestReview(handoffPath: string): Promise<TransportStatus> {
    const relay = await this.exportRelay(this.config, handoffPath);
    const fingerprint = relayFingerprint(relay);
    const existing = this.inFlight.get(fingerprint);
    if (existing) return existing;
    const operation = this.requestReviewResolved(relay, fingerprint);
    this.inFlight.set(fingerprint, operation);
    try { return await operation; }
    finally { if (this.inFlight.get(fingerprint) === operation) this.inFlight.delete(fingerprint); }
  }

  async recoverReview(handoffPath: string, confirmUnsent: boolean): Promise<TransportStatus> {
    if (confirmUnsent !== true) throw new Error("MANUAL_RECOVERY_CONFIRMATION_REQUIRED");
    const relay = await this.exportRelay(this.config, handoffPath);
    const persisted = this.store.getJobByHandoff(relay.handoff_path);
    if (persisted.handoff_sha256 !== relay.handoff_sha256) throw new Error("HANDOFF_LOOKUP_DRIFT");
    const historicalRelay = validateRelayExport(this.store.getRelayExport(persisted.job_id));
    const fingerprint = persisted.fingerprint;
    if (relayFingerprint(historicalRelay) !== fingerprint) throw new Error("STORED_JOB_IDENTITY_MISMATCH");
    if (historicalRelay.target_kind === "commit") {
      const session = this.store.getActiveSession();
      if (!session) throw new Error("SESSION_NOT_ARMED");
      this.bridge.assertReviewModeSupported(session.session_id, "relay-only");
    }
    this.store.authorizeManualRecovery(persisted.job_id);
    this.reconciledJobs.delete(persisted.job_id);
    return this.requestReviewResolved(historicalRelay, fingerprint);
  }

  private async requestReviewResolved(relay: RelayExport, fingerprint: string): Promise<TransportStatus> {
    const active = this.store.getActiveJob();
    if (active) this.expirePastDeadline(active);
    let persisted = this.store.getJobByFingerprint(fingerprint);
    if (persisted) {
      if (persisted.handoff_sha256 !== relay.handoff_sha256 || persisted.reviewed_head !== relay.reviewed_head) {
        throw new Error("STORED_JOB_IDENTITY_MISMATCH");
      }
      if (TERMINAL_PHASES.has(persisted.phase)) return publicStatus(persisted);
      if (Date.now() >= Date.parse(persisted.deadline)) return publicStatus(this.expirePastDeadline(persisted));
    }

    let session = this.store.getActiveSession();
    if (!session) throw new Error("SESSION_NOT_ARMED");

    const activeBeforeCreate = this.store.getActiveJob();
    if (activeBeforeCreate) this.cleanupUnsupportedActiveCommit(activeBeforeCreate, relay, session.session_id);
    persisted = this.store.getJobByFingerprint(fingerprint);
    if (persisted && TERMINAL_PHASES.has(persisted.phase)) return publicStatus(persisted);
    if (relay.target_kind === "commit") this.bridge.assertReviewModeSupported(session.session_id, "relay-only");

    const deadline = new Date(Date.now() + this.config.turnDeadlineMs);
    const {job} = this.store.createOrGetJob(relay, fingerprint, deadline);
    if (job.handoff_sha256 !== relay.handoff_sha256 || job.reviewed_head !== relay.reviewed_head) {
      throw new Error("STORED_JOB_IDENTITY_MISMATCH");
    }

    let current = job;
    if (TERMINAL_PHASES.has(current.phase)) return publicStatus(current);
    if (Date.now() >= Date.parse(current.deadline)) {
      return publicStatus(this.coordinator.transition(current.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED"));
    }
    session = this.store.getActiveSession();
    if (!session) throw new Error("SESSION_NOT_ARMED");
    if (current.phase === "CREATED") {
      const dispatch = this.bridge.createDispatch({
        sessionId: session.session_id,
        jobId: current.job_id,
        fingerprint,
        envelope: renderTriggerEnvelope(relay),
        reviewMode: relay.target_kind === "commit" ? "relay-only" : "pr-comment",
        deadline: current.deadline,
      });
      const accepted = this.bridge.expectOutboundAck(dispatch);
      try {
        this.bridge.markDispatchWritten(current.job_id);
        this.writeDispatch(dispatch);
        await accepted;
        this.ownedJobs.add(current.job_id);
      } catch (error) {
        this.bridge.cancelOutboundAck(dispatch, "NATIVE_DISPATCH_WRITE_FAILED");
        await accepted.catch(() => {});
        this.markSendUncertain(current.job_id, "NATIVE_DISPATCH_WRITE_FAILED");
        throw error;
      }
      current = this.store.getJob(current.job_id);
    }

    const needsRecovery = ["SESSION_LOST", "SEND_UNCERTAIN"].includes(current.phase) ||
      (["DISPATCHED", "USER_TURN_ACKED", "ASSISTANT_STARTED", "RECONCILING"].includes(current.phase) && !this.ownedJobs.has(current.job_id));
    if (needsRecovery && !this.reconciledJobs.has(current.job_id)) {
      if (relay.target_kind === "commit") this.bridge.assertReviewModeSupported(session.session_id, "relay-only");
      if (Date.now() >= Date.parse(current.deadline)) {
        return publicStatus(this.coordinator.transition(current.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED"));
      }
      if (current.phase !== "RECONCILING") current = this.coordinator.transition(current.job_id, "RECONCILING");
      if (Date.now() >= Date.parse(current.deadline)) {
        return publicStatus(this.coordinator.transition(current.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED"));
      }
      const reconcile = this.bridge.createReconcile({
        sessionId: session.session_id,
        jobId: current.job_id,
        fingerprint,
        envelope: renderTriggerEnvelope(relay),
        reviewMode: relay.target_kind === "commit" ? "relay-only" : "pr-comment",
        deadline: current.deadline,
        allowUnsentSend: this.store.claimRecoverySend(current.job_id),
      });
      const accepted = this.bridge.expectOutboundAck(reconcile);
      try {
        this.writeDispatch(reconcile);
        await accepted;
        this.reconciledJobs.add(current.job_id);
      } catch (error) {
        this.bridge.cancelOutboundAck(reconcile, "RECONCILE_WRITE_FAILED");
        await accepted.catch(() => {});
        this.markSendUncertain(current.job_id, "RECONCILE_WRITE_FAILED");
        throw error;
      }
      current = this.store.getJob(current.job_id);
    }

    if (RETURNABLE_PHASES.has(current.phase)) return publicStatus(current);
    const remaining = Math.max(1, Date.parse(current.deadline) - Date.now());
    const waitSlice = Math.min(this.config.requestWaitSliceMs, remaining);
    try {
      return publicStatus(await this.coordinator.waitFor(current.job_id, RETURNABLE_PHASES, waitSlice));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "WAIT_TIMEOUT") throw error;
      const observed = this.store.getJob(current.job_id);
      if (!RETURNABLE_PHASES.has(observed.phase) && Date.now() >= Date.parse(observed.deadline)) {
        return publicStatus(this.coordinator.transition(observed.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED"));
      }
      return publicStatus(observed);
    }
  }

  async getStatus(input: {job_id?: string; handoff_path?: string}): Promise<TransportStatus> {
    const hasJob = typeof input.job_id === "string";
    const hasPath = typeof input.handoff_path === "string";
    if (hasJob === hasPath) throw new Error("STATUS_LOOKUP_KEY_INVALID");
    if (hasJob) return publicStatus(this.expirePastDeadline(this.store.getJob(input.job_id as string)));

    const relay = await this.exportRelay(this.config, input.handoff_path as string);
    const stored = this.store.getJobByHandoff(relay.handoff_path);
    if (
      stored.handoff_sha256 !== relay.handoff_sha256 ||
      stored.reviewed_head !== relay.reviewed_head ||
      stored.fingerprint !== relayFingerprint(relay)
    ) {
      throw new Error("HANDOFF_LOOKUP_DRIFT");
    }
    return publicStatus(this.expirePastDeadline(stored));
  }
}
