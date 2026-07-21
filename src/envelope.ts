import { sha256 } from "./canonical.ts";
import type { RelayExport } from "./relay-contract.ts";

export interface TriggerEnvelope {
  text: string;
  sha256: string;
}

export const FORMAL_REVIEW_PUBLICATION_INSTRUCTION =
  "After completing the review, publish the formal verdict as a GitHub PR comment following the repository convention.";

export function renderTriggerEnvelope(relay: RelayExport): TriggerEnvelope {
  const text = [
    `Path: ${relay.handoff_path}`,
    `full Ref: ${relay.full_ref}`,
    `Reviewed head: ${relay.reviewed_head}`,
    `Review stream: ${relay.review_stream}`,
    `Effective round: ${relay.effective_round}`,
    `Package kind: ${relay.package_kind}`,
    FORMAL_REVIEW_PUBLICATION_INSTRUCTION,
  ].join("\n");
  return {text, sha256: sha256(text)};
}
