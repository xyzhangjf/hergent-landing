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
    · `parse_weekdays` / `WEEKDAY_LABELS` / `MAX_EARLY_LIMIT`
      ← `domain/arrival_schedule.py`（纯函数与常量，无 DB）
    · 品牌归一化 `normalize_brand` 由 `routers/data.py::_brand_label` 收敛而来，
      那边现在 import 本模块，**全仓只有这一份实现**。

🔴🔴 v779（2026-11-05）**两层口径打架的修正**：
    自动编排层 `domain/arrival_schedule.py::match_brands_to_periods()` 用的是
    「窗口 `[C-E, C]`」，C = 品牌方下单日（落在 `order_weekdays` 的星期），
    E = `order_max_early_days`（最多可提前天数）：主序列下单日 D 落在
    `[C-E, C]` 内 ⇒ **这一期就该报这个品牌**，即允许提前 E 天报单。
    而本模块 v765 只判 `order_end` 的星期 ∈ `order_weekdays`，完全没读 E
    ⇒ 同一期编排层判可报、拦截层判不可报。生产实证：43 期（11-06 周五截止）
    编排层把「简爱（提前 1 天）」排进去了，小程序却弹「请在 11月7日填报」。
    用户原话：「简爱是周六下订单，周六当天报单来不及，想提前一天报」。
    ⇒ 判定改为**同一个二元关系**的反向视角：存在 C ∈ [order_end, order_end+E]
      且 C 的星期 ∈ ws ⇒ 可报。E=0 时严格等价旧行为（护栏 80+ 断言原样全绿）。

🔴 弹窗日期也跟着改：改为查 `forecast_periods` 真实期次，**不再按日历推算**。
    期次是 2 天/期且与 7 天/周互质，日历上的「下一个周六」未必有期次；
    生产 43 期之后根本没有未来期次，旧弹窗给的 11-07 是纯虚构。
    查不到真实期次 ⇒ 空串 ⇒ 文案退到「本期已无可报日」（宁缺日期，不给假的）。
"""
import json
import logging
import re
from datetime import datetime, timedelta

from db.connection import get_db, get_db_tx
from domain.arrival_schedule import MAX_EARLY_LIMIT, WEEKDAY_LABELS, parse_weekdays

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


def window_hit(order_end, ws, early=0):
    """期次报单截止日是否落在该品牌的**可提前窗口**内（v779 唯一判定内核）。

    编排层 `match_brands_to_periods()` 的表述：品牌方下单日 C（星期 ∈ ws），
    主序列下单日 D 命中当且仅当 `C-E <= D <= C`。从**期次侧**看同一个二元关系：

        存在 C ∈ [order_end, order_end + E] 且 C 的星期 ∈ ws

    这里 `order_end` 就是主序列下单日 D（= 期次报单截止日），E = 可提前天数。
    🔴 E 缺省 / 坏值 / 缺列 ⇒ 0 ⇒ 退化成 `order_end 的星期 ∈ ws`，与 v765 旧行为
       **逐像素一致**（护栏 80+ 条生产真实期次断言原样全绿）。这是本次改动能
       零风险落地的前提：不会误伤任何没配 `order_max_early_days` 的租户。
    🔴 上限复用 `MAX_EARLY_LIMIT`，绝不自己写死一个数字（第二份口径）。
    🔴 绝不依赖 `order_first_date` / `order_mode`（v765 判据 ①②不变）。
    """
    d = _parse_iso(order_end)
    if d is None or not ws:
        return False
    try:
        e = max(0, min(int(early or 0), MAX_EARLY_LIMIT))
    except (TypeError, ValueError):
        e = 0
    for i in range(e + 1):
        if (d + timedelta(days=i)).isoweekday() in ws:
            return True
    return False


def next_period_date(ws, early, future_periods):
    """下一个**真实可报期次**的开放日 → `11月5日（周四）`；查不到 ⇒ 空串。

    `future_periods` 来自 `period_brand_windows()` 查 `forecast_periods` 的结果
    （只含 `order_end > 当前期次` 的行）。逐个按 `window_hit` 判定，取第一个
    可报期次的 `order_start`（用户能开始填的那天），没有则退回 `order_end`。

    🔴 **绝不按日历推算**：期次 2 天/期、与 7 天/周互质，且可手工调整；
       生产 43 期之后根本没有未来期次，日历算出的「11月7日（周六）」是虚构日期，
       用户照着去填必然扑空。查不到 ⇒ 空串 ⇒ 文案退到"本期已无可报日"，
       宁缺日期不给假的（`lock_msg_for` 的既有 fail-safe 方向）。
    🔴 返回的是**期次开放日**不是品牌下单日：用户是在期次开放期间填报。
    """
    for p in (future_periods or []):
        if not isinstance(p, dict):
            continue
        oe = str(p.get("order_end") or "").strip()
        if not oe or not window_hit(oe, ws, early):
            continue
        d = _parse_iso(str(p.get("order_start") or "").strip() or oe)
        if d is None:
            continue
        return "%d月%d日（周%s）" % (d.month, d.day, WEEKDAY_LABELS[d.isoweekday()])
    return ""


def next_order_date(ws, today=None):
    """🟡 **已废弃的日历推算**（下一个符合 `ws` 的日历日），仅供历史单测保留。

    🔴 v779 起 `judge()` **禁止调用本函数** —— 它算出来的是日历日，不是期次，
       生产实测会给用户一个根本不存在期次的日期（43 期弹「11月7日填报」，
       而 7 号没有期次，下一个真正落在周六的期次要等 11-14）。
       生产判定一律走 `next_period_date()` 查真实期次表；判据见护栏静态检查
       「judge 函数体内不得出现 next_order_date(」。
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
    """DB 行 → `{brandKey: {"weekdays":[…], "rule_id", "lead_days", "max_early"}}`。**纯函数**。

    只收 `order_weekdays` 非空的规则 —— 空值的品牌视为「不限报单日」，
    连键都不进表，避免下游每次都要判一次空。
    同一品牌有多条规则时取 `weekdays` 最多的那条（并集不被覆盖），
    避免「后写的一条把前一条抹掉」这种静默失效；`max_early` 跟着同一条规则走。

    🔴 v779 新增 `max_early`（= `order_max_early_days`）：编排层允许提前 E 天报单，
       判定层必须读同一个值，否则就是第二份口径。**缺键 / 缺列 / 坏值 ⇒ 0**
       （老租户库没有这列、夹具库也没造这列），此时行为与 v765 完全一致；
       上限复用编排层的 `MAX_EARLY_LIMIT`，不另写一个数字。
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
        try:
            e = max(0, min(int(r.get("order_max_early_days") or 0), MAX_EARLY_LIMIT))
        except (TypeError, ValueError):
            e = 0
        out[key] = {
            "weekdays": ws,
            "rule_id": r.get("id"),
            "lead_days": r.get("order_lead_days") or 0,
            "max_early": e,
        }
    return out


def judge(brand, order_end, rules, enabled=True, today=None, future_periods=None):
    """单品牌判定 → `{"brand","orderable","weekdays","weekdays_label","tip",
                    "next_date","lock_msg"}`。

    `order_end` 是该期次的**报单截止日**（`forecast_periods.order_end`）。
    任何一环缺失（开关关 / 日期坏 / 品牌没规则）⇒ 可报。

    🔴 v779：命中改用 `window_hit(order_end, ws, rule["max_early"])` ——
       与编排层同一个可提前窗口，不再只看截止日当天的星期。
    🔴 `future_periods` = 真实未来期次列表（由 `period_brand_windows` 查库下发）。
       被拦时 `next_date` **只从这里取**，查不到就空串；旧的日历推算法已禁用
       （会给不存在的期次日期）。`today` 仅为兼容旧调用保留，不再参与判定。
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
    early = rule.get("max_early") or 0
    if window_hit(order_end, ws, early):
        return res
    res["orderable"] = False
    res["tip"] = tip_for(ws)
    # v765d：弹窗正文也在这里拼好 —— 前端 `_bwMsg()` 早期版本是自己拼
    #「品牌：周X 才能报单」，两处口径必然漂（品牌名、星期、日期三样东西各一处），
    # 所以改成后端给整句、前端只渲染。v779：日期源改为真实期次表。
    nd = next_period_date(ws, early, future_periods)
    res["next_date"] = nd
    res["lock_msg"] = lock_msg_for(key, ws, nd)
    return res


def window_map(order_end, rules, enabled=True, today=None, future_periods=None):
    """全部**有规则**的品牌 → `{brandKey: judge(...)}`。**纯函数**。

    只返回有规则的品牌（没规则的直接不存在 ⇒ 前端取不到就按可报处理），
    这样下发体最小：生产目前是 2 个有效品牌，不是 390 个。
    🔴 v779：`future_periods` 必须透传给 `judge`，否则弹窗日期会退化成
       「本期已无可报日」（用户看不到下一期该哪天来）。护栏有静态判据锁这一行。
    """
    return {
        k: judge(k, order_end, rules, enabled, today, future_periods)
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
            # 🔴 v779：与 `judge()` / 编排层共用同一条 `window_hit`，
            #    否则「配置预览说不能报、小程序实际能报」= 第二份口径（v765 同族）。
            brands.append({
                "brand": k,
                "orderable": window_hit(oe, ws, r.get("max_early") or 0),
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
    # 🔴 v779：`order_max_early_days` 是**后加列**（erp_db.py 迁移 v121），
    #    老租户 / 新装库未必有。硬写进 SELECT 列表会整段抛错 → 被下方 except
    #    吞成「没有任何品牌配了报单日」= **开关打开也永远不生效**，界面一片正常，
    #    现场只有一行 warning（v765c「order_end_date」踩过一模一样的坑）。
    #    ⇒ 用 `SELECT *` 按列名取：`rules_from_rows` 缺键自动回落 max_early=0。
    sql = (
        "SELECT * FROM rebate_target_rules "
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


def _future_periods(conn, current_end):
    """当前期次之后的**真实期次**（`[{"id","order_start","order_end"}]`，按 id 升序）。

    🔴 弹窗「请在 X 月 X 日填报」的唯一日期源。日历推算已被禁用（v779）。
    🔴 同样用 `SELECT *` 按列名取：`order_start` / `order_end` 是后加列，
       老租户只有 `order_start_date` / `order_end_date`（生产 tenant_1 两套都有）。
       硬写列名 ⇒ 整段抛错 ⇒ 弹窗永远没有日期且零报错。
    🔴 fail 方向 = 空列表 ⇒ 弹窗退到「本期已无可报日」，**不影响能不能报单**。
       生产实测（2026-11-05）：期次表最大只到 43 期，一条未来期次都没有 ——
       这正是旧弹窗给「11月7日」却扑空的根因。
    """
    cur_end = str(current_end or "").strip()
    if not cur_end:
        return []
    try:
        cur = conn.execute("SELECT * FROM forecast_periods ORDER BY id")
        cols = [x[0] for x in (cur.description or [])]
        out = []
        for row in cur.fetchall():
            d = dict(zip(cols, row))
            oe = (str(d.get("order_end") or "").strip()
                  or str(d.get("order_end_date") or "").strip())
            os_ = (str(d.get("order_start") or "").strip()
                   or str(d.get("order_start_date") or "").strip())
            if oe > cur_end:
                out.append({"id": d.get("id"), "order_start": os_, "order_end": oe})
        return out
    except Exception as e:
        log.warning("未来期次读取失败（弹窗不给日期，判定不受影响）: %s", e)
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
            # v779：弹窗日期只认真实期次表，查不到就不给日期。
            future = _future_periods(c, oe)
            # v772：横幅品牌范围 = 本期预报清单，不是全商品档案。
            return oe, os_, rules, period_brands(c, period_id, os_, oe), future

        if conn is not None:
            oe, os_, rules, pbrands, future = _collect(conn)
        else:
            with get_db() as c2:
                oe, os_, rules, pbrands, future = _collect(c2)

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
        wm = window_map(oe, rules, True, today, future)
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
