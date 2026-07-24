import { sha256 } from "./canonical.ts";
import type { RelayExport } from "./relay-contract.ts";

export interface TriggerEnvelope {
  text: string;
  sha256: string;
}

export const FORMAL_REVIEW_PUBLICATION_INSTRUCTION =
  "After completing the review, publish the formal verdict as a GitHub PR comment following the repository convention.";

export const RELAY_ONLY_VERDICT_INSTRUCTION =
  "This is a commit-only review. Do not publish a GitHub PR comment. Return the complete formal verdict in your assistant response.";

export function renderTriggerEnvelope(relay: RelayExport): TriggerEnvelope {
  const text = [
    `Repository: ${relay.repository}`,
    `Path: ${relay.handoff_path}`,
    ...(relay.target_kind === "commit" ? [`Target kind: ${relay.target_kind}`, `Target ID: ${relay.target_id}`] : []),
    `full Ref: ${relay.full_ref}`,
    `Reviewed head: ${relay.reviewed_head}`,
    `Review stream: ${relay.review_stream}`,
    `Effective round: ${relay.effective_round}`,
    `Package kind: ${relay.package_kind}`,
    relay.target_kind === "commit" ? RELAY_ONLY_VERDICT_INSTRUCTION : FORMAL_REVIEW_PUBLICATION_INSTRUCTION,
  ].join("\n");
  return {text, sha256: sha256(text)};
}
