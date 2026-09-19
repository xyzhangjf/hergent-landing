# 企微机器人「你好」回复异常 — 排查报告（修订版）

日期：2026-09-11　租户：`hergent_t1`　渠道：企业微信（Wecom）
修订说明：初版误判为「全站 key 失效」；复测发现服务器上存在**两把不同的 key**，故修订。

## 一、结论速览

用户配对成功后在企微发「你好」，收到 Hermes 网关的 home channel 提示。
排查后发现这是**两个独立问题**，其中第二个是 P0 故障，但**只影响企微链路**：

| # | 问题 | 性质 | 影响范围 |
|---|---|---|---|
| 1 | `WECOM_HOME_CHANNEL` 未配置 → 首条消息弹出英文提示 | Hermes 设计行为，非故障 | 客户可见英文技术文案；AI 主动推送无出口 |
| 2 | 租户链路继承的 `DEEPSEEK_API_KEY`（`…5c58`）已失效 | **P0 故障** | **仅企微机器人**全线失败；主网关（网页副驾，`…1170`）完全正常 |

**⚠️ 核心认知：服务器上同时存在两把 key，网页端与企微端各用一把。**
用户反馈「DeepSeek 正常扣费」属实 —— 那来自网页端的 `…1170`；企微端用的是早已失效的 `…5c58`。

## 二、home channel 机制（从字节码反编译确认）

源码以 `.pyc` 分发，本机无源码。用 Python 3.11 反汇编 `gateway/run.cpython-311.pyc`
定位到 `GatewayRunner._handle_message_with_agent`（起始行 7121），逻辑为：

```python
# run.py 7631-7650 附近
if (not history
        and source.platform
        and source.platform not in (Platform.LOCAL, Platform.WEBHOOK)):
    platform_name = source.platform.value          # "wecom"
    env_key = _home_target_env_var(platform_name)  # -> WECOM_HOME_CHANNEL
    if not os.getenv(env_key):                     # ← 触发条件
        sethome_cmd = '/hermes sethome' if platform == SLACK else '/sethome'
        notice = (f"📬 No home channel is set for {platform_name.title()}. "
                  "A home channel is where Hermes delivers cron job results "
                  "and cross-platform messages.\n\n"
                  f"Type {sethome_cmd} to make this chat your home channel, "
                  "or ignore to skip.")
        await self._deliver_platform_notice(source, notice)
# ↓ 之后流程继续，正常交给 agent 处理
```

要点：

- **触发条件**＝该会话无历史（首条消息）＋ 平台非 LOCAL/WEBHOOK ＋ `WECOM_HOME_CHANNEL` 为空。
- 它是**一次性附加通知**，发出后**不阻断**后续处理（反编译可见 7657 行继续往下走）。
- 文案中 "or ignore to skip" 是字面意思：不配置也不影响基础问答。
- **语义**：home channel = Hermes 主动消息的默认投递目标，用于
  ① cron 定时任务结果推送　② 跨平台消息／通知。
- 值格式（wecom adapter 校验 `^(user|group):`）：`user:<openid>` 或 `group:<chatid>`。
- `/sethome` 的实现（`GatewayRunner._handle_set_home_command`，run.py:9941）：
  调用 `hermes_cli.config.save_env_value()` 把当前 chat_id **写入 .env**，即
  `WECOM_HOME_CHANNEL=<chat_id>`。

### 生产环境实际状态

`/opt/hermes-tenants/hergent_t1/.env`（脱敏）：

```
# Hergent 租户渠道凭证（由「连接手机」写入，勿手工编辑）
WECOM_BOT_ID=aibZXfL5ZJ7YT0K_9NX4WzaTT1me5L_f2Aa
WECOM_SECRET=***
```

→ 只有 bot 凭证，**无 `WECOM_HOME_CHANNEL`**，与提示现象吻合。

`channel_directory.json` 已记录该会话（可直接用于配置）：

```json
{"platforms": {"wecom": [{"id": "ZhangJunFeng", "name": "ZhangJunFeng", "type": "dm"}]}}
```

## 三、P0 故障：企微链路继承了一把失效的 key

### 3.1 关键事实：服务器上存在两把 key

通过对运行中进程的 `/proc/<pid>/environ` 提取指纹（仅比对尾 4 位）：

| pid | 运行用户 | 进程／用途 | key 指纹 | 实测结果 |
|---|---|---|---|---|
| 2119995 | root | `hermes gateway run`，HERMES_HOME=`/root/.hermes`，监听 127.0.0.1:18765 → **网页 AI 副驾引擎** | `sk-1763…1170` | **HTTP 200 有效**，余额 ¥8.59，`is_available: true` |
| 2124916 | hergent | `hermes gateway run`，HERMES_HOME=`/opt/hermes-tenants/hergent_t1` → **企微机器人** | `sk-1e5c…5c58` | **HTTP 401 无效** |

两把 key 归属同一个 DeepSeek 账户（用 `…1170` 查询到余额 ¥8.59）。

### 3.2 失效 key 的传播链路

```
/opt/hergent-erp/.env     DEEPSEEK_API_KEY=sk-1e5c...5c58   ← 已失效（陈旧值）
        │  systemd EnvironmentFile=/opt/hergent-erp/.env
        ▼
hergent-erp server.py（User=hergent）
        │  hermes_tenants._env_head()  ← 只剔除渠道凭证(FEISHU_*/WECOM_* 等)
        │                                 不剔除 DEEPSEEK_API_KEY，原样继承
        ▼
租户 Hermes 网关进程（pid 2124916）
        ▼
企微机器人 → https://api.deepseek.com/v1 → 401 → 降级回复
```

网关日志佐证：

```
15:33:16  INFO  inbound message: platform=wecom user=ZhangJunFeng msg='你好'
15:33:30  WARNING agent.conversation_loop: API call failed error_type=AuthenticationError
          provider=deepseek base_url=https://api.deepseek.com/v1 model=deepseek-v4-flash
          summary=HTTP 401: Authentication Fails, Your api key: ****5c58 is invalid
15:33:31  INFO  response ready: ... response=65 chars
15:33:31  INFO  [Wecom] Sending response (114 chars) to ZhangJunFeng
```

→ AI 并未真正作答，发出的是**模型不可用后的降级文案**（静默降级，客户端无报错）。

### 3.3 陈旧 key 的来源推测

`/opt/hergent-erp/.env` 头部注释：

```
# Recreated by recovery Sat Aug 22 07:56:42 AM UTC 2026 — original .env was destroyed by rsync --delete
# ERP_SECRET regenerated (original unrecoverable)
```

→ 该 `.env` 是 2026-08-22 事故恢复时**手工重建**的，很可能当时填入的是旧 key；
此后主网关那边的 key 已轮换为 `…1170`，而 `.env` 未同步。
企微通道直到 9/10-9/11 才真正接通，因此这是该陈旧值**第一次被实际使用并暴露**。

## 四、修复方案

### P0（恢复企微，二选一）

**方案 A — 同步现有 key（最快恢复，共用一把）**

1. 将 `/opt/hergent-erp/.env` 的 `DEEPSEEK_API_KEY` 更新为 `sk-1763…1170`；
2. `systemctl restart hergent-erp`（租户网关随之重启，继承新环境变量）。

- 优点：一行改动，立即恢复。
- 缺点：网页端与企微端共用一把 key、共享 ¥8.59 余额；任一入口耗尽则两处同时静默降级。

**方案 B — 给企微配专用 key（推荐）**

1. 在 DeepSeek 后台新建一把 key 专供租户使用；
2. 写入 `/opt/hergent-erp/.env`（或改为**每租户 `.env` 显式声明**，见下）；
3. 重启生效。

- 优点：额度隔离，可观测、可限额，避免一次耗尽全站降级。
- 缺点：需要用户去后台签发。

### 架构改进（建议同期做）

3. **每租户显式声明 LLM 凭证**：当前所有租户共享由 `hergent-erp` 进程继承的同一把 key，
   属凭证越界。改法：租户 `.env` 显式写 `DEEPSEEK_API_KEY`，
   并确认 Hermes 的 dotenv 加载为 override 语义（否则进程环境变量仍会胜出）。
   ⚠️ 注意：若 Hermes 使用 `load_dotenv(override=False)`，仅写租户 `.env` 不生效，
   必须同时改 `/opt/hergent-erp/.env` 或调整 `_env_head()` 的剔除清单。

4. **把 key 失效从「静默降级」变为「可见故障」**：当前客户端只收到一段降级文案，
   运维侧无告警。建议加余额／401 监控（`GET https://api.deepseek.com/user/balance`
   可查余额，当前仅 ¥8.59，偏低）。

### 门面问题（配套做）

5. 配置 `WECOM_HOME_CHANNEL=user:ZhangJunFeng`（值取自 `channel_directory.json`）
   → 提示自动消失，且 cron／主动推送有投递目标。
   - 更优：在「连接手机」保存企微凭证时，把 home channel 纳入 `CHANNEL_SPECS`
     或保存后自动写入；客户只面对中文设置项，而不是 `/sethome`。

## 五、待用户决策

- 走**方案 A**（立刻恢复）还是**方案 B**（先签发专用 key）？
- 是否同期做**租户级凭证隔离**？
- 是否一并配置 home channel（消除提示 + 打通主动推送）？
- ⚠️ 余额 ¥8.59 偏低，是否需要充值？耗尽时网页端与企微端会**同时**静默降级。

## 六、修复执行记录（2026-09-11 18:32–18:36，方案 A + 门面修复）

| # | 动作 | 结果 |
|---|---|---|
| 1 | 备份 `/opt/hergent-erp/.env` → `.env.bak-20260911-183233` | ✅ |
| 2 | 同步 key：`DEEPSEEK_API_KEY` 由 `…5c58` 改为 `…1170` | ✅ 正则命中 1 处，指纹与主网关 `IDENTICAL` |
| 3 | `systemctl restart hergent-erp` | ✅ active，`0.0.0.0:8700` 正常监听 |
| 4 | 校验租户网关进程 | ✅ 新 pid 2126285，`DEEPSEEK_API_KEY` 尾号 = `1170` |
| 5 | 备份租户 `.env`，追加 `WECOM_HOME_CHANNEL=ZhangJunFeng` | ✅ |
| 6 | 再次重启后端使配置生效 | ✅ wecom 已连接（`[Wecom] Connected to wss://openws.work.weixin.qq.com`） |
| 7 | `hermes status` 校验 home channel | ✅ `WeCom ✓ configured (home: ZhangJunFeng)` |

写入值格式依据：反汇编 `GatewayRunner._handle_set_home_command` 确认为
`save_env_value(env_key, str(source.chat_id))`，即**原样写入 chat_id**，不带平台前缀。
与 `channel_directory.json` 中 `id=ZhangJunFeng`、日志 `chat=ZhangJunFeng` 一致。

验证要点（`hermes config get` 读的是 `config.yaml`，`Config key not set` 属正常；
home channel 的判定走 `os.getenv`，须以 `hermes status` 或端到端消息为准）。

### 待端到端确认

在企微发送一条消息，预期：
1. **不再出现** home channel 提示；
2. AI 正常回答（不再降级）。

### 遗留

- 仍为**单 key 共用**（网页端与企微端共享 `…1170`），余额 ¥8.59；未做租户级凭证隔离。
- 建议加余额／401 监控（`GET /user/balance`），避免再次静默降级。

### 附：本次定位到的源码位置（便于后续排查）

Hermes 在服务器上**部分模块带明文源码**：
`/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages/hermes_cli/`
（如 `env_loader.py`、`send_cmd.py`），其余网关模块仍为 `.pyc`。

