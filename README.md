# codex-web-review-relay

Issue #40 的本地 MCP review relay companion repository。Stage B 只提供 host/contract core：localhost-only Streamable HTTP MCP、Bearer/Origin 检查、SQLite job state、fingerprint/idempotency、Native Messaging framing/bridge 与 restart reconciliation。真实 browser dispatch、`request_review` 和 formal verdict 均不在本阶段实现。

## 验证

```powershell
npm test
npm run test:compat
```

`compatibility.json` 固定 producer repository、完整 commit、v1.0 golden fixture path 与 SHA-256。`test:compat` 必须在 producer checkout 精确位于该 commit 时通过；需要非默认并列路径时设置 `RELAY_PRODUCER_ROOT`。

Native Messaging manifest 示例位于 `native-host/manifest.example.json`，注册 helper 位于 `scripts/register-native-host.ps1`。它们是 Stage B 可测试骨架，不代表已安装或已完成 browser capability。
