import { sha256 } from "./canonical.ts";
import type { RelayExport } from "./relay-contract.ts";

export interface TriggerEnvelope {
  text: string;
  sha256: string;
}

export const FORMAL_REVIEW_PUBLICATION_INSTRUCTION =
  "After completing the review, publish the formal verdict as a GitHub PR comment following the repository convention (optional — returning the verdict in this conversation via the relay channel is sufficient).";

export const REVIEW_EXECUTION_INSTRUCTION =
  "This is a formal review request. Read the handoff file at the Path above and the reviewed head commit to execute the review. Output your complete verdict as plain text in this conversation.";

export function renderTriggerEnvelope(relay: RelayExport): TriggerEnvelope {
  const text = [
    `Path: ${relay.handoff_path}`,
    `full Ref: ${relay.full_ref}`,
    `Reviewed head: ${relay.reviewed_head}`,
    `Review stream: ${relay.review_stream}`,
    `Effective round: ${relay.effective_round}`,
    `Package kind: ${relay.package_kind}`,
    REVIEW_EXECUTION_INSTRUCTION,
    FORMAL_REVIEW_PUBLICATION_INSTRUCTION,
  ].join("\n");
  return {text, sha256: sha256(text)};
}
