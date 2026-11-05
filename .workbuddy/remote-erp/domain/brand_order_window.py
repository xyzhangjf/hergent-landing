"""按品牌报单日（星期）管控 —— 「某品牌这一期能不能报」的唯一判据。

背景（2026-11-04）：
    品牌报单频率并不一致（简爱按周、蒙牛系每 2 天），而**期次骨架是全局的**
    —— 每 2 天一期，与品牌无关。此前没有任何一层把「品牌排程」落到
    「员工这一屏能不能填」上，`order_weekdays` 写了也没人读。
    本模块补的就是这一层。

三条设计判据（每条都对应一个「做错了也不报错」的坑）：

1. 🔴 **只看 `order_weekdays` 有没有值，不看 `order_mode`。**
   生产实测（tenant_1, 2026-11-04）：4 条 brand 规则 `order_mode` 全是 `interval`、
   `order_weekdays` 全空。若判据写成「mode 必须是 weekday 才算」，业务员在界面上
   勾了「每周一、周四」却没把模式切过去 ⇒ **配了等于没配，且全程无提示**。
   字段有值即代表意图，这个口径不会骗人。

2. 🔴 **不依赖 `order_first_date`。**
   `build_period_plan()` / `compute_order_dates()` 都以 first_date 作绝对锚点
   （`domain/arrival_schedule.py:357`）。上述 4 条规则的 first_date 同样为空
   ⇒ 直接复用它们会得到「规则被 `if not fd ... continue` 静默跳过」。
   本模块只做**星期**比较，不碰绝对日期锚点，故不受影响。

3. 🔴 **取 `order_end`（报单截止日）的星期，不取 `order_start`。**
   期次区间只有 2 天（如 11-03 ~ 11-04），而「周几报单」指的是**交单那天**。
   取开工首日会把「明天才截止」的品牌判成已错过。

fail-safe 方向 = **放行**（与 `db/queries/forecast_rules.py` 的数量校验相反，那里是拦）。
    理由：本开关误判的代价是**全员不能报单**，远贵于漏拦一个品牌。
    读不到配置 / 日期解析失败 / 规则表为空 ⇒ 一律 `orderable=True`。

复用而不重写（本项目反复栽在「第二份口径」上）：
    · `parse_weekdays` / `WEEKDAY_LABELS` ← `domain/arrival_schedule.py`（纯函数，无 DB）
    · 品牌归一化 `normalize_brand` 由 `routers/data.py::_brand_label` 收敛而来，
      那边现在 import 本模块，**全仓只有这一份实现**。
"""
import json
import logging
import re
from datetime import datetime, timedelta

from db.connection import get_db, get_db_tx
from domain.arrival_schedule import WEEKDAY_LABELS, parse_weekdays

log = logging.getLogger("hergent")

# KV kind —— 与「数量规则(forecast_rules)」「业务参数」「配方」共用 forecast_config 表
WINDOW_KIND = "forecast_brand_window"

# 默认关。关着时 judge() 恒返回可报 ⇒ 上线出问题改一个配置即可回到原状，
# 不需要回滚代码、不需要重新发版。
DEFAULTS = {"enabled": False}

# 文案模板：两端**同源**。前端 wxml 只渲染 tip 字段，不自己拼
#（v759 教训：五种组合摊在 wxml 里必然漏一种）。
TIP_TMPL = "该商品可报单时间为每周{wd}，本期不可提报"

# 顶部横幅（v772）：**列全「本期预报清单里可报的品牌」**，不点名不可报品牌。
#    用户口径（2026-11-05）：「不要搞那么绕，把没设规则的品牌自动归为本期可报品牌」
#    +「你要看本期预报里有哪些品牌，而不是看整个系统有几个品牌」。
#    ⇒ 范围是**本期清单**（生产 43 期只有 5 个品牌），不是商品档案（18 个）。
#    清单里没配 `order_weekdays` 的品牌天然可报，直接进白名单；
#    不再需要「，其它品牌均可报」这种把白名单拆成两段的兜底话术。
BANNER_TMPL = "本期可报品牌：{brands}"

# 本期清单里的品牌全被报单日挡住（极端态）⇒ 必须说一句，不点名任何品牌。
BANNER_NONE_TMPL = "本期暂无可报品牌"

# 拦截弹窗（填了不可报的商品时）：「本期不可报 + 哪天再来」。
# 🔴 必须给**具体日期**而不是只说「下个报单日」：用户看完弹窗就要决定
#    "现在收手、那天再来"，给星期等于让他自己算日子。
LOCK_TMPL = "{brand} 只能在{wd}报单，请在{nd}填报"
LOCK_TMPL_NO_DATE = "{brand} 只能在{wd}报单，本期已无可报日"


# ---------------------------------------------------------------- 纯函数（可脱离 DB 单测）

def normalize_brand(raw):
    """品牌归一化：**只**去掉括号备注（中/英文括号）并压掉内部空白。

    🔴 绝不做「前缀合并」—— 生产 tenant_1 实测全库同时存在裸 `蒙牛`(2) 与
       `蒙牛低温`(162) / `蒙牛鲜奶`(39) / `蒙牛常温`(14) / `蒙牛奶酪`(7) / `蒙牛乳饮`(2)。
       这些在业务上是**独立事业部**（价格政策、返利口径完全不同），任何
       「短的是长的前缀就并进短的」规则都会把 241 个商品并成一个 chip ——
       用户点一下就把 5 个事业部当 1 个报单，是不可逆的业务错误。

    · 只做括号归一：括号在品牌命名里是**明确的备注位**，`新希望(南山)` 与
      `新希望` 是同一个品牌，去括号是安全的等价合并。
    · `蒙牛鲜奶（7579）` 经此归一 → `蒙牛鲜奶`，与档案里的 39 个商品对上。
    · `新希望南山`（无括号）保持独立 —— 宁可多一个 chip，不可错并一个品牌。
    """
    s = (raw or "").strip()
    if not s:
        return ""
    t = re.sub(r"[(（][^()（）]*[)）]", "", s)
    t = re.sub(r"\s+", "", t)
    return t or s


def _parse_iso(s):
    """ISO 日期 → date。兼容 `2026-11-04` 与 `2026-11-04 12:00:00`。坏值返回 None。"""
    if not s:
        return None
    t = str(s).strip()
    if len(t) < 10:
        return None
    try:
        return datetime.strptime(t[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def weekday_of(s):
    """ISO 日期 → 1..7（1=周一，与 `order_weekdays` 存储语义一致）。坏值返回 None。"""
    d = _parse_iso(s)
    return None if d is None else d.weekday() + 1


def weekdays_short(ws):
    """[1,4] → `一、四`（接在「每周」后面用）。"""
    return "、".join(WEEKDAY_LABELS[w] for w in sorted(ws) if w in WEEKDAY_LABELS)


def weekdays_full(ws):
    """[1,4] → `周一、周四`（单独成句用）。"""
    return "、".join("周" + WEEKDAY_LABELS[w] for w in sorted(ws) if w in WEEKDAY_LABELS)


def tip_for(ws):
    return TIP_TMPL.format(wd=weekdays_short(ws))


def next_order_date(ws, today=None):
    """下一个符合 `ws` 的**日历日** → `11月5日（周四）`；`ws` 空 ⇒ 空串。

    从**明天**起算（今天若能报就不该走到这里 —— 走到锁定的都是今天不在 `ws` 的）。

    🔴 口径限制（写在这里，免得后人当权威）：这是**日历推算**，不是查期次表。
       本系统 2 天/期，与 7 天/周互质，所以「下一个星期三」和「下一个下单日落在
       星期三的期次」在绝大多数情况下重合，但**不保证**（期次手工调整过就会错位）。
       所以文案里**同时给了星期**（`11月5日（周四）`）—— 日期错位时用户仍能从
       "每周三、六"看出规律，而不是彻底迷路。真正的判据永远在服务端。
    """
    if not ws:
        return ""
    t = today if isinstance(today, datetime) else datetime.now()
    base = t.date() if hasattr(t, "date") else t
    for i in range(1, 15):
        d = base + timedelta(days=i)
        if d.isoweekday() in ws:
            return "%d月%d日（周%s）" % (d.month, d.day, WEEKDAY_LABELS[d.isoweekday()])
    return ""


def lock_msg_for(brand, ws, nd):
    """拦截弹窗正文。`nd` 为空 ⇒ 退到不带日期的句子（宁缺日期，不给假的）。"""
    label = "每周" + weekdays_short(ws)
    if nd:
        return LOCK_TMPL.format(brand=brand, wd=label, nd=nd)
    return LOCK_TMPL_NO_DATE.format(brand=brand, wd=label)


def rules_from_rows(rows):
    """DB 行 → `{brandKey: {"weekdays":[…], "rule_id", "lead_days"}}`。**纯函数**。

    只收 `order_weekdays` 非空的规则 —— 空值的品牌视为「不限报单日」，
    连键都不进表，避免下游每次都要判一次空。
    同一品牌有多条规则时取 `weekdays` 最多的那条（并集不被覆盖），
    避免「后写的一条把前一条抹掉」这种静默失效。
    """
    out = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        ws = parse_weekdays(r.get("order_weekdays"))
        if not ws:
            continue
        key = normalize_brand(r.get("scope_key") or r.get("scope_name"))
        if not key:
            continue
        cur = out.get(key)
        if cur and len(cur.get("weekdays") or []) >= len(ws):
            continue
        out[key] = {
            "weekdays": ws,
            "rule_id": r.get("id"),
            "lead_days": r.get("order_lead_days") or 0,
        }
    return out


def judge(brand, order_end, rules, enabled=True, today=None):
    """单品牌判定 → `{"brand","orderable","weekdays","weekdays_label","tip",
                    "next_date","lock_msg"}`。

    `order_end` 是该期次的**报单截止日**（`forecast_periods.order_end`）。
    任何一环缺失（开关关 / 日期坏 / 品牌没规则）⇒ 可报。

    🔴 `weekdays_label`（`每周一、四`）是给**行内短标签**用的现成整句，与 `rules` 里的
       `weekdays_cn`（`周一、周四`，单独成句）刻意不同名不同形 —— 同一个名字两种形态，
       前端必然在某个位置用错一种，而错的是标点、测试抓不到（v753 同族）。
       ⚠️ 不要在前端拼 `"每周" + weekdays_short`：`weekdays_short` 只返回 `一、四`
          （它的设计前提是"接在「每周」后面"），前端拼一次就多一份口径。
    """
    key = normalize_brand(brand)
    res = {"brand": key, "orderable": True, "weekdays": [],
           "weekdays_label": "", "tip": "", "next_date": "", "lock_msg": ""}
    if not enabled:
        return res
    wd = weekday_of(order_end)
    if wd is None:
        return res
    rule = (rules or {}).get(key)
    if not rule:
        return res
    ws = rule.get("weekdays") or []
    if not ws:
        return res
    res["weekdays"] = list(ws)
    res["weekdays_label"] = "每周" + weekdays_short(ws)
    if wd in ws:
        return res
    res["orderable"] = False
    res["tip"] = tip_for(ws)
    # v765d：弹窗正文（含"请在 X月X日（周X）填报"）也在这里拼好 ——
    # 前端 `_bwMsg()` 早期版本是自己拼「品牌：周X 才能报单」，两处口径必然漂
    #（品牌名、星期、日期三样东西各一处），所以改成后端给整句、前端只渲染。
    nd = next_order_date(ws, today)
    res["next_date"] = nd
    res["lock_msg"] = lock_msg_for(key, ws, nd)
    return res


def window_map(order_end, rules, enabled=True, today=None):
    """全部**有规则**的品牌 → `{brandKey: judge(...)}`。**纯函数**。

    只返回有规则的品牌（没规则的直接不存在 ⇒ 前端取不到就按可报处理），
    这样下发体最小：生产目前是 2 个有效品牌，不是 390 个。
    """
    return {
        k: judge(k, order_end, rules, enabled, today)
        for k in (rules or {}).keys()
    }


def banner_for(window, period_brands=None):
    """横幅：**列全本期清单里可报的品牌**（v772）。

    `period_brands` = 本期预报清单内的品牌全集（有序，来自 `period_brands()`）。
    `window` = 只含「配了 `order_weekdays`」品牌的判定结果（判定闸门结构不变）。

    🔴 没设规则的品牌**不在 `window` 里**，因此天然落进 `ok` —— 这就是
       「自动归为本期可报品牌」，不需要 `free` 布尔、不需要补一句「其它品牌均可报」。
    🔴 范围是本期清单，不是全商品档案：列的是**这张单上的品牌**，
       所以「全可报也列全」不会误导（旧口径按全档案算，才需要靠空串回避）。

    三态：
      · 清单为空 / 期次无清单 ⇒ 空串（不显示，绝不把"没导入"说成"暂无可报品牌"）
      · 清单品牌全被挡 ⇒ 「本期暂无可报品牌」
      · 否则 ⇒ 「本期可报品牌：A、B、C」（没设规则的与放行的一起列）
    """
    all_brands = [b for b in (period_brands or []) if b]
    if not all_brands:
        return ""
    blocked = {k for k, v in (window or {}).items()
               if v.get("orderable") is False}
    ok = [b for b in all_brands if b not in blocked]
    if not ok:
        return BANNER_NONE_TMPL
    return BANNER_TMPL.format(brands="、".join(ok))


def preview(rules, periods, limit=8):
    """未来若干期 × 每个规则品牌的可报矩阵 —— 供配置面板做「配完会怎样」预览。

    🔴 这条是「配了却永远命不中」的唯一显性化手段：某品牌在预览里
       8 期全红 ⇒ 它的 `order_weekdays` 与现有期次骨架永不重合（例如只配了周六，
       而期次从不在周六截止），此时必须提示，否则业务员以为本周无需报单。
    """
    out = []
    for p in (periods or [])[:limit]:
        oe = p.get("order_end") or p.get("order_end_date")
        wd = weekday_of(oe)
        brands = []
        for k, r in (rules or {}).items():
            ws = r.get("weekdays") or []
            brands.append({
                "brand": k,
                "orderable": bool(wd is not None and wd in ws),
                "weekdays": list(ws),
            })
        out.append({
            "period_id": p.get("id"),
            "order_end": oe,
            "weekday": wd,
            "weekday_cn": ("周" + WEEKDAY_LABELS[wd]) if wd else "",
            "brands": brands,
        })
    return out


# ---------------------------------------------------------------- 配置读写（DB）

def _ensure_kv(conn):
    """幂等建 KV 表（与 `forecast_rules._ensure_kv` 同构、**同一张表**）。"""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS forecast_config(
               kind TEXT PRIMARY KEY,
               payload TEXT NOT NULL,
               updated_at TEXT NOT NULL)"""
    )


def get_config():
    """读开关。**fail-safe**：任何异常都回落 `enabled=False`（= 全放行）。"""
    r = dict(DEFAULTS)
    try:
        with get_db() as conn:
            _ensure_kv(conn)
            row = conn.execute(
                "SELECT payload FROM forecast_config WHERE kind=?", (WINDOW_KIND,)
            ).fetchone()
        if not row:
            return r
        raw = row["payload"] if hasattr(row, "keys") else row[0]
        data = json.loads(raw) if raw else {}
        if isinstance(data, dict):
            r["enabled"] = bool(data.get("enabled"))
    except Exception as e:
        log.warning("forecast_brand_window 配置读取失败，按「全放行」处理: %s", e)
    return r


def is_enabled():
    return bool(get_config().get("enabled"))


def set_config(enabled):
    """保存开关。非法值抛 ValueError（路由层转 400），**不静默取反**。"""
    if not isinstance(enabled, bool):
        raise ValueError("enabled 必须是布尔值")
    with get_db_tx() as conn:
        _ensure_kv(conn)
        conn.execute(
            "INSERT OR REPLACE INTO forecast_config(kind, payload, updated_at) VALUES(?,?,?)",
            (WINDOW_KIND, json.dumps({"enabled": enabled}, ensure_ascii=False),
             datetime.now().isoformat()),
        )
        conn.commit()
    return get_config()


def load_rules(conn=None):
    """读本租户的品牌报单日规则 → `rules_from_rows(...)` 的结果。

    读的是 `rebate_target_rules`（Web「返利目标」里配的报单节奏）—— **不另存一份**。
    两份配置必然分叉：改了一边另一边不生效，是最难查的一类问题。
    """
    sql = (
        "SELECT id, scope_key, scope_name, order_mode, order_weekdays, "
        "order_lead_days FROM rebate_target_rules "
        "WHERE dimension='brand' AND is_active=1"
    )

    def _read(c):
        cur = c.execute(sql)
        cols = [d[0] for d in (cur.description or [])]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    try:
        if conn is not None:
            rows = _read(conn)
        else:
            with get_db() as c2:
                rows = _read(c2)
    except Exception as e:
        # 表不存在 / 列改名 ⇒ 当「没有任何品牌配了报单日」= 全放行（fail-safe 同向）
        log.warning("rebate_target_rules 读取失败，按「无规则」处理: %s", e)
        return {}
    return rules_from_rows(rows)


def period_brands(conn, period_id, order_start="", order_end=""):
    """本期预报清单内的品牌（归一、去重、按清单商品数降序）。

    🔴 范围 = **本期清单**（`forecast_import_products`），不是全商品档案。
       用户口径（2026-11-05）：「你要看本期预报里有哪些品牌，而不是看整个系统有几个品牌」。
       生产 43 期清单 187 项只有 5 个品牌，全档案却有 18 个 —— 按全档案算才需要
       「其它品牌均可报」这种兜底，按本期清单算可以直接把名字列全。
    🔴 期次归属条件复用 `erp_db.forecast_period_scope_sql`：与小程序铺开、提交闸门、
       Web 汇总同一条；自己抄一份 WHERE 就是第二份口径（本项目反复栽过）。
    🔴 品牌列按 PRAGMA 判存在（老租户库可能缺 `brand`）：硬写不存在的列会整段抛错，
       被外层 except 吞成空清单 ⇒ 横幅静默消失且零报错，最难查的一类。
    fail 方向 = 空清单 ⇒ `banner_for` 返回空串 ⇒ 横幅不显示（绝不阻塞报单）。
    """
    try:
        try:
            import erp_db as db       # 延迟导入：与 routers/data.py 同源，不形成循环
            if order_start and order_end:
                cond, args = db.forecast_period_scope_sql("r"), (period_id, order_start, order_end)
            else:
                cond, args = "r.period_id=?", (period_id,)
        except Exception:
            # 拿不到唯一口径（例如本地镜像缺 erp_db 的间接依赖）⇒ 退化为精确命中，
            # 与 `forecast_period_product_ids` 的降级同款；**绝不退化成"全表"**。
            # 🔴 必须降级而不是让外层 except 吞成空清单：空清单 = 横幅静默消失、零报错。
            cond, args = "r.period_id=?", (period_id,)
        rcols = {x[1] for x in conn.execute(
            "PRAGMA table_info(forecast_import_products)").fetchall()}
        pcols = {x[1] for x in conn.execute("PRAGMA table_info(products)").fetchall()}
        bp = "NULLIF(TRIM(p.brand),'')" if "brand" in pcols else "NULL"
        br = "NULLIF(TRIM(r.brand),'')" if "brand" in rcols else "NULL"
        rows = conn.execute(
            "SELECT COALESCE(%s, %s, '') AS b, COUNT(*) AS n "
            "FROM forecast_import_products r LEFT JOIN products p ON p.id=r.product_id "
            "WHERE (%s) AND r.product_id>0 GROUP BY b" % (bp, br, cond), args
        ).fetchall()
        seen = []
        for b, n in rows:
            k = normalize_brand(b)
            if k and k not in [x[0] for x in seen]:
                seen.append((k, n))
        seen.sort(key=lambda x: (-x[1], x[0]))
        return [k for k, _ in seen]
    except Exception as e:
        log.warning("本期清单品牌读取失败（横幅不显示）: %s", e)
        return []


def period_brand_windows(period_id=None, conn=None, today=None):
    """某期次的品牌窗口总览 —— 端点与提交闸门共用。

    Returns:
        {"enabled": bool, "period_id", "order_end", "weekday_cn",
         "banner": str, "brands": {brandKey: judge(...)}, "rules": [...]}

    🔴 v772：`banner` 的品牌范围是**本期预报清单**（`period_brands()`），
       而 `brands` 仍只含「配了报单日规则」的品牌 —— 判定闸门（提交 / 行内禁用）
       消费的是 `brands`，结构一字未改，本轮只换横幅口径。

    期次不存在 / 已被删 ⇒ `brands={}`、`banner=""`、`enabled` 照常返回。
    调用方据 `brands.get(品牌, {}).get("orderable", True)` 判定 —— **取不到就是可报**。
    """
    ctx = {"enabled": False, "period_id": period_id, "order_end": "",
           "weekday_cn": "", "banner": "", "brands": {}, "rules": []}
    try:
        cfg = get_config()
        ctx["enabled"] = bool(cfg.get("enabled"))
        if not ctx["enabled"] or not period_id:
            return ctx

        def _collect(c):
            # 🔴 v765c：不许写 `COALESCE(order_end, order_end_date)`。
            #    `order_end_date` 是**后加的列**：tenant_1 有（14 列），tenant_10 没有（12 列）。
            #    一条 SQL 引用不存在的列会让整段抛错 → 被外层 except 吞成「全放行」
            #    ⇒ **开关打开也永远不生效**，而现场只看到一行 warning、界面一片正常。
            #    故按列名取值：缺列 = 空串 = 该期次不下发限制（fail-open 方向不变）。
            cur = c.execute("SELECT * FROM forecast_periods WHERE id=?", (period_id,))
            r = cur.fetchone()
            oe, os_ = "", ""
            if r:
                d = dict(zip([x[0] for x in (cur.description or [])], r))
                oe = ((d.get("order_end") or "").strip()
                      or (d.get("order_end_date") or "").strip())
                os_ = ((d.get("order_start") or "").strip()
                       or (d.get("order_start_date") or "").strip())
            rules = load_rules(c)
            # v772：横幅品牌范围 = 本期预报清单，不是全商品档案。
            return oe, os_, rules, period_brands(c, period_id, os_, oe)

        if conn is not None:
            oe, os_, rules, pbrands = _collect(conn)
        else:
            with get_db() as c2:
                oe, os_, rules, pbrands = _collect(c2)

        oe = oe or ""
        wd = weekday_of(oe)
        # 期次不存在 / 没有报单截止日 / 日期解析不了 ⇒ 不下发任何品牌限制。
        # 🔴 此时若照常 window_map，judge 会因 wd=None 全部返回「可报」——
        #    语义上等于「这一期没有任何限制」，但字段里带着品牌名会让前端以为
        #    「有规则、只是本期都放行」，日后排查会被这条假信号误导。
        if wd is None:
            ctx["order_end"] = oe
            # 截止日缺失 ⇒ 判定不可用 ⇒ 本期清单里的品牌全部可报，照常列全。
            # （fail-open 方向不变：宁可列全，不可误说"暂无可报品牌"。）
            ctx["banner"] = banner_for({}, pbrands)
            return ctx
        wm = window_map(oe, rules, True, today)
        ctx.update({
            "order_end": oe,
            "weekday_cn": ("周" + WEEKDAY_LABELS[wd]) if wd else "",
            "brands": wm,
            "banner": banner_for(wm, pbrands),
            "rules": [
                {"brand": k, "weekdays": v.get("weekdays"),
                 "weekdays_cn": weekdays_full(v.get("weekdays") or []),
                 "rule_id": v.get("rule_id")}
                for k, v in wm.items()
            ],
        })
    except Exception as e:
        log.warning("period_brand_windows 失败，按「全放行」处理: %s", e)
        return {"enabled": False, "period_id": period_id, "order_end": "",
                "weekday_cn": "", "banner": "", "brands": {}, "rules": []}
    return ctx


def spec():
    """两端共用规格（`GET /api/forecast/brand-window-spec`）。

    带 **tip 模板与横幅模板** 是刻意的：前端渲染时直接用这里的字符串，
    「同一个提示在两端说同一句话」不靠人工对齐，而是同一份数据。
    """
    cfg = get_config()
    return {
        "enabled": bool(cfg.get("enabled")),
        "tip_tmpl": TIP_TMPL,
        "banner_tmpl": BANNER_TMPL,
        "banner_none_tmpl": BANNER_NONE_TMPL,
        "lock_tmpl": LOCK_TMPL,
        "lock_tmpl_no_date": LOCK_TMPL_NO_DATE,
    }
