# Stage 2 Web Review Fix

Package kind: `review-fix`
Review stream: `stage2-main`
Effective round: `2`
Target PR: `#2`
Review scope: Stage 2——修复 generic helper byte-level identity 与 Stage 2 formal-verdict workflow coverage

Previous review URL: https://github.com/David-JA/codex-web-review-relay/pull/2#issuecomment-5045538822

## OPEN findings

- `RGEN-S2-001`：generic helper 在 CRLF 下重新编码文本计算 `handoff_sha256`，且 invalid UTF-8 未稳定 fail closed。
- `RGEN-S2-004`：canonical AGENTS/conventions/workflow 未明确 Stage 2 仍使用 v1 PR-comment formal verdict source。

## Locked dispositions

- `RGEN-S2-002`、`RGEN-S2-003`：上一轮已 ACCEPTED，不回退。
- Stage 2 仍未取得 acceptance；本轮 verdict 不构成 Ready、merge、Issue acceptance 或 producer Issue closeout。
- Stage 3 commit-only schema、long-review completion detection 与无 PR transport 继续 out of scope。

## Finding → fix mapping

- `RGEN-S2-001` → `scripts/tools/relay_export_helper.py` 现在一次读取 raw bytes，以 raw bytes 与 HEAD blob 比较并直接计算 `handoff_sha256`；UTF-8 decode 在显式 fail-closed 分支中执行，invalid encoding 返回 `HANDOFF_ENCODING_INVALID`。新增 CRLF raw-byte hash 与 invalid UTF-8 tests。`.gitattributes` 约束 tracked handoff 使用 LF，避免 Windows checkout identity 漂移。
- `RGEN-S2-004` → `AGENTS.md`、`docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md` 与 canonical spec 明确：Stage 3 relay-only contract 验收前，Stage 1/Stage 2 均使用 v1 PR-comment mode，目标 PR comment 是 formal verdict source，短 `assistant_output` 仅为 transport evidence。

## Validation

- `node --experimental-strip-types --test test/relay-export-helper.test.ts`：通过，含 missing/duplicate/mismatch、dirty/untracked/blob mismatch、detached、CRLF hash 与 invalid UTF-8 cases。
- `node --experimental-strip-types --test test/repo-adapter.test.ts`：通过，含合法 nested helper 与 repository escape。
- `node --experimental-strip-types --test test/config.test.ts`：通过，含 helper path boundary。
- `npm run test:compat`：producer v1.0 schema fixture compatibility 通过。
- `python scripts/tools/relay_export_helper.py relay-export .agent/review_handoffs/pr-2/stage2-main/round-02-review-fix.md`：待本 handoff commit 后执行。
- `git diff --check`、PowerShell parse、config JSON parse：通过。

## Request

请按 `stage2-main` 的 Stage 2 round-02 identity 复审上述两个 findings 与本轮增量；只从当前 v1 PR-comment mode 的目标 PR comment readback 判定 formal verdict，不从短 `assistant_output` 推断。
