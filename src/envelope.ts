import { sha256 } from "./canonical.ts";
import type { RelayExport } from "./relay-contract.ts";

export interface TriggerEnvelope {
  text: string;
  sha256: string;
}

export function renderTriggerEnvelope(relay: RelayExport): TriggerEnvelope {
  const text = [
    `Path: ${relay.handoff_path}`,
    `full Ref: ${relay.full_ref}`,
    `Reviewed head: ${relay.reviewed_head}`,
    `Review stream: ${relay.review_stream}`,
    `Effective round: ${relay.effective_round}`,
    `Package kind: ${relay.package_kind}`,
  ].join("\n");
  return {text, sha256: sha256(text)};
}
