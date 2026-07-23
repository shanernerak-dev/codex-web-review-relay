import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type DiagnosticLevel = "off" | "error" | "info" | "debug" | "trace";
const PRIORITY: Record<DiagnosticLevel, number> = {off: 0, error: 1, info: 2, debug: 3, trace: 4};
const COMPONENTS = new Set(["native-host", "extension-background", "extension-content"]);
const EVENTS = new Set([
  "session_armed", "trigger_received", "trigger_accepted", "trigger_failed",
  "dispatch_started", "dispatch_receipt_missing", "monitor_started", "monitor_finished", "monitor_failed",
  "user_turn_observed", "assistant_turn_observed", "completion_snapshot",
  "lifecycle_requested", "lifecycle_received", "lifecycle_send", "lifecycle_native_received",
  "lifecycle_acked", "lifecycle_rejected", "diagnostic_rejected", "message_failed",
]);
const STRING_FIELDS = new Set([
  "session_id", "job_id", "request_id", "message_type", "phase", "error_code",
  "turn_id", "role", "state", "sha256", "event_id", "source_timestamp",
  "binding_generation", "document_id",
]);
const INTEGER_FIELDS = new Set(["attempt", "count", "length", "sequence", "tab_id", "candidate_count", "exact_match_count", "baseline_count"]);
const BOOLEAN_FIELDS = new Set(["connected", "generating", "response_idle", "quiet", "stable", "completion_observed"]);

export interface DiagnosticEvent {
  timestamp: string;
  level: Exclude<DiagnosticLevel, "off">;
  component: string;
  event: string;
  [key: string]: unknown;
}

function sanitizedFields(fields: Record<string, unknown>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (STRING_FIELDS.has(key) && typeof value === "string" && value.length > 0) output[key] = value.slice(0, 160);
    else if (INTEGER_FIELDS.has(key) && Number.isSafeInteger(value) && (value as number) >= 0) output[key] = value as number;
    else if (BOOLEAN_FIELDS.has(key) && typeof value === "boolean") output[key] = value;
  }
  return output;
}

export class DiagnosticLogger {
  readonly path: string;
  readonly level: DiagnosticLevel;
  readonly maxBytes: number;
  readonly retainedFiles: number;
  readonly seenEventIds = new Set<string>();
  lastError: string | null = null;

  constructor(path: string, level: DiagnosticLevel, maxBytes: number, retainedFiles: number) {
    this.path = path;
    this.level = level;
    this.maxBytes = maxBytes;
    this.retainedFiles = retainedFiles;
    try { mkdirSync(dirname(path), {recursive: true}); }
    catch (error) { this.lastError = error instanceof Error ? error.message : "DIAGNOSTIC_INIT_FAILED"; }
  }

  write(level: Exclude<DiagnosticLevel, "off">, component: string, event: string, fields: Record<string, unknown> = {}): boolean {
    if (PRIORITY[this.level] < PRIORITY[level]) return true;
    if (!COMPONENTS.has(component) || !EVENTS.has(event)) return false;
    const safe = sanitizedFields(fields);
    const eventId = typeof safe.event_id === "string" ? safe.event_id : null;
    if (eventId && this.seenEventIds.has(eventId)) return true;
    const record: DiagnosticEvent = {timestamp: new Date().toISOString(), level, component, event, ...safe};
    try {
      const line = `${JSON.stringify(record)}\n`;
      this.rotateIfNeeded(Buffer.byteLength(line));
      appendFileSync(this.path, line, "utf8");
      if (eventId) {
        this.seenEventIds.add(eventId);
        if (this.seenEventIds.size > 1024) this.seenEventIds.delete(this.seenEventIds.values().next().value as string);
      }
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "DIAGNOSTIC_WRITE_FAILED";
      return false;
    }
  }

  query(jobId: string, limit = 200): {log_path: string; events: DiagnosticEvent[]; truncated: boolean; log_error: string | null} {
    const bounded = Math.max(1, Math.min(500, limit));
    const events: DiagnosticEvent[] = [];
    try {
      for (let index = this.retainedFiles; index >= 1; index -= 1) this.readMatching(`${this.path}.${index}`, jobId, events);
      this.readMatching(this.path, jobId, events);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "DIAGNOSTIC_READ_FAILED";
    }
    events.sort((a, b) => {
      const time = String(a.source_timestamp ?? a.timestamp).localeCompare(String(b.source_timestamp ?? b.timestamp));
      return time || Number(a.sequence ?? 0) - Number(b.sequence ?? 0);
    });
    const unique = [];
    const seen = new Set<string>();
    for (const event of events) {
      const eventId = typeof event.event_id === "string" ? event.event_id : null;
      if (eventId && seen.has(eventId)) continue;
      if (eventId) seen.add(eventId);
      unique.push(event);
    }
    return {log_path: this.path, events: unique.slice(-bounded), truncated: unique.length > bounded, log_error: this.lastError};
  }

  private readMatching(path: string, jobId: string, output: DiagnosticEvent[]): void {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      try { const value = JSON.parse(line) as DiagnosticEvent; if (value.job_id === jobId) output.push(value); } catch {}
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
