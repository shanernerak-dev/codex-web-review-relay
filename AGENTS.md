# AGENTS.md

> 本文件是 agent 入口，只做**路由**与**红线**。细则见 `docs/agent_conventions.md` 与 `docs/workflows/`。不要在本文件堆细节。

## 定位

本仓库是 `codex-web-review-relay`：localhost-only 的 MCP server + Chrome 扩展，让编码 agent 经一次工具调用触发 ChatGPT 对话中的正式代码评审并取回结论。本仓库的 `docs/agent_conventions.md` 与 `docs/workflows/` 同时作为**可被其他仓库照搬的 agent 约定范例**——结构应自解释、可移植。

## 语言

面向人的沟通用中文；代码、路径、命令、标识符、正则、phase 名、schema 字段保留原文。

## 路由（做什么 → 先读什么）

| 任务 | 先读 |
|---|---|
| 理解 / 修改 传输契约、envelope、job 生命周期、phase 语义 | `docs/agent_conventions.md` §传输契约、§job 生命周期 |
| 编写 / 校验 handoff、实现 relay-export helper | `docs/agent_conventions.md` §handoff 与 helper 合同 |
| 执行或改造 review-fix 闭环 | `docs/workflows/review_fix_workflow.md` |
| 修改 README 或任何公开文档 | `docs/agent_conventions.md` §文档同步，并读 `README.md` + `README.zh-CN.md` |
| 安全 / 持久化边界 | `docs/agent_conventions.md` §安全与持久化 |
| 安装 / 外部集成（面向用户） | `README.md`（Quick Start / Integration） |
| 架构来源 / 许可证边界 | `docs/reference-architecture-audit.md` |

## 红线（不可违反；细则在 conventions）

1. relay 是 localhost-only transport；在 Stage 3 relay-only contract 完成并验收前，Stage 1/Stage 2 均沿用 v1 PR-comment mode：目标 PR comment 是 formal verdict 来源，relay `assistant_output` 只作为 transport evidence；Stage 3 验收后才可将 `assistant_output` 作为正式结论，PR comment 在该模式下可选。
2. PR trigger envelope 仅含 6 个动态字段 + 固定指令；Stage 3 commit-only envelope 在此基础上增加 `target_kind` / `target_id`，二者都**绝不内嵌 handoff 正文**；reviewer 凭 locator 与 `reviewed head` 在远端读 commit / handoff。开源仓库经 commit 取证是不可动摇的基础。
3. 改 relay 行为以 `src/*` 与 `contracts/*` 为权威；改公开文档须 `README.md` 与 `README.zh-CN.md` 同步。
4. handoff / helper 合同 fail-closed：任何校验失败中止于 dispatch 前。
5. review round 按 Stage 独立计数；Stage 切换后从 `round-01` 重新开始，不得把上一 Stage 的 round 累计到下一 Stage。为避免 v1 handoff path 冲突，跨 Stage 的 stream 必须带 Stage 作用域。
6. 不擅自扩大改动范围；commit 保持单一范围。在用户已明确授权的 review/PR workflow 内，agent 可对范围受控且验证完成的改动直接 commit 和 push；merge / tag / branch deletion 仍需单独授权。
