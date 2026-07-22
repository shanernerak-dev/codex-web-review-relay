# 评审请求

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#2`
Review scope: PR#2 首轮评审——relay 通用化 Stage 1（transport 回退基线 + spec 骨架）

## 评审区间

- **Review base commit**：`76292939b15f341927973249f09ce0bba8560ffa`（PR#2 的 base = main tip）。
- **Review head commit**：以 trigger envelope 的 `Reviewed head` 字段为准（= 本 handoff 提交后的分支 tip）。
- **取证命令**：

  ```
  git diff 76292939b15f341927973249f09ce0bba8560ffa..<Reviewed head>
  ```

> base 与 head 之间的全部 commit 均已 push 到公开远端 `origin/codex/relay-generality`，可经 GitHub connector 直接读取。

## 区间 commit 清单（base..head）

- `02bc922 stage1: revert relay transport to PR#1-merge baseline (43c33e4) + add generality spec skeleton`

（另含本 round-01 handoff 提交本身。）

## 区间改动文件清单

- `discuss/relay_generality_spec.md`
- `extension/content.js`
- `src/envelope.ts`

## PR 意图

本 PR 是 relay 通用化改造的 Stage 1（共 3 stage，详见 `discuss/relay_generality_spec.md`）：

1. **transport 回退基线**：`extension/content.js` 与 `src/envelope.ts` 逐字节回退到 PR#1 merge 点 `43c33e4`（producer 已验证的 completion detection + 单条 PR-comment 指令版本）。此前在 main 上尝试"无 PR + 对话内长评审"偏离了基线设计包络，导致 round1-2 截断、round3-6 TIMEOUT。回退基线恢复 PR-comment 模式的可运行性。
2. **spec 骨架**：新增 `discuss/relay_generality_spec.md`，轻量多 stage 计划（Stage 1 跑通 PR-comment 模式；Stage 2 对齐 producer conventions 范本；Stage 3 实现并测试无 PR 通用模式）。

## 评审任务

### 任务一：验证 transport 回退正确性

确认 `extension/content.js` 与 `src/envelope.ts` 在本 PR 的 diff 中呈现为"回退到 43c33e4 基线"——即删除了 main 上的 completion detection 重写（30s 窗口、sendLifecycle 超时保护、完成块门控变更）和 envelope 第二条指令（`REVIEW_EXECUTION_INSTRUCTION`），恢复为基线的 1500ms 窗口 + 单条 `FORMAL_REVIEW_PUBLICATION_INSTRUCTION`。

### 任务二：评审 spec 骨架

`discuss/relay_generality_spec.md` 是否：
1. 准确描述了根因（流程姿势偏离 + transport 回归 + target 作用域错配）。
2. Stage 表是否合理（Stage 1 不动传输代码、Stage 2 框架、Stage 3 才动 envelope+completion detection）。
3. 不变量是否与 `src/*`、`contracts/*` 一致（envelope 不内嵌正文、target_pr 须指向 open PR、fail-closed）。
4. 授权与轮次语义是否对齐 producer（5 轮绑 authorization_class，非无条件硬上限）。

### 任务三：中英一致性

本 PR 未改 README，但确认 spec 中的术语与 README 已确立的两层依赖模型一致（relay-only verdict vs PR comment）。

## 输出格式

- Verdict：`PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 逐项 findings（如有），含位置、问题、建议。
- 若无 blocking finding，verdict 为 `PASS`。

## 注意事项

- 本轮只审 PR#2 的 diff 质量与 spec 合理性，不审源码实现正确性。
- 你应当经 `Reviewed head` 在远端读取上述文件与 diff 后再下结论。
- 评审结论经 relay MCP 通道回传即可；PR comment 可选。
- 评审语言中文或英文均可。
