import io, sys

P = "/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/memory/MEMORY.md"
MARK = "🔴🔴 **改单「删除列 → 保存失败」→ §v194**"

NEW = (
    "🔴🔴 **改单「删除列」/「保存失败」→ §v194 + §v194b**（**两度修正，只认 v3**）：**先分清是哪一种**——"
    "(a)「**页面出错了 / 表格没了 / 找不到保存按钮**」⇒ `selStats`(`3815`) 越界 ⇒ `App.vue:2` 的 `<ErrorBoundary>`"
    "（`position:fixed;inset:0`）**全屏接管** ⇒ **保存按钮根本不存在**（判据 `selRange.c1 > visibleCols.length "
    "+ units.length - 1`；**普通单击不建选区**，只有拖选 / Shift+单击 / Shift+方向键 / 全选才建；"
    "`clampSelection`(4865) **只夹 `selected` 漏 `selRange`** 是第二条腿）——**这条真实、已复现，但不是用户那次**；"
    "(b)「**页面还在、点保存弹『保存失败（网络或服务器异常）』**」⇒ **真因**＝后端 `bulk_upsert_products`(`data.py:336`) "
    "在**写事务内**调 `track_brand`(`erp_db.py:8417`)，而它**另开连接**写 `brand_pending` ⇒ **自锁** ⇒ 每行白等 "
    "`busy_timeout=5000`(`connection.py:228`) ⇒ **`N ≥ 4 行未注册品牌` 即 > 20 秒** ⇒ 前端 `AbortController`"
    "(`client.js:184` timeout=20000) 中止 ⇒ **nginx `499`** ⇒ `AbortError.message`(=`signal is aborted without reason`) "
    "三个正则全不命中 ⇒ 落兜底文案。**判据**：① **等间隔精确 5 秒**的 `database is locked` 同 trace 重复＝**事务自锁**"
    "（`16:47:57→16:50:13` 28 条＝`5 秒 × N`；三次真实浏览器 `499`＝`16:48:12 / 18:24:38 / 22:59:55`，起点＝499−20s；"
    "我的探针 **4 行 ⇒ 正好 20 秒**，被 499 卡在阈值上）② **`499/502/504` 只在 nginx**、应用日志一行都不写 ⇒ "
    "**第 0 步必须查两层**，且 **nginx 是唯一带 UA 的层**（出口 IP 与探针相同 ⇒ **IP 分不出归属**）③ 品牌构成与库对账"
    "（`福宝 24` ↔ `products` 里 24 个；`brands` 仅 4 条）④ **异常条数要对上账**（全天 96 = 3×28 + 3×4）· "
    "**与「删列」无因果**（失败全落 `bulk-upsert`；`save-matrix` 真实浏览器 **0 次非 200**；三次跑在**三个不同前端构建**上）· "
    "**基线**：`12–16/Sep` 真实浏览器 save-matrix **0**、`17/Sep` **3 / 0**、`18/Sep` **0 / 3（全 499）** ⇒ **极低频路径** · "
    "**附带伤害＝一次点击 140 秒全租户写冻结**（97 次 locked 里 96 是 `track_brand`，另 1 是 `[Scheduler] Low stock check`）· "
    "**第二个坑**：`brand_pending` 13 条全 `resolved`/`backfill`、无 pending，`dismiss`(`8393-8394`) **只标 resolved、"
    "不加进 `brands`** ⇒ 「忽略」过的品牌每次复发，而新待审记录**恰因自锁写不进** ⇒ **队列看起来干净、实际永远收不到** · "
    "**修复（代码未动一行）**：**P0-1 `track_brand` 登记移出写事务**（循环内只用 `db.normalize_brand()`——返回值与 "
    "`track_brand` 相同 ⇒ 不改写入内容；`with` 退出后统一登记 ⇒ **140 秒 → 亚秒级**；⚠️ **后端契约级**，先核调用方）→ "
    "**P0-2 只提交脏行**（现每次全量 154 行；与 P0-1 **都要做**）→ P0-3 `bulkUpsert` 放宽超时 + 文案改可行动（**仅缓解**，"
    "不解决写锁）；P1-1 `kind` 分类器**必须判 `e.name`**；**P1-2 ＝ (a) 那组独立缺陷**；P2 品牌治理（修好 P0-1 会涌入 "
    "14 个品牌 · 需拍板归并）· 告警 · 部署留 `dist-<ts>.tar.gz`（**服务器不留历史 dist** ⇒ 无法事后核对版本）· "
    "待查 `Sep 01` 63 次 locked（来源 `POST /api/rebate-rules`，**同族隐患，机制未核**）· "
    "⚠️ **口径更正：旧的「每天 2000–23000 行 locked」是错的**，实测 `Aug 02`1 / `Sep 01`63 / `Sep 18`97 · "
    "交付 `outputs/改单删列保存失败排查-2026-09-18/`（**02 = v3 报告** · 04 = 原始证据 · 03 = 崩页截图）· "
    "**待用户拍板 甲 最小止血 / 乙 止血+治本 / 丙 全做**"
)

s = io.open(P, encoding="utf-8").read()
i = s.find(MARK)
if i < 0:
    print("MARK NOT FOUND"); sys.exit(1)
j = s.find("\n", i)
if j < 0:
    j = len(s)
old = s[i:j]
s2 = s[:i] + NEW + s[j:]
io.open(P, "w", encoding="utf-8").write(s2)
print("OK")
print("marker_at=", i, " line_end_at=", j)
print("old_len=", len(old), " new_len=", len(NEW), " delta=", len(NEW) - len(old))
