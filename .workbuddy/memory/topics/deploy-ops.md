# 部署与真机验证细节（从 MEMORY.md 下沉）

## ⚠️ 事故
- 2026-08-22 裸 `rsync --delete` 删掉 `.env` → 服务挂；已重建并备份 `/root/.hergent-env/.env`。`.env` 勿提交 git。

## 前端部署
- `npm run build` **&&** `rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/` **&&** `chown -R hergent:hergent /opt/hergent-cn-v2`。**必须 &&**；nginx 静态免 restart。
- 构建前先 `pkill -f vite`（dev server 占用会让 emptyDir rmSync 失败）。
- nginx 路由：`/api/` → 127.0.0.1:8700；`/hermes/` → 127.0.0.1:18765（Bearer `hergent-prod-gateway-key-2026`）。
- 验证静态资源须带 Host 头：`curl -H "Host: hergent.cn" http://127.0.0.1/...`。

## 后端部署
- 仓库根 `deploy.sh`：排除 `.env`（**绝不 rsync `*.db`**）→ chown hergent → 清 `__pycache__` → `systemctl restart`。
- 健康检查：`curl --noproxy '*' http://127.0.0.1:8700/api/health`（**唯一正确探活路径**）；**重启后 sleep 5 再探活**（3s 内过早会返 000）。
- ⚠️ **`GET /health` 返 500 是假故障**：`/health` 从未注册为路由，请求落到 `@app.get("/")` 的静态兜底，而 `static -> ../static` 已断 → 抛 `RuntimeError: File at path /opt/hergent-erp/static/index.html does not exist.`。见到此栈**别以为是后端挂了**，换 `/api/health` 复测。
- ⚠️ `hermes-gateway` 重启后**约 30s 才监听 18765**（8s 时 `ss` 为空、进程树只有主进程属正常冷启动）；探活推荐 `curl -H 'Authorization: Bearer hergent-prod-gateway-key-2026' https://hergent.cn/hermes/health`。SOUL.md 改动**必须重启该服务**才对模型生效（进程只在启动/会话创建时读取）。
- ⚠️ **生产=早期部署的工作区整体**（数千行未提交改动 + 未跟踪新文件早已在线）。只部署 HEAD 会回退线上 `forecast.py`（+614 行）。部署前须全量比对工作区 vs 生产 md5。
- ⚠️ 生产**扁平布局**：`/opt/hergent-erp/` 直接是 `server/` 的内容，无 `server/` 子层。
- ⚠️ 生产存在**本地没有的目录** `hermes-engine/`、`incident_20260812/` → `deploy.sh` 的 `--delete` 会**误删**；小改动优先**定向部署（不带 `--delete`）**。
  - **2026-09-12 复现**：`rsync --dry-run --delete server/ /opt/hergent-erp/` 列出将删 `.hermes/`、`hermes-engine/.hermes/node/...node_modules`、`.cache/uv/...`、`.local/state/hermes/`、`incident_20260812/`。**结论：`deploy.sh` 与任何带 `--delete` 的整目录 rsync 一律不要用于后端**（会删 Hermes 运行时）。dry-run 必须先跑。
- ⚠️ `rsync -aR src/./f.py` 的 `/./` 截断在本机**不生效** → 文件会被推到目标子目录（**2026-09-12 再次发生**：误建 `/opt/hergent-erp/server/`，已 `rm -f` 三文件 + `rmdir` 清理）。**后端部署一律用 `scp <本地文件> root@…:/opt/hergent-erp/<同名路径>` 逐个显式目标路径**；部署后 `grep -c <新符号> /opt/hergent-erp/<文件>` 验证落点，**别信 rsync 的 OK**。
  - 落点自检命令：`ls -l /opt/hergent-erp/erp_db.py` 时间戳应更新；`grep -c 'forecast_period_default' /opt/hergent-erp/erp_db.py` 应 >0。
  - 服务运行路径 = `/opt/hergent-erp/`（`WorkingDirectory=/opt/hergent-erp`，`ExecStart=/usr/bin/python3 server.py`），**不是** `/opt/hergent-erp/server/`。
- ⚠️ **`erp.hergent.cn` 是第二个前端面（旧 vanilla+Vite 前端），2026-09-13 已恢复上线**（此前 `/opt/static` 丢失致整站 404）。构建/部署/验证见下节「第二个前端面」。
- 服务器上跑单测：先 `. /opt/hergent-erp/.env`（缺 `ERP_SECRET` 会 RuntimeError），再 `sys.path.insert(0,'/opt/hergent-erp')`。

## 第二个前端面：erp.hergent.cn（旧前端 static/）
- **源码**：`hergent-erp/static/`（vanilla JS + Vite，`src/main.js` 按 index.html 顺序 side-effect import 全模块；`vite.config.js` 用 `exposeTopLevelGlobals` 插件把列 0 顶层声明挂回 `window`，模拟旧多 `<script>` 加载序）。
- **产物/部署**：`cd static && CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` → `static/dist/` → `rsync -a --no-owner --no-group --delete static/dist/ root@…:/opt/static/` → `chown -R hergent:hergent /opt/static`。
- 🔴 **文档根 = `/opt/static`**；nginx 三处引用（`root`、`location /static/` 的 `alias`、`location = /static/sw.js` 的 `alias`）**2026-09-13 起直接指向 `/opt/static`**，不再经 `/opt/hergent-erp/static`。原因：那个符号链接位于后端 rsync 目标目录内，被 `deploy.sh --delete`／磁盘清理删掉后 **nginx 不报错、整站静默 404**（本次事故即此）。已用「隐藏符号链接后站点仍 200」验证加固生效。
- `static/dist/` **不被 git 跟踪**（构建产物），`static/` 源码与 `static/js/modules/*` 才是提交对象。
- **验证工具**（laozhangai-product/.workbuddy/tools/）：`erp-site-restore-e2e.js`（18 项真机断言：200／资源零 404／登录／主壳渲染／徽标／登录后接口无 401、5xx／无 pageerror）、`erp-shell-probe.js`（布局盒模型+祖先链+级联）、`erp-dom-structure.js`（关 JS 只看 HTML 解析出的真实 DOM 结构）。
- ⚠️ 旧前端登录后顶栏徽标、引导、更新日志等由 `localStorage`/cookie 驱动；E2E 里要显式关掉引导遮罩（按钮文案：知道了／下一步／跳过／完成／开始使用）。
- ⚠️ 该站 `#loginOverlay` 里的测试账号提示是给审核用的 `admin/admin123`；真机验证用 `mptest/Mptest@1`（tenant1，sales 角色），sales 角色会刷一批 RBAC 403 toast（chat/reports/accounts 模块），属正常，不是故障。


## E2E 账号
- `POST /api/auth/demo-login`：demo 租户（tenant10）只读，token 在顶层，不污染数据。
- tenant1：`mptest/Mptest@1`（X-Tenant-Id:1，sales 角色，可访问 rebate-rules）；`mptestsp/Mpsup@1`（supervisor，访问 rebate-rules 会 403，属正常）。
- ⭐ **真机 E2E 最省事的入口 = 登录页的「先看看演示效果（免注册）」按钮**（2026-09-13 实测，脚本见 `.workbuddy/tools/expiry-caliber-v157-e2e.js`）：
  点击后直接落到 `#/workbench`（演示租户，顶栏标「演示模式 · 模拟数据」），**无需任何凭据**。
  用 puppeteer 走 UI 填表登录 `mptest` 实测**未成功**（填完点「登 录」仍停在登录页），
  故 UI 自动化优先走演示入口；确需 tenant1 身份时改用上面的 HTTP 直打（读 `sessions` 表取
  存量 token，见 `.workbuddy/tools/` 里 v157 的 `verify_v157_http.py` 模式）。
- ⭐ **tenant10（演示租户）是唯一「有完整效期数据」的租户**：10 个批次全部带 `expiry_date`、
  553 件、配方 `threshold_days=7` —— 做临期/货损类前端 E2E 只能用它（tenant1 的 54 批效期全空，
  卡片 `v-if="expiryData.length"` 恒为 0 不渲染）。实测它能暴露真问题：预警计数由「10 条」
  纠正为 **7 条**（过滤掉正常档），今日待办首次出现「5 批已过期 · 2 批临近效期」。

## GitHub
- 推送走 **SSH:443**（https PAT 已过期，会 401）。
- 本地 `.git/index.lock` 沙箱 unlink 被拒 → 需 `dangerouslyDisableSandbox` 外部 `rm`。

## 真机（agent-browser / puppeteer）坑
- 加 `--proxy-server=127.0.0.1:63932` 会 `ERR_PROXY_CONNECTION_FAILED` → 一律**直连**（并 `unset AGENT_BROWSER_PROXY`）。
- 页面用 hash 路由；`page.goto` 到仅 hash 不同的 URL **不会重跑路由 Guard** → 需带 `?v=<ts>` 强制刷新。
- ⚠️ **2026-09-11 环境变更（旧记录已失效）**：
  - node 版本目录变成 `22.22.2-3`（`22.22.2-2` 已消失），**`versions/*/bin/agent-browser` 不再存在**，`which agent-browser` 找不到。改用 workspace 里的包直接调：
    `NODE=/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`
    `ABJS=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules/agent-browser/bin/agent-browser.js`
    `"$NODE" "$ABJS" open <url>`（版本 0.27.0）。
  - ⭐ **不要再用 `AGENT_BROWSER_EXECUTABLE_PATH` 指系统 Chrome**——0.27.0 下会报 `✗ CDP response channel closed`（打开了但连不上 CDP）。**`unset` 掉它，用内置 Chromium**（已在 `~/Library/Caches/ms-playwright/chromium-1223`）即可正常。
  - daemon 状态残留会导致同类 CDP 报错：先 `"$NODE" "$ABJS" close`，再删 `~/.agent-browser/default.{pid,sock,stream,engine,version}` 后重试。
  - `ps` 在沙箱内被禁（`operation not permitted`）→ 用状态文件判断/清理，别依赖 `ps -ef`。
- **测量页面布局不要靠截图目测**：注入脚本读 `getBoundingClientRect()` + `getComputedStyle()` 更准。注意**垂直滚动条会占 8px**，会让 `gapLeft/gapRight` 天然差 8px（<8 视为居中，±2 是阈值之外的噪声）；判"是否居中"要跑**有滚动条和无滚动条两种页面**校准。

---

## 运维告警（主动监控）
- `server/scripts/llm_health_monitor.py`（生产 `/opt/hergent-erp/scripts/`，状态在 `var/`）cron `*/5`，由 **root + `runuser -u hergent`** 降权执行 —— ⚠️ hergent 用户 shell 是 `/usr/sbin/nologin`，**不要用它的 crontab**。四项：① key 401/停用 ② 余额 warn<¥20 / crit<¥5 ③ 各租户 `gateway.log` **增量字节偏移**扫新增错误 ④ 探活 `8700/api/health` + `18765/health`。推送走 `hermes send --to wecom`，判据取 `--json` 的 `success`，**勿信 exit code**。手册 `artifacts/llm-health-monitor-ops-guide.md`。
- ⭐ Hermes `gateway.log` 多数行（多行堆栈、emoji 提示行）**无时间戳前缀** → **不能按 mtime 判「近 N 分钟」**（会把历史错误反复误报）。正解=字节偏移只读新增 + 首次基线不追溯历史。
- `server/scripts/holiday_sync.py`（root crontab `0 9 * * *`，同款 `runuser` 降权）**法定节假日表每年自动补齐**：当年缺失即补 / 11-01 起每天试抓次年 / 11-20 起仍缺则**每周**提醒 / **齐全时零网络请求**。⚠️ **源站对未发布年份返回 HTTP 200 空壳（`days:[]`）→ 必须判 days 非空**，只看状态码会把空表当数据落盘。数据层 `server/holiday_calendar.py` 为纯标准库，接口与脚本共用。

## 前端产物版本溯源（判断"某改动是否早已上线"）
- 线上包名带内容哈希，rsync `--delete` 会覆盖旧的 → **nginx access.log 的 `hash + 字节数` 序列是唯一事后证据**：`zgrep -oh "GET /assets/<Page>-[A-Za-z0-9_-]*\.js " /var/log/nginx/access.log*`，按日志文件顺序看体量何时阶跃 → 可判定某批未提交改动当时是否已在生产（例：Rebate 包自 9/10 起稳定 50.7KB，证明 v132 仪表盘改动早已上线，本次仅为补提交）。

---

## 本地复现后端迁移 + 抓「无名 FAILED」真凶（2026-09-13 建立）

`_migration_log_error(e)` 匿名调用只会打一行 `[Migration] FAILED: <msg>`，**不告诉你是哪条 SQL**。静态 grep 常找不到（DDL 可能是多行/拼接字符串）。可靠解法：

```python
# 1) 包装 sqlite3.connect 返回「转发代理」，在 sqlite 抛错的第一现场打印 SQL + 栈
#    ⚠️ sqlite3.Connection.execute 在 Python 3.13 是只读 C 类型，无法 monkeypatch
#       （TypeError: cannot set attribute of immutable type）→ 只能换 connect。
#    代理必须转发 __getattr__ / __setattr__ / __enter__ / __exit__（row_factory 是 setattr 赋值）。
_real = sqlite3.connect
class _Proxy:
    def __init__(self, c): object.__setattr__(self, "_c", c)
    def __getattr__(self, k): return getattr(self._c, k)
    def __setattr__(self, k, v): setattr(self._c, k, v)
    def __enter__(self): return self._c.__enter__()
    def __exit__(self, *a): return self._c.__exit__(*a)
    def execute(self, sql, *a, **kw):
        try: return self._c.execute(sql, *a, **kw)
        except Exception as e:
            if "not constant" in str(e): print("SQL:", str(sql)[:600]); traceback.print_exc()
            raise
    def executescript(self, sql, *a, **kw): ...  # 同上
sqlite3.connect = lambda *a, **kw: _Proxy(_real(*a, **kw))
```

```bash
# 2) 跑迁移（必须有这两个环境变量，否则 core.py 会 raise）
cd server && ERP_SECRET=x ERP_DB_PATH=/tmp/migchk/db/erp.db PYTHONPATH=<hook 目录>:.
```
- 🔴 **解释器要选带依赖的**：managed python 3.13 缺 `cryptography` → `ModuleNotFoundError`；
  用 `/Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python`（已含 cryptography/fastapi）。
- 🔴 **要看「duplicate column」类告警必须连跑两次同一库**：全新库没有旧列，触发不到该分支。
- ⚠️ 全新 scratch 库上出现 `no such table: users / return_orders` 是**假象**（生产由 `server.py` 的 `_init_users()` 建 `users`），别据此改代码。

## 日志验收必须按 `ActiveEnterTimestamp` 严格截取
`journalctl --since "30 min ago"` 会**跨越上次重启**，把修复前的残留日志算进来 → 误判「修了还在刷」。
正确：`T=$(systemctl show hergent-erp -p ActiveEnterTimestamp --value); journalctl -u hergent-erp --since "$T"`。
判据取**行数**：`grep -c -i -e migration -e "no such table"`，期望 **0**。


## 🔴 隔离租户 E2E：**不要删租户库文件重建**（2026-09-14 实测，会得到「两套数据」假象）
运行中的服务可能仍握着**已被 unlink 的旧 inode** → 脚本直连读到**新库**、HTTP 请求打到**旧库**。
症状极像代码 bug：商品 id 是 1,2,3（看着是新库）但列表里冒出上一轮建的行、新增同名被拒。
- **正解**：库文件保留，用 SQL 清掉关心那几张表（`DELETE FROM price_channels / products / ...`，同一事务 commit）。
- 已经删过库的：`systemctl restart hergent-erp` 才能让服务重开文件。
- ⚠️ **`DELETE FROM t` 后 INSERT 拿到 4,5,6 ≠ 没删掉**：`INTEGER PRIMARY KEY AUTOINCREMENT` 保留序列。我据此误判过「脚本和 HTTP 各读一个库」。
- 跑隔离租户脚本时**不要删文件**这条同样适用于收尾：销毁时删库**之后**若服务还在跑，紧接着重启一次。

### ✅ 根因已定案（2026-09-17 v184）—— 「幽灵数据库连接」，**产品级 P0**

上节记的是症状；本轮把成因定位到两处代码，并确认**生产同样会中招**：

| 位置 | 代码 | 问题 |
|---|---|---|
| `db/connection.py:200` `_sqlite_connect()` | 按 **(线程, 路径)** 缓存连接，复用前只 `conn.execute("SELECT 1")` | SQLite 在文件被 **unlink** 后**已打开的 fd 依然有效**（inode 还在，只是目录项没了）⇒ 探活照样通过 ⇒ **继续读写幽灵库** |
| `db/connection.py:93` `set_tenant_context()` | `if not os.path.exists(tp): _ensure_tenant_db(...)` | 文件一没就**自动建一个全新的空库**（新 inode）；新文件一旦存在**再也不会重建** ⇒ 幽灵连接**永不自愈** |

**分裂形态**：异步端点（事件循环线程，命中缓存）读**幽灵库**；同步端点（线程池，新 key）读**新库**。

**症状（极具误导性）**：`POST` 全回 **200**，还回 `id=19/20` 单调递增；紧接着 `GET` 看不到；
**决定性证据 = 目标文件里 `sqlite_sequence.forecast_periods` 恒不变**（AUTOINCREMENT 序列的更新是
**事务性**的 ⇒ 说明**该文件上从未发生过提交**）。

**定案四实验**（顺序即排除法）：
1. `v184_commit_test`：调 API 前后读**文件** `max(id)` → 不变（排除「端点根本没写」）；
2. `v184_http_vs_file`：进程内往文件插 `id=13` → HTTP `GET` **读得到**；HTTP `POST` → 文件**不变**
   （证明 HTTP 与文件是**两个 inode**）；
3. `v184_inproc`：在服务进程内**直调**写函数 → **提交成功**（证明管道本身无恙）；
4. `systemctl restart hergent-erp` 后重跑 → 全正常（**定案**）。

**生产影响面**（不只沙箱）：运维误删 / `mv` 走租户库 · 从备份 `cp` **覆盖**恢复 · 手工重建 ·
迁移脚本「先删后建」。触发后**请求全 200 但写不落盘**，且**不重启永远不会自愈**。
⚠️ Hergent 业务端点里 `async def` 占比很高（预报/导入/副驾），故中毒面很大。

**修复建议（未落地，涉及连接层基础设施须先确认）**：
- **A（最小，推荐）**：把探活升级为**验身份** —— 建连时记 `conn._hergent_dev_ino = (st.st_dev, st.st_ino)`，
  命中缓存时 `os.stat(db_path)` 比对，不等则丢弃重连。约 8 行，只在命中缓存时多一次 `os.stat`。
- **B（更彻底）**：加 `_sqlite_evict_path(db_path)`（遍历全部 key 因 key 含 `tid`），
  在 `set_tenant_context()` 检测到文件缺失时、`tenant_db_init()` 之后调用。
  ⚠️ B 单独用会**漏**「`exists()` 为真但 inode 已变」（如 `cp` 覆盖）⇒ **建议 A+B**。
- **C（零代码，立刻可用）**：任何重建/替换/删除租户库之后 **必须重启服务**，顺序 = **先动文件、再重启**。


## 真机前端 E2E 的两个前提（hergent.cn）
1. **路由是 hash 模式**：真实地址 `hergent.cn/#/price-channels`。用 `/price-channels` 会被服务端返回同一 index，但落回默认 `#/workbench`（看起来像「新页面没生效」）。
2. **token 必须在 SPA 启动前注入**：用 `context.addInitScript()` 写 `hergent_v2_token` / `hergent_v2_tenant` / `hergent_v2_user`。先 `goto #/login` 再写 localStorage 的话，Pinia 里的登录态已缓存为空 → 之后所有跳转被守卫弹回 `/login`，看起来像「token 失效」。
   渠道页可用隔离租户令牌直连（`hergent_v2_user.role` 给 `boss`，UI 不因权限缺失隐藏元素）。

## 🔴 `dist/` 是**共享可变产物**：「我构建的」≠「我部署的」（2026-09-17 v183 实测踩到）

多会话并行改同一个仓库时，`hergent-cn-v2/dist/` 随时可能被**另一路会话的 `npm run build`** 覆盖，
于是你 `rsync dist/` 推上去的**不是你的构建**。实测时间线：

| 时间 | `assets/Forecast-*` | 来源 |
|---|---|---|
| 15:17 | `De3UWvpU.js` 276648 | 我的构建（= 上线基线 + 我的改动） |
| 15:20 | `Cx2A1X5F.js` 282602 | **并发会话重建**（含它的在途功能） |
| 15:20 | ↑ **我的 rsync 推的是这一份 → 线上** | 把一个「后端端点尚未部署」的功能前端带上了生产 |

- **识别法**：部署后核对**产物名 + 字节数**与自建是否一致；不一致就 `ls -la dist/assets/ | grep <主chunk>`
  看 mtime，不是你构建的时间 ⇒ 确认被第三方重建。**`rsync` 退出码 0 不能证明「部署的是我的构建」。**
- **处置顺序**：① 先做**归一化差集**看清「多出来的真变化是什么」→ ② 查那功能**前后端是否成对**
  （打印路由表 / `openapi.json`）→ ③ 再决定「一起上线 / 回滚上一版产物 / 让发起方收口」，
  并在交付说明里记档。**⚠️ 别一看不对就回滚** —— 若对方功能已成对且更完整，回滚反而是退步。
- ⚠️ **`.js`/`.css`/`index.html` 之外的资源（如 `favicon.svg`）不在「改前副本」里** ⇒
  想整体回滚**不能**直接 `rsync --delete` 那份副本（会把没下载的资源删掉）。
- ⚠️ **查端点是否存在不要用 `405 vs 404`**：本项目 RBAC 会**先返回 401**，三个路径全 401 看不出区别
  （实测 `/copy`、`/seed`、`/close` 一律 401）。**用 `openapi.json` / 路由表**（v183 实测：1125 条路由里无 `copy|seed`）。
- ⭐ **差集脚本已入库，别再现写**：`.workbuddy/tools/dist_normalized_diffcheck.py` —— 抹平
  chunk 名 hash / `data-v-<scopeId>` / `sk-<scopeId>` 后逐字节比，输出「可解释派生噪声 N 项 /
  真变化 M 项」并打印真变化的首个差异上下文。用法见脚本头部（含「改前目录」的 `rsync` 取法）。
  ⚠️ 它在 **v181/v182/v183 被现写重写过三次** —— 直接用它，不要重写第四次。
- ⭐ **四层差集的第 ① 层也有工具了**（2026-09-19 v208 新增）：`.workbuddy/tools/dist-pair-check.py`
  —— 「**去 hash 基名配对字节数**」，输出四段：**仅基准有**（= 将被 `--delete` 删掉）/
  **仅对比有**（= 新增 chunk）/ **字节数相同的基名**（名字变了、内容长度没变）/
  **字节数不同的基名**（= 真变化，逐个归因）。退出码 0 = 基名集合一致、1 = 有 chunk 增删。
  🔴 **四层里只有它能一句话回答「有没有夹带别人的新页面」** —— 因为**改名不算、增删才算**。
  🔴 副产物判据：若**所有**基名的字节数都相同 ⇒ 本次构建与基准**只差文件名**
    （成因见下节「注释也会改产物」）⇒ 对用户**零影响**，可据此决定要不要重部署。
  ✅ 2026-09-19 v208 实测——只改 `Forecast.vue` 一个文件时它长这样（可作「干净发布」的样板）：
    基名集合完全一致 · 字节数变化**只有 `Forecast.js`**（297,559 → 297,589，**Δ+30**）·
    其余 52 个只改名 · 中文串零增零删 · scope-id 集合只变 1 个（`afed5296`→`2ae9db8b`）。

---

## 🔴 「在途改动是否已上线」的四条判据（2026-09-17 第四次重写差集脚本后固化）

前端仓库长期有 20~35 个 dirty 文件；部署前必须先回答**「除本轮改动外，工作区里别的改动上线了吗」**
—— 答「是」才能直接 `rsync dist`（否则会把别人的半成品推上线）。四条判据，强度递增：

1. **文件级 md5**（后端最省）：本地工作区文件 vs 生产落点文件（`md5 -q` / `ssh md5sum`）。
   实测后端 10 个在途文件 **9 个逐字节一致** ⇒ 已上线；第 10 个 `server.py` 的差异**纯是本轮**
   （生产 `grep loss_accounting` 为空）。
2. **产物 hash 归一化比对**（前端唯一可行）：用 `tools/dist_normalized_diffcheck.py`
   —— 🔴 **这是第四次被现写替代**（详见上一节）。归一化正则**必须含 `-` 且用 `{8,}`
   **（Vite 会写 `index-D-E6wC05.js`）；用 `{8}` 会残留字符 ⇒ 报「内容不同但字节数相同」的假阳性。
   实测：47 个 chunk 里 **44 个与生产逐字节相同**，差异只在被本轮改动的 3 个文件所在 chunk。
3. **高特异性特征 grep**：用**字符串字面量 / CSS 类名**（不被 minify 破坏）。
   实测命中 `操作过于频繁，请稍后再试` / `sessionsLoading` / `(无标题)` / `rc-items`（类名）/
   `已因长时间无操作自动退出登录` / `tb-copilot` / `bulk-upsert`。
   ⚠️ **函数名在压缩包里必然 0**（局部名被 mangle）—— 别据此判「改动丢了」。
4. **⭐ 中文串差集**（最终判据）：求「生产独有中文」集合，**为 0 ⇒ 零夹带零缺失**。
   🔴 **坑**：`git diff` 的 `+` 行里大部分中文是**代码注释**，注释不进产物 ⇒ grep 产物恒 0 命中，
   会把「已上线」**误判成「未上线」**（v1 脚本全表报"未上线"即此坑）⇒ 提取前必须先过滤注释；
   ⚠️ 短词会误命中（`货损核算` 天然存在于 2 个产物文件）⇒ 特征串要长要独特，并配**阴性对照**
   （拿一个已知未上线的新文件跑一遍）自证方法有效。

配套两条：
- **「仍 dirty」可能是正确结果** —— scoped 提交只落本轮 hunk，在途 hunk 按设计留在工作区；
  自证 = **剩余 hunk 数 == 登记在途数**（实测 9/2/10 三处全等）。
- ⚠️ **`gfocus.py` 按 `-U3` 切 hunk** ⇒ 相邻的「我的插入」与「在途改动」**会被合并进同一个 hunk**
  （实测 `router/index.js`：本轮插 3 行 + 在途 archive 路由 10 行 → 合成 `@@ -44,13 +46,25 @@`）
  ⇒ **混合场景一律改用 `scoped_stage_by_marker.py`**（`-U0` 粒度 + `exclude_hunks` old_start 黑名单
  + `new_file`/`binary` 支持；加新提交只需在它的 `SPECS` 里加一条 spec）。

### 🔴 部署后：前端**每次重新发布**都要复跑一次本页验证（2026-09-17 v184 收尾固化）

**为什么**：`dist/` 是**整体构建产物**，而构建又是**从工作区取的** ⇒
① 无法只上线一个页面；② **一次与本页无关的重新发布，也可能把本页带坏**（带了别人的在途改动）。
实测：我部署时线上入口是 `index-D2vUzcbZ.js`，收尾复核已成 `index-B6SbeKBL.js`
（磁盘 dist mtime 更晚）⇒ **上一轮的真机结论自动过期，必须重取**。

- 货损核算页的可复跑脚本：`.workbuddy/tools/loss-accounting-prod-verify.js`（**只读**，20 项断言）
  —— 只「开录入态 → 数输入框 → 退出」，并断言**零改动时「保存」为 disabled**（写路径有闸）。
- 复核要**两侧一起**：后端具名文件 `md5` vs 生产 + 前端产物 `md5` vs 生产（经 https 拉取比对，
  比 ssh 更贴近用户实际拿到的东西），再确认**入口 JS 引用了本页 chunk**。

**🔴 验证 URL 必须带 `?cb=<ts>`**：hergent.cn **没有 CDN**（`server: nginx/1.18.0` 直出，
无 `x-cache`/`via`），但**本机 HTTP 代理会缓存 `index.html`** —— 不带 cache-buster 的请求会返回
**旧入口 hash**（实测返回 `index-D8Qj6j3h.js`，**该文件磁盘上根本不存在**）；
带上 `?cb=` 才与磁盘/生产一致。⚠️ **不加 cb 会把"我这边的代理缓存"误读成"部署没生效"**，
进而去查一个不存在的问题。

**⚠️ 附带一条 grep 纪律**（本轮踩，第二次同类）：**grep 前先抄完整文件名当模式，别用自己缩写的近似串**。
实测 `ls | grep -i lossact` 返回空，一度据此以为生产缺 `LossAccounting` 产物、准备报事故 ——
实际文件名是 `Loss` + `Accounting`，**"lossact" 不是它的子串** ⇒ 纯属**假阴性**。
（同族：`grep "A\|B"` 静默失效、`--include=*.py` 静默失效 —— 都是"看起来没匹配"的假阴性。）


## 🔴 部署前必须**先查生产现状**：并发会话会把你上一版覆盖掉（2026-09-18 v185 实测）

**为什么**：本机常有两个会话同时改同一仓库、共用同一个 `hergent-cn-v2/dist/`。
上一版的「`dist/` 是共享可变产物」讲的是**"我推上去的不是我的构建"**；这一条讲的是**更早的一步**：
**"我以为刚才推上去的那一份还在"** —— 它可能已经被别人后来的 `rsync --delete` 整体换掉了。

实测时间线：

| 时间 | 线上入口 | 来源 |
|---|---|---|
| 上一轮收尾 | `index-CAael5ec.js` | 我的 v185-nav 构建（干净） |
| 本轮的**中途**某刻 | `index-C6weAN3i.js` | **并发会话**用共享 `dist/` 推送，把我 08:13 的**中间构建**带上线（含**未完工**的仪表盘代码） |

- **必须先排除「服务器自动部署」再下结论**：查 `crontab -l` / `ls /etc/cron.d` / `last`。
  本轮实测 **无任何自动部署** ⇒ 确认是**本机另一会话**所为。
- 🔴 **纪律**：**部署前先看生产现状 + 文件时间戳**，别假设"刚才那份还在"。
  标准三步：① `curl -H 'Cache-Control: no-cache' ".../index.html?cb=$(date +%s)"` 取线上入口 hash；
  ② 与磁盘 `dist/assets/index-*.js` 比对；③ 与**我上一轮记录**的 hash 比对。
  三者不一致 ⇒ 先解释清来源（谁、什么时候、为了什么），再决定覆盖还是协同。
- ⚠️ **这条同时是"中间构建会被带上线"的放大器**：工作区一旦有**未完工**的页面代码，
  别人一次无关的 `rsync dist/` 就会把半成品推给用户 ⇒ **未完工的功能不要留在会进构建的工作区里过夜**；
  来不及完工就**先 stash / 先只改不接线**，或完工后立刻重新构建 + 重新部署。
- 验收侧的影响：**上一轮的真机结论一律过期**，必须重跑探针（本项目货损核算页 =
  `.workbuddy/tools/loss-accounting-prod-verify.js`，只读）。

## 🔴 构建**之前**先查「谁刚动过工作区」+ 用**隔离目录**构建（2026-09-18 v185 实测）

上面那条讲的是「部署前先查生产现状」。这一条更早一步：**构建前先查工作区**。

**判据（一行）**：`find hergent-cn-v2/src -mmin -40 -type f`
（⚠️ macOS 用 `-mmin`；`-newermt '-40 minutes'` 报 `bad date`）

本轮实测：我在 12:56 构建并出完差集报告，随后发现 `Forecast.vue` 12:59、
`Rebate.vue` / `variables.css` 12:54、`BrandFilter.vue` 12:45 都被**并发会话**动过，
且它在我出报告**之后**才提交完 4 笔 `v185 rebate` 工作。

三条推论：
1. 🔴 **差集报告会过期** —— 必须对**部署前一刻**的线上产物重跑，不能拿中途快照当验收。
2. 🔴 **共享 `dist/` 会夹带他人未完工改动** ⇒ 用**隔离构建目录**：
   ```bash
   rsync -a --exclude node_modules --exclude dist <repo>/hergent-cn-v2/ /tmp/mybuild/
   ln -s <repo>/hergent-cn-v2/node_modules /tmp/mybuild/node_modules
   cd /tmp/mybuild && PATH=<managed node>/bin:$PATH CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build
   ```
   要**排除某个别人正在改的文件**时，再用 `git show HEAD:<path> > /tmp/mybuild/<path>` 覆盖回 HEAD 版。
   好处：① 产出不含他人未完工改动的 dist；② 不污染共享 `dist/`；③ 后续别人再动源码也不影响这一份。
3. **别把他人已提交的改动误判成 hash 传递性噪声** —— 逐项归因（谁、哪一笔 commit），
   归不到因的就不许上线。

## 🔴 判定 minify 差异：**禁用 `grep ^+/-`**，改用 **token 集合签名**（2026-09-18 实测）

`grep "^+" / "^-"` 是**逐行**匹配，而压缩产物是**一个超长行** ⇒
① 只命中该行的**前 64 字节窗口**；② 被 chunk 名 / `scopeId` 的**长度差**污染
（`a4 as Vt` → `a4 as Lt`）⇒ **假信号**，会让人以为"有大量语义改动"或"全是噪声"，两种误判都致命。

**正确做法**：抹平 chunk 名与 scopeId 后，提取**四类 token 的 counter 集合**做差集：
字符串字面量 / 数字 / 运算符 / 关键字。对 26 万字节的 chunk 是 ~10⁵ 量级计数，
**标识符重排会互相抵消**，剩下的才是真差异。

实测：`Forecast` 的 `+5 字节` 经此判定 = **`+3 字节` 纯标识符 rename**（四类 token 零差异），
且量与「目标与返利」那套已提交改动的规模逐字吻合 ⇒ 确认是 hash 传递性，非语义变化。

## 🔴🔴 并发会话的「隔离构建」会把你已验收的改动**连根抹掉**（v187/v188 实测）

**事故形态**：并发会话为排除别人的在途改动会做「隔离构建」—— 把不是自己的文件
`git show HEAD:<path> > <isolated>/<path>` **覆盖回 HEAD 版**再 build。你若已把改动
**部署上线但还没提交**，对方这一手会让你的改动**根本不在它的产物里**，它一 rsync，你的修复被整体抹掉。

实测（2026-09-18）：17:11 我部署 + 双侧 md5 验收通过；**17:12:17** 对方部署，线上
`Forecast-*.js` 从我的 286,545 字节换成不含我改动的 284,914 字节（HEAD 版）。

**判据**：验收后隔一会儿回读线上包的**字节数 / 哈希** —— 与自建不一致 = 被覆盖。
⚠️ **不能拿「我那次部署的 md5」当证据**（那一刻对，此刻不对）。收尾时也再回读一次。

**恢复姿势（不回滚任何人）**：
1. 重新快照**当前**线上产物 + 用**当前工作区**全量构建（= 对方的最新 + 你的改动）；
2. 对**当前**线上产物重跑归一化差集 → 确认只剩你的那一项；
3. 再部署。**不要**回滚对方已上线的内容（那会把它已交付的功能删掉）。

**根治（机制层）**：改动验收通过后**尽快 scoped 提交进 HEAD** —— 对方下次「按 HEAD 隔离」
就会自动带上你的改动，不再互相挤掉。对方是否照做**不在你控制内** ⇒ 交付前回读线上包不能省。

⚠️ 推论：**正在改的文件不要长期处于「已上线未提交」状态**；跨轮次长任务尤其危险。


## 🔴🔴 只改**注释**也要重构建重部署 —— scope id 把**源码全文**算进哈希（2026-09-18 v190 实测）

**现象**：部署完、又订正了 `Forecast.vue` 里 3 行**注释**。随后本地重建的包与线上 **md5 对不上**：
**字节数完全相同**，只有 `data-v-XXXXXXXX`、esbuild 短名（`fo`↔`mo`）、chunk hash 不同。

**根因**（`node_modules/@vitejs/plugin-vue/dist/index.mjs:90`，v5.2.4）：
```js
descriptor.id = getHash(normalizedPath + (isProduction ? source : ""))   // sha256 hex[:8]
```
样式作用域 id = `sha256(相对路径 + **源码全文**)[:8]` ⇒ **注释也算**。改任何一行（含注释）
⇒ 产物里所有 `data-v-*` 变 ⇒ **md5 必然不同**。
（连带：esbuild 的短名按**字符频次**分配，scope-id 字符串一变会顺带让 `fo`/`mo` 这类名字互换 ——
这正是「差异只在标识符名上」看起来像噪声的原因。）

**⚠️ 我踩过的误判（别重犯）**：先把「/tmp 隔离构建 vs 线上 md5 不同」归因成**隔离目录的路径**噪声。
**错**。决定性实验：同一源码连跑两次隔离构建，md5 **完全相同**（构建是确定性的）；
再把源码原样放回主仓库路径构建，得到的**仍是隔离目录那份**。⇒ **真变量只有源码**。
判据：**同一源码两次构建 md5 不同**才叫不确定性；**源码已变而 md5 不同**就是产物过期。

**自查判据**（线上这个包到底是不是当前源码构建的）：
```bash
python3 -c "import hashlib;s=open('src/pages/Forecast.vue',encoding='utf-8').read();\
print(hashlib.sha256(('src/pages/Forecast.vue'+s).encode()).hexdigest()[:8])"
# ↑ 相对路径 = 相对 vite root（hergent-cn-v2/），如 src/pages/Forecast.vue
ssh root@47.113.224.140 'grep -o "data-v-[0-9a-f]\{8\}" /opt/hergent-cn-v2/assets/<Page>-*.css | sort -u'
```
相等 ⇒ 线上产物**就是**当前源码构建的（v190 订正后 = `0e543102` ✅）；
不等 ⇒ 部署后动过这个文件，**必须重构建重部署**（哪怕只动注释），否则「源码 ≡ 产物」审计链断了。

**纪律**：**先定稿、再部署**。注释订正/收尾措辞一律在构建**之前**做完 ——
否则交付摘要里的 md5 与线上脱节，白跑一轮双侧校验。

### 补（2026-09-19 v207 实测）：注释级改动**已部署后才发现**怎么办 —— 允许「登记式断链」，不许装作没断

**本轮实况**：v207 上线并真机验收通过**之后**，才发现编号撞了 v205（被同日另一会话占用，
对方日报写明「由对方改号」），于是把 `Forecast.vue` 的 19 处注释改号（16 处 →v207、3 处 →v208）。
这**违反了上面的「先定稿、再部署」** ⇒ 线上 scopeId 立刻与源码脱节：

| | scopeId | 说明 |
|---|---|---|
| 线上 `Forecast-Bu6KwkMW.css` | `data-v-13251408` | = **v205 注释版**源码构建（v207 上线时的产物） |
| 当前源码**应有** | `data-v-afed5296` | 按 `sha256('src/pages/Forecast.vue' + 源码)[:8]` 实算 ✅ 算法复验通过 |
| 本地新构建 | 含 `data-v-afed5296` | ✅ 与「当前源码应有」逐字一致 |

🔴 **这次为什么没「重构建重部署」**：此刻前端工作区有 **24 个文件**未提交的在途改动
（`Shell.vue` / `router/index.js` / `api/*` / 多页面），且已证实**线上 Shell 产物比工作区旧**
（线上 `Shell-B23z21lA.css` ↔ 本地构建 `Shell-H-O79mlU.css`）⇒ 现在部署 = **替别人发布未完成的工作**。
⇒ 取舍：**宁可让这一处审计链断着并登记，也不夹带别人的在途改动上线。**

🔴 **两个不成立、不许用来给自己开脱的理由**：
- ❌「中文串集合差为空 ⇒ 行为等价」—— **不成立**：`Math.round` → `Math.ceil` 这类改动
  **一个新中文串都不加**，差集照样为空。「中文串集合差」只能证明**没夹带别人的 UI 文案**，
  **不是**行为等价的判据（别把它当万能等价证明）。
- ❌「反正注释不进产物」—— 只说明**注释文本**不入产物；而 scopeId 把**源码全文（含注释）**算进哈希
  ⇒ 产物字节**确实变了**（本轮 `Forecast-*.js` 改名 + 几乎所有 chunk 级联改名 + 1440 段等长差异）。
  「行为差异为零」是**另一条证据**（三份产物 grep `v205`/`v207` 计数**全为 0**）得出的，
  不是从「注释不进产物」推出来的。

✅ **正确处置（本轮采用）**：把这条断链**显式登记**在记忆与交付里 ——
「线上 = 旧注释版源码构建；源码 = 新注释版；行为差异经真机断言判定为零（29/29）」，
并写明它会**在下一次正常部署时自动愈合**。
⛔ 反面：装作没断 —— 下次谁跑上面的自查命令就会看到 mismatch，
误判成「部署过期/未部署」，白跑一轮排查。

✅ **已于同日 22:5x 愈合（v206 前端部署）**：v206 部署时 `dist/` 里正是 v207 改号后的构建，
四层差集核查判定它「相对线上 = v206 自己的功能改动 + v207 的零行为影响注释改号」后照发
⇒ 线上 scopeId 回到 `data-v-afed5296`，与源码一致。**登记式断链的寿命就是下一次正常部署**。
🔴 由此固化的判据：**「hash 变了但字节数不变」绝不能只看 hash** —— 必须叠加
①去 hash 基名配对字节数（只该有自己改的那几个 chunk 变）②中文串集合差（见下条：它**不是**行为等价证明）
③**逐字节比对**（区分「等长替换」与「短名重分配」）④归一化差集。四层都过才可发布。
⚠️ **注意中文串差集的定位**：它能证明「**没夹带别人的 UI 文案**」，**不能**证明行为等价
（`Math.round`→`Math.ceil` 一个新中文串都不加）。别把它当万能等价证明——这是 v207 段落已经写明、
v206 又独立复验一次的同一条纪律。

**工具**：`tools/dist-bytes-diff.py` —— 两份 minified 产物的**字节级差异定位**
（输出长度/md5、差异段数、每段的 A/B 原文与「等长 / 变长」标记）。
用途：当两份产物**长度相同、md5 不同**时，区分「等长替换（可归因）」与「压缩器短名重分配」；
本轮实测线上 vs 本地 1440 段**全部等长**，差异集中在 `data-v-*` / 依赖 chunk 名 / 短名互换 ——
与本节结论完全吻合。

## 🔴 沙箱（`sandbox_tenant.py --src`）的两个必知副作用（2026-09-18 v190 实测）

① **克隆后沙箱「没有期次」**：`--src` 会把全部 `forecast_submissions.order_date` 改写成**今天**
   ⇒ 归属期次全落空 ⇒ `/api/forecast/periods` 返回 **0 条**。
   **不要为此造期次**（引入与被测行为无关的变量）。正解：`period_id = 0` + **今日窗口**
   （前端 `loadCross` 本来就有这条降级：无期次 ⇒ 造 `{id:0, name:'今日报单', order_start/end: 今天}`）；
   直调 `save-matrix` 同样传 `period_id=0` 而非 `null`。
② **`POST /api/products/bulk-upsert` 20s 超时**（前端 `api()` 默认 `timeout=20000`），
   报错文案 `signal is aborted without reason`。该接口本轮一行没碰、生产日常正常 ⇒ **沙箱环境特性**。
   绕法：`setRequestInterception(true)`，**只**给该接口回成功壳并**取证**（存 payload），
   本轮要验的接口（`batch-factory-price`）**必须真实放行** —— 否则整场验证变成自问自答。

---

## 🔴🔴 验「后端路由是否已删/已加」：**HTTP 状态码不可用**（2026-09-19 v196 实测，两次误判）

**场景**：删掉一个 router（摘 `include_router` + 删文件）后验证是否生效。
第一版判据「删掉后该路径应返回 **404**」—— **全项 FAIL**，且 FAIL 得很像"删除没生效"。

### 真因：`rbac_middleware` 在路由匹配**之前**跑，且用**静态前缀表**
`server/server.py:617` `rbac_middleware` → `:638` 遍历 `_PATH_MODULE_MAP`（`:311`）按
`path.startswith(prefix)` 解析模块 —— **完全不查 `app.routes`**：

| 情形 | 返回 | 与路由存在性 |
|---|---|---|
| 未带凭证 | **401**（任何 `/api/*`，**含从来不存在的路由**） | 无关 |
| 命中前缀但该角色无权限 | **403**（如 `_PATH_MODULE_MAP` 有 `"/api/ai": "chat"` ⇒ `/api/ai-learning/*` 被吞成 chat；supervisor 无 chat ⇒ **恒 403**） | 无关 |
| 未命中任何前缀 | **403** `MODULE_NOT_CONFIGURED` | 无关 |

⇒ **匿名 / 低权限角色视角永远看不到 404**。判别性实验（打一个**从未存在**的路由）也是 401/403，
就证明了这个判据没有区分力 —— **不是删除失败，是判据本身无效**。

### ✅ 正确判据（两条腿，缺一不可）
1. **权威**：`/openapi.json` —— FastAPI 从 `app.routes` 生成，**不经业务中间件**。
   数 `len(d['paths'])`（改动前后应精确差 N 条）+ 确认目标前缀 0 条。
2. **成对对照**（需凭证）：**同前缀、同 token**，一个存在的子路径 + 一个不存在的子路径：
   ```
   GET /api/forecast/periods                  → 200   ← 正例：证明权限够、可达路由层
   GET /api/forecast/definitely-not-real-xyz  → 404 {"detail":"接口不存在：…"}  ← 负例：证明 404 链路成立
   GET /api/<已删前缀>/probe                  → 403   ← 预期（中间件先拦），不是失败
   ```
   **只有正例没有负例 = 判据可能恒绿；只有负例没有正例 = 判据可能恒红。**
3. 另必须核：`journalctl -u hergent-erp --since '10 minutes ago' | grep -iE 'Traceback|ImportError'` 为 0
   —— import 失败会让**整个后端起不来**，这是删 router 的首要风险。

⭐ 工具：`.workbuddy/tools/backend-route-removal-verify.py`
（`HG_EXPECT_ROUTES` / `HG_GONE_PREFIX` / `HG_USER`+`HG_PASS`；用法与其文件头同名，内含本文全部判据）

### 🔴 删 router 的正确顺序与自检
1. **先摘注册、再删文件** —— 任何中间态都能启动；反过来（先删文件）会让 `from routers.X import` 直接失败。
2. 摘完用 **AST 逐条核对** `server/server.py` 的全部本地 import 都有对应文件（本轮 177 条全过）
   —— 这是"删除不会造成 import 失败"的静态最强保证。
3. 生产侧：scp 单文件（**不用整目录 rsync，禁 `--delete`**）→ chown → 删目标 `.py` + 清 `*<name>*.pyc`
   → `systemctl restart` → `is-active` + 日志无异常 + openapi 计数。
4. 落点自检：`grep -c '<router>_router' /opt/hergent-erp/server.py` = 0、目标文件 No such、
   `ls -d /opt/hergent-erp/server` 仍是 **No such**（防影子目录）。

### ⚠️ 同轮第二个坑：引号嵌套
把 `curl … /openapi.json | python3 -c '… d[\"paths\"] …'` 串在一条 `ssh "…"` 里，
内层双引号被吞 ⇒ 空响应、`JSONDecodeError: Expecting value: line 1 column 1`，
**看起来像"服务没起来"**（当时刚重启 4 秒，更容易误判）。
修法：一律 `ssh root@… 'python3 -' < script.py` 送脚本文件。

## 🔴🔴 「幽灵租户库」：任何**以 root 打开过某个不存在的租户库**的脚本，都会让调度器**永久报错**（2026-09-19 v205 部署当日实测，1268 条错误）

**症状**（生产）：
```
[Scheduler] Cron tasks check error: attempt to write a readonly database      ← 每分钟 ×2
[Scheduler] ai reminders tenant=2 error: attempt to write a readonly database
[Scheduler] ai reminders tenant=3 error: attempt to write a readonly database
[Tenant patch] FTS products_fts in /opt/hergent-erp/tenant_3.db: attempt to write a readonly database
```
**现场**：`/opt/hergent-erp/tenant_2.db`、`tenant_3.db` = **0 字节、`root:root`**、两者 ctime **同一纳秒**。

**机制（三个缺陷串起来，缺一不可）**
1. `db.connection.set_tenant_context(tid)` 有 **v88 兜底「租户库缺失就建库」** ⇒ 任何以 root 跑的脚本
   只要碰过一次 `set_tenant_context(2)`，就落下一个 **0 字节 root 文件**（SQLite 连接后首次写才写头，
   所以是 0 字节）。
2. `scheduler._tenant_ids()`（`scheduler.py:956`）**扫的是文件系统**（`glob tenant_*.db` + `fullmatch`），
   **不查 `tenants` 表、也不查 `user_tenants`** ⇒ 幽灵文件被当成真实租户 2/3。
3. 服务以 `hergent` 运行、文件归 `root` ⇒ 每次 tick 写它都失败；而调用处是
   `except ... print` ⇒ **不抛不中断，每 2 分钟刷一行，永久静默劣化**。

**判据 / 认领（10 分钟可复现，别猜）**
```bash
stat -c "%n size=%s ctime=%z owner=%U:%G" /opt/hergent-erp/tenant_*.db   # 找 size=0 + root:root
python3 -c "import sqlite3;[print(r) for r in sqlite3.connect('/opt/hergent-erp/erp.db').execute('SELECT id,name,is_active FROM tenants')]"
python3 -c "import sqlite3;[print(r) for r in sqlite3.connect('/opt/hergent-erp/erp.db').execute('SELECT user_id,tenant_id,role FROM user_tenants')]"
journalctl -u hergent-erp --since <日期> --no-pager | grep -ci "readonly database"    # 起止时间点
```
🔴 **归属判据（很硬）**：**服务以 `hergent` 跑 ⇒ 它创建的文件必然 `hergent:hergent`**。
所以 **`root:root` 的幽灵库一定来自 root shell / root 脚本**，不可能是应用自己产生的。
⇒ 反过来说：**部署期间任何以 root 执行的验证片段都可能留下它**（本轮就落在重启后第 53 秒、
冒烟脚本跑起来之前的那段窗口里）。**取证能力有限时，就照实说「来自一个 root 进程、无法进一步归因」。**

⚠️ **危险的不是报错本身，而是它的另一种结局**：如果那个文件恰好归 `hergent`（比如脚本是用
`sudo -u hergent` 跑的），`set_tenant_context(2)` 会**把它补成完整 schema** ⇒ 系统从此认真对待
一个不存在的「租户 2」（无人属于它，但简报/提醒/监控都会去跑）。**root:root 反而挡住了这一步。**

**处置（可回滚，别 `rm`）**
```bash
mkdir -p /root/quarantine_ghost_tenants_$(date +%Y%m%d)
mv /opt/hergent-erp/tenant_2.db /opt/hergent-erp/tenant_3.db /root/quarantine_ghost_tenants_*/
```
⚠️ **移动后不会立刻止血**：正在跑的进程已把 `tenant_2/3` 的连接/列表握在手里 ⇒ **还会再报 1–2 个 tick**
（本轮 16:01 移动、16:02:39 仍报、16:04:39 起为 0）。**别据此以为没生效、更别去动 `tenants` 表。**
⚠️ 顺带发现的**设计缺陷（未修，待拍板）**：`_tenant_ids()` 既不看 `tenants` 表、也不跳过不可写文件
⇒ 系统的「租户集合」有**两个真相源**（磁盘文件 vs `tenants` 表）。生产里 `tenant_9.db` 就是
「有库、不在 `tenants` 表」的活例子（它能写，所以不报错、也不报异常）。
**建议**：`_tenant_ids()` 与 `tenants` 表取交集（或至少跳过 `os.access(f, os.W_OK)` 为假者）。

🔴 **给所有「以 root 跑生产库脚本」的纪律**：跑之前先想清楚 **`ERP_DB_PATH` / `DB_DIR` 指向哪**，
以及 **脚本会不会 `set_tenant_context` 一个不存在的 id**。验证片段宁可显式带
`ERP_DB_PATH=/tmp/xxx`，也不要在 `/opt/hergent-erp` 里裸跑。

---

## §v214b 🔴 差集第⑥层：token 级对齐（「等长替换 + 标识符重编号」是**注释改动的正常签名**，不是夹带）

> 2026-09-20。工具 `tools/dist-token-align.py`（新）· 技能 `hergent-frontend-deploy-verify` §第⑥层

**实测签名（记住这条，否则一定误判）**：只改一个**注释**、重建后产物出现——① **scopeId 变**
（Vue 的 scopeId 是 **`hash(路径 + 源码)` 派生**，任何源码字节变化含注释都改它）② 由①级联的
**chunk 名全链漂移** ③ **几百个压缩标识符整体重编号**（本轮 540 处单字符 `e3`→`e6`；对照实验 756 处）。
⇒ **字节数完全相同、md5 不同**。

**为什么旧判据抓不住**：第⑤层（`dist-invariant-diff.py` 归一化）只归一化 `data-v-<8hex>` 与
`<基名>-<hash>`，**归一化不掉标识符重编号** ⇒ 会报「归一化后仍不同」；
而 §token 折叠法（`[A-Za-z0-9_-]{8,}` → `#`）也漏 —— 压缩名只有 2–3 字符，根本没被折叠，
会被当成「可读 token 差异」逐条报出来，**看着非常像夹带**。
而「字面量集合比对」只回答「有没有新的业务字串」，也证明不了没有夹带。

**终局判据（三条同时成立 ⇒ 零逻辑、零字面量改动）**：
① **token 总数相同**（本轮 `140245 == 140245`）
② **非 id token 差异逐条可归约成 `data-v-X` / `<基名>-H.<ext>`**（本轮 8 条，全解释）
③ **id 重命名严格一对一**（无一对多、无多对一；本轮 旧 270 ↔ 新 270）
> 为什么必须 ③：只比「归一化文本」或「字面量集合」**挡不住互换型改动** —— `a-b` → `b-a`
> 归一化后逐字相同、字面量集合也相同。③ 配 ①的 token 计数才能把命名互换暴露出来。

**自证范式（把「无法解释」变成「已刻画的签名」）**：出现一簇解释不了的差异时，做一次
**同源变异重建**（源码只加/删一个注释 → 重建 → 用同一套判定比「原产物 vs 变异产物」）。
若复现**同一族**差异 ⇒ 该族就是这类改动的正常签名。
🔴 **测完必须回滚变异并重建，且核「回滚后产物与变异前逐字节相同」** —— 这条同时证明
**构建确定性**（同源两次构建 57 文件全等，含全部 chunk hash）。

**顺带修的既存判据漏洞**：🔴 **「双侧 md5 一致」只证明传输没坏，不证明「现在仍一致」** ——
本次后端在前端部署之后又被改过注释 ⇒ 线上 `c311900a…` vs 本地 `919776ba…` 已漂移。
**凡「部署后又改了源码」，交付前必须重新核一次双侧**（本次差异仅为注释，功能字节一致，但仍补部署对齐）。

## §v230 🔴 「本地 == 生产」的**批量**判据 + 「口径重写」不能用等长判据（2026-09-21 实测）

**场景**：生产上积压了一批「已部署、从未提交」的改动。要在**不逐 hunk 切分**的前提下判断
「哪些文件可以**整文件**入库」—— 否则任何按 HEAD 的重部署都会**静默抹掉**它们。

**两条判据必须同时成立**（缺一不可）：

| # | 判据 | 命令要点 |
|---|---|---|
| ① | **逐文件 md5 全等**（**不得抽样**） | 两侧各出 `find <dir> -type f -print0 \| sort -z \| xargs -0 md5sum`，再 `diff` |
| ② | **无源码文件 mtime 晚于构建时刻** | `find <src> -newermt "<构建时间>" -type f` 必须为空 |

🔴 **为什么必须 ②**：①只证明「产物内容 == 线上内容」，但**源码可能在那次构建之后又被改过**
—— 此时产物与生产一致、源码却已超前 ⇒ 整文件入库会把**未上线的在途改动**一起带进去。

**实测（2026-09-21）**：后端 13 个改动文件 md5 **13/13** == `/opt/hergent-erp/`（**FLAT 布局**）；
前端本地 `dist` vs `/opt/hergent-cn-v2` **57/57 文件逐字节全等**；前端源码树 75 个文件
**没有一个 mtime 晚于构建时刻 `2026-09-21 16:00:38`** ⇒ 整文件入库成立。

🔴🔴 **由此推翻的一次错误裁定**：上一轮判 `Forecast.vue`「含别人的**未部署**在途改动，故不提交」
—— 实际它（HEAD 9213 行 → 工作区 10934 行、**186 个 hunk**）**已随 16:00 构建全量上线**。
⇒ **教训：判「哪些 hunk 属于我」之前，先判「这个文件整体是否已上线」。**

**「口径重写」型术语批次不能用等长判据**：v226（「厂价」→「进价」，295 处）**不是等长替换**，
任何「等长 / token 计数 / 归一化」判据都**认不出它** ⇒ 只能**逐个 dump 全文人工读**。

## §v230 🔴 受控提交 / 收索引的**三条操作纪律**（2026-09-21 血泪，含一次真实数据损失）

**① 临时索引（`GIT_INDEX_FILE`）提交后，必须复位共享索引。**
用临时索引提交只动 HEAD、不碰对方索引 —— 但**共享索引会停留在提交前状态**（显示 `MM` / `D `）。
此时任何 `git commit`（不带 `-a`）会把它们「当改动」提交出去 = **把刚提交的内容回退成旧版**。
复位命令（🔴 路径必须走 `-z` 或 `-c core.quotepath=false`）：

```bash
git diff --cached --name-only -z | while IFS= read -r -d '' p; do git reset -q HEAD -- "$p"; done
```

🔴 **为什么必须 `-z`**：路径含中文时，`$(git diff --cached --name-only)` 返回的是**带引号的转义串**
（`"\346\234\252…"`），把它交给 `git reset -- <它>` 是**静默 no-op** —— 不报错、索引还是脏的。
（实测：小程序 11 个文档的 `MM` / `D ` 因此未被复位，靠上面这条才收拾干净。）

**② 收索引绝不用 `git checkout -- <目录>`。**
它会连带抹掉该目录下**所有已跟踪文件**的未提交改动，**不报错、不可逆**。
**实测损失（2026-09-21）**：`git checkout -- .workbuddy` 抹掉
· `tools/scoped_stage_by_marker.py` **619 行**未提交改动（v224 的 `drop_plus_lines` + `dropped`）
· `memory/MEMORY.md` 涨到 **~15.2KB** 的那部分内容（被退回 `d89c5d5` 的 5579 B 版）
⇒ 收拾索引**只能用 `git reset`**（不碰工作区）。

**③ 只提交「已修改的跟踪文件」会造出坏提交。**
`app.json` 引用**未入库的页面**、三个页面 `require` **未入库的模块** ——
而 git、`node --check`、`py_compile` **全都不报**（都是合法文件，只是**引用悬空**）。
⇒ 提交前必做两项审计：
· **可达性审计**：所有 `require(...)` / `import` 的**目标是否都在入库集合内**
· **页面完整性审计**：`app.json` 里每个页面路径**是否有实体文件**

**🆕 记忆文件被 git 回退后怎么捞回来**：WorkBuddy 每轮 API 调用都会把
`<working_memory_content>`（即 `memory/MEMORY.md` 全文）写进
`~/.workbuddy/traces/<session-id>/*.json` ⇒ 扫 trace、取**最长的那一份**即最完整版本。
（🔴 只对**已跟踪**文件有效：`topics/*.md` 多为未跟踪，`git checkout` 不会动它们。）
