# codex-web-review-relay

Issue #40 的本地 MCP review relay companion repository。Stage B 提供 host/contract core；Stage C 增加 manually armed Manifest V3 extension、ChatGPT DOM adapter、真实 `request_review(handoff_path)`、status lookup 与 fail-closed reconciliation。Trigger 由六个动态定位字段和一条固定 GitHub publication instruction 组成；固定指令不参与 request fingerprint。Transport 在 `TURN_IDLE` 持久化并返回最后一个 Web Agent assistant turn 及其 SHA-256，供 Repo Agent 检查 convention compliance；它仍不代表 formal verdict，Repo Agent 必须独立执行 GitHub readback。

Stage C 的第三方结构对照、license boundary 与采用/延期结论见 `docs/reference-architecture-audit.md`。本地 `reference/` 仅保存通过 ZIP 下载的 ignored audit snapshot，不进入 Git。

Canonical GitHub repository 为 `shanernerak-dev/codex-web-review-relay`，visibility 为 `PUBLIC`。现有本机 checkout 目录 `C:\coding_projet\single-crystal-review-relay` 是 bootstrap 时形成的 user-local historical path，不属于产品 identity。`private: true` 仅用于阻止意外发布 npm package，不表示 GitHub repository visibility。

Native host 采用单进程 topology：Chrome 启动的 `native-host` 同时持有唯一 `JobStore` / `JobCoordinator` / `NativeBridge` 并启动 localhost MCP server，进程内 event-driven wait 不跨进程共享。

Review timing 分为两个有界层级：`requestWaitSliceMs` 默认 5 分钟，只限制单次 MCP event-driven wait；soft slice 到期返回当前非终态且不停止 extension observer。同 fingerprint 再次调用只继续等待原 job，不 redispatch。`turnDeadlineMs` 默认 15 分钟，是整个 Web Agent turn 的 hard deadline；只有达到该上限才持久化 terminal `TIMEOUT`。

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

随后在 `chrome://extensions` 以 Load unpacked 加载 `extension/`，打开目标 ChatGPT conversation，并从 popup 手动 `Arm`。`Arm` 的 current tab 是唯一 conversation 选择权；host 不保存 URL/hash，job 不绑定 conversation/session。Service-worker restart 只可在 binding 仍有效的有界 lease 内恢复同一 tab；tab navigation 会持久化 invalid binding、禁止自动 reconnect/dispatch，并要求重新 `Arm`。

安装器同时设置当前用户环境变量 `CODEX_WEB_REVIEW_RELAY_TOKEN`；main repository 的 project Codex config 只引用变量名，不保存 token。首次安装或 token 轮换后，需要在 extension 已 `Arm`、native host 正在监听时重启 Codex，使 MCP client 读取新环境并完成初始化。

清理使用同一精确目录：

```powershell
pwsh -NoProfile -File scripts/install-native-host.ps1 `
  -InstallRoot <USER_LOCAL_INSTALL_ROOT> `
  -RepositoryRoot <MAIN_REPOSITORY_ROOT> `
  -Remove
```
