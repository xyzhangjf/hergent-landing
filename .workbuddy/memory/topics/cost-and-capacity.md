# 成本与容量模型（v641 实测，2026-10-20）

## 机器
- `ecs.e-c1m2.large` 经济型 e，**2 核 4G**，华南河源，系统盘 40G（**已用 83%，剩 6.5G**）
- 价格（阿里云活动价）：1M 带宽 **819 元/年**（≈68 元/月）；3M **1090 元/年**（≈91 元/月）；5 年付月均 20.52 元
- 内存实测可用 3495MB，已用 2205MB，**swap 已动用 40MB**（说明已经在临界）

## 内存账（谁在吃，20:30 实测）

| 项目 | 内存 | 性质 |
|---|---|---|
| `hermes-gateway.service`（根实例 = 老板 **web** 副驾） | **1101MB** | 主进程 490（含 100MB state.db 缓存）+ 2 个 MCP（65+121）+ 线程 17 |
| `t1`（老板 **企微** 副驾） | **459MB** | 主进程 417 + MCP 70 + 线程 9 |
| `hergent-erp`（后端本体） | 367MB | |
| `t10`（演示租户，**22 天未登录**） | **225MB** | 纯固定成本 |
| mariadb | 194MB | |
| journald | 98MB | |
| nginx + 系统其他 | ~250MB | |

## 🔴 核心判据（回答「还没怎么用就扛不住」）

1. **不是「用得多」，是「每开一个入口就常驻一整套进程」。** 铁证：`t10` 自 9-28 起 22 天没登录，照样占 225MB；与请求量完全无关。
2. **老板一人占整机 45%**：web 走根实例 1101MB + 企微走 t1 459MB = **1560MB**。这两个入口是**同一个副驾产品**，Hermes 的 `platforms` 本来就是 dict，`api_server` 与 `wecom` **可以同实例共存** —— 当初拆两个实例是 v635 迁租户时的历史遗留，不是设计需要。
3. **`state.db` 会随使用线性膨胀，且 FTS trigram 索引放大 ~20 倍**：根实例 `state.db` **100MB**（137 会话 / 5923 消息），t1 仅 17MB。5923 条消息撑出 100MB，其中 `messages_fts_trigram*` 四个影子表占大头（中文三字组合 × 每条消息）。
4. **每租户必备的常驻件**：网关主进程 230~490MB + MCP 读表 65~120MB + 线程子进程 9~17MB。

## 容量与单价换算

| 场景 | 单租户内存 | 本机可放 | 每户成本（按 68~91 元/月） |
|---|---|---|---|
| 现状（web + 企微 拆双实例） | 1560MB | **1.6 户**（连第 2 个客户都放不下） | **408~540 元/年** |
| 单入口租户 | ~460MB | 5.6 户 | 145~190 元/年 |
| **合并双入口（1 实例 2 平台）** | ~460MB | **5.6 户** | **145~190 元/年** |
| 换 4 核 16G（2174 元/年 / 181 元/月） | ~460MB | ~33 户 | **66 元/年** |

> 计算口径：3.5G − 系统 550MB − 后端 370MB = **2580MB 可分配**。

## 优化抓手（按性价比排序）

1. **合并老板的 web + 企微到一个实例** → 直接省掉一整个网关（-459 或 -1101MB）。只改 config，不写代码。⚠️ 取舍：根实例属主 `hergent`（**能改生产代码**，老板要留的超管能力）；t1 属主 `hergent_t1`（隔离）。合并到根实例 = 保留超管但企微入口也带进来；合并到 t1 = 失去改代码能力。
2. **闲置租户按需停** → 闲置即 0MB（t10 就是现成样本）。这是 SaaS 正确姿势：经销商一天真正用副驾可能就几次。
3. **MCP 读表按需启**（只在真正读表时起）→ 每户 -65~186MB。现在是常驻。
4. **FTS trigram 索引**按需建或只保留 `messages_fts`（去掉 trigram）→ 每户 -30~80MB 磁盘 + 内存。
5. **磁盘立刻可清 3~4G**（与多租户无关，是运维债）：`/opt/hergent-cn-v2` 2.3G（历次构建残留 dist-v6xx）、`/opt/hergent-erp/backups` 1.4G、`/opt/hergent-erp-prod` 891M（旧生产目录）、`/root` 里 600MB 的 exe 安装包 + `$PLUGINSDIR`、旧 db 备份 32M×2。

## 🔴 比钱更要紧：故障域

「一台机器手工挂多租户」在 1~3 户可行，5 户以上会持续出事：
- 2026-10-20 已演过一次：一个租户进程把后端 cgroup 顶穿 → **整站白屏 + 企微消息 19 分钟才回**（`time=1148.9s`）
- v640 之前每次 `systemctl restart hergent-erp` 会**掐断所有租户副驾通道**（control-group kill 经 sudo 转发）
- 升级/重启/备份都是「影响所有人」的操作；出问题定位要跨 N 份实例

⇒ 卖 SaaS 的门槛不是服务器钱，是**能否同时支持 5 个互不认识的客户不中断**。

## 定价参考
- 成本（优化后）：服务器 ~150 元/年/户 + 模型 API（估 60~200 元/年/户，取决于读表频次；模型 = `deepseek-v4-flash`）+ 备份/支持
- 卖 1000~2000 元/年 ⇒ 毛利 70%+，健康
- 若不优化就卖：每户 408~540 元/年服务器成本，一台机只能放 1.6 户 ⇒ **交付能力是瓶颈，不是价格**

---

# v642 落地：A 方案（合并到根实例）——2026-10-20 21:27 完成

## 做了什么
把老板的**企微入口从 t1 独立网关搬进根实例**（`/root/.hermes`，systemd `hermes-gateway.service`），同一个进程同时跑 `api_server:18765`（web 副驾）+ `wecom`。

| 改动 | 位置 | 备份 |
|---|---|---|
| `platforms.wecom`（含 `channel_overrides.ZhangJunFeng` 的纯文字提示）合并进根 config | `/root/.hermes/config.yaml` | `config.yaml.bak-v642-wecom`（后缀实际是 `.yaml.bak-v642-wecom`） |
| `WECOM_BOT_ID/SECRET/HOME_CHANNEL` 追加 | `/root/.hermes/.env`（0600 hergent） | `.env.bak-v642-wecom` |
| 平台租户(1) 改为**代理根实例状态**、不再自己 spawn | `hermes_tenants.py` | `.py.bak-v642-platform` |
| `hergent` 可 `systemctl start/stop/restart hermes-gateway` | `/etc/sudoers.d/hergent-platform-gateway` | — |
| 补 t1 独有 skills（`hergent-doc-deliverables`、`hergent-reporting`） | `/root/.hermes/skills/` | — |

## hermes_tenants.py 关键设计（平台租户 = 根实例的别名）
- 新增 `PLATFORM_HOME=/root/.hermes`、`PLATFORM_SERVICE=hermes-gateway`、`_host_home(tid)`、`is_platform_tenant(tid)`。
- **凭证与运行态都走 `_host_home`**：`read_credentials` / `apply_channel` / `remove_channel` / `_state_path` / `_state_is_fresh`。⇒ 老板以后在「能力中心」改企微凭证，写的是**真正生效**的那个 `.env`；不改的话会出现「保存成功但没生效」的静默失效。
- `_proc_pid_for_home(1)` → `_systemd_main_pid()`（读 `systemctl show hermes-gateway -p MainPID`，hergent 可读）。
- `ensure_running(1)` **直接 return None**、`mcp_config_drift(1)` 不判 —— 否则 60 秒保活会再拉起一个只有 wecom 的孤立实例。
- `gateway_start/stop/restart(1)` → `_platform_service_ctl()` 走 sudo 白名单（前端「重连」按钮即此路径）。
- `_channel_log_error(1)` 改读**根实例日志尾部 256KB**：租户目录的 `.mark` 偏移对不上根日志，否则会把合并前的 846609 当当前错误假报。
- `apply_channel` 对平台租户写后 `chmod 0600`（`_write_env` 默认 0660 是给租户用的）。

## 踩到的坑
🔴 **旧后端的保活会「复活」你刚杀掉的租户网关**：21:20 杀 t1，21:20:41 旧进程（patch 尚未生效）又拉了一个。⇒ 改完 `hermes_tenants.py` **必须重启后端**再做「杀掉观察 60s」的验证，否则以为补丁无效。
🔴 同一个企微 bot **只能一个 websocket 订阅**：双连时报 `WeCom errcode 846609: aibot websocket not subscribed`，表现是「发消息不回 / 图片上传失败」，且进程会陷入 100% CPU 重连死循环（v642 实测 t1 空转 252 分钟 CPU）。
🔴 `kill -TERM` 杀不掉这种卡住的网关（shutdown handler 卡在异步清理），要 `kill -9`，且要连 `sudo -u` 包装一起杀。

## 效果（21:29 实测）
| | 改造前 20:30 | 改造后 21:29 |
|---|---|---|
| 内存已用 | 2205MB | **1348MB** |
| 可用内存 | 987MB | **1855MB** |
| 网关进程 | 3 个（根 1101 + t1 459 + t10 225） | 2 个（根 260 + t10 236） |
| 老板入口实例数 | 2（web / 企微各一） | **1** |

省 **~868MB**，可用内存翻倍。web 与企微现在共用同一进程、同一 `state.db`、同一套 skills/SOUL（根 SOUL 10KB ⊃ t1 4.2KB；企微渠道靠 `channel_overrides` 禁掉 ```cards``` 代码块协议）。

## 🔴 v642 合并后遗症：租户家的「非 config 状态」不会跟着搬
合并入口（把 t1 的 wecom 搬进根实例）时只搬了 `config.yaml` + `.env` + `skills/` + `SOUL.md`。
**漏了两类**，都在 21:38 真机暴露：

1. **配对状态在 `<home>/platforms/pairing/wecom-approved.json`**（不是老的 `<home>/pairing/`，那目录是空的）。
   没搬 ⇒ 老板在企微发消息收到「Hi~ I don't recognize you yet! 配对码 LGZS6E3H」。
   修：`sudo -u hergent env HOME=/root/.hermes HERMES_HOME=/root/.hermes /usr/local/lib/hermes-agent/venv/bin/hermes pairing approve wecom <码>`。
   `PairingStore.is_approved()` **每次调用都重读 json**（`gateway/pairing.py:346`）⇒ 批准后**不用重启网关**，下一条消息即生效。
2. **对话历史在 `<home>/state.db`**（t1：7 会话 / 1507 条 / 2026-09-11→10-20）⇒ 合并后企微新对话写进根实例的 state.db，老的企微上下文成为孤儿（技能、SOUL 都在，只是「昨晚聊到哪」接不上）。

⇒ 以后再做「入口合并」，清单必须包含：`config.yaml`、`.env`、`skills/`、`SOUL.md`、**`platforms/pairing/*.json`**、并按需评估 `state.db` 历史迁移。

---

# v643 磁盘真实构成与清理风险（2026-10-20 21:50 实测）

🔴 **先纠错**：v641 报的「构建残留 2.3G + 备份 1.4G + 旧目录 891M + 安装包 600M」是粗扫估值，**漏掉了最大头**。真实 31G 已用：

| 目录 | 占用 | 是什么 |
|---|---|---|
| `/tmp` | **12G** | 96 个 tar.gz，其中 27 个 `hergent-backup-*.tar.gz`（7-21~7-26 的全站快照，每个 342M）+ `pull.tar.gz` 431M |
| `/opt` | 5.5G | cn-v2 2.3G（assets 672M/25662 文件、backup 1.4G、.git 142M）+ erp 1.8G + erp-prod 872M |
| `/usr` | 3.9G | 系统，不动 |
| `/var` | 3.6G | www 1.5G（updates 567M + landing 442M + hergent.cn 437M）、lib 1.4G（mariadb）、log 632M（journal 528M） |
| `/root` | 2.8G | .cache 623M、.hermes 413M、hergent 257M、两个 setup.exe 409M、$PLUGINSDIR 165M |
| `/swapfile` | 2.1G | **不能动** |

## 各分类的风险判据
- ✅ **`/tmp/*.tar.gz` 最低风险**：放 /tmp 的备份本来就等于没备份（重启即清）。🔴 但**禁止 `rm -rf /tmp/*`**（会删 mysql.sock / systemd-private-* 等运行时 socket）⇒ 按文件名清单删。
- ⛔ **`/opt/hergent-cn-v2/assets`（672M/25662 文件）风险最高，不建议清**：线上目录，rsync 不带 `--delete` ⇒ 每次构建累积。判死活必须做入口闭包（v583 白屏教训：删掉被懒加载 chunk 引用的 hash 文件 ⇒ 点进某页才 404）。600M 收益不划算。
- ⚠️ **`/var/www/hergent-updates`（567M）= 桌面端 electron-updater 自动更新源**（`latest.yml`+历史 exe），**不是安装包残留**。删老版本可能让装旧版的机器更新失败。
- ⚠️ 备份类可裁不可全清：`/opt/hergent-cn-v2/backup/20260514_155901` 1.1G（5 个月前，版本差 90+ 版，回滚不可能用到）；`/opt/hergent-erp/backups/` 474 份日备 1.4G（7-09 起），保留 10 天省 ~1G。风险＝"回溯两周前数据"的能力。
- ✅ **`/opt/hergent-erp-prod`（872M，frappe，2026-06-13）**：6 月那套 Frappe/ERPNext 实验（apps+env+sites），全盘无 systemd/nginx/cron 引用，且 nginx root 只有 `/opt/hergent-cn-v2`、`/opt/static`。删了不影响线上，代价是那套实验环境**不可一键重建**（路线早已废弃）。
- ✅ 零风险小项：`journalctl --vacuum-size=150M`（省 ~380M）、`/root/.cache` 623M（npm/pip 缓存）。
- 🔴 安装包 `Hergent-*-setup.exe`（409M）+ `$PLUGINSDIR`（165M 解包临时）：删了要重装得重新跑一次桌面端打包。

## 结论（估算）
按「/tmp + journal + cache + 5月备份 + erp 备份留10天 + erp-prod」全清 ≈ **省 14G，83% → 约 48%**。其中纯零风险（不动任何线上文件）约 **11G**。

## v643 落地结果（2026-10-20 22:00，方案 B）
脚本 `v643-disk-clean.py`（在服务器 `/root/`，默认 dry-run，`--apply` 才删；白名单前缀 + 硬禁路径 + 逐项打印 + 只追加到 `/root/disk-cleanup-20261020.log`）。

| 阶段 | 内容 | 释放 |
|---|---|---|
| S1 | `/tmp` 深度 1 的压缩包（`.tar.gz/.tgz/.zip/.tar`）+ `/tmp/hergent-backup/`，mtime ≤ 2026-09-20 | **10.27G / 176 项** |
| S2 | `journalctl --vacuum-size=150M` | 528M → 224M |
| S3 | `/root/.cache/{pip,uv}` | 550.7M |
| S4 | `/opt/hergent-cn-v2/backup/20260514_155901` | 1014.9M |
| S5 | `/opt/hergent-erp/backups/` mtime < 2026-10-10（460 项，含旧 tenant_N_2026-08-*.db 及其 -shm/-wal） | 693.5M |

**磁盘 31G/83% → 19G/49%（可用 6.5G → 20G）**。零服务中断：hergent-erp / hermes-gateway / nginx / mariadb 全 active，`hergent.cn` 200、`/api/health` 200、`:18765` 200，`api_server`+`wecom` 双 connected。

保留（未动）：`/opt/hergent-cn-v2/assets` 25662 个文件、`backup/pre-v548-20261017`(336M)、`backup/快消版-20260509`、`backup/20260514_hergent_v1`、erp 日备 10-10 起的 11 天、`/var/www/hergent-updates` 567M。

## 仍可再省（未做，等用户决定）
- `/opt/hergent-erp-prod` 872M（6 月 Frappe 实验，无引用）→ 方案 C
- `/opt/hergent-cn-v2/assets` 672M / 25662 文件（需入口闭包校验，风险最高）
- `/tmp` 剩 1.5G：`v317-preview` 201M、`v381-src` 110M、`v325-shadow-*` 78M×2、`v312-shadow` 78M、`v369sh` 48M、`shadow_v386` 48M（8-9 月的构建影子目录）
- `/root` 安装包 409M + `$PLUGINSDIR` 165M、`/root/hergent` 257M

## v643b 第二轮（22:05）—— 用户一句「清」，把剩余低风险项也清了
脚本 `/root/v643b-disk-clean2.py`（显式清单，无通配符；FORBID + KEEP 双保险）。释放 **2.69G**：

| 内容 | 量 |
|---|---|
| `/opt/hergent-erp-prod`（6 月 Frappe 实验，删前确认无进程/无 systemd 单元在用） | 588M |
| `/tmp` 18 个构建影子/预览/恢复目录（`v317-preview`、`v381-src`、`v*-shadow*`、`permfix_shadow_*`、`v362_prod_*` 等） | ~1.0G |
| `/tmp` 27 个一次性测试库与旧代码副本（`test-*.db`、`t1test.db`、`tenant_1_import_bak_*`、`v.zip` 等） | ~330M |
| `/root` 旧安装包 `Hergent-*1.0.86.exe`(408M) + `$PLUGINSDIR`(165M，NSIS 解包临时) + `/root/hergent/` 旧包(176M) + `.npm`(94M) | ~843M |

**磁盘 19G/49% → 16G/41%，可用 20G → 23G。** 服务全 active、站点与接口 200、企微与 api_server 均 connected。
保留（刻意没删）：`/root/hergent/hermes.tar.gz`（84M，Hermes 引擎打包运行时，服务器上唯一副本）、`/tmp/hergent-erp-bak-20261014-154628`（10-14 源码快照）、`/tmp/real_order.xlsx` 等业务表格、前端 assets 25662 文件、`/var/www/hergent-updates` 567M。

⚠️ 教训：把要删的目录同时写进 FORBID 会导致**静默跳过**（`/opt/hergent-erp-prod` 第一次干跑就因此被跳过，只报「禁止删除」一行）⇒ FORBID 只放「绝不能删」的父目录，别放待删对象本身。

## 两轮合计
磁盘 **31G/83% → 16G/41%**，共释放 **15.2G**。仍占大头：`/opt/hergent-cn-v2` 1.3G（assets 672M + .git 142M）、`/opt/hergent-erp` 1.1G（日备 11 天 + 租户库）、`/var/www` 1.5G、`/root/.hermes` 411M。

## 🔴 v644 真实价格（2026-10-20 老板本人告知 + 官方口径核对）
- 这台机器 = 阿里云 `cn-heyuan`（华南河源）`ecs.e-c1m2.large` = **2核4G，经济型 e 实例**，`i-f8zgucsi9gk2ep12gmy5`。
- **老板实付口径：原价 714 元/年，现特价 378 元/年**（v641 我按活动价 819/年估的，偏高，作废）。
- 官方参考：经济型 e 2核4G 包年 440.64 元/年、按量 0.225 元/时；活动页含带宽 1M 599.93 / 2M 834.53 / 3M 1089.53。⇒ 714 应含带宽+系统盘。
- 🔴 **经济型 e = 共享 CPU、无性能 SLA**（官方明确"高峰时段可能出现性能抖动"）。这是这台机器「一忙就白屏」的隐性根因之一，比内存更隐蔽 —— 之前 v639/v640 只查了 cgroup 内存，没查 CPU 争抢。
- 单价换算：378 元/年 = **31.5 元/月/台**。⇒ **每客户一台独立机**的商业模型成立（一机多租户省下的钱 << 工程复杂度与故障域代价）。

### 单客户服务器成本（按一客户一台算）
| 口径 | 元/年/户 | 元/月/户 | 若收 500 元/月，服务器占比 |
|---|---|---|---|
| 特价 378 | 378 | 31.5 | **6.3%** |
| 原价 714 | 714 | 59.5 | 11.9% |
| 同规格 u1（独享 CPU，199 活动价限购 1 台） | 199~600 | 16.6~50 | 3.3~10% |

⚠️ 必须确认三件事（没确认前不要按 378 做多年计划）：① 378 是否**首年新购专享**、续费是否回 714；② 是否有**同主体限购**（阿里云 99/199 计划都是 1 台/主体，且续费不得变配）；③ 续费是否要求**配置锁定**。

---

# v645 实测：单户真实资源与并发上限（2026-10-20 22:15-22:35）

方法：在演示租户 t10 的独立出口 `:18810` 打真实请求（**不碰老板根实例**，压测期间站点 78ms / API 60ms / 两通道 connected）。脚本 `/root/v645-concurrency.sh`、`/root/v645b-load.sh`。

## 单户内存曲线（t10 cgroup memory.current）
| 阶段 | 值 |
|---|---|
| 长期静置 22 天 | 223MB（**内核回收后的读数，不是真实常驻**） |
| **刚启动** | **282MB** ← 这才是"没人用但活着"的成本 |
| 首次对话后 | 313MB（+31） |
| 连续 3 轮后 | 317MB |
| 串行 3 条后 | 319MB |
| 并发 3 条后 | 322MB |
| 6 并发后 | 330MB |
| 一次读表（4.8 万 token）后 | 332MB |

🔴 **内存不随使用量膨胀**：稳态 323MB，之后每轮只 +2~3MB。`state.db` 文件会长，但 RSS 不涨。⇒ 之前"用久了越来越大"的假设作废。

## 并发（单户内并发 N 个 ≡ N 户同时用）
| 并发 | 单请求耗时 | 窗口 CPU（2核=200%） |
|---|---|---|
| 1 串行 | 0.90 / 0.99 / 1.41s | ~22% |
| 3 | 1.30 / 1.30 / 1.42s | ~30% |
| **6** | 1.72–2.15s | **50.2%** |

🔴 **CPU 有 4 倍余量**，延迟退化是排队不是算力（网关绝大部分时间在等 LLM）。**内存先撞墙，CPU 不是瓶颈。**
⚠️ 但这是共享 CPU 的经济型 e 实例，厂商明说高峰性能抖动 ⇒ 50% 是宿主机空闲时的数，生产高峰可能翻倍。

## 容量（4G 机）
available 1677MB；系统底座 ≈450MB；老板自用（根实例 349 + 后端 262）≈611MB。
(1677−400 余量)/323 = **3.9 户** ⇒ **老板 + 3 个客户**。v641 估的"1.6 户"作废（合并入口省 868MB 抬上来的）。

## 🔴 token 成本（首次量化）
- 系统提示固定 **11,258 tokens/轮**（技能索引+工具定义全在里面）
- 一次**失败**读表重试 = **48,330 tokens**（3 次尝试 × 1.6 万）
- 模型 `deepseek-v4-flash`（$0.03/M 输入 · $0.06/M 输出 · $0.01/M 缓存 ≈ 0.21 元/M 输入）
- 20 轮/天 ⇒ 22.5 万 token/天 ⇒ **1.4 元/月**；+10 次读表/天 ⇒ **4.5 元/月**

## 总成本（结论）
| 方案 | 元/月/户 | 收 500/月占比 |
|---|---|---|
| 一客户一台（378/年） | 31.5 + 3 = **34.5** | 6.9% |
| 一机四户分摊 | 7.9 + 3 = 10.9 | 2.2% |

⇒ **省 23 元/月换 4 倍故障域，不划算。接客户就新开一台。**

## 🔴 两个新问题（重要）
1. **闲置租户停不掉**：`ensure_running()` 的跳过条件是 `not enabled_channels and not _has_api_server`；t10 配了 `api_server` ⇒ 永远不满足 ⇒ 停掉 75 秒后被保活拉起。⇒ **每接一个客户，282MB 就是永久固定支出**。要省必须加"休眠"（如最近 N 天无活动就跳过保活）。
2. **镜像开新客户会带走老板数据**：`erp.db`（客户名/进货价/返利率）+ 根 `state.db`（全部对话）+ `.env`（key）⇒ 走镜像必须配脱敏脚本，不能开机就卖（跨租户铁律）。

## 落地清单（接第二个客户）
镜像 → 脱敏脚本 → 改域名/租户名 → 关老板实例起客户实例。**首次要把"镜像+脱敏"这条路走通（唯一需要开发的），之后每客户 ≈50 分钟。**
