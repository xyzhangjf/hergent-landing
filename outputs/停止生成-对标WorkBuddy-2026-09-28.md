# 输入框「停止生成」——对标 WorkBuddy 的实现与落地（v309，2026-09-28）

> 起因：老板反馈「我们的 AI 输入框只有发送按钮，消息发出后无法停止」。
> 本文记录 ① WorkBuddy 到底怎么做的（本机 app.asar 实测，非推测）② 我们据此做了什么改动
> ③ 验证数字 ④ 还没验证的部分。**代码已改完并构建，未上线**（原因见 §7）。

---

## 一、WorkBuddy 的真实实现（实测，附源码位置）

### 1.0 取法（可复现）

```bash
# app.asar 头：@0=4 固定；@4=headerPickleSize；@12=jsonSize；JSON 从 offset 16 开始
# 🔴 教训：jsonSize 在 **@12**，不是 @8（@8 = jsonSize+6，多读 6 字节 padding ⇒ JSON.parse 报错，
#    node 会把 5MB 的头当「报错行」整段打印，看起来完全不像偏移量问题）
node wb_asar.js list "lib-chat-ui"       # → /renderer/assets/lib-chat-ui-*.{js,css}
node wb_asar.js dump "/renderer/assets/lib-chat-ui-C7y1ZM_R.js"
```

关键源码都在 `lib-chat-ui-*.js` 里（打包自 monorepo 的 packages/）：

| 内容 | 包路径（bundle 内可见） |
|---|---|
| 发送/停止按钮 | `packages/conversation-render/src/chat-input/components/send-button/send-button.tsx` |
| 输入区工具条（把 onStop 接上） | `packages/cb-chat-ui/src/components/chat-input/...`（`InputToolbarImpl`） |
| 消息时间线（中断态渲染） | `packages/cb-chat-ui/src/components/message-timeline/...` |
| 传输层（真断连） | `packages/agent-client-protocol/src/common/client/streamable-http` |

### 1.1 核心：**发送与停止是同一个按钮**，按 loading 分流

`send-button.tsx` 原文（行为即全部契约）：

```js
const loading = internalSending || !!isStreaming && (preferCancelWhileStreaming || !allowSendWhileStreaming || !hasContent || hasProcessing)
const canStop = loading && !!onStop && !cancelDisabled
const semanticDisabled = loading ? (!!cancelDisabled || !onStop) : isSendDisabled
const handleClick = () => {
  if (canStop) { onStop?.(); return }     // ← 流式中：同一个按钮 = 停止
  if (loading) return
  if (semanticDisabled) return
  store.api.send().catch(...)             // ← 空闲时：发送
}
const buttonDisabled = hasCustomContent ? false : semanticDisabled
```

**四条可照搬的结论：**

1. `handleClick = loading ? onCancel : onSend` —— 不需要两个按钮，也不需要把发送键禁掉。
2. **loading 期间按钮不再 disabled**（`semanticDisabled` 在 loading 分支只看 `cancelDisabled / onStop`）。
   这条最关键：**我们原先的病根就是把 streaming 塞进了 `:disabled`**。
3. `canStop` 需要宿主真的提供了 `onStop` —— 只给图标不给回调 = 假停止键（WB 用 `!onStop` 表达）。
4. 参数轴：`allowSendWhileStreaming` / `preferCancelWhileStreaming` / `cancelDisabled`
   —— WB 允许「流式中还能继续发」（排队/打断），我们暂不引入，保持「流式中只能发停止」。

### 1.2 三态视觉：**只换图形，不换颜色**

```css
.cr-send-button            { width:32px;height:32px;border-radius:50%;background:transparent;
                             color:var(--cr-send-button-fill); transition:opacity .15s, transform .1s }
.cr-send-button:hover:not(:disabled) { opacity:.8 }
.cr-send-button:active:not(:disabled){ transform:scale(.93) }   /* ← 按下缩到 93% */
.cr-send-button--sending   { opacity:.7; cursor:default }        /* 只能等、不能停 */
.cr-send-button--stop      { color:var(--cr-send-button-fill-stop); opacity:1; cursor:pointer }
.cr-send-button__stop-confirm-label { font-size:11px; font-weight:600; max-width:28px; height:32px }
```

色值实测（`--cr-internal-*`）：

| 变量 | light | dark |
|---|---|---|
| `send-button-fill`（发送） | `rgba(0,0,0,.9)` | `rgba(255,255,255,.92)` |
| `send-button-fill-stop`（停止） | **`rgba(0,0,0,.9)`** | **`rgba(255,255,255,.92)`** |
| `send-button-fill-disabled` | `rgba(0,0,0,.2)` | `rgba(255,255,255,.2)` |

⇒ **停止态与发送态同色，不是红色。** 图标本身是「实心圆 + 挖空符号」（一个 path，`fillRule:evenodd`）：

```js
STOP_PATH  = "M16 32C24.8366 32 32 24.8366 32 16C32 7.16344 … ZM13 10C11.3431 10 10 11.3431 10 13V19C10 20.6569
              11.3431 22 13 22H19C20.6569 22 22 20.6569 22 19V13C22 11.3431 20.6569 10 19 10H13Z"
ARROW_PATH = "M16 32C24.8366 32 32 24.8366 32 16C32 7.16344 … ZM16 19.2104C15.5529 19.2104 …"
```
（方块内切于 32 圆盘：x/y 10→22 **边长 12/32**、圆角 r=3。我们的按钮同为 32px，直接 1:1 复刻。）

### 1.3 文案与 aria（i18n 键 `chatInput.*`）

| 键 | 中文 | 英文 |
|---|---|---|
| `chatInput.send` | 发送 | Send |
| `chatInput.sending` | 发送中… | Sending… |
| `chatInput.stop` | 停止 | Stop |
| `chatInput.stopConfirm` | **再次按下快捷键停止** | Press the shortcut again to stop |
| `message.interrupted` | **任务被中断** | Task interrupted |

```js
const tooltip   = loading ? (showStopConfirm ? t("chatInput.stopConfirm") : t("chatInput.stop"))
                          : (semanticDisabled && disabledTooltip ? disabledTooltip : t("chatInput.send"))
const ariaLabel = loading ? (canStop ? t("chatInput.stop") : t("chatInput.sending")) : t("chatInput.send")
// aria-disabled 只在「流式中但没有停止能力」时才为真：
"aria-disabled": semanticDisabled && !canStop
```

### 1.4 快捷键 = **二次确认**（防误触）

`pendingStopConfirm` 是宿主传进来的布尔：第一次按 `Esc` → 按钮位置把图标换成快捷键标签「Esc」、
tooltip 变「再次按下快捷键停止」；再按一次才真停。

```js
if (showStopConfirm) return jsx("span", { className: p("send-button__stop-confirm-label"),
                                          children: stopShortcutLabel || "Esc" })
```

### 1.5 真正「停掉」靠三件事（不是只改前端状态）

`streamable-http` 里：

```js
function cancelActiveReaderThenAbort() {          // ① 取消 SSE reader ② 掐断 fetch
  if (activeSSEReader) { const r = activeSSEReader; activeSSEReader = null
    r.cancel().catch(()=>{}).finally(() => abortController.abort()); return }
  abortController.abort()
}
async function sendDelete() {                     // ③ 再通知服务端拆除这次运行
  headers["Acp-Connection-Id"] = currentConnectionId
  await customFetch(endpoint, { method: "DELETE", headers, signal: AbortSignal.timeout(5e3) })
}
```

### 1.6 中断之后：**保留内容 + 打标记 + 可恢复**

消息时间线（`message-timeline`）里的取值取向，值得我们学：

```js
const USER_CANCELLED_TEXTS = ["[User Cancelled]", "Interrupted by user"]
checkIsLastContentUserCancelled = (list) => last(list)?.text ∈ USER_CANCELLED_TEXTS  // 末条哨兵
removeInvalidContents           = (list) => 命中时 slice(0, -1)                      // 只是**剥掉哨兵**，不断整条
const shouldShowCancelledIndicator = Boolean(cancelledText) || (isCancelled || …) && isMessageEnd
onRestoreCancelledConversation(requestId)   // 「恢复」被中断的那次对话（服务端有 requestId 可续）
```

⇒ 与「删掉半截气泡」相反：**已生成的内容留着**，只在末尾挂一个中性标记。

---

## 二、我们原来的缺口（病根，两处）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `CopilotDrawer.vue` 发送键 | `:disabled="… \|\| store.chat.streaming \|\| …"` ⇒ 流式期间按钮**被禁用**，点了没反应。全站**没有任何**中止入口。 |
| 2 | `api/client.js::hermesChat` | `AbortController` 只被**内部超时**触发，**不接受外部信号** ⇒ 就算把按钮做出来也无处执行中止。 |

附带一个会误导人的细节：`AbortError` 原先**同时**代表「超时」和（本该的）「用户停止」，
catch 里统一显示「回答生成超时，已停止」——若不做区分，点停止会看到一句错误的红字。

---

## 三、本轮改动（file-level）

### `hergent-cn-v2/src/api/client.js`
- `hermesChat(..., { signal })` 新增**外部中止信号**；`_mergeSignal()` 与内部超时控制器合并
  （优先 `AbortSignal.any`，老浏览器回退为事件转发，**绝不静默丢弃外部信号**）。
- fetch 改用合并后的 `sig`。
- 新增 catch：**外部信号**导致的中止 ⇒ 抛 `StoppedError`（`err.stopped===true`），
  内部超时仍抛原生 `AbortError` ⇒ 两条路在调用方可判。
- `_abortError()` 文案「已停止生成」。

### `hergent-cn-v2/src/components/CopilotDrawer.vue`
- 新增状态：`sctrl`（shallowRef，当前请求中止器）/ `stopRequested` / `stopConfirm`（Esc 确认态）；
  派生 `canStop = streaming && sctrl`、`stopHint`。
- 新增 `stopReply()`：**先解锁 UI 再 abort**（避免「点了停止还得等一个网络回合」的空窗）。
- `streamReply()`：创建 `AbortController` → 传 `signal: ctrl.signal`；收尾处清空 `sctrl`；
  **catch 拆成两条路**——`stopped` ⇒ 保留气泡、打 `m.stopped=true`、落盘、不报错、直接 return；
  其余失败路径**一字未改**（超时/断网/502 仍然删半截气泡 + 分级文案 + 静默重试）。
- 发送键：单按钮双态（`is-stop` / `is-busy`）、loading 时**可点**、图标箭头↔方块、
  `aria-label`/`title` 三态、二次确认时显示「Esc」。
- `onKeydown`：`Esc` 二次确认停止（**全屏时 Esc 仍优先退出全屏**；**有下拉菜单开着时 Esc 只收菜单**）。
- 模板：新增 `.cp-stopped`「已停止生成」标记。
- CSS：`.cp-send.is-stop`（同色、cursor:pointer、active 缩 93%）、`.cp-send.is-busy`（只能等的态）、
  `.cp-send-esc`（11px/600，对齐 WB）、`.cp-stopped`（中性灰，不喧哗）。

### 未改
- 后端 `hergent-erp/server/routers/copilot_proxy.py` **一行未动**（见 §6 判断）。

---

## 四、状态与交互变化

| 阶段 | 按钮 | 图标 | 可点 | tooltip / aria | 其他 |
|---|---|---|---|---|---|
| 空闲（有草稿） | `cp-send` | 箭头 | ✅ | 发送 | Enter 发送 |
| 流式中（有可停请求） | `cp-send is-stop` | 方块 | ✅ | 停止生成（Esc） | 思考点/工具步骤正常滚 |
| 流式中按了一次 Esc | 同上 + 「Esc」标签 | Esc 字样 | ✅ | **再次按下 Esc 停止** | 2.5s 无第二次则自动复位 |
| 流式中（无请求可停，极短窗口） | `cp-send is-busy` | 箭头 | ❌ | 发送 | 对齐 WB `--sending`（只能等） |
| 已停止 | `cp-send` | 箭头 | ✅ | 发送 | 气泡保留已生成内容 + 「已停止生成」；**不弹红字**；已落盘；可立刻再发 |
| 超时/断网（未变） | `cp-send` | 箭头 | ✅ | 发送 | 红字分级提示 + 「重试」，半截气泡移除 |

---

## 五、验证（本地，真实产物 + 真实 Chrome）

**① 传输层**（`node stop-transport.test.mjs`，7/7）——用真实 HTTP 服务证明「中止 = 真断连」：

```
PASS ① 中止后 reject（不是静默 resolve）      name=StoppedError
PASS ① 错误可判为「用户停止」                  StoppedError/stopped=true
PASS ① 服务端观察到连接断开（真的掐断上游）     close@+403ms
PASS ① 中止前已收到增量（不是一开始就断）       已收 5 帧
PASS ② 超时抛原生 AbortError                   name=AbortError
PASS ② 超时**不**被误判成用户停止（判别力）      stopped=undefined
PASS ③ 正常流式仍能跑完并返回全文               len=16
```
> 判别力：①② 分别覆盖正/反两侧；③ 证明正常路径没被改坏。
> 途中修掉两个**harness 自身的假阳性**（`req.on('close')` 在 POST 上会立即触发；
> `"__finite":true` 正则漏了尾引号 ⇒ 服务端根本没走「正常收尾」分支）。

**② 界面**（`node stop-ui.probe.cjs`，17/17）——用**真实构建产物**在无头 Chrome 里跑通全流程：

```
PASS S1 流式中按钮切到「停止」                停止生成（Esc） / cp-send is-stop
PASS S1 流式中按钮**可点**（旧版此处置灰不可点） disabled=false
PASS S1 停止前不存在「已停止生成」标记（判别力前提） count=0
PASS S1 点了真的停：服务端连接被提前关闭        frames=2 close@+216ms
PASS S1 停止后按钮回到「发送」 / 内容被保留     停前 12 → 停后 12
PASS S1 不弹红字报错（停止≠出错）              msg-error=0
PASS S1 点击停止**没有**新增/误发消息           msg 2 → 2
PASS S2 Esc 第一次：显示「Esc」且**未**停止      escLabel=1 stillStop=true
PASS S2 Esc 第二次：真的停止                   cp-stopped=2
PASS S3 停止后仍可再次发送（组件未被卡死）       streams=3
PASS 全程无页面级 JS 异常
```

**③ 产物一致性**：`dist/` 与隔离构建目录 `dist-v309/` **逐文件 md5 完全一致**
（⇒ 探针结论对将要上线的 `dist/` 同样成立）。

> ⚠️ 重建后 chunk 文件名会变（`Shell-CiAEjR6F` → `Shell-Bspv50du`、`index-D49ms2ij` → `index-CvDSEtjv`、
> `Forecast-D9hg8Wft` → `Forecast-CnxaIA5Y`）。这是 **hash 级联**：`client.js` 变了 ⇒ 依赖它的 chunk
> 名字跟着变，**不代表 Forecast 等页面被改过**（其文件 mtime 仍是 15:09，早于两次构建）。
> 判据只能用「按逻辑名前缀比字节」，**看名字什么都判断不了**。

---

## 六、后端为什么不用改

前端 abort 后浏览器关闭 HTTP 连接；`copilot_proxy.py` 是**同步生成器 + urllib 透传**
（`_iter_upstream` 内有 `finally: resp.close()`），客户端断开时 Starlette 关闭该生成器 ⇒
上游到 Hermes 的连接随之关闭。

⚠️ **本节是代码推断，未在生产实测**（见 §7）。WorkBuddy 之所以还有第 ③ 步
（`DELETE` + `Acp-Connection-Id`），是因为它的运行是 ACP 有状态会话；我们的
`/v1/chat/completions` 是无状态请求，断连即等价于「这次运行没人要了」。

---

## 七、还没验证 / 需确认

1. **生产链路的断连传播**：后端到 Hermes 那段（`127.0.0.1:18765`）是否**立刻**关闭、
   Hermes 收到断连后是否**真的终止 agent 循环**（而非继续跑到 token 用完）——**未实测**。
   要坐实需在上线后做一次带凭据的真机中止，并看网关日志/账本。
2. **上线门禁（重要）**：本轮前端是**全量构建**，而 `hergent-cn-v2/src` 工作区当前有
   **39 个已改文件**（含并行会话在途改动）⇒ 直接 rsync 会把别人的半成品一起带上生产。
   按 v294/v305 纪律，发版前必须先核「线上生效版 == 基线」+ API 超集差集。
   **故本轮只构建、未上线。**
3. **未做**（对齐 WB 的其余选择，留作后续选项）：`allowSendWhileStreaming`（流式中还能发）、
   中断后「继续/恢复」上次对话（WB 的 `onRestoreCancelledConversation` + requestId；
   我们的是无状态请求，需另设机制）。

---

## 八、变更清单

```
M hergent-cn-v2/src/api/client.js               +~40 行（外部 signal / StoppedError）
M hergent-cn-v2/src/components/CopilotDrawer.vue +~120 行（按钮双态 / 停止收尾 / Esc / 标记 / CSS）
```
构建产物：`hergent-cn-v2/dist/`（旧 dist 已按 §14 正解**移走保全**，未删：
`/tmp/hergent-cn-v2-dist-bak-20260928-1705`、`/tmp/hergent-cn-v2-dist-bak2-1706`）；
隔离副本 `hergent-cn-v2/dist-v309/`（与 `dist/` 逐文件 md5 一致）。

验证脚本（本轮临时产物，未入库）：`/tmp/stop-transport.test.mjs`（7/7）、`/tmp/stop-ui.probe.cjs`（17/17）、
`/tmp/wb_asar.js`（WorkBuddy asar 读取器）。

---

## 九、✈️ 上线与生产真机验收（2026-09-28 19:34，已部署）

### 9.1 提交
| 提交 | 内容 |
|---|---|
| `174c914` | feat(copilot): 输入框支持「停止生成」（v309）—— 41 文件 / +8910 −502 |
| `379a7cf` | docs(memory): 补 v309 提交记录 |

### 9.2 部署前的四道判据（全部通过才敢发）
| # | 判据 | 读数 |
|---|---|---|
| ① | 线上生效版识别（**按 mtime 分离**，不看 `ls -lt` 并集） | `index.html` mtime `16:43:03` ⇒ 58 文件 = 生效批次；线上 `assets/` 物理文件 **848 / 仅 55 个基名**（历次并集） |
| ② | 基名配对差集 | 基名集合**完全一致**（无 chunk 新增/删除）；真内容变化仅 13 项，其中 10 项为 `Δ+1`＝纯 hash 级联 |
| ③ | API 超集（会不会撤回线上功能） | 撤回 **0** / 新增 **0** |
| ④ | 后端路由**穷尽**核对 | 用 `erp.hergent.cn/openapi.json`（**1189 条**）逐条匹配产物里 313 个 `/api` 路径 |

### 9.3 🔴 上线前拦下两颗「上线即说谎」的雷（本轮最有价值的一段）
`openapi` 穷尽核对 + **有权限(boss)令牌**实测，双双确认下列端点在**生产后端不存在**：

| 端点 | 调用方 | 触发时机 | 失败表现 | 处置 |
|---|---|---|---|---|
| `/api/collections/aging`、`/api/collections/payments` | `CollectionsCard` | **落地页 `onMounted` 即请求** | `catch` → **静默降级成空态** | 🔴 **摘入口** |
| `/api/import/ledger` | `DataLedger` | `onMounted(load)` | 显示一行错误 | 🔴 **摘入口** |
| `/api/commitments*`、`/api/import/receipts`、`/api/import/mapping-memory` | CommitmentsTab / ImportReceipt | 点页签 / 导入后 | — | 保持（**线上早已在跑**，非本次引入） |

- 判据纪律：**不带 token 的 401 与低权限角色的 403 对「路由是否存在」零判别力**
  （RBAC 在路由匹配**之前**就返回）。本轮 `/api/commitments` 用 boss 令牌回的是
  `403 路径未配置访问模块` —— 看似"权限问题"，**openapi 实查该路由根本不存在**。
- 摘除方式：**只在隔离构建副本**（`/tmp/v309-deploy`）里加 `v-if="false"` + 写明原因的注释，
  **工作区源码一行未动**（那是另一会话的工作）。自证三步：
  ① 组件特有文案在产物里**归零**（`当前没有未清的客户应收` / `数据类目`）；
  ② 本轮自己的判别串**仍在**；③ `collectionsApi` 被 tree-shake ⇒ `/api/collections/aging` 从产物消失。

### 9.4 部署
```
备份：/root/hergent-cn-v2-bak-20260928-193400.tgz（12M）+ _rollback/index.html.pre-v309-*
rsync -a --no-owner --no-group /tmp/v309-fe-dist/ root@47.113.224.140:/opt/hergent-cn-v2/   # 不带 --delete
ssh root@… "chown -R hergent:hergent /opt/hergent-cn-v2"
```
- **刻意不带 `--delete`**（按 v292 判据）：线上 `assets/` 是历次构建并集，删它不可逆；不带只是留旧代死文件。
- 双侧 md5 **4/4 一致**；线上入口 = 公网入口 = `index-CN2Wvw7b.js`。
- ⚠️ **连带教训**：不带 `--delete` 之后，「在 `assets/*.js` 里 grep 某串」**必然假阳性**
  （会命中上一代残留）。判别串必须**只对「当前生效批次」**跑：
  从线上入口 chunk 抽出引用列表（52 个），逐个 grep —— 本次据此得到干净读数。

### 9.5 生产真机验收（**20/20**，截图 `停止生成-生产真机验收-2026-09-28.png`）
真实点击、真实 Hermes（用**隔离租户 9997**跑的，跑完 `down` 且 `ZERO_RESIDUE: true`）：

```
PASS ① 页面在跑本轮构建（入口 chunk）        /assets/index-CN2Wvw7b.js
PASS ② 从未请求 /api/collections/aging（摘除证据）  无 collections 请求
PASS ② 落地页无「客户回款」空卡文案 / 静态资源无 4xx
PASS ④ 流式中按钮切「停止」且**可点**（旧版此处 disabled）
PASS ④ 已真实发出 chat 请求 · 停止前已收到模型增量（10 字）
PASS ⑤ 网络层：chat 请求被中止  net::ERR_ABORTED        ← 真掐断
PASS ⑤ 按钮回「发送」/ 出现「已停止生成」/ 内容保留（10 → 23）/ 不弹红字 / 无多余消息
PASS ⑥ Esc 第一次显示「Esc」未停、第二次真停
PASS 全程无页面级 JS 异常
```

### 9.6 ⭐ 顺带结掉了上一轮挂着的「未验证项」
上一轮我标注「后端到 Hermes 的断连传播、以及 Hermes 是否真的终止 agent 循环 —— 代码推断成立，未实测」。
本轮验收期间，网关 `journalctl -u hermes-gateway` 在 **19:37:26 / 19:37:39 / 19:37:43** 记录 3 条：

```
WARNING agent.chat_completion_helpers: Stream ended with no finish_reason after
delivering text with no tool calls; treating as a mid-stream drop.
```

时间与「1 次 curl 中止 + 探针 2 次点击停止」**逐条对上** ⇒ **客户端中止确实一路传到 Hermes，
且 Hermes 自己把它识别成 mid-stream drop**。这一项从「推断」升级为「有日志证据」。
（仍未测：Hermes 收到 drop 后是否**立刻**停止计费/停止上游 LLM 调用 —— 属其内部实现。）

### 9.7 收尾
- 服务器临时文件（`/tmp/sandbox_tenant.py`、`sandbox_9997.meta.json`、`live_files.txt`）**已清理**；
  沙箱库 `tenant_9997.db*` **0 残留**；源库 sha256 前后一致、`src_business_check.verdict = ok`。
- **未提交**：本轮「摘入口」只存在于隔离构建副本，**不在 HEAD 源码里** ——
  这是**有意为之**（不动别人的工作）。🔴 **遗留提醒**：若日后有人从 HEAD 重新构建部署，
  这两个卡片会**再次回到落地页**并继续打 404 接口；正确处理是**后端补上这 5 个端点**，
  或由该组件的作者决定去留。
