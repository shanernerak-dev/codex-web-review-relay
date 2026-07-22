import { sha256 } from "./canonical.ts";
import type { RelayExport } from "./relay-contract.ts";

export interface TriggerEnvelope {
  text: string;
  sha256: string;
}

export const FORMAL_REVIEW_PUBLICATION_INSTRUCTION =
  "After completing the review, publish the formal verdict as a GitHub PR comment following the repository convention (optional — returning the verdict in this conversation via the relay channel is sufficient).";

export const REVIEW_EXECUTION_INSTRUCTION =
  "请基于你的预读上下文和 trigger envelope 中的信息，现在执行正式评审。如果你能访问仓库文件，请读取验证；如果不能，请基于预读基线和 handoff 中的修复摘要评审。以纯文本形式输出完整评审结论。";

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
