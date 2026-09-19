# 连接手机 / IM 渠道 — v131（2026-09-10）

> 从 MEMORY.md 下沉，避免主记忆超限。**⛔ 下方的硬阻塞已在同日落地解决，见文末「落地结果」。**

## 桌面版 = Hermes 官方机制（不是群机器人 Webhook）
- 链路：平台**自建应用凭证** + **长连接(WebSocket)** + **DM 配对码审批**。
- 字段定义见 `desktop-app/js/config.js::CHANNEL_CARDS`：飞书 `app_id/app_secret`、企微 `bot_id/secret`、钉钉 `client_id/client_secret`、QQ `app_id/app_secret`。
- 桌面写配置：`desktop-app/main.js:894` `hermes config set <ch>.<key>` + `<ch>.enabled true`；探测 `gateway_state.json` 的 `platforms[ch].state==='connected'`；配对审批 `main.js:1993` 直接走官方 `hermes pairing approve <code>`。
- 官方配对系统：`~/.hermes/hermes-agent/venv/.../gateway/pairing.py` —— 8 位去混淆码、1h 过期、每平台 ≤3 待批、10min 限流、5 次失败锁 1h、SHA-256+盐、chmod 0600，落 `~/.hermes/platforms/pairing/`；CLI `hermes pairing {list|approve <platform> <code>|revoke}`。
- 连接方式（由 pyc 符号提取证实）：飞书=`lark_oapi` + `ws.Client` + `EventDispatcher`；企微=`wss://` + bot_id；钉钉=websocket stream。

## 当前 Web 端是群机器人 Webhook（单向）
- `ConnectCenter.vue` + `server/ai_channels.py`，字段 `webhookUrl`，存 `ai_channel_configs(tenant_id, channel, config_json, enabled)`；健康检查与推送都 POST 到 Webhook → **单向，手机只收不回**。
- 卡片的 `corpId/agentId/appId` 是**摆设**（后端只读 webhookUrl）；`generate_pairing` / `approve_pairing` 前端是拿码后**自我 approve**（自问自答）。

## ⛔ 落地硬阻塞
- 生产 Hermes 是**单实例全局**（`hermes gateway run` + `/root/.hermes/config.yaml`，仅 api_server:18765，~180MB RSS），`platforms` 配置**全局单份、无租户概念**。
- 多租户长连接必须**每租户一个 Hermes profile → 一个常驻 gateway 进程**（`hermes profile` / `hermes gateway list` 证实按 profile 分进程）。
- Web 后端目前**无任何写 config.yaml / 管理 gateway 的代码** → 要落地需先补这一层。

## ✅ 落地结果（2026-09-10 晚，用户选「B+直接下线+复刻引导词」）
- 后端 `hermes_tenants.py` + 前端 `ConnectCenter.vue` 已上线（commit `d6c077e` / `beeb7bb`）。
- **下面三条「硬阻塞」已全部消除**：
  - 单实例全局 → 改为**每租户独立 `HERMES_HOME=/opt/hermes-tenants/hergent_t<id>`**，配置/凭证/配对/state 全隔离。
  - 「无写 config.yaml / 管理 gateway 的代码」→ 已补：不需要写 config.yaml，**只写 `.env` 的成对变量** Hermes 即自动启用该平台；网关用 `hermes gateway run --force`（零 sudo）接管。
  - 配对不再自问自答 → 改走官方 `hermes pairing list/approve/revoke`。
- 细节与三个技术坑（状态假阳性 / Popen PID 不可靠 / `--force` 必需）见 `2026-09-10.md` 的 v131 段。
- ⚠️ 未解约束：**每租户常驻进程 ~90–265MB，服务器 3.5G 内存仅支撑约 8–20 租户**。

## 层级模型（2026-09-11 核代码确认，答疑用）
- **凭证层级 = (租户 × 渠道)**：`hermes_tenants.CHANNEL_SPECS` 每渠道只有一组 env（企微仅 `WECOM_BOT_ID`/`WECOM_SECRET`）→ **一个租户一个企微机器人**，四个渠道同理。**架构上不支持「一个角色一个机器人」**。
- **角色↔渠道 = 多对多出站订阅**：`ai_channels.ai_role_channels` UNIQUE(tenant_id, role_id, channel)；语义是「勾选的角色，其回复推到这个渠道」（`ai_channels.py:273 push_role_channels`）。同一渠道可被 N 个角色绑定 → N 个角色共用一个机器人。
- **多角色共用时靠 title 区分**：`CopilotDrawer.vue:1139` 传 `title = currentRole.name`，`send_message` 以 `hermes send -s <title>` 发出 → 手机上看到的标题即角色名。
- ⚠️ **入站无角色维度**：配对只有 (租户, 渠道)（`pairing/*-approved.json`），**没有 user→role 映射**；手机发消息直接进 Hermes 智能体，不带 Hergent 角色。角色绑定只作用于**出口**，不作用于**入口**。
- 若要「一角色一机器人」：需每角色一个 Hermes profile（内存 ×角色数）+ 企微建 N 个自建应用 + 老板加 N 个机器人 → 当前不推荐。

## 配对审批（DM pairing）—— 2026-09-11 修正，v136
**用户视角**：新同事在企微给机器人发消息 → 机器人回「Hi~ I don't recognize you yet! Here's your pairing code: PAVGNRZ2 / Ask the bot owner to run: hermes pairing approve wecom PAVGNRZ2」→ **管理员在 Hergent「能力中心 → 谁可以跟 AI 对话」里填这 8 位码批准**（不必上服务器敲命令）。

### 三个真实缺陷（都已修）
1. 🔴 **目录错位**：Hermes v0.19+ 的 `PAIRING_DIR = get_hermes_dir("platforms/pairing","pairing")` = `<HERMES_HOME>/platforms/pairing/`（新目录权威，旧 `home/pairing/` 是历史遗留，官方还会把旧数据 merge 进新目录）。旧实现只读 `home/pairing/` → **用户在手机那边等着审批，后台列表恒为空**。且 `ensure_home` 每次都建空的 legacy 目录 → 排查时极易误判。
   → 修：`_PAIRING_SUBDIRS = ("pairing","platforms/pairing")` 两个都读、新目录覆盖旧的；`ensure_home` 改建权威目录。
2. 🔴 **CLI 恒 exit 0**：`hermes_cli/pairing.py` 的 `_cmd_approve/_cmd_revoke` **只 print 不同文案，从不 sys.exit(非0)**（成功/错码/锁定三种情况 rc 都是 0）。所以**绝不能按 `rc != 0` 判失败** —— 原实现会把「错码」当「已批准」返回。
   → 修：解析 stdout —— `Approved!` / `not found or expired` / `locked out` / `Revoked access`（副产物：CLI 自己也是靠这套文案，没有比这更稳的信号）。
3. 🔴 **把 entry_id 当配对码**：pending JSON 的 key 是 `secrets.token_hex(8)`，**值只存加盐 SHA-256**（明文仅存在于对方收到的那条机器人回复里，服务端无法代查）。旧实现把 key 当 `code` 返回给前端 → 点「批准」必然失败，**且每次失败都调 `_record_failed_attempt`** → 连点 5 次触发**渠道级锁定 1 小时**（`_lockout:wecom`，所有人一起遭殃，且锁定期间连新码都不签发）。
   → 修：待审条目只返回 `user_name / expires_in_minutes / expired / locked_out`；配对码由管理员**向对方索要后手填**；`pairing_approve` 前置拦锁定；`pairing_list` 额外返回 `locked[]` 供前端出横幅。

### Hermes 配对机制常量（`gateway/pairing.py`）
- `CODE_TTL_SECONDS=3600`（码 1 小时过期）、`RATE_LIMIT_SECONDS=600`（同人 10 分钟只能要 1 次码）、`LOCKOUT_SECONDS=3600`、`MAX_FAILED_ATTEMPTS=5`、`MAX_PENDING_PER_PLATFORM=3`；字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（**排除 0/O/1/I**）。
- 计数文件 `<PAIRING_DIR>/_rate_limits.json`：`{平台:用户id}=限流时间戳`、`_failures:<平台>`=失败次数、`_lockout:<平台>`=解禁时间戳。
- `list_pending()` 显示的 `code` 是 **hash 前 8 位十六进制**，不是配对码，只能当"能区分条目"的编号。

### 验证手法（可复用）
- 端到端自检必须**以 `hergent` 身份**跑（`runuser -u hergent -- …`），否则写的文件属主是 root，网关读不到。
- 脚本要带**断言**：错码必须 `ok=False`、错码**不能**进 approved、真码 `ok=True`、revoke 后 approved 为空。
- 清理时**必须复位 `_failures:*` / `_lockout:*`**，否则测试本身会把真实渠道顶到锁定。
- 需要 `chat` 权限账号做真机验证时：**权限权威副本在主库 `erp.db.role_permissions`**（`core._load_perms()` 读它，改完要重启服务刷新 `ROLE_PERMS` 进程内缓存）；`tenant_1.db.role_permissions` 是**不参与鉴权的遗留表**（第一次改错库已验证）。验证完务必还原两处。
