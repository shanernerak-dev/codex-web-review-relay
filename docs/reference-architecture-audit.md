# Stage C reference architecture audit

本审计服务于 Issue #40 的 Stage C transport pilot。第三方源码仅作为结构与失败模式参考；当前实现为独立编写，没有复制第三方代码。

## 冻结输入

参考源码由 `gh api repos/<owner>/<repo>/zipball` 下载到本地 ignored `reference/`，未使用 `git clone`，也不进入交付提交。

| Project | ZIP snapshot | License | ZIP SHA-256 |
|---|---|---|---|
| `hangwin/mcp-chrome` | `f48e717` | MIT | `47563CCFD0768BBC0BDF1C7E454636E1F983E4D71AEE863763FBBC6E81BF2B81` |
| `SyncNos/SyncNos-Webclipper` | `534b8cb` | AGPL-3.0 | `BB4A6C3039F00E60E3579242E463B6042B11CD70931F67E46AC50D21DD99B3AF` |
| `coddingtonbear/obsidian-local-rest-api` | `6091b86` | MIT | `7E61F8F4F95AF73C31AC57ED4057BC7979AFF84B52AF9B787DB4C5294EBD9844` |

`SyncNos-Webclipper` 只允许概念级对照，禁止复制或近似改写其 AGPL implementation。

## 采用的结构原则

- 从 `mcp-chrome` 借鉴 Native Messaging 的 request/response correlation、pending timeout、bounded reconnect 与连接并发保护；本项目仍保持 single-job、manually armed、same-conversation 的窄边界。
- 从 `SyncNos-Webclipper` 借鉴 entrypoint / service / platform 分层、contract-first message router、runtime timeout，以及 visible ChatGPT composer 的 fail-closed 选择；不采用其代码。
- 从 `obsidian-local-rest-api` 借鉴 localhost Bearer gate、MCP protocol/body boundary 和显式 HTTP timeout；当前批准合同继续使用 exact loopback HTTP，不引入自签 TLS/certificate UI。

## Pilot 前 delta

审计确认以下事项必须在真实 Chrome pilot 前闭合：

1. lifecycle event 必须等待 correlated `EVENT_ACK` 后才清理 active job。
2. `DISPATCH_TRIGGER` / `RECONCILE_TRIGGER` 必须取得 extension acceptance ACK；write-to-stdout 不等于 browser receipt。
3. 只对已人工 arm 的同一 tab/conversation 做 bounded reconnect，并恢复原 `session_id`；显式 Disarm 停止恢复。
4. content observer 必须串行处理 mutation；assistant completion 需经过 quiet window，不能在节点刚出现时立即 `TURN_IDLE`。
5. 同 tab 导航导致的 conversation drift 必须 fail closed；dispatch 前重新验证 page identity。
6. Native error 必须关联原 request ID；localhost MCP 只在首次有效 `ARM_SESSION` 后进入 ready/listening。

低成本增强同时包括 visible-control filtering、HTTP timeout 和 popup connection/binding diagnostics。

## 明确延期或不采纳

可延期：offscreen keepalive、多 MCP session SDK、通用 queue、跨浏览器 abstraction、通用 selector engine。真实 Chrome pilot 若证明 MV3 service worker 仍会在 active Native port 下失活，再单独评估 offscreen document。

不采纳：广域 browser automation、自动 arm 任意页面、跨进程 host、把 authorization 或 handoff 正文加入 trigger、自签 TLS UI，以及任何 AGPL source reuse。

## 验证要求

- Unit/integration：correlated ACK、dropped/duplicate ACK、同 fingerprint concurrency、restart reconciliation、hidden duplicate controls、timeout/error boundary。
- Real Chrome：manual arm → MCP initialize → single dispatch → exact user turn → assistant start/quiet idle；随后定点覆盖 same-tab navigation、native process exit/reconnect、timeout 与 retry。
- `TURN_IDLE` 只证明 transport completion；formal verdict 仍由 Repo Agent 独立进行 GitHub readback。
