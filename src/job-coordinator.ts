import { EventEmitter } from "node:events";
import { JobStore, type JobPhase, type StoredJob } from "./job-store.ts";

export class JobCoordinator extends EventEmitter {
  readonly store: JobStore;

  constructor(store: JobStore) {
    super();
    this.store = store;
  }

  transition(jobId: string, phase: JobPhase, errorCode: string | null = null): StoredJob {
    const job = this.store.transitionJob(jobId, phase, errorCode);
    this.emit(`job:${jobId}`, job);
    return job;
  }

  waitFor(jobId: string, accepted: ReadonlySet<JobPhase>, timeoutMs: number): Promise<StoredJob> {
    const current = this.store.getJob(jobId);
    if (accepted.has(current.phase)) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const event = `job:${jobId}`;
      const onUpdate = (job: StoredJob) => {
        if (!accepted.has(job.phase)) return;
        clearTimeout(timer);
        this.off(event, onUpdate);
        resolve(job);
      };
      const timer = setTimeout(() => {
        this.off(event, onUpdate);
        reject(new Error("WAIT_TIMEOUT"));
      }, timeoutMs);
      this.on(event, onUpdate);
    });
  }
}
