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
    return new Promise((resolve, reject) => {
      const event = `job:${jobId}`;
      let settled = false;
      const onUpdate = (job: StoredJob) => {
        if (settled || !accepted.has(job.phase)) return;
        settled = true;
        clearTimeout(timer);
        this.off(event, onUpdate);
        resolve(job);
      };
      const timer = setTimeout(() => {
        this.off(event, onUpdate);
        reject(new Error("WAIT_TIMEOUT"));
      }, timeoutMs);
      this.on(event, onUpdate);
      try {
        onUpdate(this.store.getJob(jobId));
      } catch (error) {
        clearTimeout(timer);
        this.off(event, onUpdate);
        reject(error);
      }
    });
  }
}
