# Stage 2 Web Review Request

Package kind: `review-request`
Review stream: `stage2-main`
Effective round: `1`
Target PR: `#2`
Review scope: Stage 2——通用 helper fail-closed 合同、repository-relative runtime 边界、single-crystal 迁移说明与 producer compatibility

## Stage-scoped identity

Stage 1 的 `main/round-04` 已完成正式评审并由 Maintainer 批准进入 Stage 2。Stage 2 的 round 重新从 `01` 计数；旧的 `main/round-05` 是 Stage 2 初次尝试的历史 review identity，不再作为当前 Stage 2 canonical trigger。当前 handoff 使用 `stage2-main/round-01`，避免跨 Stage path collision。

## Review baseline

- Review base commit：`76292939b15f341927973249f09ce0bba8560ffa`
- Previous formally reviewed head：`09c0e063214646542666c5dda8057cd46b404d59`
- Reviewed head：以 trigger envelope 的 `Reviewed head` 字段为准。
- Producer tracking Issue：[#44](https://github.com/David-JA/single-crystal-stress/issues/44)

## Stage 2 implementation

- `scripts/tools/relay_export_helper.py` 现在要求并校验 `Target PR`、`Review stream`、`Effective round`、`Package kind`、`Review scope`，逐项核对 path/header，拒绝 duplicate/missing/malformed/mismatch、dirty/untracked/blob mismatch、detached HEAD 与 handoff symlink escape。
- `src/config.ts` 拒绝 absolute、UNC、drive-relative 与 parent-traversal `helperPath`；`src/repo-adapter.ts` 通过 realpath containment 在 runtime 再次 fail closed，并允许合法 nested helper。
- `scripts/install-native-host.ps1` 对 helper 做 repository containment canonicalization，并在 helper 不存在或 symlink escape 时拒绝安装。
- `README.md` / `README.zh-CN.md` 同步补充 helper header 合同、无 scope fallback、runtime 边界和 single-crystal 重装迁移命令。
- conventions/spec 明确 review round 按 `(Stage, review stream)` 独立计数，Stage 2 从 round-01 开始。
- 未修改 relay-export v1.0 schema、transport、MCP/native protocol 或 extension behavior。

## Prior Stage 2 review findings addressed

旧 Stage 2 review identity `main/round-05` 的 `REQUEST CHANGES` findings：

- `RGEN-S2-001`：generic helper 的稳定 header 与 fail-closed negative coverage。
- `RGEN-S2-002`：installer 与 runtime 的 repository-relative helper containment。
- `RGEN-S2-003`：双语 README 的 single-crystal migration path；producer-side real-helper readback 仍以 Issue #44 记录，待本 PR 收尾后执行。

## Validation requested

- `npm test` 及 helper/config/repo-adapter targeted tests。
- generic helper 的成功、missing/duplicate/mismatch、dirty/untracked/blob mismatch、detached HEAD cases。
- producer `scripts/tools/check_stage_gate_readiness.py relay-export` 的真实 handoff readback 与 v1.0 schema compatibility；结果回写 Issue #44。

## Review boundaries

- 本轮不实现 Stage 3 commit-only schema、long-review completion detection 或无 PR transport。
- 不执行 Ready、merge、Issue acceptance 或 producer Issue closeout。
