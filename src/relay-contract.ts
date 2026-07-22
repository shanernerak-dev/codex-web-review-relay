import { canonicalJson, sha256 } from "./canonical.ts";

export interface SchemaVersion {
  major: number;
  minor: number;
}

export type RelayTargetKind = "pr" | "commit";

export interface RelayExport {
  schema_version: SchemaVersion;
  repository: string;
  target_kind: RelayTargetKind;
  target_id: string;
  target_pr: number | null;
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

export const RELAY_EXPORT_SUPPORT = Object.freeze({major: 1, minMinor: 0, maxMinor: 1});

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
  if ((version.minor as number) > RELAY_EXPORT_SUPPORT.maxMinor) {
    throw new Error("RELAY_SCHEMA_MINOR_UNSUPPORTED");
  }

  requireString(record, "repository", /^[^/\s]+\/[^/\s]+$/);
  const handoffPath = requireString(record, "handoff_path");
  const pathMatch = handoffPath.match(/^\.agent\/review_handoffs\/(?:pr-([1-9][0-9]*)|review-([a-z0-9][a-z0-9-]*))\/([a-z0-9][a-z0-9-]*)\/round-(0[1-9]|[1-9][0-9]+)-(review-request|review-fix|evidence-amendment|human-decision)\.md$/);
  if (!pathMatch) throw new Error("RELAY_EXPORT_INVALID:handoff_path");
  const inferredKind: RelayTargetKind = pathMatch[1] ? "pr" : "commit";
  if (version.minor === 0 && inferredKind !== "pr") {
    throw new Error("RELAY_COMMIT_SCHEMA_MINOR_UNSUPPORTED");
  }
  if ((version.minor as number) >= 1 && (record.target_kind === undefined || record.target_id === undefined)) {
    throw new Error("RELAY_TARGET_IDENTITY_REQUIRED");
  }
  const targetKind = record.target_kind === undefined ? inferredKind : record.target_kind;
  if (targetKind !== "pr" && targetKind !== "commit") throw new Error("RELAY_EXPORT_INVALID:target_kind");
  if (targetKind !== inferredKind) throw new Error("RELAY_TARGET_PATH_MISMATCH");
  const targetId = record.target_id === undefined
    ? (inferredKind === "pr" ? `pr-${pathMatch[1]}` : `review-${pathMatch[2]}`)
    : record.target_id;
  requireString({target_id: targetId}, "target_id", inferredKind === "pr" ? /^pr-[1-9][0-9]*$/ : /^review-[a-z0-9][a-z0-9-]*$/);
  const targetPr = record.target_pr === undefined ? (inferredKind === "pr" ? Number(pathMatch[1]) : null) : record.target_pr;
  if (inferredKind === "pr") {
    if (!Number.isInteger(targetPr) || (targetPr as number) < 1 || targetId !== `pr-${targetPr}`) throw new Error("RELAY_EXPORT_INVALID:target_pr");
  } else if (targetPr !== null) {
    throw new Error("RELAY_EXPORT_INVALID:target_pr");
  }
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
  return {...record, target_kind: targetKind, target_id: targetId, target_pr: targetPr} as RelayExport;
}

export function relayFingerprint(relay: RelayExport): string {
  const identity = {
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
  };
  if (relay.target_kind === "commit") {
    return sha256(canonicalJson({...identity, target_kind: relay.target_kind, target_id: relay.target_id}));
  }
  // PR mode intentionally preserves the pre-Stage-3 byte-for-byte identity.
  return sha256(canonicalJson(identity));
}
