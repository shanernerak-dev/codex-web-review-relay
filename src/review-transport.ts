import { renderTriggerEnvelope } from "./envelope.ts";
import { JobCoordinator } from "./job-coordinator.ts";
import { JobStore, type JobPhase, type StoredJob } from "./job-store.ts";
import { NativeBridge } from "./native-protocol.ts";
import { relayFingerprint, type RelayExport } from "./relay-contract.ts";
import { runRelayExport } from "./repo-adapter.ts";
import type { RelayConfig } from "./config.ts";

export type NativeDispatchWriter = (message: Record<string, unknown>) => void;
export type RelayExporter = (config: RelayConfig, handoffPath: string) => Promise<RelayExport>;

const RETURNABLE_PHASES = new Set<JobPhase>([
  "TURN_IDLE", "SESSION_LOST", "SEND_UNCERTAIN", "BLOCKED", "MISMATCH", "TIMEOUT",
]);

export interface TransportStatus {
  job_id: string;
  fingerprint: string;
  handoff_path: string;
  handoff_sha256: string;
  reviewed_head: string;
  phase: JobPhase;
  result: StoredJob["result"];
  error_code: string | null;
  deadline: string;
}

function publicStatus(job: StoredJob): TransportStatus {
  return {
    job_id: job.job_id,
    fingerprint: job.fingerprint,
    handoff_path: job.handoff_path,
    handoff_sha256: job.handoff_sha256,
    reviewed_head: job.reviewed_head,
    phase: job.phase,
    result: job.result,
    error_code: job.error_code,
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

  private async requestReviewResolved(relay: RelayExport, fingerprint: string): Promise<TransportStatus> {
    const session = this.store.getActiveSession();
    if (!session) throw new Error("SESSION_NOT_ARMED");

    const deadline = new Date(Date.now() + this.config.requestDeadlineMs);
    const {job} = this.store.createOrGetJob(relay, fingerprint, deadline);
    if (job.handoff_sha256 !== relay.handoff_sha256 || job.reviewed_head !== relay.reviewed_head) {
      throw new Error("STORED_JOB_IDENTITY_MISMATCH");
    }

    let current = job;
    if (current.phase === "CREATED") {
      const dispatch = this.bridge.createDispatch({
        sessionId: session.session_id,
        jobId: current.job_id,
        fingerprint,
        envelope: renderTriggerEnvelope(relay),
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
      if (current.phase !== "RECONCILING") current = this.coordinator.transition(current.job_id, "RECONCILING");
      const reconcile = this.bridge.createReconcile({
        sessionId: session.session_id,
        jobId: current.job_id,
        fingerprint,
        envelope: renderTriggerEnvelope(relay),
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
    try {
      return publicStatus(await this.coordinator.waitFor(current.job_id, RETURNABLE_PHASES, remaining));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "WAIT_TIMEOUT") throw error;
      const observed = this.store.getJob(current.job_id);
      if (!RETURNABLE_PHASES.has(observed.phase)) {
        return publicStatus(this.coordinator.transition(observed.job_id, "TIMEOUT", "TURN_DEADLINE_EXCEEDED"));
      }
      return publicStatus(observed);
    }
  }

  async getStatus(input: {job_id?: string; handoff_path?: string}): Promise<TransportStatus> {
    const hasJob = typeof input.job_id === "string";
    const hasPath = typeof input.handoff_path === "string";
    if (hasJob === hasPath) throw new Error("STATUS_LOOKUP_KEY_INVALID");
    if (hasJob) return publicStatus(this.store.getJob(input.job_id as string));

    const relay = await this.exportRelay(this.config, input.handoff_path as string);
    const stored = this.store.getJobByHandoff(relay.handoff_path);
    if (
      stored.handoff_sha256 !== relay.handoff_sha256 ||
      stored.reviewed_head !== relay.reviewed_head ||
      stored.fingerprint !== relayFingerprint(relay)
    ) {
      throw new Error("HANDOFF_LOOKUP_DRIFT");
    }
    return publicStatus(stored);
  }
}
