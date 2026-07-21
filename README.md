# codex-web-review-relay

Issue #40 的本地 MCP review relay companion repository。Stage B 提供 host/contract core；Stage C 增加 manually armed Manifest V3 extension、ChatGPT DOM adapter、真实 `request_review(handoff_path)`、status lookup 与 fail-closed reconciliation。Transport `TURN_IDLE` 不代表 formal verdict；Repo Agent 仍需独立执行 GitHub readback。

Canonical GitHub repository 为 `shanernerak-dev/codex-web-review-relay`，visibility 为 `PUBLIC`。现有本机 checkout 目录 `C:\coding_projet\single-crystal-review-relay` 是 bootstrap 时形成的 user-local historical path，不属于产品 identity。`private: true` 仅用于阻止意外发布 npm package，不表示 GitHub repository visibility。

Native host 采用单进程 topology：Chrome 启动的 `native-host` 同时持有唯一 `JobStore` / `JobCoordinator` / `NativeBridge` 并启动 localhost MCP server，进程内 event-driven wait 不跨进程共享。

## 验证

```powershell
npm test
npm run test:compat
```

`compatibility.json` 固定 producer repository、完整 commit、v1.0 golden fixture path 与 SHA-256。`test:compat` 必须在 producer checkout 精确位于该 commit 时通过；需要非默认并列路径时设置 `RELAY_PRODUCER_ROOT`。

## Stage C 本机安装

Extension 固定 ID 为 `kkdijpckhlminpolkllmmkldlljakfem`，源码目录为 `extension/`。安装器会在显式 user-local 目录中生成 Bearer token、SQLite path、relay config、compiled launcher 与 exact-origin Native Messaging manifest，并注册当前用户的 Chrome host：

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot <USER_LOCAL_INSTALL_ROOT> `
  -RepositoryRoot <MAIN_REPOSITORY_ROOT>
```

随后在 `chrome://extensions` 以 Load unpacked 加载 `extension/`，打开目标 ChatGPT conversation，并从 popup 手动 `Arm`。同一 browser session 内会复用 session ID，用于 native-host restart reconciliation；完整浏览器退出后不会自动恢复 armed state。

安装器同时设置当前用户环境变量 `CODEX_WEB_REVIEW_RELAY_TOKEN`；main repository 的 project Codex config 只引用变量名，不保存 token。首次安装或 token 轮换后，需要在 extension 已 `Arm`、native host 正在监听时重启 Codex，使 MCP client 读取新环境并完成初始化。

清理使用同一精确目录：

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot <USER_LOCAL_INSTALL_ROOT> `
  -RepositoryRoot <MAIN_REPOSITORY_ROOT> `
  -Remove
```
