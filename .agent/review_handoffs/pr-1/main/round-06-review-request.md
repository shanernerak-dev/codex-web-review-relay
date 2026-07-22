# 评审请求

Package kind: `review-request`
Review stream: `main`
Effective round: `6`
Target PR: `#1`
Review scope: 14c0978 至 reviewed head 累积修改的 README 与 agent 约定文档评审

## 评审区间（务必据此取证，不要只凭预读基线）

- **Review base commit**：`14c0978731c80cd02e9ccb51358370fa3ff60be5`（即 web agent 此前预读并认可的 companion 仓库基线 `14c0978`）。
- **Review head commit**：以 trigger envelope 的 `Reviewed head` 字段为准（= 本 handoff 提交后的 `HEAD`，由 relay-export helper 在提交后填入；本文件不硬写该 SHA 以避免自指）。
- **取证命令（全区间）**：

  ```
  git diff 14c0978731c80cd02e9ccb51358370fa3ff60be5..<Reviewed head>
  ```

- **取证命令（仅被评审文件）**：

  ```
  git diff 14c0978731c80cd02e9ccb51358370fa3ff60be5..<Reviewed head> -- README.md README.zh-CN.md src/envelope.ts extension/content.js scripts/install-native-host.ps1 config/relay.config.example.json scripts/tools/relay_export_helper.py AGENTS.md docs/agent_conventions.md docs/workflows/review_fix_workflow.md
  ```

> 说明：base 与 head 之间的全部 commit 均已 push 到公开远端 `origin/main`，可经 GitHub connector 直接读取，无需依赖 envelope 内嵌正文。

## 区间 commit 清单（base..head，按时间从旧到新）

- `baf7e38 docs: add agent entry, conventions, and review-fix workflow (three-layer architecture)`
- `9d825cf fix(extension): timeout-protect sendLifecycle to prevent monitor deadlock; simplify envelope instruction`
- `e780b53 fix: unblock completion detection and allow file reading in review`
- `67174d4 docs: add round-04 review-fix handoff addressing all 8 findings`
- `1655989 docs: fix all 8 web-agent review findings (F-README-001~008)`
- `192649b fix: improve review detection reliability and README completeness`
- `44366ff docs: add round-03 Chinese handoff for README review`
- `96561f9 feat(envelope): embed review execution instruction, make PR comment optional`
- `00d2840 docs: add round-02 Chinese handoff for README review retry`
- `cceb007 fix(extension): increase stable-turn detection window from 1.5s to 30s`
- `56bac5f docs: rewrite round-01 handoff in Chinese for README review`
- `cd80785 docs: make GitHub PR comment optional, clarify relay verdict delivery path`
- `b349d38 docs: add round-01 review request handoff for README review`
- `11a575b feat: add minimal relay-export helper for companion repo`

（另含本 round-06 handoff 提交本身，即 `Reviewed head`；该 handoff 文件不在被评审集合内。）

## 被评审文件集合（curated scope）

- `README.md`
- `README.zh-CN.md`
- `src/envelope.ts`
- `extension/content.js`
- `scripts/install-native-host.ps1`
- `config/relay.config.example.json`
- `scripts/tools/relay_export_helper.py`
- `AGENTS.md`
- `docs/agent_conventions.md`
- `docs/workflows/review_fix_workflow.md`

## 区间改动文件全清单（仅供参考；评审范围以上方 curated 集合为准）

- `.agent/review_handoffs/pr-1/main/round-01-review-request.md`
- `.agent/review_handoffs/pr-1/main/round-02-review-request.md`
- `.agent/review_handoffs/pr-1/main/round-03-review-request.md`
- `.agent/review_handoffs/pr-1/main/round-04-review-fix.md`
- `.agent/review_handoffs/pr-1/main/round-05-review-fix.md`
- `AGENTS.md`
- `README.md`
- `README.zh-CN.md`
- `config/relay.config.example.json`
- `docs/agent_conventions.md`
- `docs/workflows/review_fix_workflow.md`
- `extension/content.js`
- `scripts/install-native-host.ps1`
- `scripts/tools/relay_export_helper.py`
- `src/envelope.ts`

## 评审任务一：核销 round-03 的 8 项 findings

round-03 曾基于预读基线给出 8 项 findings（4 blocking + 3 major + 1 minor），但因当时未读取 head 而全部记为 UNVERIFIED。本区间已对其修复，请用上方 diff 逐条核销为 ACCEPTED / STILL_OPEN：

- **F-README-001**（helper 合同不闭合）：主要修复 `1655989`，辅以 `192649b`。核销点：Quick Start 是否在首次调用前要求配置 helper、是否写明 `python <helper> relay-export <handoff_path>` 调用形式与 stdout/stderr 规则。
- **F-README-002**（平台依赖过度承诺）：主要修复 `1655989`，辅以 `cd80785`、`96561f9`。核销点：自动 PR comment 是否对公开/私有仓库都标为需连接器；是否新增手动 PR comment 场景；GitLab/Gitee 适配说明是否指向 `src/envelope.ts` 而非 helper。
- **F-README-003**（MCP 配置不可执行）：主要修复 `1655989`，辅以 `192649b`。核销点：是否提供 Codex TOML 示例、JSON 是否标注为通用示意、是否说明环境变量需新开终端/重启、是否给 `/health` 验证步骤。
- **F-README-004**（lifecycle 漏恢复态）：主要修复 `1655989`。核销点：是否覆盖 `SESSION_LOST`/`SEND_UNCERTAIN`/`RECONCILING`，是否说明可返回 phase、同 fingerprint 重试幂等、`recover_review` 约束。
- **F-README-005**（helper/native host 职责边界）：主要修复 `1655989`。核销点：`frontmatter` 是否改为 header fields；是否区分 native host 不解析正文、helper 负责解析校验。
- **F-README-006**（持久化未披露）：主要修复 `1655989`。核销点：安全章节是否披露 SQLite 保存 `assistant_output` + SHA-256 及卸载删除。
- **F-README-007**（安装依赖原 checkout）：主要修复 `1655989`。核销点：是否警告 launcher 内嵌 `src/cli.ts` 绝对路径、安装后不可移动/删除 checkout。
- **F-README-008**（popup lease timer 超承诺）：主要修复 `1655989`。核销点：popup 描述是否降格为 Arm 状态/连接状态确认。

## 评审任务二：评审新增的三层 agent 约定文档

本区间新增 `AGENTS.md`、`docs/agent_conventions.md`、`docs/workflows/review_fix_workflow.md`，作为公开仓库的 agent 约定范例。请评审：

1. **路由闭合**：`AGENTS.md` 是否只做路由与红线、细则是否都下沉到 conventions，无冗余细节。
2. **一致性**：conventions 中的契约（两层依赖、envelope 构成、handoff 路径正则、relay-export 字段、job 生命周期三分类、持久化披露）是否与 `src/*`、`contracts/*`、`README.md` 一致。
3. **可移植性**：作为其他仓库可照搬的范例，结构是否自解释、是否避免本仓库私有假设泄漏。
4. **workflow 反模式表**：是否准确覆盖本轮真实踩过的坑（未 push 就触发、envelope 内嵌正文、active job 冲突、handoff 缺 finding→fix 映射、中英不同步）。

## 评审任务三：中英一致性

确认 `README.md` 与 `README.zh-CN.md` 在本区间的所有改动同步，术语对齐（helper vs native host、transport completion vs formal verdict、recovery vs terminal、relay-only vs PR comment）。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 对评审任务一：逐条 disposition（ACCEPTED / STILL_OPEN），STILL_OPEN 须给位置与建议。
- 对评审任务二、三：逐项 findings（如有），含位置、问题、建议。
- 若任务一全部 ACCEPTED 且任务二、三无 blocking finding，verdict 为 `PASS`。

## 注意事项

- 本轮**只审文档与约定质量**，不审源码实现正确性（实现已通过 targeted tests + compat check）。
- 你**应当**经 `Reviewed head` 在远端读取上述文件与 diff 后再下结论；若仍无法读取，请明确说明并给 `HUMAN DECISION REQUIRED`，不要凭预读基线臆断当前 head。
- 评审结论经 relay MCP 通道回传即可；PR comment 可选。
- 评审语言中文或英文均可；引用代码/路径保留原文。
