import { canonicalJson, sha256 } from "./canonical.ts";

export interface SchemaVersion {
  major: number;
  minor: number;
}

export interface RelayExport {
  schema_version: SchemaVersion;
  repository: string;
  target_pr: number;
  handoff_path: string;
  handoff_sha256: string;
  full_ref: string;
  reviewed_head: string;
  review_stream: string;
  effective_round: number;
  package_kind: "review-request" | "review-fix" | "evidence-amendment" | "human-decision";
  normalized_scope: string[];
  scope_sha256: string;
  [key: string]: unknown;
}

export const RELAY_EXPORT_SUPPORT = Object.freeze({major: 1, minMinor: 0, maxMinor: 0});

function requireString(record: Record<string, unknown>, key: string, pattern?: RegExp): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`RELAY_EXPORT_INVALID:${key}`);
  }
  return value;
}

export function validateRelayExport(value: unknown): RelayExport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RELAY_EXPORT_INVALID:object");
  }
  const record = value as Record<string, unknown>;
  const version = record.schema_version as Record<string, unknown> | undefined;
  if (!version || version.major !== RELAY_EXPORT_SUPPORT.major || !Number.isInteger(version.minor)) {
    throw new Error("RELAY_SCHEMA_MAJOR_UNSUPPORTED");
  }
  if ((version.minor as number) < RELAY_EXPORT_SUPPORT.minMinor) {
    throw new Error("RELAY_SCHEMA_MINOR_UNSUPPORTED");
  }

  requireString(record, "repository", /^[^/\s]+\/[^/\s]+$/);
  if (!Number.isInteger(record.target_pr) || (record.target_pr as number) < 1) {
    throw new Error("RELAY_EXPORT_INVALID:target_pr");
  }
  requireString(record, "handoff_path", /^\.agent\/review_handoffs\/pr-[1-9]\d*\/[a-z0-9][a-z0-9-]*\/round-(?:0[1-9]|[1-9]\d+)-(review-request|review-fix|evidence-amendment|human-decision)\.md$/);
  requireString(record, "handoff_sha256", /^[0-9a-f]{64}$/);
  requireString(record, "full_ref", /^refs\/heads\/[A-Za-z0-9._/-]+$/);
  requireString(record, "reviewed_head", /^[0-9a-f]{40}$/);
  requireString(record, "review_stream", /^[a-z0-9][a-z0-9-]*$/);
  if (!Number.isInteger(record.effective_round) || (record.effective_round as number) < 1) {
    throw new Error("RELAY_EXPORT_INVALID:effective_round");
  }
  if (!["review-request", "review-fix", "evidence-amendment", "human-decision"].includes(String(record.package_kind))) {
    throw new Error("RELAY_EXPORT_INVALID:package_kind");
  }
  if (!Array.isArray(record.normalized_scope) || record.normalized_scope.length === 0 || record.normalized_scope.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error("RELAY_EXPORT_INVALID:normalized_scope");
  }
  requireString(record, "scope_sha256", /^[0-9a-f]{64}$/);
  const observedScopeHash = sha256(canonicalJson(record.normalized_scope));
  if (observedScopeHash !== record.scope_sha256) {
    throw new Error("RELAY_SCOPE_HASH_MISMATCH");
  }
  return record as RelayExport;
}

export function relayFingerprint(relay: RelayExport): string {
  return sha256(canonicalJson({
    repository: relay.repository,
    target_pr: relay.target_pr,
    handoff_path: relay.handoff_path,
    handoff_sha256: relay.handoff_sha256,
    full_ref: relay.full_ref,
    reviewed_head: relay.reviewed_head,
    review_stream: relay.review_stream,
    effective_round: relay.effective_round,
    package_kind: relay.package_kind,
    scope_sha256: relay.scope_sha256,
  }));
}
