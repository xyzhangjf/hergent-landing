# Hermes 副驾「AI助手暂时离线，请稍后再试」根因排查报告

> 生成时间：2026-08-22
> 排查范围：前端触发逻辑 / 后端 AI 服务可用性 / 网络链路 / 认证与鉴权 / 并发与限流
> 结论先行：**该精确中文短语「AI助手暂时离线，请稍后再试」不在前端源码与构建产物中**，前端只会冒泡外部错误文案或输出两个固定兜底。根因锁定在外层（Hermes 引擎层 / nginx 上游 / 上游 LLM 服务），需现场 curl + journalctl 实测定论。

---

## 0. 关键事实锚定（已读源码确认）

### 0.1 前端错误文案机制（client.js :120-183 + CopilotDrawer.vue :734-743）

`hermesChat()` 在 `!res.ok` 时抛错：
```js
throw new Error(e.detail || e.message || `Hermes 错误 (${res.status})`)
```
SSE 流解析中仅 `try/catch` 吞掉不完整行，**任何 SSE 数据行里携带的 `detail`/`message` 会被原样冒泡**。

`streamReply()` 的 catch（:738-740）：
```js
store.chat.error = e && e.name === 'AbortError'
  ? '回答生成超时，已停止。请点「重试」重新发送。'
  : (e && e.message ? e.message : '与 AI 助手通信失败，请稍后再试')
```

**前端自身只有两个固定兜底文案**：
1. `回答生成超时`（AbortError，即 180s/300s 分级超时触发）
2. `与 AI 助手通信失败，请稍后再试`（无 message 时的终极兜底）

**结论**：「AI助手暂时离线，请稍后再试」若出现在界面，唯一来源是 `e.message`——即 Hermes 引擎、nginx 网关错误页、或上游 502/504 响应体把该短语作为错误文案回传，被前端冒泡显示。前端不是根因，是"传声筒"。

### 0.2 Hermes 生产拓扑（HANDOFF.md 确认）

- 引擎进程：`systemd hergent-gateway.service`，api_server 仅监听 **loopback `127.0.0.1:18765`**。
- 前端不直接连 18765。生产链路：浏览器 → `nginx /hermes/` → 注入 Bearer 网关 key `hergent-prod-gateway-key-2026` → `127.0.0.1:18765`。
- 前端 `hermesChat` 请求 `/hermes/v1/chat/completions` **不带 Bearer**（由 nginx 注入），前端 `hermesKey` 在生产为空白字符串。
- 模型：`deepseek-v4-flash`；LLM key 在 `.env` 的 `DEEPSEEK_API_KEY`（旧 `AI_API_KEY` 已吊销）。
- ConnectCenter 的"离线/连接异常"提示**仅针对 wecom/feishu/dingtalk 推送渠道**，与 Hermes AI 对话无关，已排除。

---

## 1. 根因分析（按可能性从高到低）

| # | 候选根因 | 可能性 | 判断依据 |
|---|---------|--------|---------|
| R1 | **Hermes 上游 LLM key 失效 / 额度耗尽**（DEEPSEEK_API_KEY） | ⭐⭐⭐⭐⭐ | 模型 deepseek-v4-flash 依赖该 key；key 失效时 Hermes 会把「服务不可用/离线」类文案写入 SSE 错误行或 HTTP 错误体，被前端冒泡。这是"频繁离线"最典型诱因（key 轮换、欠费、被风控）。 |
| R2 | **Hermes 进程崩溃 / OOM / 频繁重启** | ⭐⭐⭐⭐ | systemd 单实例，工具循环（spreadsheet 长任务）或大上下文可能 OOM；重启窗口内 nginx 上游 18765 连接拒绝 → 502，错误页/网关文案被误读为"离线"。 |
| R3 | **nginx 上游 502/504 + proxy_read_timeout 过短** | ⭐⭐⭐⭐ | Hermes 长任务（对账/复盘）跑数分钟，若 `proxy_read_timeout` < 任务耗时，nginx 切断连接返回 504；前端 SSE 流被掐断后 `reader.read()` reject，catch 冒泡"通信失败"。 |
| R4 | **网关 key 鉴权失败**（nginx 注入缺失 / key 轮换） | ⭐⭐⭐ | 前端不带 key，全靠 nginx 注入 `hergent-prod-gateway-key-2026`。若 nginx 配置缺失该注入或 key 被轮换，18765 返回 401/403，前端抛「Hermes 错误 (401)」或网关错误页文案。 |
| R5 | **并发 / 单实例连接耗尽** | ⭐⭐⭐ | Hermes 单实例 + 多用户并发长任务，线程/连接池耗尽，慢请求堆积 → 部分请求超时/排队 → 间歇性"离线"感。 |
| R6 | **前端超时误杀（已修复，低概率复发）** | ⭐ | P0 炸弹#4 已修：120s→300s 分级超时。若仍见"回答生成超时"属正常长任务边界，非"离线"文案。 |

**最可能根因组合**：R1（LLM key）与 R3（nginx 超时）叠加——key 偶发限流/超时触发 Hermes 返回错误 SSE，叠加 nginx 长任务断流，共同造成"频繁离线"观感。

---

## 2. 修复方案（按优先级排序，含代码层面建议）

### P0 — 前端：区分「服务不可用」与「请求失败」，避免误导"离线"文案

**问题**：前端把任何外部错误都冒泡成"通信失败/离线"类文案，无法区分"真离线"与"临时请求失败"。

**改动（CopilotDrawer.vue :738-740）**：根据 HTTP 状态与错误类型映射更精准文案 + 自动重试退避。

```js
} catch (e) {
  const last = store.chat.messages[replyIndex]
  if (last && !last.card) store.chat.messages.splice(replyIndex, 1)
  // 区分错误类型，避免一切失败都冒泡成"离线"
  let msg
  if (e && e.name === 'AbortError') {
    msg = '回答生成超时，已停止。请点「重试」重新发送。'
  } else if (/离线|offline|暂时不可用|503|502|504/i.test(e?.message || '')) {
    msg = 'AI 服务暂时不可用，正在自动重试…如持续失败请稍后再试。'
  } else if (/401|403|鉴权|unauthorized/i.test(e?.message || '')) {
    msg = 'AI 服务鉴权异常，请联系管理员。'
  } else {
    msg = e?.message || '与 AI 助手通信失败，请稍后再试'
  }
  store.chat.error = msg
  store.chat.streaming = false
  // 对"服务不可用"类错误尝试一次静默重试（退避 1.5s）
  if (/离线|offline|502|503|504|暂时不可用/i.test(msg) && !payload.__retried) {
    setTimeout(() => streamReply({ ...payload, __retried: true }), 1500)
  }
  return
}
```

**改动（client.js :141-144）**：对非 ok 响应，把 HTTP 状态码塞进 message 便于前端分类：
```js
throw new Error(`[HTTP ${res.status}] ` + (e.detail || e.message || 'Hermes 上游错误'))
```

### P1 — 后端：Hermes 健康检查 + LLM key 监控 + 自愈

1. **加 health 探测端点**：在 18765 暴露 `/v1/health`，返回 LLM key 状态（valid/expired/quota）、上游连通性、进程 uptime。前端/监控可轮询。
2. **LLM key 监控**：在 Hermes 调用上游前做 key 有效性预热检查；key 失效时在 SSE 首行返回结构化错误（`{"type":"error","code":"LLM_KEY_INVALID"}`）而非模糊"离线"文案。
3. **systemd 自愈**：`hergent-gateway.service` 已 `Restart=always`；确认 `RestartSec=5` 与 `MemoryMax` 防 OOM 雪崩。

### P1 — nginx：放大超时 + 上游失败返回明确错误

`/hermes/` 代理段补充：
```nginx
proxy_read_timeout 320s;          # 覆盖最长 300s 长任务 + 余量
proxy_connect_timeout 10s;
proxy_send_timeout 320s;
proxy_intercept_errors on;
# 上游 502/504 时返回结构化 JSON 而非默认错误页
error_page 502 504 = @hermes_down;
location @hermes_down {
  default_type application/json;
  return 503 '{"detail":"AI 服务暂时不可用，请稍后再试"}';
}
```
**关键**：默认 nginx 502/504 错误页是 HTML，前端 `res.json()` 解析失败 → 落到「Hermes 错误 (502)」或「通信失败」。改为 JSON `detail` 后，前端能精准显示"暂时不可用"而非崩溃式冒泡。

### P2 — 并发：Hermes 实例隔离 + 队列

- 长任务（对账/复盘）与短对话分队列，避免互饿。
- 评估 Hermes 是否支持多 worker；单实例下对并发 SSE 做连接数上限保护 + 友好排队提示。

---

## 3. 验证修复效果的步骤（生产实测）

> ⚠️ 本会话 Bash 工具不可用，以下为待执行验证清单（Bash 恢复后或由运维执行）。

**V1 后端 LLM key 与进程**（SSH `ssh -i ~/.ssh/id_ed25519 root@47.113.224.140`）：
```bash
# 进程存活
systemctl status hergent-gateway --no-pager | head -20
journalctl -u hergent-gateway --since "2 hours ago" | grep -iE "error|offline|key|quota|timeout|traceback" | tail -40
# 本地 health 探测（绕过 nginx，直连 loopback）
curl --noproxy '*' -s -m 10 http://127.0.0.1:18765/v1/models -H "Authorization: Bearer hergent-prod-gateway-key-2026" | head -c 500
# LLM 上游连通（用 .env 的 DEEPSEEK_API_KEY 直测）
curl -s -m 15 https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY" | head -c 300
```

**V2 nginx 上游与超时**：
```bash
grep -nE "proxy_read_timeout|proxy_pass|/hermes" /etc/nginx/conf.d/*.conf
tail -50 /var/log/nginx/error.log | grep -i "upstream\|18765\|timeout" | tail -20
# 模拟长任务经 nginx 代理，观察是否 504
curl -s -m 330 -X POST https://hergent.cn/hermes/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"帮我做一份完整经营复盘"}],"stream":true}' | head -c 800
```

**V3 前端行为**：
- 部署 P0 改动后，在浏览器开 DevTools（Cmd+Option+I）→ Network，过滤 `/hermes`，观察失败时响应体是 JSON `detail` 还是 HTML 错误页。
- 触发"服务不可用"类错误，验证前端自动退避重试是否生效（1.5s 后重发一次）。

---

## 4. 监控与告警配置建议

### 4.1 服务端探测（Prometheus / 简单 cron）

| 指标 | 探测方式 | 告警阈值 |
|------|---------|---------|
| Hermes 进程存活 | `systemctl is-active hergent-gateway` | 非 active 立即告警 |
| 18765 loopback 可达 | `curl --noproxy '*' 127.0.0.1:18765/v1/models` | 连续 2 次失败 |
| LLM key 有效期/额度 | Hermes `/v1/health` 返回 key 状态 | `valid!=true` 告警 |
| nginx 上游 502/504 率 | `nginx error.log` 关键词计数 | 5 分钟 > 5 次 |
| 前端 SSE 失败率 | 前端埋点上报（见 4.2） | 5 分钟 > 3% |

### 4.2 前端埋点（client.js hermesChat）

在 catch 与 `!res.ok` 处上报结构化事件，区分"真离线"与"临时失败"：
```js
// 在 hermesChat 抛错前上报
navigator.sendBeacon?.('/api/metrics', JSON.stringify({
  evt: 'hermes_req_fail',
  status: res?.status,
  msg: e?.message?.slice(0, 120),
  ts: Date.now()
}))
```

### 4.3 告警通道
- 严重（进程挂/key 失效）：企业微信/飞书机器人即时推送（复用已有 wecom/feishu 通道）。
- 预警（502 率上升/长任务超时增多）：日报汇总。

---

## 5. 待办与遗留

- [ ] **生产实测 V1-V3 待执行**（Bash 工具本会话不可用，恢复后或交运维执行，优先确认 R1 LLM key 状态与 R3 nginx 超时）。
- [ ] P0 前端区分文案 + 退避重试改动：**尚未落盘**（本报告给出代码，待 Craft 模式写入 client.js / CopilotDrawer.vue 并经构建部署）。
- [ ] P1 nginx 超时与 `@hermes_down` 结构化错误：**尚未落盘**（需改 nginx 配置并 reload）。
- [ ] P1 后端 `/v1/health` 端点：需 Hermes 侧支持或新增轻量探测。

---

## 附：排查排除项（已证伪）

- ❌ 前端硬编码"AI助手暂时离线"文案 → Grep 全量搜源码/dist/outputs 均不存在。
- ❌ ConnectCenter 渠道离线提示 → 仅 wecom/feishu/dingtalk，与 Hermes 对话无关。
- ❌ 前端 120s 超时误杀 → P0#4 已修为 300s 分级超时，仅当真超长任务才报"超时"非"离线"。
