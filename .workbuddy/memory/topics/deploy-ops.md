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
