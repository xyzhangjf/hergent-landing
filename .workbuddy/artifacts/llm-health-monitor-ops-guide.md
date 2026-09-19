# Hergent AI 出口健康监控 · 交付说明

> 交付时间：2026-09-11 · 后端提交 `b9ba158`（已推送 `upgrade/v84-international`）
> 触发原因：2026-09-11 企微机器人持旧 key 全线 401，AI **静默降级**拖到用户主动反馈才发现

---

## 1. 解决的问题：「静默降级」

模型 key 失效或账户余额耗尽时，Hermes **不会报错**。用户看到的只是一句降级文案
（"AI 答非所问"），运维侧**零信号**。9-11 那次事故里：

- 租户网关继承了一个 8 月 22 日 rsync 事故后手工重建时填错的旧 key
- 企微机器人每次对话都 401，日志里记了，但**没人看日志**
- 直到用户主动反馈"AI 怎么答不上话"才被发现

**监控的目标：把「静默降级」变成「可感知故障」。**

---

## 2. 架构

```
root crontab (*/5)
   └─ runuser -u hergent  (降权执行，最小权限)
        └─ /opt/hergent-erp/scripts/llm_health_monitor.py
             ├─ ① key 有效性   GET api.deepseek.com/user/balance
             ├─ ② 账户余额     分档：ok / warn(<¥20) / crit(<¥5)
             ├─ ③ 网关错误日志  各租户 gateway.log「新增」内容增量扫描
             └─ ④ 服务探活     127.0.0.1:8700/api/health、:18765/health
                  │
                  └─ 触发 → hermes send --to wecom
                              └─ 复用租户 home channel（ZhangJunFeng）
```

**关键设计决策**

| 决策 | 理由 |
|---|---|
| 独立脚本 + cron，而非塞进 hergent-erp 的 scheduler | 监控不能与被监控对象同生共死——后端挂了，探活告警仍要发得出来 |
| 纯标准库（urllib / subprocess） | 无第三方依赖，不受后端虚拟环境变动影响 |
| 复用 `hermes send` 出站 | 不必新增 webhook 凭证，自动复用租户已授权的企微 home channel |
| 只推运维本人，不进客户门面 | 平台级故障（共享 key、余额）不该暴露给客户租户 |
| 增量字节偏移扫日志 | Hermes 网关日志里大量行（多行堆栈、emoji 提示）**没有时间戳前缀**，按 mtime 兜底会把历史错误反复翻出来误报（实测踩过） |

---

## 3. 检查项与阈值

| # | 检查项 | 判据 | 级别 |
|---|---|---|---|
| 1 | **key 有效性** | HTTP 401 / `is_available=false` | 🚨 严重 |
| 2 | **账户余额** | < ¥5 严重；< ¥20 预警 | 🚨 / ⚠️ |
| 3 | **网关错误日志** | 新增日志命中 401/402/余额不足 | 🚨 严重 |
| 4 | **服务探活** | 8700 `/api/health` 或 18765 `/health` 非 200 | 🚨 严重 |

**去重规则**（状态文件 `var/llm_health_state.json`）

- 同档位不重复刷屏：严重 2 小时一次、预警 12 小时一次
- **档位升级立即推**（预警 → 严重）
- **恢复正常也推一条**（让你知道问题已解）

> 当前余额 ¥8.59 → 处于 `warn` 档，**每 12 小时提醒一次**，直到充值超过 ¥20
> 或调低阈值。充值后会收到一条「✅ 恢复正常」。

---

## 4. 部署清单（全部已验证）

| 项目 | 位置 | 状态 |
|---|---|---|
| 监控脚本 | `/opt/hergent-erp/scripts/llm_health_monitor.py`（owner hergent, 755） | ✅ MD5 与仓库一致 |
| 状态文件 | `/opt/hergent-erp/var/llm_health_state.json` | ✅ 已生成 |
| 运行日志 | `/opt/hergent-erp/var/llm_health_monitor.log`（>2MB 自动轮转） | ✅ 有记录 |
| 定时任务 | root crontab：`*/5 * * * * /usr/sbin/runuser -u hergent -- …` | ✅ 实测触发 |
| 仓库版本 | `server/scripts/llm_health_monitor.py` @ `b9ba158` | ✅ 已推送 |

**顺带修掉的隐患**：root crontab 原有的 `*/5 * * * * /opt/hergent-erp/scripts/healthcheck.sh`
指向一个**从不存在的文件**（`/opt/hergent-erp/scripts/` 目录此前根本没有），即每 5 分钟
报错一次的垃圾配置 —— 已清除，其探活职责并入本脚本检查项 ④。

---

## 5. 运维手册

```bash
# 看当前状态（只读，不推送、不改状态）
runuser -u hergent -- /usr/bin/python3 /opt/hergent-erp/scripts/llm_health_monitor.py --status

# 看运行日志
tail -30 /opt/hergent-erp/var/llm_health_monitor.log

# 看状态（上次各检查项的档位与时间）
cat /opt/hergent-erp/var/llm_health_state.json

# 测试推送通道是否通（会真的发一条到企微）
runuser -u hergent -- /usr/bin/python3 /opt/hergent-erp/scripts/llm_health_monitor.py --test

# 忽略冷却强制重推一次
… --force

# 临时停用（注释掉即可）
crontab -l | sed '/llm_health_monitor/s/^/#/' | crontab -
# 恢复
crontab -l | sed '/llm_health_monitor/s/^#//' | crontab -
```

**调阈值**：在 crontab 那行前面加环境变量即可，无需改脚本

```bash
*/5 * * * * LLM_BALANCE_WARN_CNY=50 LLM_BALANCE_CRIT_CNY=10 /usr/sbin/runuser -u hergent -- …
```

**可用环境变量**

| 变量 | 默认 | 含义 |
|---|---|---|
| `LLM_BALANCE_WARN_CNY` | 20 | 余额预警线 |
| `LLM_BALANCE_CRIT_CNY` | 5 | 余额严重线 |
| `LLM_LOG_WINDOW_MIN` | 20 | 基线阶段的时间戳回溯窗口（分钟） |
| `OPS_ALERT_HOME` | `/opt/hermes-tenants/hergent_t1` | 用哪个租户的凭证出站 |
| `OPS_ALERT_TARGET` | `wecom` | 推送目标（走 home channel） |
| `PROBE_ERP_URL` / `PROBE_HERMES_URL` | 见脚本 | 探活地址 |

---

## 6. 验证证据

| 验证项 | 方式 | 结果 |
|---|---|---|
| 推送通道 | 真实调用 `hermes send` | ✅ `success:true`（企微已收到 2 条） |
| 余额分档 | 桩数据 4 组（50/12/3/不可用） | ✅ 全通过 |
| key 401 识别 | 桩数据抛 HTTPError 401 | ✅ 判为严重 |
| 增量扫描不误报 | 桩数据 5 场景（首次基线/新增/重复/正常行/轮转） | ✅ 全通过；**线上历史 15:33 的 8 条旧错误不再误报** |
| 服务探活 | 桩数据（200 / 500 / 拒连） | ✅ 全通过 |
| cron 真实触发 | 临时改 `* * * * *` 观察 | ✅ `last_run` 18:41:32 → 18:43:02 |
| 去重冷却 | 连续两次 warn 档运行 | ✅ 不重复推送 |
| 401 端到端 | 向网关日志注入带时间戳的 401 行 | ✅ 检出 `[CRIT] 1 条`，日志已还原 |
| 首次真实告警 | 真实运行 | ✅ 推送余额预警至企微（`message_id: aibot_send_msg-e77a…`） |

---

## 7. 已知边界与后续建议

**边界**

1. **基线不追溯**：脚本首次见到某个租户日志时只建基线（取文件当前大小），
   万一故障恰好发生在首次运行前，那一次不会被追溯告警。仅影响第一轮。
2. **不监控第三方依赖**：只探活本机进程，域名解析 / nginx / 上游网络故障不在范围。
3. **余额是平台级、共享的**：网页端与企微端目前共用同一把 key、同一份余额（见下）。

**建议的下一步**

1. ⚠️ **充值**：余额 ¥8.59 已在预警档。耗尽时网页端与企微端会**同时静默降级**——
   现在至少有告警了，但建议保持余额在 ¥50 以上。
2. **租户级 key 隔离**：把 LLM 凭证下放到每个租户 `.env`，才能按客户控额度、
   分档计费，也避免一家出问题全站受影响。
3. **微信通知而非只推企微**：如果以后要真正面向非技术客户，告警应该走微信服务号
   模板消息，而不是企微 home channel。
