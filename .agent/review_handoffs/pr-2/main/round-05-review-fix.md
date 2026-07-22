# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `5`
Target PR: `#2`
Review scope: Stage 2——通用化 helper/config 安装路径，并核验 single-crystal producer 兼容边界

## 评审区间

- Review base commit：`76292939b15f341927973249f09ce0bba8560ffa`
- Previous formally reviewed head：`09c0e063214646542666c5dda8057cd46b404d59`
- Stage 2 implementation commit：`a6e18fc`
- Review head：以 trigger envelope 的 `Reviewed head` 字段为准。
- 取证命令：`git diff 09c0e063214646542666c5dda8057cd46b404d59..<Reviewed head>`

## Stage 2 变更

- `scripts/install-native-host.ps1` 新增 `-HelperPath`，默认使用通用的 `scripts/tools/relay_export_helper.py`，并拒绝 absolute helper path。
- `config/relay.config.example.json` 不再默认指向 producer-specific `check_stage_gate_readiness.py`。
- `README.md` / `README.zh-CN.md` 同步说明：将 generic helper 复制到 target repository，或通过 `-HelperPath` / 配置指定自己的 helper。
- `discuss/relay_generality_spec.md` 记录 Stage 1 acceptance、Stage 2 进入状态和 producer integration tracking Issue #44。
- 未修改 relay-export v1.0 schema、transport、MCP/native protocol 或 extension behavior。

## 跨仓库影响与跟踪

producer repository：`David-JA/single-crystal-stress`

integration tracking Issue：[#44](https://github.com/David-JA/single-crystal-stress/issues/44)

本轮需要评审：

- generic helper/config 是否仍保持当前 producer helper 的 v1.0 compatibility；
- 是否清楚区分 companion 示例 helper 与 producer 自有 helper；
- 是否存在会破坏 single-crystal 现有安装、handoff 或 PR-comment 使用方式的隐含改动。

## 验证证据

- `npm run test:compat`：通过，producer fixture schema v1.0 compatible。
- `python scripts/tools/relay_export_helper.py relay-export .agent/review_handoffs/pr-2/main/round-04-review-fix.md`：通过。
- `scripts/install-native-host.ps1` PowerShell parse：通过。
- `config/relay.config.example.json` JSON parse：通过。
- `git diff --check`：通过。

## 评审任务

1. 评审 Stage 2 增量 diff 的通用性、文档准确性和配置行为。
2. 确认 installer 默认值不再绑定 single-crystal producer。
3. 确认现有 v1.0 producer helper contract 未被破坏。
4. 确认 Issue #44 足以承载后续 producer-side compatibility readback。
5. 本轮不要求实现 Stage 3 commit-only schema、long-review completion detection 或无 PR transport。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 明确列出 blocking / major / minor findings。
- Stage 1 formal verdict 规则仍然有效：PR comment 是正式来源，relay assistant response 只需短确认。
- 不执行 Ready、merge、Issue acceptance 或 producer Issue closeout。
