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

1. relay 是 localhost-only transport；verdict 主路径是 MCP `assistant_output` 回传，GitHub PR comment **可选**。
2. trigger envelope 仅含 6 个动态字段 + 固定指令，**绝不内嵌 handoff 正文**；reviewer 凭 `Path` 与 `reviewed head` 在远端读 commit / handoff。开源仓库经 commit 取证是不可动摇的基础。
3. 改 relay 行为以 `src/*` 与 `contracts/*` 为权威；改公开文档须 `README.md` 与 `README.zh-CN.md` 同步。
4. handoff / helper 合同 fail-closed：任何校验失败中止于 dispatch 前。
5. 不擅自扩大改动范围；commit 保持单一范围；push / merge / tag 为受控操作，需明确授权。
