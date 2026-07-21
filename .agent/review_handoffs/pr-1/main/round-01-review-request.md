# 评审请求

Package kind: `review-request`
Review stream: `main`
Effective round: `1`
Target PR: `#1`
Review scope: 公开仓库 README 文档质量评审

## 背景

本仓库（`shanernerak-dev/codex-web-review-relay`）刚从内部项目转为**公开 GitHub 仓库**。README 已从内部 Stage 导向描述重写为面向外部用户的通用文档，包含英文主体（`README.md`）和完整中文翻译（`README.zh-CN.md`）。

PR #1（feat: implement Stage B relay host core）已 merge。README 重写在后续 main 分支 commit 中完成。

本轮 commit 已将 GitHub PR comment 从"必须"改为"可选"，并更新了双向信息传递描述。

## 评审范围

请评审 `README.md` 和 `README.zh-CN.md` 作为本仓库公开首页文档的质量。重点关注：

### 1. 准确性
验证技术描述（端口号、文件路径、CLI 命令、schema 字段、job phase、配置键）是否与源码一致：
- `src/server.ts` — MCP server 实现
- `src/review-transport.ts` — job 生命周期和 fail-closed 语义
- `src/relay-contract.ts` — relay export schema 验证
- `src/envelope.ts` — trigger envelope 生成（6 个动态字段 + 1 条固定指令）
- `contracts/mcp-tools.schema.json` — MCP 工具定义
- `config/relay.config.example.json` — 配置示例
- `extension/manifest.json` — 扩展 manifest 和权限
- `scripts/install-native-host.ps1` — 安装器脚本

### 2. 完整性
外部用户从零开始能否仅凭 README 完成安装、配置、首次调用？是否有遗漏的关键步骤或前置条件？

### 3. 可理解性
对不熟悉 MCP / Native Messaging / Chrome extension 的开发者，概念解释是否充分？架构图是否清晰？

### 4. 中英一致性
`README.zh-CN.md` 是否与 `README.md` 语义一一对应，无遗漏、无多余、无翻译歧义？

### 5. 平台依赖描述
"两层依赖"模型（relay 传输层 vs 可选的 PR comment 层）是否清晰准确？三种场景表格是否完整？

### 6. 安全声明
Security Model 章节是否准确反映实际实现（localhost-only、Bearer token、fail-closed）？

### 7. 过度承诺 / 欠承诺
是否有描述超出当前 MVP 能力的地方，或遗漏了重要限制？

## 输出格式

请按以下格式提供评审结论：

- Verdict: `PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 逐项 findings（如有），每项包含：位置、问题描述、建议修复
- 如无 blocking finding，verdict 为 PASS

## 注意事项

- 本轮评审**只审 README 文档质量**，不审源码实现正确性（实现已通过 22/22 targeted tests + compat check）。
- 不要求 Stage Gate 治理流程——那是 producer 仓库的内部规范，companion 仓库作为公开项目不强制。
- 评审结论无需发布为 GitHub PR comment，通过 relay MCP 通道回传即可。
- 评审语言：中文或英文均可；引用代码/路径时保留原文。
