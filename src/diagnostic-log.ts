import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type DiagnosticLevel = "off" | "error" | "info" | "debug" | "trace";
const PRIORITY: Record<DiagnosticLevel, number> = {off: 0, error: 1, info: 2, debug: 3, trace: 4};
const SAFE_KEYS = new Set([
  "session_id", "job_id", "request_id", "message_type", "phase", "error_code",
  "attempt", "turn_id", "role", "count", "length", "sha256", "state",
  "connected", "generating", "response_idle", "quiet", "stable", "completion_observed",
]);

export interface DiagnosticEvent {
  timestamp: string;
  level: Exclude<DiagnosticLevel, "off">;
  component: string;
  event: string;
  [key: string]: unknown;
}

function safeText(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, max);
}

export class DiagnosticLogger {
  readonly path: string;
  readonly level: DiagnosticLevel;
  readonly maxBytes: number;
  readonly retainedFiles: number;

  constructor(
    path: string,
    level: DiagnosticLevel,
    maxBytes: number,
    retainedFiles: number,
  ) {
    this.path = path;
    this.level = level;
    this.maxBytes = maxBytes;
    this.retainedFiles = retainedFiles;
    mkdirSync(dirname(path), {recursive: true});
  }

  write(level: Exclude<DiagnosticLevel, "off">, component: string, event: string, fields: Record<string, unknown> = {}): void {
    if (PRIORITY[this.level] < PRIORITY[level]) return;
    const record: DiagnosticEvent = {
      timestamp: new Date().toISOString(),
      level,
      component: safeText(component, 64) ?? "unknown",
      event: safeText(event, 96) ?? "unknown",
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!SAFE_KEYS.has(key) || value === undefined || value === null) continue;
      record[key] = typeof value === "string" ? value.slice(0, 160) : value;
    }
    const line = `${JSON.stringify(record)}\n`;
    this.rotateIfNeeded(Buffer.byteLength(line));
    appendFileSync(this.path, line, "utf8");
  }

  query(jobId: string, limit = 200): {log_path: string; events: DiagnosticEvent[]; truncated: boolean} {
    const bounded = Math.max(1, Math.min(500, limit));
    const events: DiagnosticEvent[] = [];
    for (let index = this.retainedFiles; index >= 1; index -= 1) this.readMatching(`${this.path}.${index}`, jobId, events);
    this.readMatching(this.path, jobId, events);
    return {log_path: this.path, events: events.slice(-bounded), truncated: events.length > bounded};
  }

  private readMatching(path: string, jobId: string, output: DiagnosticEvent[]): void {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      try {
        const value = JSON.parse(line) as DiagnosticEvent;
        if (value.job_id === jobId) output.push(value);
      } catch {
        // A torn final line must not make historical diagnostics unreadable.
      }
    }
  }

  private rotateIfNeeded(incomingBytes: number): void {
    if (!existsSync(this.path) || statSync(this.path).size + incomingBytes <= this.maxBytes) return;
    for (let index = this.retainedFiles; index >= 1; index -= 1) {
      const source = index === 1 ? this.path : `${this.path}.${index - 1}`;
      const target = `${this.path}.${index}`;
      if (existsSync(target)) rmSync(target);
      if (existsSync(source)) renameSync(source, target);
    }
  }
}
