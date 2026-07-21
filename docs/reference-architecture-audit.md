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

- 从 `mcp-chrome` 借鉴 Native Messaging 的 request/response correlation、pending timeout、bounded reconnect 与连接并发保护；本项目仍保持 single-job、manually armed current-tab 的窄边界。
- 从 `SyncNos-Webclipper` 借鉴 entrypoint / service / platform 分层、contract-first message router、runtime timeout，以及 visible ChatGPT composer 的 fail-closed 选择；不采用其代码。
- 从 `obsidian-local-rest-api` 借鉴 localhost Bearer gate、MCP protocol/body boundary 和显式 HTTP timeout；当前批准合同继续使用 exact loopback HTTP，不引入自签 TLS/certificate UI。

## Pilot 前 delta

审计确认以下事项必须在真实 Chrome pilot 前闭合：

1. lifecycle event 必须等待 correlated `EVENT_ACK` 后才清理 active job。
2. `DISPATCH_TRIGGER` / `RECONCILE_TRIGGER` 必须取得 extension acceptance ACK；write-to-stdout 不等于 browser receipt。
3. 只对已人工 arm 的 current tab 做 bounded reconnect；显式 Disarm 或 tab navigation 停止该 binding，重新 Arm 由 Maintainer 选择目标 conversation。
4. content observer 必须串行处理 mutation；assistant completion 需经过 quiet window，不能在节点刚出现时立即 `TURN_IDLE`。
5. 同 tab 导航必须 fail closed 并要求重新 Arm；dispatch 前只验证目标仍是受支持的 ChatGPT conversation page。
6. Native error 必须关联原 request ID；localhost MCP 只在首次有效 `ARM_SESSION` 后进入 ready/listening。

低成本增强同时包括 visible-control filtering、HTTP timeout 和 popup connection/binding diagnostics。

## Round 1 pilot finding

首次真实 Chrome dispatch 在写入 composer 之前校验 send button，因空 composer 的 button 正常处于 disabled 状态而 fail closed，未确认产生 user turn。修复后流程固定为：读取 baseline → 写入并回读 composer → 等待唯一可见 send button enabled → click → 观察 composer 清空、生成状态或 exact new user turn 之一作为 click receipt。Extension 同时把具体 DOM error code 经 Native Messaging 持久化到 job，避免只留下不透明的 acknowledgement timeout。

该修复不改变六个动态定位字段、fingerprint、authorization boundary 或 formal verdict readback；后续按 Maintainer 决定追加一条固定 GitHub publication instruction，该固定指令不参与 fingerprint。`SEND_UNCERTAIN` 仍只能通过 same-fingerprint reconciliation 恢复，不能 blind resend。

首次 pilot 同时暴露了 identity 设计错误：project conversation 使用 `/g/<project>/c/<conversation>`，普通 conversation 使用 `/c/<conversation>`；把完整 pathname hash 持久化会让 ChatGPT 路由表示参与 transport identity。Maintainer 决定由 popup `Arm` 当前 tab 作为唯一 conversation 选择权。Host 不再保存或比较 conversation URL/hash，job 也不绑定 session；`chrome.storage.local` 只保存有界 manual-arm tab/session lease 以承受 service-worker restart。发生导航后必须重新 Arm。未闭合 job 只能在 Maintainer 重新 Arm 后由同 fingerprint reconciliation 检查 exact envelope，并继续受 `recovery_send_used` 最多一次约束。

## 明确延期或不采纳

可延期：offscreen keepalive、多 MCP session SDK、通用 queue、跨浏览器 abstraction、通用 selector engine。真实 Chrome pilot 若证明 MV3 service worker 仍会在 active Native port 下失活，再单独评估 offscreen document。

不采纳：广域 browser automation、自动 arm 任意页面、跨进程 host、把 authorization 或 handoff 正文加入 trigger、自签 TLS UI，以及任何 AGPL source reuse。

## 验证要求

- Unit/integration：correlated ACK、dropped/duplicate ACK、同 fingerprint concurrency、terminal retry without session、restart reconciliation、navigation invalid binding、expired dispatch/recovery、assistant output persistence/size bound、hidden duplicate controls、timeout/error boundary。
- Real Chrome：manual arm → MCP initialize → single dispatch → exact user turn → assistant start/quiet idle；随后定点覆盖 same-tab navigation、native process exit/reconnect、timeout 与 retry。
- `TURN_IDLE` 返回最后一个 Web Agent assistant turn 与 hash，只证明 transport completion 并支持 convention 检查；formal verdict 仍由 Repo Agent 独立进行 GitHub readback。
