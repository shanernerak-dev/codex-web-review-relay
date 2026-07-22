# 评审请求

Package kind: `review-fix`
Review stream: `main`
Effective round: `4`
Target PR: `#1`
Review scope: 公开仓库 README 文档质量评审（第四轮，修复全部 8 个 findings）

## 背景

本仓库（`shanernerak-dev/codex-web-review-relay`）刚从内部项目转为**公开 GitHub 仓库**。README 已从内部 Stage 导向描述重写为面向外部用户的通用文档，包含英文主体（`README.md`）和完整中文翻译（`README.zh-CN.md`）。

## Round 3 评审结论与本轮修复

Round 3 web agent 基于预读基线给出了 8 个 findings（4 blocking + 3 major + 1 minor），verdict 为 HUMAN DECISION REQUIRED（因未读取当前 head）。本轮已针对全部 8 个 findings 进行修复：

| Finding | 严重度 | 修复内容 |
|---------|--------|----------|
| F-README-001 | Blocking | Quick Start step 3 新增 helper CLI 合同（`python <helper> relay-export <handoff_path>`、stdout/stderr 规则） |
| F-README-002 | Blocking | 平台依赖表格修正：自动 PR comment 无论公开/私有都需要连接器；新增手动 PR comment 场景；适配说明指向 `src/envelope.ts` 而非 helper |
| F-README-003 | Blocking | 提供 Codex `config.toml` 示例；JSON 标注为通用示意；新增环境变量重启说明；新增 `/health` 验证步骤 |
| F-README-004 | Blocking | Job lifecycle 替换为三分类表格（active/recovery/terminal）；文档化可返回 phase、同 fingerprint 重试语义、手动恢复约束 |
| F-README-005 | Major | 明确 native host vs helper 职责边界；`frontmatter` 改为 `header fields`；新增 CLI 调用形式 |
| F-README-006 | Major | 披露 SQLite 持久化 `assistant_output` + SHA-256；区分"不存储凭据"与"持久化最后回复" |
| F-README-007 | Major | 警告 launcher 内嵌 `cli.ts` 绝对路径；安装后不可移动/删除 checkout |
| F-README-008 | Minor | Popup 描述从"lease 计时器"改为"连接状态" |

## 评审范围

请基于你的预读上下文 + 上述修复摘要，对当前 head 的 `README.md` 和 `README.zh-CN.md` 进行评审。重点关注：

1. 上述 8 个 findings 是否已在当前 head 中得到充分修复
2. 修复是否引入了新的不一致或错误
3. 中英一致性是否保持

## 输出格式

- Verdict: `PASS` / `REQUEST CHANGES` / `HUMAN DECISION REQUIRED`
- 逐项 findings（如有），每项包含：位置、问题描述、建议修复
- 如无 blocking finding，verdict 为 PASS

## 注意事项

- 本轮评审**只审 README 文档质量**，不审源码实现正确性。
- 评审结论无需发布为 GitHub PR comment，通过 relay MCP 通道回传即可。
- 评审语言：中文或英文均可；引用代码/路径时保留原文。
