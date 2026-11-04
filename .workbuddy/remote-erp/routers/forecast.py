"""Forecast Orders Router (v92.2) — 预报订单: 填报/审核/付款/模版

H1a (2026-07-23): Pydantic validation added to JSON-body write endpoints.
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from core import _auth, _admin, pydantic_error_detail
from pydantic import BaseModel, Field, ConfigDict, ValidationError
import json, csv, io, logging, hashlib, erp_db as db
from datetime import datetime, timedelta
from urllib.parse import quote
# v233：模板「*数量」换算的**后端唯一实现**（与前端 `Forecast.vue::perCase` 同源，
#   同源判据 = `.workbuddy/tools/v233-percase-parity.py` 输出 `PARITY OK n/n`）。
from domain.unit_convert import convert_qty

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


def _period_label(pid):
    """期次显示名。删除是**先取快照再删**，删完行就没了，留痕明细必须提前备好。"""
    try:
        with db.get_db_tx() as conn:
            r = conn.execute(
                "SELECT name, order_start, order_end FROM forecast_periods WHERE id=?", (pid,)
            ).fetchone()
        if not r:
            return f"期次#{pid}"
        return f"{r['name'] or ('期次#' + str(pid))}（{r['order_start']}~{r['order_end']}）"
    except Exception:
        return f"期次#{pid}"


def _audit_period_op(user, pid, action, detail):
    """期次级破坏性操作留痕（关闭 / 删除）。

    v166 (2026-09-15)：埋点放在**端点**而非前端 —— 关闭/删除是破坏性操作，
    任何客户端（Web / 小程序 / 脚本）触发都要留下同一条记录，前端埋点可被旧版前端
    或直接调接口绕过。审计失败只告警，绝不因此让关闭/删除本身失败（fail-open）。
    写的是 `audit:<pid>` 键；删除期次不会级联清 forecast_config，故删除记录得以留存。
    """
    try:
        from routers.forecast_config import _append_audit, _audit_who
        who = _audit_who(user=user)
        with db.get_db_tx() as conn:
            _append_audit(conn, pid, action, detail, who=who)
    except Exception as e:
        import logging
        logging.getLogger("hergent").warning(f"period audit skipped ({action}, pid={pid}): {e}")


class _Base(BaseModel):
    model_config = ConfigDict(extra="allow")


class FcPeriodCreate(_Base):
    name: str = Field(..., min_length=1)
    order_start: str = Field(..., min_length=1)
    order_end: str = Field(..., min_length=1)
    arrival: str = Field(..., min_length=1)
    # v273（2026-09-25）：新建期次时**自动沿用「上一期」的商品清单**。
    #   🔴 默认 **True** —— 用户诉求原话：「新建期次时应自动带出上一个期次的商品信息」。
    #     默认 True 还让**老前端**（不传该字段）直接拿到新行为，不必两端同时上线，
    #     也不会出现「后端已更、前端未更 ⇒ 带不出」这种半截状态。
    #     要一个空白期次（自己导入 / 手填）就显式传 false，前端表单已给这个开关。
    #   ⚠️ `_Base` 是 `extra="allow"`，加字段不影响既有客户端。
    seed_from_prev: bool = True


class FcOrderSubmit(_Base):
    period_id: int = Field(..., gt=0)
    submitter_name: str = Field(..., min_length=1)
    product_name: str = Field(..., min_length=1)
    quantity: float = Field(..., gt=0)


class FcOrderReview(_Base):
    reviewer_qty: float = Field(..., gt=0)


class FcKpiCreate(_Base):
    month: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    value: float = Field(..., ge=0)


class FcBankImport(_Base):
    rows: list = Field(..., min_length=1)


class FcBankMatch(_Base):
    ref_type: str = Field(..., min_length=1)
    ref_id: int = Field(..., gt=0)


class FcRebateRule(_Base):
    brand: str = Field(..., min_length=1)
    rule_type: str = Field(..., min_length=1)


def _v(model, b):
    try:
        model(**b)
    except ValidationError as e:
        raise HTTPException(422, detail=pydantic_error_detail(e))


# ============================================================
# v242 报单自动化（租户级契约）
# ============================================================
# GET  /api/forecast/auto-period   读配置 + 运行状态 + 未来 6 期预览
# PUT  /api/forecast/auto-period   写配置（手动/自动 + 三个时点）
#
# 存储：**复用** rebate_target_rules 的 4 列（auto_period_enabled / auto_open_time /
#   auto_close_time / supplier_deadline_time）。后端已有「租户内唯一」约束 ⇒ 语义上
#   已经是租户级配置，故**零 schema 变更**。把「存储在哪」封在本文件，前端只认本
#   契约 ⇒ 将来若把 4 列物理搬到独立租户级表，前端零改动。
# 校验：**不另写一套** —— 直接复用 rebate_rules.validate_rule（唯一实现，含租户
#   唯一性、关单须早于厂家下单截止、开启须有首次报单日）。跨 router 的惰性 import
#   是本仓既有范式（见 _audit_period_op → routers.forecast_config）。
class AutoPeriodIn(_Base):
    enabled: int = 0
    rule_id: int = 0
    auto_open_time: str = ""
    auto_close_time: str = ""
    supplier_deadline_time: str = ""


def _auto_period_rule_rows(conn):
    """本租户全部启用中的品牌规则（自动化的「承载者」与「基准品牌候选」都从这里出）。"""
    return [dict(r) for r in conn.execute(
        "SELECT * FROM rebate_target_rules WHERE is_active=1 AND dimension='brand' ORDER BY id"
    ).fetchall()]


def _auto_reap_on():
    """本租户是否**开着报单自动化** —— 决定「过期未关的期次会不会被系统自己收掉」。

    🔴 为什么必须由服务端给、不能前端拼：前端看不到品牌规则里的 `auto_period_enabled`
       （它在 `rebate_target_rules` 上，走 `/auto-period` 另一条链）。而这个事实
       **决定提醒怎么说**：
         · 开着 ⇒ 「系统会自动把它关掉」（等一会儿就行）
         · 没开 ⇒ 「系统**不会**自动处理，请手动关闭」（否则用户会一直等）
       猜错方向的代价**不对称**：说"会自动处理"而实际不会 ⇒ 用户白等，且他等的那一刻
       正是自动建表被挡住的每一刻（本轮故障就是这个形态）；说"要手动"而实际会自动
       ⇒ 用户多点一次，无害。
       ⇒ 因此**任何不确定**（含读表异常、老租户库没有这张表）一律取 False（保守侧）。

    ⚠️ 这里的 `except → False` 与「探针禁律（禁止 `except: 返回空`）」**不冲突**：
       那条禁律的对象是**诊断脚本**（把"我错了"伪装成"世界是空的"，会导出假结论）；
       此处是**产品代码的 fail-safe**，且方向保守（退化成"请手动关闭"，不骗人）。
    """
    try:
        with db.get_db_tx() as conn:
            rows = _auto_period_rule_rows(conn)
        return bool(next((r for r in rows
                          if int(r.get("auto_period_enabled") or 0) == 1), None))
    except Exception:
        return False


def _auto_period_view(rows, carrier, skips_by_rule=None):
    """组装响应：配置 + 基准品牌节奏镜像 + 候选品牌 + 未来 6 期 + 下一次动作。

    预览与调度器**同源**（domain.arrival_schedule.build_period_plan），不做镜像
    ⇒ 界面看到的 = 系统要做的。

    v365：`skips_by_rule` = 各品牌「不到货」的停单日（`db.rebate_arrival_skip_map`）。
       命中某期的到货日 ⇒ 该期 `excluded=True`（调度器不会再自动建它）。
       **必须由服务端注入**：前端看不到 `rebate_arrival_skips`，自己推必然与实际漂移。
    """
    import os
    from domain.arrival_schedule import build_period_plan
    times = {
        "open": ((carrier or {}).get("auto_open_time") or "20:00"),
        "close": ((carrier or {}).get("auto_close_time") or "10:00"),
        "supplier": ((carrier or {}).get("supplier_deadline_time") or "12:00"),
    }
    candidates = [{
        "rule_id": r.get("id"),
        "brand": r.get("scope_name") or r.get("rule_name") or "",
        "order_first_date": r.get("order_first_date") or "",
        "order_mode": r.get("order_mode") or "interval",
        "order_cadence_days": r.get("order_cadence_days") or 0,
        "order_weekdays": r.get("order_weekdays") or "",
        "order_lead_days": r.get("order_lead_days") or 0,
    } for r in rows if (r.get("order_first_date") or "").strip()]
    cadence = None
    if carrier:
        cadence = {k: carrier.get(k) for k in (
            "order_mode", "order_first_date", "order_cadence_days", "order_weekdays",
            "order_lead_days", "order_max_early_days")}
    bench = carrier or (candidates[0] if len(candidates) == 1 else None)
    preview, warnings, nxt = [], [], None
    excluded_count = 0          # v365：本次排程内有几期因「不到货」不再自动新建
    if bench and (bench.get("order_first_date") or "").strip():
        bname = bench.get("scope_name") or bench.get("rule_name") or ""
        plan_rules = [{**r, "name": r.get("scope_name") or r.get("rule_name") or ""}
                      for r in rows if (r.get("order_first_date") or "").strip()]
        if not any(x["name"] == bname for x in plan_rules):
            plan_rules.append({**bench, "name": bname})
        try:
            plan = build_period_plan(plan_rules, horizon_days=90,
                                     open_time=times["open"], close_time=times["close"],
                                     supplier_time=times["supplier"],
                                     skips_by_rule=skips_by_rule)
            preview = (plan.get("periods") or [])[:6]
            warnings = plan.get("warnings") or []
            excluded_count = int(plan.get("excluded_count") or 0)
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
            for p in (plan.get("periods") or []):
                oa, ca = p.get("open_at"), p.get("close_at")
                if not oa or not ca:
                    continue
                if p.get("excluded"):
                    continue      # v365：被排除的期次不是"下一次动作"的候选
                if oa <= now_str < ca:                     # 填报窗口正开着 ⇒ 下一次动作是关单
                    nxt = {"open_at": oa, "close_at": ca, "window_open": True}
                    break
                if oa > now_str and nxt is None:
                    nxt = {"open_at": oa, "close_at": ca, "window_open": False}
        except Exception as e:
            warnings = [f"排程预览生成失败：{e}"]
    bname = (carrier.get("scope_name") or carrier.get("rule_name") or "") if carrier else ""
    return {
        "enabled": 1 if carrier else 0,
        "rule_id": (carrier.get("id") if carrier else 0) or 0,
        "brand": bname,
        "occupied_by": bname,
        "times": times,
        "cadence": cadence,
        "candidates": candidates,
        "next": nxt,
        "preview": preview,
        "excluded_count": excluded_count,      # v365
        "warnings": warnings,
        "dry_run": 1 if (os.environ.get("HERGENT_AUTO_PERIOD_DRY_RUN") or "0").strip().lower()
                        in ("1", "true", "yes") else 0,
    }


@router.get("/auto-period")
def auto_period_get(request: Request):
    """报单自动化：读配置 + 运行状态 + 未来 6 期预览。"""
    _auth(request)
    with db.get_db_tx() as conn:
        rows = _auto_period_rule_rows(conn)
        skips = db.rebate_arrival_skip_map(conn)     # v365：停单日（表缺失 ⇒ {}）
    carrier = next((r for r in rows if int(r.get("auto_period_enabled") or 0) == 1), None)
    return {"success": True, "data": _auto_period_view(rows, carrier, skips)}


@router.put("/auto-period")
async def auto_period_put(request: Request):
    """写报单自动化配置（租户级）。校验复用 rebate_rules.validate_rule（唯一实现）。"""
    _auth(request)
    b = await request.json()
    _v(AutoPeriodIn, b)
    enabled = 1 if int(b.get("enabled") or 0) == 1 else 0
    rid = int(b.get("rule_id") or 0)
    from routers.rebate_rules import validate_rule as _vr, _row_to_dict as _rd, _now as _rbr_now
    with db.get_db_tx() as conn:
        skips = db.rebate_arrival_skip_map(conn)     # v365：停单日（表缺失 ⇒ {}）
        if rid > 0:
            row = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rid,)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM rebate_target_rules WHERE auto_period_enabled=1 AND is_active=1 "
                "ORDER BY id LIMIT 1").fetchone()
        if not row:
            if enabled:
                raise HTTPException(400, "请先选择「以哪个品牌的报单节奏为准」，"
                                         "且该品牌须已在「目标与返利」里填好首次报单日")
            rows = _auto_period_rule_rows(conn)
            return {"success": True, "data": _auto_period_view(rows, None, skips)}
        rule = dict(row)
        if enabled:
            merged = _rd(row)
            for k, dflt in (("auto_open_time", "20:00"), ("auto_close_time", "10:00"),
                            ("supplier_deadline_time", "12:00")):
                v = (b.get(k) or rule.get(k) or dflt)
                merged[k] = str(v).strip() or dflt
            merged["auto_period_enabled"] = 1
            errors, cleaned = _vr(merged, conn, exclude_id=rid or None)
            if errors:
                raise HTTPException(400, "；".join(errors))
            conn.execute(
                "UPDATE rebate_target_rules SET auto_period_enabled=1, auto_open_time=?, "
                "auto_close_time=?, supplier_deadline_time=?, updated_at=? WHERE id=?",
                (merged["auto_open_time"], merged["auto_close_time"],
                 merged["supplier_deadline_time"], _rbr_now(), rule.get("id")))
        else:
            # 关闭 = 关掉「**当前真正开着的那条**」，而不是前端传来的 rule_id：
            # v242b 起下拉在手动模式也可选（允许先挑基准品牌再开），此时 rule_id 可能
            # 已指向另一条规则，若照它去关就会**关错人** —— 表现为「切了手动，自动化还在跑」。
            conn.execute(
                "UPDATE rebate_target_rules SET auto_period_enabled=0, updated_at=? "
                "WHERE auto_period_enabled=1 AND is_active=1", (_rbr_now(),))
        rows = _auto_period_rule_rows(conn)
    carrier = next((r for r in rows if int(r.get("auto_period_enabled") or 0) == 1), None)
    return {"success": True, "data": _auto_period_view(rows, carrier, skips)}


def _periods_skipped(periods):
    """v368：**已存在**的期次里，到货日被**任一**品牌标记「不到货」的那些。

    🔴 判据必须与自动建表的排除判定**同口径**（`_apply_period_exclusions` v368 起
       已是「任一品牌停 ⇒ 整期不建」）⇒ 这里只需「该期 `arrival_date` 落在**任一**
       规则的停单日集合里」，**不必重跑排程**（排程重算会把"已建出来的期次"和
       "未来计划"混在一起，反而说不清"这几期为什么还在这儿"）。

    用途两条（老板 v368 拍板的 ③ 与 ④）：
      ③ 这些期次是「本不该建」的（多半在用户点停单**之前**就自动建出来了）
         ⇒ 期次列表给它们**一键作废**入口；
      ④ 期次列表加「有 N 期的货不来了」说明 —— 否则用户只看到"期次怎么少了"，
         不知道是自己点过「不到货」（v365 定下的不静默原则）。

    🔴 读停单失败**绝不能让期次列表 500**：这是首页级热接口，停单只是附加说明。
       失败 ⇒ 返回空列表 + 日志留痕（不是静默吞掉）。
    """
    try:
        _map = db.rebate_arrival_skip_map() or {}
    except Exception as ex:                      # noqa: BLE001 —— 说明信息，失败可降级
        logging.getLogger("hergent").warning(
            "[v368] 读「到货停单」失败 ⇒ 期次列表不显示作废入口（期次本身不受影响）: %s", ex)
        return []
    _days = set()
    for _v in _map.values():
        _days |= set(_v or ())
    if not _days:
        return []
    out = []
    for p in (periods or []):
        _ad = str(p.get("arrival_date") or "")[:10]
        if _ad and _ad in _days:
            out.append({"id": int(p.get("id") or 0), "name": p.get("name") or "",
                        "arrival_date": _ad, "status": p.get("status") or "open"})
    return out


@router.get("/periods")
def list_periods(request: Request):
    _auth(request)
    # 2026-09-12：current 改用展示专用兜底 —— 期次全部 closed 时也要给一个默认期次，
    # 否则前端 curPeriod=0 → 汇总表落到「今天~今天」→ 默认视图空表（详见 erp_db.forecast_period_default）。
    # 2026-09-18 v193：新增 `open` 字段 = **进行中（status='open'）的那个期次**，没有则 null。
    #   为什么必须由服务端给、而不是让前端从 `periods[].status` 自己算：
    #   `open` 与导入落库用的是**同一个函数** `erp_db.forecast_period_current()`（导入侧的归属
    #   判定见 import_router._execute_forecast_cross 的硬闸）⇒ 前端「导入按钮是否可用」与
    #   后端「导入会不会被 400」判据**逐字同源**，不可能各算一份而漂移。
    #   ⚠️ 与 `current` 的区别（两者**不可互换**）：`current` 是**展示**口径，期次全 closed 时会
    #      兜底到「最近有报单的期次 / 最新创建的期次（不限状态）」—— 它服务默认视图；
    #      而 `open` 只认真实进行中的期次。导入侧只认 `open`（既定方案 §四.1：闸门若不收窄
    #      default() 兜底则形同虚设，closed 期次仍会被选中）。
    _open = db.forecast_period_current()
    _periods = db.forecast_period_list()
    # v368：已存在期次里「那天到货被标记不到货」的 —— 供期次列表给出
    #       「有 N 期的货不来了」说明 ＋ 一键作废入口（详见 `_periods_skipped`）。
    _skipped = _periods_skipped(_periods)
    return {"success": True, "periods": _periods,
            "current": db.forecast_period_default(),
            "open": _open,
            # v368：附加字段，**不改变**上面四个字段的任何既有语义 ——
            #   前端老代码不看它们也能照常工作（纯增补，不是换口径）。
            "skipped": _skipped,
            "skipped_dates": sorted({s["arrival_date"] for s in _skipped}),
            # v355（2026-10-01）：
            #   `open_stale` —— 上面那个「进行中」的期次，其实**报单窗口已经过去了**。
            #     🔴 为什么这一位是必需的：前端那条「当前没有进行中的期次」横幅判的是
            #        **有没有** open 期次（`hasOpenPeriod`），而僵尸期次**自己就冒充 open**
            #        ⇒ 横幅不出现 ⇒ 用户看到"有期次"，实际报不了单，而它正挡着自动建表。
            #        生产实证：2026-09-29 ~ 10-01 连着两天零提示。
            #        判据 `forecast_period_stale_open` 与报单硬锁同源（含 id>0 护栏）。
            #   `auto_reap_on` —— 决定同一句话怎么说（会自动收 / 只能你手动收），
            #        理由与 fail-safe 方向见 `_auto_reap_on`。
            "open_stale": db.forecast_period_stale_open(_open),
            "auto_reap_on": _auto_reap_on()}


@router.get("/order-board")
def order_board(request: Request):
    """预报订单历史看板：按期次聚合关键指标。

    v368：增补 `skipped`（到货日被标记「不到货」的已存在期次）与行内
          `arrival_skipped` 标记 —— 期次列表据此给出「有 N 期的货不来了」说明
          与**一键作废**入口（见 `_periods_skipped`）。
    """
    _auth(request)
    _board = db.forecast_order_board()
    _skipped = _periods_skipped(_board)
    _ids = {int(s["id"]) for s in _skipped}
    for r in (_board or []):
        r["arrival_skipped"] = 1 if int(r.get("id") or 0) in _ids else 0
    return {"success": True, "board": _board, "skipped": _skipped}


# ========================================================================
# v282（2026-09-26）：「沿用到了上一期，却带过来 **0 个商品**」必须**告警**
# ========================================================================
# 🔴 为什么加这段 —— 生产实证（2026-09-26，不是推测）：
#   期次 #18 是 v273 上线**之前**建的，没走过沿用逻辑 ⇒ 自己清单是空的；
#   期次 #19 上线后自动建，沿用「上一期（#18）」⇒ **复制 0 行、打印「0 个商品」、零告警**。
#   后果：小程序报单页**完全空白**，用户到打开页面那一刻才发现，而**再下一期会继续沿用这个空清单**
#   （逐期传染，见 forecast-order-domain.md §沿用上一期）。
#
# 设计取舍（为什么不在这里「自动往前找非空期次」）：
#   「沿用上一期」是**用户可见的既定口径**（前端新建表单就写着「会带过来哪一期的清单」）。
#   静默改锚点 = 用户看到的提示与实际行为不一致，比空清单更难排查。
#   ⇒ 本函数只**把话说出来**，锚点一个字不改。
_CARRY_EMPTY_TITLE = "本期报单商品清单是空的"


def _carry_empty_warn(src_id, src_name, src_count):
    """返回 (warning_text, log_text)；`src_id<=0`（压根没有上一期）时返回空 → 不算异常。"""
    if int(src_id or 0) <= 0:
        return "", ""
    _label = (src_name or "").strip() or ("期次#%d" % int(src_id))
    _n = int(src_count or 0)
    if _n > 0:
        # 上一期有清单、却一个都没带过来 ⇒ 目标期次里已有同商品（幂等跳过），不是缺陷
        return ("上一期「%s」有 %d 个商品，但没有新增（本期已有相同商品）。"
                "请核对本期的商品清单是否符合预期。" % (_label, _n),
                "[v282][carry-empty] src=#%d「%s」src_count=%d added=0（目标已有同商品，非缺陷）"
                % (int(src_id), _label, _n))
    return ("上一期「%s」自己的商品清单就是**空的** ⇒ 本期也没能带过来任何商品。"
            "照这个走，小程序报单页会是一片空白，而且**下一期还会继续沿用这个空清单**。"
            "处理：打开「预报 → 本期」，点空态行的「从上一期复制清单」挑一个清单不为空的期次，"
            "或直接导入 Excel。" % _label,
            "[v282][carry-empty] src=#%d「%s」src_count=0 ⇒ 沿用得到 0 个商品（源期次本身为空，会逐期传染）"
            % (int(src_id), _label))


@router.post("/periods")
async def create_period(request: Request):
    _auth(request)
    b = await request.json()
    _v(FcPeriodCreate, b)
    # 🔴 v368（老板拍板，**刻意如此**，别"顺手"改掉）：
    #   手动建表**不读**「到货停单」（`rebate_arrival_skip_map` / `build_period_plan`
    #   的 `skips_by_rule`）。停单管的是「**系统别替我建**」，不是「**我不许建**」——
    #     用户在「目标与返利 → 到货节奏」点掉某天 = 告诉系统那天别自动开表；
    #     他自己点「新建期次」要补一期，必须能建（v354/355 死锁的教训之一正是
    #     「系统替用户做了不可回退的决定」）。
    #   ⇒ 这里**一行都不碰**停单数据；任何"手动建表也该被拦"的改动必须先问过口径。
    #     验收判据：停单日对应的期次，手动建表**必须建得出来**（v368 harness G12 组）。
    # 2026-09-16：硬校验在 db.forecast_period_create 内部（period_validate，唯一实现）
    try:
        pid = db.forecast_period_create(b["name"], b["order_start"], b["order_end"], b["arrival"])
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    # v273（2026-09-25）：**自动沿用上一期的商品清单**。
    #
    # 🔴 复用 `forecast_period_seed` —— 它是 v184 的**唯一**复制实现（只搬
    #    `forecast_import_products`、带 `origin='seeded'`、按 (period_id, product_id) 幂等、
    #    连 v202 的模板行序一起带）。**绝不在这里新写第二份复制 SQL**：
    #    「同一份数据两处实现」必然漂移，而漂移在这里的后果正是 8 月底那次
    #    「模版 159 个、系统里 275 个」的并集 bug（见 forecast-order-domain.md §跨期复制）。
    # 新期次刚 INSERT 出来必为 `status='open'`（DDL DEFAULT 'open'），满足 seed 的前置条件。
    # 「上一期」按**业务时间序**判定（`forecast_period_prev_id(order_start)`），不是按 id。
    _seed = bool(b.get("seed_from_prev", True))
    _copied, _src_id, _src_name = 0, 0, ""
    _src_count = 0
    if _seed:
        try:
            _src_id = db.forecast_period_prev_id(b["order_start"], exclude_id=pid)
            if _src_id:
                _r = db.forecast_period_seed(pid, _src_id)
                _copied = int(_r.get("added") or 0)
                _src_name = _r.get("src_name") or ""
                _src_count = int(_r.get("src_count") or 0)   # v282：区分「源为空」与「全跳过」
            # 没有更早的期次 ⇒ 本期就是第一期，无可沿用。**不是错误**，静默放过。
        except Exception as ex:
            # 🔴 沿用失败**绝不阻断创建**（fail-open）：期次已经建成了，用户还能走
            #    空态行的「从上一期复制清单」或直接导入。但**必须留痕** ——
            #    否则「没带出来」又变成一次没有线索的静默失效。
            logging.getLogger("hergent").warning(
                "[period-create] 期次#%s 沿用上一期清单失败（已跳过，期次本身已创建）: %s", pid, ex)
    # v282：「有上一期、却 0 个商品」⇒ 必须在**日志 + 响应**两处都说出来（前端据此出黄色提示）。
    _carry_warn, _carry_log = _carry_empty_warn(_src_id, _src_name, _src_count) if _copied == 0 else ("", "")
    if _carry_log:
        logging.getLogger("hergent").warning("[period-create] 期次#%s %s", pid, _carry_log)
    return {"success": True, "id": pid, "copied": _copied,
            "src_id": _src_id, "src_name": _src_name,
            "src_count": _src_count, "carry_warn": _carry_warn}


# 期次字段中文名（留痕明细用）——与前端表单标签一致，避免审计里出现英文字段键
_PERIOD_FIELD_LABEL = {"name": "期次名称", "order_start": "下单开始",
                       "order_end": "下单截止", "arrival": "预计到货"}


@router.patch("/periods/{pid}")
async def update_period(request: Request, pid: int):
    """修改期次名称 / 日期（**仅 open 期次**）。2026-09-16 新增。

    为什么必须有：此前期次只有 create / close / delete 三条路径 ⇒ 名字打错只能
    「关闭 → 删除」，而删除会级联删掉该期次全部报单/明细/定稿/付款/订单且不可恢复。
    补上本接口后，「新建期次」才成为可逆操作。

    RBAC：`/api/forecast` 前缀已映射到 `data` 模块（server.py:_PATH_MODULE_MAP），
    PATCH → `update` 动作。已核实生产 `role_permissions` 只有 1 条自定义行（supervisor）
    且为 legacy list 格式（list = 该模块全动作），其余角色走 `_DEFAULT_PERMS` 的 list
    ⇒ 所有持有 `data` 的角色都具备 `data:update`，本接口不需要新增权限项。
    """
    u = _auth(request)
    b = await request.json()
    if not isinstance(b, dict):
        raise HTTPException(400, "请求体格式不对")
    _allowed = {"name", "order_start", "order_end", "arrival"}
    if not (_allowed & set(b.keys())):
        raise HTTPException(400, "没有要修改的内容")
    if not db.forecast_period_get(pid):
        raise HTTPException(404, "期次不存在或已删除")
    label = _period_label(pid)      # 改前快照：留痕要能看出「从什么改成什么」
    try:
        r = db.forecast_period_update(
            pid,
            name=b.get("name"),
            order_start=b.get("order_start"),
            order_end=b.get("order_end"),
            arrival=b.get("arrival"),
        )
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if not r["changed"]:
        # 同值重提不留痕（留痕铁律：只记真实变化）
        return {"success": True, "changed": {}, "noop": True, "period": r["period"]}
    _detail = "；".join(
        f"{_PERIOD_FIELD_LABEL.get(k, k)} {v[0] or '（空）'} → {v[1] or '（空）'}"
        for k, v in r["changed"].items()
    )
    # 改期次窗口会改变该期全部口径（达成月归属 / 返利 / 舟谱导出），属实质性改动 → 留痕
    _audit_period_op(u, pid, "period_update", f"{label}｜{_detail}")
    return {"success": True, "changed": r["changed"], "period": r["period"]}


@router.post("/periods/{pid}/copy")
async def copy_period(request: Request, pid: int):
    """复制期次：**新建**一个期次，只把源期次的**商品清单**带过来。2026-09-17 新增。

    为什么必须有：此前「照着上一期建下一期」只能重建 —— 期次没有复制路径，
    商品清单得靠重新导入一遍。往期预报列表的「复制」按钮走这里。

    🔴 **只带商品清单这一个桶**（`forecast_import_products`，归属键 = period_id）。
    **不带**报单明细 / 加单 / 定稿 / 付款 —— 后两者的归属键是
    `(period_start, period_end)` **日期窗口**而非期次 id（见
    `routers/forecast_submissions.py:462`、`erp_db.py:15200`），复制过来会让新期与源期
    **共用同一份**加单与定稿（窗口重叠即串期），且同屏不报任何错。
    客户列 / 户头来自 `report_mapping`，是全局的、不按期次，无需复制。

    「复制」对**任何真实期次**开放、**不限 open** —— 源可以是已关闭期次，这正是
    「复制满意的那一期」的主场景。合成期次（id<0，来自 order-board）没有
    forecast_periods 记录，在这里自然 404（前端也已按 `Number(row.id) > 0` 屏蔽）。
    """
    u = _auth(request)
    b = await request.json()
    if not isinstance(b, dict):
        raise HTTPException(400, "请求体格式不对")
    src = db.forecast_period_get(pid)
    if not src:
        raise HTTPException(404, "源期次不存在或已删除")
    for k, lab in (("name", "期次名称"), ("order_start", "下单开始"),
                   ("order_end", "下单截止"), ("arrival", "预计到货")):
        if not str(b.get(k) or "").strip():
            raise HTTPException(400, f"请填写{lab}")
    try:
        r = db.forecast_period_copy(pid, b["name"], b["order_start"],
                                    b["order_end"], b["arrival"])
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    _src_label = src.get("name") or f"期次#{pid}"
    _copied = f"带过来 {r['copied']} 个商品（不含报单数量 / 加单 / 定稿）"
    # 两个方向都留痕：源期次上记「被复制成了哪一期」，新期次上记「从哪来」——
    # 否则几轮之后没人知道某期的清单最初出自何处。
    _audit_period_op(u, pid, "period_copy", f"{_src_label} → 新期次「{r['name']}」｜{_copied}")
    _audit_period_op(u, r["id"], "period_copy", f"复制自「{_src_label}」｜{_copied}")
    return {"success": True, "id": r["id"], "name": r["name"],
            "copied": r["copied"], "src_name": r["src_name"]}


@router.post("/periods/{pid}/seed")
async def seed_period(request: Request, pid: int):
    """把期次 {pid}（源）的**商品清单**填入目标期次。2026-09-17 新增。

    与 `copy` 的分工：`copy` 建**新**期次（往期列表「复制」）；本接口往**已存在**的
    期次里填（汇总表空态行的「从上一期复制清单」）—— 空期次不必先删掉再重建。

    目标必须是 **open** 期次（关闭即定稿，不许再变）。幂等：目标里已有的商品按
    (period_id, product_id) 跳过，不覆盖用户已改的登记。
    """
    u = _auth(request)
    b = await request.json()
    if not isinstance(b, dict):
        raise HTTPException(400, "请求体格式不对")
    try:
        tgt = int(b.get("target_period_id") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "目标期次参数不对")
    if tgt <= 0:
        raise HTTPException(400, "请指定要填入的目标期次")
    if tgt == pid:
        raise HTTPException(400, "源期次与目标期次是同一个")
    try:
        r = db.forecast_period_seed(tgt, pid)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    _detail = (f"「{r['src_name']}」→「{r['target_name']}」｜新增 {r['added']} 个商品"
               + (f"，跳过 {r['skipped']} 个（本期已有）" if r["skipped"] else "")
               + "（不含报单数量 / 加单 / 定稿）")
    _audit_period_op(u, tgt, "period_seed", _detail)
    # v282：手动点「从上一期复制清单」也同样要说得清楚 —— 尤其「源期次自己就是空的」那种，
    #   用户点完看到的还是空表格，若只回一句「新增 0 个商品」就等于又一次静默失效。
    _carry_warn, _carry_log = _carry_empty_warn(pid, r.get("src_name"), r.get("src_count")) \
        if int(r.get("added") or 0) == 0 else ("", "")
    if _carry_log:
        logging.getLogger("hergent").warning("[period-seed] 目标期次#%s %s", tgt, _carry_log)
    return {"success": True, "added": r["added"], "skipped": r["skipped"],
            "before": r["before"], "after": r["after"], "src_name": r["src_name"],
            "src_count": int(r.get("src_count") or 0), "carry_warn": _carry_warn}


@router.post("/periods/{pid}/close")
def close_period(request: Request, pid: int):
    """关闭期次（= 定稿）。**同时是加单/减单通知的唯一推送出口**（v318）。

    🔴 v318 变更（用户拍板）：加单/减单通知原先挂在 `POST /forecast-submissions/save-matrix`
       上（v277 需求 7）。但保存是**草稿**动作 —— 经理每改一轮就保存一次，通知发一次；
       而真正的终态是「关闭期次」（弹窗原文就写着「关闭 = 定稿」），它此前一条通知都不发。
       现在出口唯一化：只有真·定稿才通知，保存不再发。

    🔴 幂等靠**状态跃迁**（`forecast_period_close` 返回是否真的 open→closed），不靠通知层去重：
       重复点「确认关闭」/ 前端重试 ⇒ 不重复推送；而「关 → 重开 → 再关」这第二次真定稿
       必须**再发一次**（通知层的 24 小时窗口会把那次折叠掉，所以那边已关掉去重）。

    ⚠️ 通知失败**不影响定稿**（定稿已提交成功，回执里如实说明发了几条）—— 与
       `save-matrix` 里「通知失败不能升级成保存失败」是同一条纪律。
    ⚠️ 自动关单（`scheduler.py` 的到期自动关闭走的是 `db.forecast_period_close`，不经本端点）
       不触发通知 —— 通知正文带「操作人」，它对应的是**经理当面点下的那次定稿**。

    🆕 v319（2026-09-29）：① 落 `closed_by/closed_mode='manual'` 留痕；
       ② 推送成功后写 `alloc_pushed_at` —— 于是「关闭了但通知还没发出去」这件事
          在库里**可见**（自动关单的期次会停在这一档），历史页据此给出手动推送入口。
    """
    u = _auth(request)
    _who = (u.get("display_name") or u.get("username") or "经理")
    transitioned = db.forecast_period_close(pid, by=_who, mode="manual")
    # 关闭 = 经理的审批定稿动作之一，必须留「谁关的」
    _audit_period_op(u, pid, "period_close",
                     f"{_period_label(pid)}（关闭后不再接受新报单）")
    notified = {"sent": 0, "skipped": 0, "people": 0}
    if transitioned:
        try:
            # 局部 import：本模块与 product_targets 无静态依赖，避免在 import 期引入环
            from routers.product_targets import notify_extra_allocs_finalized
            notified = notify_extra_allocs_finalized(pid, operator=_who)
            # 推送出口**走成功**（不论实际发了几条）就记时刻：本期没有加/减单时 sent=0，
            # 那也是「这个动作已完成」；界面对「没有分配行」的期次不显示推送按钮，
            # 所以不会出现"点了没反应"。抛异常则**不标记** ⇒ 如实停在「尚未推送」。
            db.forecast_period_mark_alloc_pushed(pid)
        except Exception as e:
            import logging
            logging.getLogger("hergent").warning(
                "v318 定稿通知发送失败（关闭已成功，期次#%s）：%s", pid, e)
    return {"success": True, "notified": notified, "closed_by": _who}


@router.post("/periods/{pid}/push-alloc")
def push_alloc(request: Request, pid: int):
    """v319：**手动推送**本期的加单/减单明细（用户 2026-09-29 拍板）。

    🔴 为什么需要这个出口：v318 把推送挂在「关闭期次」上，但生产上期次的关闭**主要来自
       自动关单**（`scheduler._auto_period_close` 直调 db 层、没有操作人 ⇒ 不发通知）。
       实测 2026-09-29 期次 #21 就是自动关的 ⇒ **加单/减单通知一条都没发**，界面毫无提示。
       ⇒ 现在把出口**定在人确认的那一次**：自动关单只改状态，推送由人在这里点。
       （为什么不"顺手也挂到自动关单上"：自动关单 11:00、v305 授权改单可改到 12:00
         ⇒ 11:00 推的是**一小时后还会被改掉**的版本，而推送**不可撤回**。）

    幂等/重复推：本端点**不拦重复**（人点两次就发两次）—— 因为这里是人明确点的动作，
       与「关闭期次」的隐式推送不同。但仍写 `alloc_pushed_at` 供界面显示"上次推送时间"。
       ⚠️ 若要防误点，是前端 confirm 的职责，不在服务端拦（服务端拦反而会让
          "补推一次"这个正当操作做不到）。
    """
    u = _auth(request)
    _who = (u.get("display_name") or u.get("username") or "经理")
    p = db.forecast_period_get(pid)
    if not p:
        raise HTTPException(404, "期次不存在或已删除")
    try:
        from routers.product_targets import notify_extra_allocs_finalized
        notified = notify_extra_allocs_finalized(pid, operator=_who)
    except Exception as e:
        import logging
        logging.getLogger("hergent").warning("v319 手动推送加单明细失败（期次#%s）：%s", pid, e)
        raise HTTPException(500, "推送失败，请稍后重试")
    db.forecast_period_mark_alloc_pushed(pid)
    _audit_period_op(u, pid, "period_push_alloc",
                     f"{_period_label(pid)}（加单/减单明细推送：发出 {notified.get('sent', 0)} 条）")
    return {"success": True, "notified": notified}


@router.post("/periods/{pid}/reopen")
def reopen_period(request: Request, pid: int, mode: str = "full"):
    """v219：重开期次（撤销「关闭 = 定稿」）。
    🆕 v319（用户 2026-09-29 拍板）：拆成**两个语义不同的动作**，用 `mode` 区分。

      · `mode=unlock`（**解锁编辑**）—— `status` **保持 closed**，只记「人工已接管」
        （`reopened_at`）⇒ 授权角色可经 v305 通道改数，而**销售的小程序报单通道不打开**。
        副作用最小，是「我只要改一个错数」的正确选择。
      · `mode=full`（**恢复报单**，**默认**）—— `status` 回 `open`，销售可继续报单。
        ⚠️ 默认值取 full 是**向后兼容**：旧前端不带 mode 调用时行为与 v219 逐字一致。

    存在理由见 `db.forecast_period_reopen` 的 docstring：关闭此前是**单向**的，
    而 open 期次又不许删 ⇒ 误关一次即永久锁死、无补救。本接口是那条补救路径。

    两个 mode 都会写 `reopened_at` —— 那是**自动关单的豁免键**（v319）：没有它，
    `full` 重开会在 2~5 分钟内被调度器重新关掉（生产 2026-09-27 实测两次）。

    与 `close` 对称：同样走 `/api/forecast` 前缀的 RBAC（`data` 模块），同样留痕。
    """
    u = _auth(request)
    _m = "unlock" if str(mode or "").strip() == "unlock" else "full"
    ok = db.forecast_period_reopen(pid, mode=_m)
    if not ok:
        raise HTTPException(404, "期次不存在或已删除")
    _audit_period_op(u, pid, "period_unlock" if _m == "unlock" else "period_reopen",
                     f"{_period_label(pid)}"
                     + ("（解锁编辑：可改数，销售报单通道不开）" if _m == "unlock"
                        else "（恢复报单：销售可继续报单）"))
    return {"success": True, "mode": _m}


@router.delete("/periods/{pid}")
def delete_period(request: Request, pid: int):
    u = _auth(request)
    label = _period_label(pid)          # 必须在删除前取，删完就查不到了
    # A4 修复 (2026-07-24)：失败不再返回 200+success:false 伪成功，改用 HTTP 状态码——
    # 不存在 404（前端 catch 已有 toast），非法操作 400。
    try:
        ok = db.forecast_period_delete(pid)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if not ok:
        raise HTTPException(404, "期次不存在或已删除")
    # 删除是不可恢复的破坏性操作，留痕（记录随 forecast_config 留存，不随期次级联删除）
    _audit_period_op(u, pid, "period_delete", f"{label}（含该期全部报单/订单/定稿/付款，不可恢复）")
    return {"success": True}


@router.post("/periods/{pid}/void")
def void_period(request: Request, pid: int):
    """v368：**作废**一个「本不该建」的期次（那批货不到）。

    🔴 为什么是「关闭 + 留痕」而不是「删除」——两个硬约束逼出来的唯一解：
       (a) `forecast_period_delete` **只删已 closed 的期次**（open 直接抛错），
           而误建的期次恰恰**总是 open 的**（刚被自动建出来、还没人报单）
           ⇒ 「先作废再删」才删得动，而真删会**级联删掉该期全部报单/订单/付款**
           （不可恢复）—— 万一已经有人报过单，那就是数据事故；
       (b) 自动建表那道硬闸是「同一时间只能有一个 **open** 期次」⇒ 误建的那期
           只要还是 open，就一直**挡着下一期自动建表**（v354/355 死锁同款）。
       ⇒ 作废 = `forecast_period_close(pid, mode='void')`：
           · status → closed ⇒ 立刻让开那道硬闸（这是"一键作废"真正要解决的事）；
           · `closed_mode='void'` ⇒ 与「人工定稿 / 系统到点 / 系统回收」**可区分**，
             历史页据此显示「已作废」（`ForecastHistory.closeHint` 已同批改）；
           · **数据全留** ⇒ 报过的单查得到，且 `reopen` 能救回来（真删就救不回）。

    ⚠️ 刻意**走 db 函数、不经 `close_period` 端点** ⇒ 不发加单/减单通知：
       这是「撤销」，不是「定稿」，给用户推"本期已定稿"是错的。
    ⚠️ 幂等：重复点只返回 `transitioned=False`，不改 `closed_at/closed_by`
       （v319 的状态跃迁语义：留痕只在真跃迁时写）。
    """
    u = _auth(request)
    _who = (u.get("display_name") or u.get("username") or "经理")
    _row = db.forecast_period_get(pid)
    if not _row:
        raise HTTPException(404, "期次不存在或已删除")
    _label = _period_label(pid)
    transitioned = db.forecast_period_close(pid, by=_who, mode="void")
    if transitioned:
        # 🔴 留痕与「删除」分开记账：两者后果完全不同（一个可恢复、一个不可恢复），
        #    混在一个 action 里会让审计无法回答「这一期到底还在不在」。
        _audit_period_op(u, pid, "period_void",
                         f"{_label}（到货日已标记「不到货」⇒ 作废；数据保留，可重开）")
    return {"success": True, "transitioned": bool(transitioned), "voided_by": _who,
            "was_open": (str((_row or {}).get("status") or "open") == "open")}


# ===== A8 修复 (2026-07-24)：删除被 forecast_config.py 先注册覆盖的死代码 =====
# 原 GET/PUT /api/forecast/column-schemes 与下方 accuracy 均由 forecast_config_router
# 先行 include（server.py L753 < L817），此文件版本永远不可达；前端实际消费 config 版
# 响应。保留会让两个实现并存、口径漂移，故删除。

@router.get("/orders/{period_id}")
def list_orders(request: Request, period_id: int):
    _auth(request)
    return {"success": True, **db.forecast_order_list(period_id), "stats": db.forecast_submitter_stats(period_id)}

@router.post("/orders")
async def submit_order(request: Request):
    _auth(request)
    b = await request.json()
    _v(FcOrderSubmit, b)
    oid = db.forecast_order_create(b["period_id"], b["submitter_name"], b.get("submitter_type","sales"),
                                    b["product_name"], b["quantity"], b.get("unit","箱"), b.get("unit_price",0))
    # A1/A2 修复 (2026-07-24)：
    # - A2：按 period_id 精确取本期次（原代码取 forecast_period_list()[0]=最新期次，与本单无关，
    #   多期次并存时统计错乱）
    # - A1：all_done 恒真问题——期次表（forecast_periods）无 expected_submitters 配置字段，
    #   原 `len(stats) >= b.get("expected_submitters", len(stats))` 默认值即 len(stats) 恒真，
    #   且客户端可伪造任意期望值。修正为仅回传真实已报人数，不再下发误导性"全员完成"。
    stats = db.forecast_submitter_stats(b["period_id"])
    return {"success": True, "id": oid, "all_submitted": bool(stats),
            "reported_count": len(stats)}

@router.post("/orders/{oid}/review")
async def review_order(request: Request, oid: int):
    _auth(request)
    b = await request.json()
    _v(FcOrderReview, b)
    db.forecast_order_review(oid, b["reviewer_qty"], b.get("notes",""))
    return {"success": True}

@router.post("/orders/{oid}/confirm")
def confirm_order(request: Request, oid: int):
    _auth(request)
    db.forecast_order_confirm(oid)
    return {"success": True}

# KPI
@router.get("/kpi")
def kpi_list(request: Request, month: str = None):
    _auth(request)
    if not month: month = datetime.now().strftime("%Y-%m")
    return {"success": True, "targets": db.kpi_target_list(month), "achievement": db.kpi_achievement_calc(month)}

@router.post("/kpi")
async def kpi_create(request: Request):
    _auth(request)
    b = await request.json()
    _v(FcKpiCreate, b)
    kid = db.kpi_target_create(b["month"], b["name"], b.get("type","sales_amount"), b["value"], b.get("unit","元"), b.get("brand",""))
    return {"success": True, "id": kid}

# Template generation
@router.get("/template/{period_id}")
def generate_template(request: Request, period_id: int):
    """Generate self-pickup + transfer order templates."""
    _auth(request)
    orders = db.forecast_order_list(period_id)
    period = None
    for p in db.forecast_period_list():
        if p["id"] == period_id: period = p; break
    html = _build_template_html(period, orders.get("orders", []))
    return {"success": True, "html": html, "period_name": period.get("name","") if period else ""}

def _build_template_html(period, orders):
    """Build printable HTML template for self-pickup and transfer orders."""
    if not period: return "<p>未找到预报周期</p>"
    arrival = period.get("arrival_date","")
    h = '<div style="font-family:PingFang SC,sans-serif;padding:20px;max-width:800px;margin:0 auto">'
    h += '<h2 style="text-align:center;margin-bottom:4px">预报订单-自提单</h2>'
    h += f'<p style="text-align:center;color:#666">到货日期: {arrival} | 生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M")}</p>'
    # Group by submitter
    groups = {}
    for o in orders:
        s = o.get("submitter_name","")
        groups.setdefault(s, []).append(o)
    for name, items in groups.items():
        h += f'<h3 style="margin-top:20px;border-bottom:1px solid #ddd;padding-bottom:4px">{name}</h3>'
        h += '<table style="width:100%;border-collapse:collapse;margin-top:8px"><tr style="background:#f5f5f5"><th style="padding:6px;text-align:left">商品</th><th style="padding:6px;text-align:right">数量</th><th style="padding:6px;text-align:right">单价</th><th style="padding:6px;text-align:right">金额</th></tr>'
        for o in items:
            qty = o.get("reviewer_qty") or o.get("quantity",0)
            price = o.get("unit_price",0)
            h += f'<tr><td style="padding:6px">{o["product_name"]}</td><td style="padding:6px;text-align:right">{qty}{o.get("unit","箱")}</td><td style="padding:6px;text-align:right">¥{price:.0f}</td><td style="padding:6px;text-align:right">¥{qty*price:.0f}</td></tr>'
        h += '</table>'
        total = sum((o.get("reviewer_qty") or o.get("quantity",0)) * o.get("unit_price",0) for o in items)
        h += f'<p style="text-align:right;margin-top:4px"><strong>小计: ¥{total:,.0f}</strong></p>'
    grand = sum((o.get("reviewer_qty") or o.get("quantity",0)) * o.get("unit_price",0) for o in orders)
    h += f'<hr style="margin-top:20px"><p style="text-align:right;font-size:18px"><strong>总计: ¥{grand:,.0f}</strong></p>'
    h += '<p style="margin-top:40px">提货人签名: ___________  日期: ___________</p>'
    h += '</div>'
    return h

# Payment check
@router.get("/payment-check/{period_id}")
def payment_check(request: Request, period_id: int):
    """Calculate how much needs to be paid based on orders minus system balance."""
    _auth(request)
    orders = db.forecast_order_list(period_id)
    total = sum((o.get("reviewer_qty") or o.get("quantity",0)) * o.get("unit_price",0) for o in orders.get("orders",[]))
    # Get available balance from accounts
    try:
        accts = db.account_summary()
        bal = sum(a.get("balance",0) for a in (accts or [])) if isinstance(accts, list) else 0
    except Exception:
        bal = 0
    return {"success": True, "order_total": round(total,0), "available_balance": round(bal,0),
            "need_to_pay": round(max(0, total - bal), 0)}

# Bank statements
@router.get("/bank")
def bank_list(request: Request, status: str = None):
    _auth(request)
    return {"success": True, "statements": db.bank_statement_list(status)}

@router.post("/bank")
async def bank_import(request: Request):
    _auth(request)
    b = await request.json()
    _v(FcBankImport, b)
    imported = 0
    for row in b.get("rows", []):
        db.bank_statement_import(row.get("date",""), float(row.get("amount",0)),
                                row.get("direction","in"), row.get("counterparty",""), row.get("desc",""))
        imported += 1
    return {"success": True, "imported": imported}

@router.post("/bank/{sid}/match")
async def bank_match(request: Request, sid: int):
    _auth(request)
    b = await request.json()
    _v(FcBankMatch, b)
    db.bank_statement_match(sid, b["ref_type"], b["ref_id"])
    return {"success": True}

# ============================================================
# P1-2 厂家预存款余额 & 付款闭环（定稿金额口径：decisions.final_qty × 进价）
# ============================================================
@router.get("/payments/balance")
def payments_balance(request: Request):
    """厂家预存款余额列表（每供应商最新一条）。"""
    _auth(request)
    return {"success": True, "balances": db.supplier_balance_list()}


@router.post("/payments/balance")
async def payments_balance_save(request: Request):
    """更新厂家余额：{supplier_id, supplier_name, balance}。"""
    u = _auth(request)
    b = await request.json()
    b = b if isinstance(b, dict) else {}
    return db.supplier_balance_upsert(
        b.get("supplier_id", 0), b.get("supplier_name", "蒙牛"), b.get("balance", 0),
        str(u.get("name") or u.get("id") or ""))


def _price_stat_out(st):
    """付款口径的 `price_stat` 返回结构 —— `/payments/compute` 与 `/payments/preview` **共用**。

    ⚠️ 这不是"统计好看用"的字段，是**诚实回报**链的一环：
       `fallback_rows`  = 缺进价、按标准售价折箱估算的行数（金额**略偏高**）
       `no_price_rows`  = 连价都没有 ⇒ **未计入金额**的行数
       `no_ratio_rows`  = 有报单量但换算不出箱 ⇒ **未计入金额**的行数
       后两者是「金额偏小」的**唯一线索** —— 没有它们，界面只能显示一个
       看起来完整的数（「零值即健康」的孪生病灶：**看着完整**）。
       生产实测 tenant_1 / 472 商品里**有进价的仅 158 个** ⇒ 这两项经常非 0，不是罕见分支。
    """
    return {"factory_rows": int(st.get("factory_rows") or 0),
            "purchase_rows": 0,          # 兼容：v226b 起恒 0
            "fallback_rows": int(st.get("fallback_rows") or 0),
            "fallback_qty": round(float(st.get("fallback_qty") or 0), 2),
            "no_price_rows": int(st.get("no_price_rows") or 0),
            "no_ratio_rows": int(st.get("no_ratio_rows") or 0),
            "orphan_rows": int(st.get("orphan_rows") or 0),
            "order_box": round(float(st.get("order_box") or 0), 3),
            "extra_box": round(float(st.get("extra_box") or 0), 3),
            "product_rows": int(st.get("product_rows") or 0),
            "period_id": int(st.get("period_id") or 0),
            "caliber": st.get("caliber") or ""}


@router.post("/payments/compute")
async def payments_compute(request: Request):
    """计算本期需付款：订单金额(Σ定稿量×进价) − 厂家余额 → 差额。
    落 period_payments(pending) + 推送（差额>0 提醒付款，=0 告知无需付款）。"""
    u = _auth(request)
    try:
        b = await request.json()
    except Exception:
        b = {}
    b = b if isinstance(b, dict) else {}
    start, end = (b.get("start") or ""), (b.get("end") or "")
    if not start or not end:
        raise HTTPException(400, "缺少 start/end 报单窗口")
    supplier_id = int(b.get("supplier_id") or 0)
    supplier_name = (b.get("supplier_name") or "蒙牛")[:40]
    # 🔴 v319（2026-09-29，用户拍板）：金额口径**改成「报单合计 + 加单」**，
    #   唯一实现在 `routers/product_targets.period_order_amount()`（本端点与 `/payments/preview` 共用
    #   —— 两处各写一份必然漂移，而这笔钱要拿去付厂家，不能有两个答案）。
    #   旧实现读 `forecast_audit_decisions.final_qty`：那是**已废弃的「审核台定稿量」**，
    #   生产只读实测该表 **0 行** ⇒ `order_amount` 恒 0 ⇒ `gap = max(0, 0-balance) = 0`
    #   ⇒ 旧前端显示**绿色**的「需付款 ¥0」（数字是 0、颜色是绿的、零报错，而真实值约 ¥4657）。
    #   为什么换成报单量：**报单是当前唯一真实的量**（审核台那条流程已废弃），加单按其分配
    #   结果（`alloc_box`，已是箱）并入。口径与诚实回报字段见该函数 docstring。
    #   ⚠️ 局部 import：本模块与 product_targets 无静态依赖（同 v318 的通知函数），避免 import 期成环。
    from routers.product_targets import period_order_amount, period_id_by_window
    _pid_for_amount = period_id_by_window(start, end)
    order_amount, price_stat = period_order_amount(_pid_for_amount, start, end)
    # 兼容：`purchase_rows` 字段保留在返回结构里（v226b 起恒 0），避免破坏既有调用方解析。
    price_stat["purchase_rows"] = 0
    price_stat["period_id"] = _pid_for_amount
    balance = 0.0
    try:
        bl = db.supplier_balance_list()
        if supplier_id:
            for x in bl:
                if int(x.get("supplier_id") or 0) == supplier_id:
                    balance = float(x.get("balance") or 0)
                    break
        elif bl:
            balance = float(bl[0].get("balance") or 0)
    except Exception:
        balance = 0.0
    gap = max(0.0, order_amount - balance)
    db.period_payment_save(start, end, supplier_id, supplier_name, order_amount, balance, gap)
    # 🔴 v319：缺价/缺换算的商品**不进金额**，必须在推送正文里说出来 ——
    #   否则老板按一个**偏小**的数去付款（这正是「静默降级」最贵的形态：
    #   数字看着完整、颜色正常、零报错，而它是错的）。生产实测 472 个商品里
    #   有进价的仅 158 个 ⇒ 这个提示**经常会出现**，不是罕见分支。
    _miss = int(price_stat.get("no_price_rows") or 0) + int(price_stat.get("no_ratio_rows") or 0)
    _fb_note = ""
    if price_stat.get("fallback_rows"):
        _fb_note += (f"\n注意：{price_stat['fallback_rows']} 个商品没有进价，金额按标准售价估算")
    if _miss:
        _fb_note += (f"\n🔴 另有 {_miss} 个商品缺进价或换算比，金额**未含**它们 —— 实际应付可能更高")
    try:
        today = datetime.now().strftime("%m月%d日")
        if gap > 0:
            msg = (f"本期需付款 ¥{gap:,.0f}\n订单金额 ¥{order_amount:,.0f} − 厂家余额 ¥{balance:,.0f}（{supplier_name}）{_fb_note}")
            db.message_send(f"{today} 厂家付款 {start}~{end}", msg, "danger", "经营副驾")
            from feishu_notify import push_to_wecom, push_to_feishu
            push_to_wecom(f"{today} 厂家付款", msg)
            push_to_feishu(f"{today} 厂家付款", msg)
        else:
            db.message_send(f"{start}~{end} 付款确认",
                            f"本期订单 ¥{order_amount:,.0f} ≤ 厂家余额 ¥{balance:,.0f}，无需额外付款。{_fb_note}",
                            "info", "经营副驾")
    except Exception as e:
        print(f"[payments] push error: {e}")
    return {"success": True, "order_amount": round(order_amount, 2), "balance": round(balance, 2),
            "gap_amount": round(gap, 2), "need_pay": gap > 0,
            # ⚠️ 兼容别名（v319）：旧前端读的是 `r.need_to_pay`，而本接口一直只返回 `need_pay`
            #   ⇒ 那个三元判断恒走 else 分支 ⇒ 恒显示绿色「需付款 ¥0」，且「确认已付款」按钮
            #   **永不出现**（两个缺陷叠加，界面看起来完全正常）。两个键都给 ⇒ 连缓存住老包的
            #   前端也立刻显示对；`static/` 源码同步改成 `need_pay`（双保险，见该文件注释）。
            "need_to_pay": gap > 0,
            "price_stat": _price_stat_out(price_stat)}


@router.get("/payments/preview/{start}/{end}")
def payments_preview(request: Request, start: str, end: str, supplier_id: int = 0):
    """付款预览（只读，不落单不推送）：**订单金额（报单合计 + 加单）× 进价** − 厂家余额 → 差额。

    与 /payments/compute 使用**同一份实现**（`routers/product_targets.period_order_amount`），
    保证付款卡片显示与确认数一致（#5-② 口径统一）—— 两处各写一份必然漂移。

    🔴 v319（2026-09-29）：金额口径从「定稿量 × 进价」**改成「报单合计 + 加单」**。
    旧口径读 `forecast_audit_decisions`（已废弃的审核台定稿量，生产 **0 行**）⇒ 金额恒 0
    ⇒ 前端显示绿色的「需付款 ¥0」。而**旧前端读的键是 `need_to_pay`、本接口返回的是
    `need_pay`** ⇒ 那个三元判断恒走 else 分支 ⇒ 恒绿色、且「确认已付款」按钮永不出现
    （两个缺陷叠加，界面上看起来完全正常）。⇒ 本次两个都修：口径换掉，并**同时返回
    `need_to_pay` 兼容别名**（老包缓存住的前端也能立刻显示对，详见 static 侧注释）。

    ⚠️ 诚实回报：缺进价/缺换算比的商品**不进金额**，行数放在 `price_stat`
       （`no_price_rows` / `no_ratio_rows`）—— 界面必须能说「另有 N 个商品未含」。
    """
    _auth(request)
    from routers.product_targets import period_order_amount, period_id_by_window
    _pid_for_amount = period_id_by_window(start, end)
    order_amount, price_stat = period_order_amount(_pid_for_amount, start, end)
    price_stat["purchase_rows"] = 0        # 兼容：v226b 起恒 0
    price_stat["period_id"] = _pid_for_amount
    balance = 0.0
    try:
        bl = db.supplier_balance_list()
        if supplier_id:
            for x in bl:
                if int(x.get("supplier_id") or 0) == supplier_id:
                    balance = float(x.get("balance") or 0)
                    break
        elif bl:
            balance = float(bl[0].get("balance") or 0)
    except Exception:
        balance = 0.0
    gap = max(0.0, order_amount - balance)
    return {"success": True, "order_amount": round(order_amount, 2), "balance": round(balance, 2),
            "gap_amount": round(gap, 2), "need_pay": gap > 0,
            "need_to_pay": gap > 0,          # v319 兼容别名，理由见 /payments/compute 的注释
            "price_stat": _price_stat_out(price_stat)}


@router.post("/payments/confirm")
async def payments_confirm(request: Request):
    """付款到账确认：{start, end, paid_amount} → 标记 paid + 通知可生成下游订单/舟谱模板。"""
    u = _auth(request)
    try:
        b = await request.json()
    except Exception:
        b = {}
    b = b if isinstance(b, dict) else {}
    start, end = (b.get("start") or ""), (b.get("end") or "")
    if not start or not end:
        raise HTTPException(400, "缺少 start/end 报单窗口")
    paid = float(b.get("paid_amount") or 0)
    db.period_payment_confirm(start, end, paid, str(u.get("name") or u.get("id") or ""))
    try:
        today = datetime.now().strftime("%m月%d日")
        db.message_send(f"{today} 付款到账", f"周期 {start}~{end} 已确认到账 ¥{paid:,.0f}，可生成下游订单/舟谱导入模板。", "info", "经营副驾")
    except Exception:
        pass
    return {"success": True, "paid": paid}


# ============================================================
# P1-3 舟谱导入模版引擎（确定性生成，零 LLM 零 token）
#
# 逆向自用户真实的舟谱导入模板（2026-08 样本）：
#   自提订单：工作表「自提订单」22 列，按客户分单，单号 ZT{日期}{21起}，
#            必填 *源单据号/*业务员/*仓库/*单位/*数量/*单价(折后价)；
#            单价=下单表分销价格四舍五入两位；商品只填条码。
#   调拨订单：工作表「调拨订单」13 列，按业务员本人仓分单，单号 DB{日期}{01起}，
#            必填 *源单据号/*调出仓/*调入仓/*单位/*订单数量；调出仓固定总仓。
# 归属判定复用「报单配置」(report_mapping)：report_alias↔列头简称，
#   counterparty_type=self_warehouse→调拨，其余→自提。
# 单位来自提交明细（导入下单表时已落库），缺失按名称关键词推断兜底。
# ============================================================

ZT_HEADERS = [
    "*源单据号", "客户编号", "客户名称", "*业务员", "部门", "项目", "*仓库",
    "单据日期", "整单备注", "制单人", "商品编号", "商品货号", "商品名称",
    "商品条码", "*单位", "*数量", "*单价(折后价)", "订单金额", "明细备注",
    "业务属性", "标签", "",
]
DB_HEADERS = [
    "*源单据号", "*调出仓", "*调入仓", "单据日期", "*单位", "整单备注",
    "商品编号", "商品名称", "商品条码", "期望生产日期", "*订单数量",
    "调拨参考价", "明细备注",
]
# 自提模板的「业务员 / 部门 / 仓库」三列与单号起始序号 —— v160 (2026-09-14) 起一律取
# **租户业务参数**（`db.get_business_profile()`），不再硬编码。
# 原先这里是四个模块级常量（默认业务员 / 公司名称 / 默认仓 / 自提单号起始序号），
# 且写的是**一家客户的值** —— 那家公司的全称与那个人的人名，
# 于是任何租户生成模板都会把别家公司、别人的人名写进「部门」「业务员」列。
# 取值的唯一实现见 db/queries/business_profile.py；界面入口在「报单配置 → 模板参数」。
#
# ⚠️ 别混为一谈：ZT_HEADERS / DB_HEADERS（列名与列序）与单号形态 ZT{日期}{两位序号}
#    是**舟谱格式契约**，保留硬编码是**正确的**；只有上面那四个值是业务配置。

# 单位推断兜底：名称关键词→单位（下单表无单位列，主档未覆盖全部条码时用）
_UNIT_HINTS = [
    ("桶", "桶"), ("组", "组"), ("条", "条"), ("连杯", "杯"), ("杯", "杯"),
    ("连包", "包"), ("包", "包"), ("袋", "袋"), ("板", "板"), ("盒", "盒"),
    ("罐", "罐"), ("瓶", "瓶"), ("箱", "箱"),
]


def _guess_unit(name: str) -> str:
    n = str(name or "")
    for kw, u in _UNIT_HINTS:
        if kw in n:
            return u
    return "件"


def _fmt_barcode(v) -> str:
    if v is None or str(v).strip() == "":
        return ""
    try:
        return str(int(float(str(v).strip())))
    except Exception:
        return str(v).strip()


def _fmt_qty(v) -> int:
    try:
        return int(float(v or 0))
    except Exception:
        return 0


def _round_price(v) -> float:
    try:
        return round(float(v or 0), 2)
    except Exception:
        return 0.0


# ---------------------------------------------------------------- v232：模板单价
# 舟谱「*单价(折后价)」与「*单位」是**同一行上的两个格** ⇒ 必须同量纲。
# 真实样本（`自提订单导入模板_20260430.xlsx`，107 行）实测：`*单位=组 / *数量=36 /
# *单价(折后价)=7.67` —— 7.67 正是该商品的 `products.dist_price`（元/小单位），
# 而不是 82.8（`factory_price`，元/箱）。两者相差 `规格 × 0.9`（= 10.8 倍）。
#
# 🔴 而报单明细行的 `it["price"]` 在真实数据里**就是进价（元/箱）**：
#    生产 tenant_1 实测 544/560 行 `price == products.factory_price`，
#    且 `amount == 箱数 × 进价`（v217「本期需付款」口径）。
#    ⇒ 把明细价写进「*单价(折后价)」= 量纲错位（v217「99→990」的同族，方向相反）。
#
# ⇒ v232 起：单价取**该报单对象的渠道价**（`resolve_for_report`，v218 报告 §10.7 P2-1
#   + `预报订单导入模版与自提取价配置-设计-2026-09-14.md §4.3` 的既定设计）。
#   取不到 ⇒ 回退明细价（**不改变任何取不到的行**），并且必须**显式回报**。
#
# 为什么回退而不是「换算」：换算要用 perCase（档案换算，P2-2 的范畴），
# 而「一个错价」比「一个明确标注的旧价」贵得多 —— 先不静默改动拿不准的行。

def _reject_reason(d):
    """渠道价能不能用在「与 *单位 同量纲」的列上 —— 不能则返回中文原因。

    判据只看**取价分支自己声明的单位语义**，不猜：

        products_factory  → 元/**大单位**（舟谱「进价(大单位)」）⇒ **永不**可用：
                            模板行的 `*单位` 是报单单位（小/中单位，v223 铁律），
                            两者量纲必然不同。用它 = 复制 v217 的 990。
        matrix 命中某档     → 元/该档单位 ⇒ 可用（档位就是按单位名对齐选的）。
        matrix 退回主列     → 单位**未知**（旧结构主列没声明过单位）⇒ 不用：
                            「宁可不填」胜过「填一个不知道量纲的数」。
        products_dist     → 元/小单位 ⇒ 可用。
    """
    src = str(d.get("price_source") or "")
    if src == "products_factory":
        return "渠道价源是「进价」（元/大单位），与模板行的报单单位不同量纲"
    if src == "matrix" and not str(d.get("price_unit") or "").strip():
        return "渠道矩阵只录了未声明单位的价（主列），量纲未知"
    return ""


def _template_price(it, mapping, unit, stat):
    """舟谱模板「*单价(折后价)」取值。**渠道价优先 → 报单明细价兜底**。

    返回 `(price, source)`；`source` ∈ `channel` / `detail`。
    `stat` 是本次生成共享的计数字典（供末尾**汇总回报**），键：
        `ch` 用上渠道价 / `missing` 该渠道没录价 / `arity` 量纲不可用 /
        `nopid` 明细行无档案号 / `err` 取价异常 / `arity_sample` 前 3 条原因样本
    """
    detail = _round_price(it.get("price"))
    pid = int(it.get("product_id") or 0)
    if pid <= 0:
        stat["nopid"] += 1
        return detail, "detail"
    try:
        d = db.resolve_for_report(pid, mapping, unit)
    except Exception as e:
        stat["err"] += 1
        print(f"[zhoupu-template] resolve_for_report pid={pid}: {e}")
        return detail, "detail"
    if d.get("missing"):
        stat["missing"] += 1
        return detail, "detail"
    why = _reject_reason(d)
    if why:
        stat["arity"] += 1
        if len(stat["arity_sample"]) < 3:
            stat["arity_sample"].append(
                f"「{it.get('product_name') or ('商品#' + str(pid))}」{why}")
        return detail, "detail"
    stat["ch"] += 1
    return _round_price(d.get("price")), "channel"


def _new_price_stat():
    return {"ch": 0, "missing": 0, "arity": 0, "nopid": 0, "err": 0, "arity_sample": []}


def _new_unit_stat():
    """模板「*单位」的来源与**数量换算**统计（v233）。见 `_unit_stat_warnings`。"""
    return {"manual": 0, "conv": 0, "fail": 0, "sample": []}


def _unit_stat_warnings(stat, warnings):
    """把「*单位」的来源与数量换算结果**显式回报**（不静默）。

    🔴 v233 之前，本行的单位可能被 `forecast_barcode_units` 人工层改掉而**数量不动**
    —— 只改标签不改数，正是 v217 那个错误的镜像（`*单位=件` 而 `*数量` 仍是条数）。
    现在：改单位**必带换算**；换算不出来时**退回明细单位原样输出**并在这里点名。
    用户拿到文件时看不到这些判断过程，所以必须回报。
    """
    if stat["manual"]:
        warnings.append(
            "本期有 %d 行的「*单位」取自该商品**档案里指定的报单单位**"
            "（「商品档案 → 报单单位」，与主表「单位」列同源）。" % stat["manual"])
    if stat["conv"]:
        warnings.append(
            "本期有 %d 行的「*单位」按「商品档案 → 报单单位」调整过，「*数量」已按档案换算"
            "同步折算（换算比与主表「合计(箱)」同源）。" % stat["conv"])
    if stat["fail"]:
        warnings.append(
            "🔴 有 %d 行**报单单位与明细单位不一致、但换算比缺失**，已**保持明细单位原样输出**"
            "（宁可不改，不写一张量纲可能错的单）。请在「商品档案」页补齐该商品的中/大单位"
            "换算或规格，或核对「报单单位」。%s"
            % (stat["fail"], "".join("　" + s for s in stat["sample"])))


# ---------------------------------------------------------------- v233：报单单位与换算
# 模板行「*单位」与「*数量」是**同一行上的两个格** ⇒ 改单位必须同步改数量。
#
# v233 之前：单位优先级 = 条码人工层 > 明细单位 > 名称推断，而**数量从不换算**
#   ⇒ 凡人工作层把单位改掉的行，数量都还是明细单位下的数（**只改标签不改数**）。
#
# v233 起，单位最终取值收敛到「商品档案 → 报单单位」（`products.order_unit`，
#   与主表「单位」列**同源**；根因与设计见 `db/queries/products.py` 顶部整段），并配套换算：
#     ① 单位与明细不同、且换算比可求 ⇒ 按档案换算数量
#        （换算比与主表 `perCase` 同源，见 `domain/unit_convert.py` + 同源校验脚本）
#     ② 换算不出来 ⇒ **退回明细单位、数量原样**，并在 warnings 里点名
#        （绝不「单位改了数不动」—— 那是 v217 那个 990 的镜像错误）

_UNIT_FIELDS = ("name", "spec", "unit", "medium_unit", "medium_ratio",
                "large_unit", "large_ratio", "order_unit")


def _fetch_product_units(pids):
    """批量取本期涉及商品的单位/换算字段 → `{pid: dict}`。

    🔴 必须批量：模板可能有几百行，逐行查库是 N+1。
    ⚠️ 取不到（无档案 / 库异常）⇒ 返回 `{}`，下游按「无档案」处理 ⇒ 完全回到 v233 之前的行为。
    """
    ids = sorted({int(p) for p in (pids or []) if int(p or 0) > 0})
    if not ids:
        return {}
    out = {}
    _cols = ", ".join(_UNIT_FIELDS)
    try:
        with db.get_db() as conn:
            use_order_unit = True
            for i in range(0, len(ids), 400):     # 分批，防 SQLite 变量上限
                chunk = ids[i:i + 400]
                ph = ",".join("?" * len(chunk))
                if use_order_unit:
                    try:
                        rows = conn.execute(
                            "SELECT id, " + _cols + " FROM products WHERE id IN (" + ph + ")",
                            chunk).fetchall()
                    except Exception as e:
                        # 典型：租户库还没做列对账（`order_unit` 不存在）。**不能让模板整体 500** ——
                        #   退回不含该列的查询（`unit` 列一定存在 ⇒ 等价于 v233 之前的行为），
                        #   并显式告警：否则「回填了却没生效」会与「根本没回填」读数完全相同。
                        print(f"[zhoupu-template] order_unit 列不可用，回退旧查询：{e}")
                        use_order_unit = False
                        rows = conn.execute(
                            "SELECT id, " + _cols.replace(", order_unit", "")
                            + " FROM products WHERE id IN (" + ph + ")", chunk).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id, " + _cols.replace(", order_unit", "")
                        + " FROM products WHERE id IN (" + ph + ")", chunk).fetchall()
                for r in rows:
                    out[int(r["id"])] = {k: (r[k] if k in r.keys() else "") for k in _UNIT_FIELDS}
    except Exception as e:
        print(f"[zhoupu-template] fetch product units: {e}")
        return {}
    return out


def _resolve_template_unit(bc, detail_unit, pname, arc, unit_map):
    """模板行「*单位」的最终取值 + 来源标签（**唯一实现**）。

    优先级（高 → 低）：
      ① `products.order_unit` —— 人工在「商品档案」页指定的**报单单位**（v233 一等公民）
      ② `forecast_barcode_units[bc]` —— 存量人工层（v233 已回填进 ①；此处只做兼容读取，
         使「回填尚未执行」的库与「回填已执行」的库输出**一致**）
      ③ 明细行自带单位 —— 现状默认（也是「实际发生过的报单单位」）
      ④ 按商品名推断 —— 现状兜底

    返回 `(unit, src)`，`src` ∈ `product` / `barcode` / `detail` / `guess`。
    ⚠️ ① ② 都为空时**逐字回到 v233 之前的行为**（3 → 4），这是「存量零变化」的落点。
    """
    ou = str((arc or {}).get("order_unit") or "").strip()
    if ou:
        return ou, "product"
    mu = str((unit_map or {}).get(bc) or "").strip()
    if mu:
        return mu, "barcode"
    du = str(detail_unit or "").strip()
    if du:
        return du, "detail"
    return _guess_unit(pname), "guess"


def _align_row_unit(unit, qty, detail_unit, arc, ustat):
    """把 `(unit, qty)` 对齐到最终报单单位：**单位与明细不同时按档案换算数量**。

    🔴 为什么必须成对处理：`*单位` 与 `*数量` 是同一行上的两个格。只改标签不改数 =
       把 v217 的错误复制一遍（明细 8 条写成 8 件 = 64 条）。
       ⇒ 换算不出来时**宁可退回明细单位**（数量原样），也不交一张量纲可能错的单。
    返回 `(unit, qty)`；`qty` 可能是小数（换算结果）—— **不擅自取整**（见下）。
    """
    du = str(detail_unit or "").strip()
    u = str(unit or "").strip()
    if not du or not u or u == du:
        return u, qty
    arc = arc or {}
    new_qty = convert_qty(qty, du, u, arc, arc.get("spec") or "")
    if new_qty is None:
        ustat["fail"] += 1
        if len(ustat["sample"]) < 3:
            ustat["sample"].append("「%s」%s→%s" % (arc.get("name") or "", du, u))
        return du, qty
    ustat["conv"] += 1
    # 舟谱真实样本的「*数量」恒为整数；换算结果若不是整数**不取整**
    # （1.5 组取整成 2 组 = 凭空多报半组货），交给 warnings 让用户核对。
    if abs(new_qty - round(new_qty)) < 1e-6:
        return u, int(round(new_qty))
    return u, round(new_qty, 3)


def _price_stat_warnings(stat, warnings):
    """把取价统计**显式回报**（不静默）。

    🔴 这些数字是「本期模板上的单价是怎么来的」的唯一载体：用户拿到文件时看不到
    `source`，只能靠这里知道「哪几行没走渠道价、为什么」。旧实现一个数字都不报，
    「取到进价」与「取到渠道价」在文件里长得一模一样。
    """
    if stat["ch"]:
        warnings.append(
            f"本期「*单价(折后价)」有 {stat['ch']} 行取自**报单对象的渠道价**"
            f"（与本行「*单位」同量纲）。")
    fb = stat["missing"] + stat["arity"] + stat["nopid"] + stat["err"]
    if fb:
        bits = []
        if stat["missing"]:
            bits.append(f"{stat['missing']} 行该渠道没录价")
        if stat["arity"]:
            bits.append(f"{stat['arity']} 行渠道价的单位与报单单位不同量纲")
        if stat["nopid"]:
            bits.append(f"{stat['nopid']} 行没有商品档案号")
        if stat["err"]:
            bits.append(f"{stat['err']} 行取价出错")
        warnings.append(
            f"另有 {fb} 行**回退为报单明细价**（{'；'.join(bits)}）—— 明细价是"
            f"「进价（元/箱）」，与「*单位」不是同一量纲，这几行请在舟谱侧核对单价。"
            + ("".join("　" + s for s in stat["arity_sample"])))
    elif not stat["ch"]:
        warnings.append("本期模板「*单价(折后价)」全部沿用报单明细价（进价，元/箱），"
                        "未取到渠道价 —— 请确认这是你要的口径。")


def _fetch_period_by_window(start: str, end: str):
    with db.get_db() as conn:
        return conn.execute(
            "SELECT id, name, order_start, order_end, arrival_date FROM forecast_periods "
            "WHERE order_start=? AND order_end=? ORDER BY id DESC LIMIT 1",
            (start, end),
        ).fetchone()


def _entity_department(prof, entity, warnings):
    """本单「部门」列取值：优先该户头配的部门名；未配 → 回落默认部门并**显式告警**。

    v163：同一商品可由两个户头下单 → 同一客户会拆出多张单，每张单的「部门」列不同。
    兜底与告警**必须**留在生成侧（`db.entity_department()` 未配就返回空串）——
    取数函数里偷偷回落会让「这个户头没配部门」在生成侧不可见，正是本次要消灭的静默降级。
    """
    ent = str(entity or "").strip()
    default = prof.get("company_name") or ""
    if not ent:
        return default
    dept = ""
    try:
        dept = db.entity_department(ent)
    except Exception as e:
        print(f"[zhoupu-template] entity_department error: {e}")
    if dept:
        return dept
    # 按户头去重 —— 一个户头缺部门名会影响本期**每一张**该户头的单，
    # 逐个 group 追加会刷出 N 条一模一样的警告。2026-09-15 实测：这条刷屏把
    # `X-Template-Warnings` 响应头顶出 nginx 缓冲 → 整个下载端点 502（文件都拿不到）。
    _msg = ("户头「%s」未配置对应的舟谱部门：该单「部门」列已回落为默认公司名，下单前请核对。"
            "请在「报单配置 → 模板参数」里为每个下单主体填写部门。" % ent)
    if _msg not in warnings:
        warnings.append(_msg)
    return default


def _fetch_submissions(start: str, end: str):
    """取报单窗口内的导入提交（下单表导入落库口径），含明细。
    下单表导入按 order_date 落库；窗口内任一天的导入都纳入，避免日期口径不一致漏单。"""
    with db.get_db() as conn:
        subs = conn.execute(
            "SELECT id, store_id, store_name, order_date FROM forecast_submissions "
            "WHERE role='导入' AND order_date>=? AND order_date<=? ORDER BY order_date, id",
            (start, end),
        ).fetchall()
        result = []
        for s in subs:
            items = conn.execute(
                "SELECT product_id, product_name, spec, unit, quantity, price, barcode, ordering_entity "
                "FROM forecast_submission_items WHERE submission_id=? ORDER BY id",
                (s["id"],),
            ).fetchall()
            result.append({"store_id": s["store_id"], "store_name": s["store_name"],
                           "order_date": s["order_date"],
                           "items": [dict(i) for i in items]})
        return result


def _item_barcode(item: dict) -> str:
    """优先用明细冗余条码（v109 新增列），否则联产品主档。"""
    bc = str(item.get("barcode") or "").strip()
    if bc:
        return _fmt_barcode(bc)
    pid = int(item.get("product_id") or 0)
    if not pid:
        return ""
    with db.get_db() as conn:
        r = conn.execute("SELECT barcode FROM products WHERE id=?", (pid,)).fetchone()
    return _fmt_barcode(r["barcode"]) if r else ""


def _build_zhoupu_data(start: str, end: str, seq_map=None, meta_out=None):
    """组装自提/调拨两份模板的行数据。返回 (zt_rows, db_rows, warnings)。

    v665 新增两个可选入参/出参，承载「源单据号唯一性」（见本文件号段基础设施那一段）：
      · `seq_map`：`{"ZT": (30, 35), "DB": (1, 8)}` —— 生成端点**先从库内水位占号**，
        再把号段传进来。缺省 None = 预览（按当前水位推起始号，**不占号**）；
        `/zhoupu-template` 兼容接口必须走这条 —— 看一眼统计不该白吃一段号。
      · `meta_out`：dict 出参，被填入 `period_id / arrival_date / 各前缀的 docs、
        内容指纹、范围标签`，供调用方判幂等与落追溯记录。
    """
    _period_id, date_compact = _period_ctx(start, end)

    # v160：模板的业务列（业务员/部门/仓库）与单号起始序号取**租户业务参数**，
    # 不再是代码常量。读不到时回落中性默认（业务员/公司名为空）→ 见下方 warnings 显式回报。
    prof = db.get_business_profile()

    # 报单配置：别名→归属（自提/调拨）+ 对象名 + 目标仓名
    try:
        mappings = db.report_mapping_list(include_inactive=0)
    except Exception as e:
        print(f"[zhoupu-template] report_mapping error: {e}")
        mappings = []
    alias_map = {}
    raw_map = {}          # v232：别名 → **完整** report_mapping 行（取价要用 channel_id 等字段）
    for m in mappings:
        alias = (m.get("report_alias") or "").strip()
        if not alias:
            continue
        # v232：`alias_map` 是给模板列用的**投影**（只留 4 个键）。
        # 取价需要 `channel_id` / `counterparty_id` / `counterparty_type`，
        # 而 `resolve_report_channel()` 正是按这三个字段判决 —— 所以另存整行。
        # ⚠️ 不复用 `alias_map[alias]` 往里塞字段：那是模板列的契约，扩它会把
        #    「投影」变成「又一个映射」，下一个字段改动就得同步两处。
        raw_map[alias] = m
        # 调拨对象的显示名：舟谱样本为「姓名+仓」，而配置里可能只写了仓全称
        alias_map[alias] = {
            "type": m.get("counterparty_type"),
            "name": m.get("system_name") or m.get("counterparty_name") or alias,
            "dst_wh": m.get("dst_wh") or 0,
            # v294：`src_wh` 此前**连投影都没有** —— 调拨行的「调出仓」恒取租户默认仓，
            # 报单配置里选的源仓从未参与过模板生成（配了等于没配）。
            "src_wh": m.get("src_wh") or 0,
            # 报单对象 id（本人仓映射 = 那个仓的 warehouses.id）。
            # 用于「调入仓」的第二档回退 —— `system_name` 是**配置时抄下的仓名快照**，
            # 仓改名后就过期了；对象 id 才是唯一真身（同一关系不留两份拷贝）。
            "cp_id": m.get("counterparty_id") or 0,
            "employee_name": m.get("employee_name") or "",
        }

    submissions = _fetch_submissions(start, end)
    # 单位映射（人工维护，优先级最高）：条码→单位
    try:
        unit_map = db.forecast_barcode_units_map()
    except Exception as e:
        print(f"[zhoupu-template] barcode_units error: {e}")
        unit_map = {}
    # 同一客户在窗口内可能多次导入（如加单）：按 条码+单位 聚合数量
    merged = {}
    warnings = []
    pstat = _new_price_stat()   # v232：取价来源统计（末尾汇总回报）
    ustat = _new_unit_stat()    # v233：单位来源 + 数量换算统计（末尾汇总回报）
    # v233：本期涉及商品的单位/换算字段**一次取全**（循环内逐行查库是 N+1）。
    arc_map = _fetch_product_units(
        [it.get("product_id") for sub in submissions for it in sub["items"]])
    # v160：业务列来自租户配置 —— 缺值必须**显式回报**，绝不静默生成一列空白
    # （舟谱对被拒列会整批拒收；静默失败比明确报错贵得多）。
    if not prof["salesman"]:
        warnings.append("未设置「默认业务员」：模板「业务员」列将为空。请在「报单配置 → 模板参数」里填写。")
    if not prof["company_name"]:
        warnings.append("未设置「公司名称」：模板「部门」列将为空。请在「报单配置 → 模板参数」里填写。")
    for sub in submissions:
        alias = sub["store_name"]
        for it in sub["items"]:
            qty = _fmt_qty(it.get("quantity"))
            if qty <= 0:
                continue
            bc = _item_barcode(it)
            if not bc:
                warnings.append(f"「{alias}」的商品「{it.get('product_name','')}」缺少条码，已跳过（请在商品主档补条码）")
                continue
            # v163 下单主体（户头）进入聚合键 —— 这是「不能合并」的落点。
            # 业务约束（用户 2026-09-15）：同一商品（同条码）可被两个户头下单，
            # 源表用两行表达；不拆条码（同一商品档案），但**也不能合并** ——
            # 两个户头各下一张单，因为单据的「部门」列不同、舟谱按单收货。
            # 旧实现只按 alias 聚合 → 两个户头的货并进同一张单，第一个户头名还会盖掉第二个
            # （`max(old[3], price)` 那套只在同 (条码,单位) 内合并，压根不看户头）。
            # 户头取**明细行**的权威值（v163 起随行落库）；为空 → 视为「无户头」，
            # 回退单据默认部门（company_name），保证存量数据零行为变化。
            ent = (it.get("ordering_entity") or "").strip()
            g = merged.setdefault((alias, ent), {
                "alias": alias, "entity": ent, "cfg": alias_map.get(alias), "items": {}})
            # v233：单位优先级 = 商品档案「报单单位」→ 条码人工层 → 明细单位 → 名称推断。
            #   唯一实现 = `_resolve_template_unit`；前两档皆空时**逐字**回到 v233 之前的行为。
            #   🔴 为什么必须与主表同源：v217「模板填条、系统显示件」的根因就是两处读不同来源。
            detail_unit = (it.get("unit") or "").strip()
            arc = arc_map.get(int(it.get("product_id") or 0) or 0)
            unit, _usrc = _resolve_template_unit(bc, detail_unit, it.get("product_name"), arc, unit_map)
            if _usrc == "product":
                ustat["manual"] += 1
            # v233：改单位**必须**同步改数量（否则 = 把 v217 的错误复制一遍）。
            #   换算不出来 ⇒ 退回明细单位 + 数量原样，并在 warnings 里点名。
            unit, qty = _align_row_unit(unit, qty, detail_unit, arc, ustat)
            # v232：单价取「该报单对象的渠道价」（与本行单位同量纲），取不到才回退明细价。
            #   明细价 = 进价（元/箱），与「*单价(折后价)」+「*单位」的契约不同量纲
            #   ⇒ 直接写它会偏大「规格 × 0.9」倍。详见 `_template_price` 上方注释。
            #   ⚠️ 必须在 `_align_row_unit` **之后**取价：渠道价按单位名选档（v231），
            #      单位换了档位就换了。
            price, _psrc = _template_price(it, raw_map.get(alias), unit, pstat)
            key = (bc, unit)
            if key in g["items"]:
                old = g["items"][key]
                g["items"][key] = (bc, unit, old[2] + qty, max(old[3], price))
            else:
                g["items"][key] = (bc, unit, qty, price)

    zt_groups = []   # [{alias, entity, cfg, items:[(barcode, unit, qty, price)]}]
    db_groups = []
    # v361（2026-10-01，用户报障）：**没有「导出配置」的报单对象必须拦住**，不许默认塞进自提。
    unmapped_aliases = []
    # merged 的键是 (alias, entity) 二元组 → 一个客户在本期可能拆出多张单（每户头一张）。
    for _gkey, g in merged.items():
        items = list(g["items"].values())
        if not items:
            continue
        # ⚠️ 必须把 list 写回 g["items"]：下游按 `for bc, unit, qty, price in g["items"]` 解包，
        # 而合并阶段 g["items"] 是 dict —— 直接 append(g) 会让解包拿到 dict 的 **键**（2 元组）
        # → `ValueError: not enough values to unpack (expected 4, got 2)`（2026-09-15 实测）。
        g["items"] = items
        # 🔴 v361：`cfg` 为空 = 这个报单对象**从没在「报单配置」登记过**（或它的配置已停用，
        #   被 `include_inactive=0` 排除）⇒ 它**没有导出单据类型**，系统无从判断该进
        #   「自提订单」还是「调拨订单」表，更拿不到「客户全称 / 部门 / 取价渠道」。
        #   改前：这里走 `else` 分支 **默认塞进自提**，客户名用列头（如「备货」）冒充 ⇒
        #   用户明确没配过的列照样出现在舟谱模板里（本次报障的成因，2026-10-01）。
        #   改后：**不进任何模板**（拦住），并在 `warnings` 里点名 + 指正门。
        if not g["cfg"]:
            unmapped_aliases.append(g["alias"])
            continue
        if g["cfg"]["type"] == "self_warehouse":
            db_groups.append(g)
        else:
            zt_groups.append(g)

    if unmapped_aliases:
        # 去重保序：同一简称可能因多个户头 / 多条导入出现多次，只点名一次。
        _seen = list(dict.fromkeys(unmapped_aliases))
        # 🔴 v361b：**必须限量点名**。这条警告要走 `X-Template-Warnings` **响应头**，而该头有
        #   1500 **编码后**字节的硬预算（`_hdr_safe_warnings`；顶穿了 nginx 直接 502，用户连
        #   文件都拿不到 —— 2026-09-15 实测过）。中文经 `quote()` 每字膨胀成 9 字符 ⇒
        #   逐个点名时 30 个对象 = 2215 字节 ⇒ **这条警告自己被截断**，而被切掉的正是句尾
        #   「去『报单配置』怎么修」那段 —— 用户只看到一串名字、看不到出口（信息给了一半
        #   比不给更坏，是本项目反复在修的那族）。故只列前 5 个 + 总数，最坏 ~1120 字节
        #   （硬预算 1500；留 ≥300 给后续告警，护栏实测 1/5/8/30 个 → 852/1072/1115/1117）；
        #   完整清单走 `/api/forecast/zhoupu-template`（JSON 正文，不受响应头预算约束）。
        _head = "、".join("「%s」" % a for a in _seen[:5])
        _more = ("等，共 %d 个" % len(_seen)) if len(_seen) > 5 else ""
        warnings.append(
            "有 %d 个报单对象没有「导出配置」（未在「报单配置」登记，或配置已停用），"
            "已从模板中拦住、不进任何一份舟谱模板：%s%s。"
            "请到「报单配置」建立归属（门店→自提订单 / 本人仓→调拨单）后重新导出。"
            % (len(_seen), _head, _more))
    mappings = alias_map
    if not mappings and not unmapped_aliases:
        warnings.append("报单配置为空：本期没有可导出的报单对象。请先在「报单配置」里维护归属")

    # ---- v665：本批的内容指纹与范围标签（在拼单号**之前**算 —— 指纹不含单号） ----
    #   `items` 是明细行数（一个 (条码,单位) 一行），台账里用来核对「号段长度 = 分单数」。
    _scope_zt = _scope_label(zt_groups)
    _scope_db = _scope_label(db_groups)
    if isinstance(meta_out, dict):
        meta_out.clear()
        meta_out.update({
            "period_id": _period_id,
            "arrival_date": date_compact,
            "zt": {"docs": len(zt_groups),
                   "items": sum(len(g["items"]) for g in zt_groups),
                   "fingerprint": _content_fingerprint(zt_groups, _scope_zt),
                   "scope": _scope_zt},
            "db": {"docs": len(db_groups),
                   "items": sum(len(g["items"]) for g in db_groups),
                   "fingerprint": _content_fingerprint(db_groups, _scope_db),
                   "scope": _scope_db},
        })

    # ---- 自提行 ----
    zt_rows = []
    _sm = seq_map or {}
    # v665：起始序号不再在函数内自增（那样每批都从头重编 ⇒ 必然重号），改为
    #   「端点占号后传进来」；预览模式按水位推。格式一行不动。
    seq = _seq_first_of(_sm.get(_ZT_PREFIX),
                        prof.get("zt_seq_start") or _DOC_SEQ_DEFAULT_ZT,
                        _period_id, date_compact, _ZT_PREFIX)
    if zt_groups and seq + len(zt_groups) - 1 > _DOC_SEQ_MAX:
        # 真实生成时这条走不到（`_alloc_doc_seqs` 会先硬拒绝）；只可能出现在预览。
        warnings.append("自提单号序号将超过两位（起始 %d + 本期 %d 单）→ 单号变三位，请核对舟谱格式。"
                        % (seq, len(zt_groups)))
    for g in zt_groups:
        no = f"ZT{date_compact}{seq:02d}"
        seq += 1
        # v163：一张单一个部门 —— 部门名按本单的户头取（同一 g 内所有行共用），
        # 未配置该户头时回落默认公司名并在 warnings 里点名（绝不静默出一张部门写错的单）。
        _dept = _entity_department(prof, g.get("entity"), warnings)
        for bc, unit, qty, price in g["items"]:
            row = [""] * 22
            row[0] = no
            row[2] = g["cfg"]["name"] if g["cfg"] else g["alias"]
            row[3] = prof["salesman"]
            row[4] = _dept
            row[6] = prof["warehouse"]
            row[13] = int(bc) if bc.isdigit() else bc
            row[14] = unit
            row[15] = qty
            row[16] = price
            zt_rows.append(row)

    # ---- 调拨行 ----
    # v294（2026-09-27）：**真读**报单配置里的「源仓 / 目标仓」（`report_mapping.src_wh/dst_wh`）。
    # 改前实测：`dst_wh` 只被投影进 `alias_map`，全仓库 grep **没有任何读取方**；
    # `src_wh` 连投影都没有 ⇒ 调拨行的「调出仓」恒 = 租户默认仓、「调入仓」恒 = 配置里
    # 手输的对象名（`name`）或「姓名+仓」拼接 ⇒ 用户在报单配置里选的两个仓**完全没生效**，
    # 而界面上选完还显示得好好的（典型"配了等于没配"，且零报错）。
    #
    # 取值优先级（**每一档都可解释，不猜**）：
    #   调出仓 = 源仓(name) → 租户默认仓
    #   调入仓 = 目标仓(name) → 配置里的显示名 → 「姓名+仓」拼接（老逻辑原样保留）
    # ⚠️ 只影响 `counterparty_type='self_warehouse'` 的行 —— 前端「源仓/目标仓」两个下拉
    #    也只在本人仓时才显示（ReportMapping.vue:262），所以自提行的行为一字不变。
    # ⚠️ 仓库名册**一次取全**（不逐行查库）；取不到（缺表/异常）时该档自动落回下一档，
    #    绝不因为查不到仓名就把整张模板搞崩。
    try:
        _wh_names = {int(w.get("id") or 0): (w.get("name") or "")
                     for w in (db.get_warehouses_full() or [])}
    except Exception as e:
        print(f"[zhoupu-template] warehouses error: {e}")
        _wh_names = {}

    db_rows = []
    # v665：调拨号段同样改从库内水位取（原来是写死的 `seq = 1`，每批重号）
    seq = _seq_first_of(_sm.get(_DB_PREFIX), _DOC_SEQ_DEFAULT_DB,
                        _period_id, date_compact, _DB_PREFIX)
    for g in db_groups:
        no = f"DB{date_compact}{seq:02d}"
        seq += 1
        _cfg = g["cfg"] or {}
        # 配了仓、但那个仓已经不在仓库档案里（被删/换租户库）⇒ **必须点名**。
        # 静默落回旧档位是最坏形态：用户以为模板按他选的仓出的，实际不是。
        _dst_id = int(_cfg.get("dst_wh") or 0)
        _src_id = int(_cfg.get("src_wh") or 0)
        for _lid, _lbl in ((_src_id, "源仓"), (_dst_id, "目标仓")):
            if _lid and _lid not in _wh_names:
                _m = (f"「{g['alias']}」配置的{_lbl}（仓库 #{_lid}）在仓库档案里找不到，"
                      f"该列已回落为默认值，请到「报单配置」重新选择。")
                if _m not in warnings:
                    warnings.append(_m)
        # 调入仓：目标仓 → **报单对象本身**（本人仓映射的对象就是那个仓）→ 配置显示名 → 拼接
        #   第二档为什么必要：`system_name` 是配置时抄下的仓名快照，仓改名后就过期了；
        #   而「调入仓」的业务含义 = 那个员工的仓，对象 id 才是唯一真身。
        dst_name = (_wh_names.get(_dst_id)
                    or _wh_names.get(int(_cfg.get("cp_id") or 0))
                    or "")
        if not dst_name:
            # 老逻辑原样保留：配置里的显示名；样本为「姓名+仓」，不含员工名时自动拼
            dst_name = _cfg.get("name") or (g["alias"] + "仓")
            if _cfg.get("employee_name") and dst_name and _cfg["employee_name"] not in dst_name:
                dst_name = _cfg["employee_name"] + "仓"
        # 调出仓：源仓优先，未配则沿用租户默认仓（改动前行为）
        src_name = _wh_names.get(_src_id) or prof["warehouse"]
        for bc, unit, qty, _price in g["items"]:
            row = [""] * 13
            row[0] = no
            row[1] = src_name
            row[2] = dst_name
            row[4] = unit
            row[8] = int(bc) if bc.isdigit() else bc
            row[10] = qty
            db_rows.append(row)

    _price_stat_warnings(pstat, warnings)
    _unit_stat_warnings(ustat, warnings)

    return zt_rows, db_rows, warnings


def _render_zhoupu_xlsx(zt_rows, db_rows) -> bytes:
    """输出标准舟谱导入 xlsx。真实导入文件只含一个工作表：
    仅有自提数据→单表「自提订单」；仅有调拨数据→单表「调拨订单」；
    两者都有（合并场景）才各建一表。列头与真实模板逐字一致。"""
    import openpyxl
    wb = openpyxl.Workbook()
    has_zt = bool(zt_rows)
    has_db = bool(db_rows)
    if has_zt or not has_db:
        ws1 = wb.active
        ws1.title = "自提订单"
        ws1.append(ZT_HEADERS)
        for r in zt_rows:
            ws1.append(r)
    if has_db:
        if has_zt:
            ws2 = wb.create_sheet("调拨订单")
        else:
            ws2 = wb.active
            ws2.title = "调拨订单"
        ws2.append(DB_HEADERS)
        for r in db_rows:
            ws2.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/import-templates")
def import_template_list(request: Request):
    """可选的导入模版清单（供前端下拉选择）。"""
    _auth(request)
    return {"success": True, "templates": [
        {"id": "zhoupu-pickup", "name": "舟谱自提订单", "ext": "xlsx"},
        {"id": "zhoupu-transfer", "name": "舟谱调拨订单", "ext": "xlsx"},
        {"id": "zhoupu-all", "name": "舟谱（自提+调拨合并包）", "ext": "zip"},
    ]}


def _hdr_safe_warnings(warnings, max_bytes=1500):
    """把 warnings 压进响应头的**安全版本** —— HTTP 头有大小上限，超了 nginx 直接 502。

    判据（2026-09-15 实测）：警告文案含中文，`quote()` 后每个汉字膨胀成 9 个字符，
    十几条长警告足以顶穿 nginx 默认 `proxy_buffer_size`（4k）→ **用户连文件都下不到**，
    而日志里只有一句 `upstream sent too big header`。两级兜底：
      ① 只取前 10 条；② 按**编码后**字节数硬截断，且不切断 %XX 转义序列。
    被截断时尾部补一个「…」明示。完整警告走 `/api/forecast/zhoupu-template`（JSON 全文）。
    """
    q = quote("; ".join(warnings[:10]))
    if len(q) <= max_bytes:
        return q
    cut = q[:max_bytes]
    while cut.endswith("%"):
        cut = cut[:-1]
    if len(cut) >= 2 and cut[-2] == "%":
        cut = cut[:-2]
    return cut + "%E2%80%A6"        # 尾巴补「…」表示已截断


def _period_ctx(start: str, end: str):
    """(期次 id, 8 位到货日) —— 模板生成侧的唯一取数口。

    v665：为什么要把「期次 id」和「到货日」放在**同一个函数**里返回：
      单号里的日期段、文件名里的日期、号段水位表的主键（`period_id + arrival_date`）
      必须是同一个值。三处各查一遍 `_fetch_period_by_window` 迟早会漂 —— 一旦漂了，
      「唯一性按 A 判、文件名按 B 写」，用户对不上批次，而且这种错**不会报错**。
    日期口径与改动前逐字一致（期次 `arrival_date` → 报单起始日 → 窗口末端）。
    """
    period = _fetch_period_by_window(start, end)
    pid = 0
    d = ""
    if period:
        try:
            pid = int(period["id"] or 0)
        except Exception:
            pid = 0
        d = period["arrival_date"] or ""
    if not d:
        d = start
    compact = (d or "").replace("-", "")
    if not compact.isdigit() or len(compact) != 8:
        compact = (start or end or "").replace("-", "")
    return pid, compact


def _arrival_compact(start: str, end: str) -> str:
    """解析本期到货日期（真实模板的文件名/单据号均用到货日期），兜底用报单起始日。返回 8 位紧凑日期。"""
    return _period_ctx(start, end)[1]


# =====================================================================================
# v665（2026-10-24）：舟谱源单据号唯一性 —— 号段水位 + 批次台账
#
# 解决什么：同一期次因各品牌到货不同要分几批生成导入模板，而舟谱要求「源单据号」唯一。
#   改动前 `seq` 是 `_build_zhoupu_data` 里一个**函数内局部变量**（自提从配置项起、
#   调拨从 1 起），每次生成从头重编、生成完即销毁 ⇒ **同期次第二批与第一批逐字重号**，
#   舟谱整份校验 ⇒ 第二批大概率整批被拒。
#
# 怎么做：单号格式一个字不动（`ZT/DB` + 8 位日期 + 2 位序号是舟谱格式契约，加字母有
#   被拒收的风险），唯一性做在**序号空间的库内发放**上；批次信息只落台账与文件名。
#   方案与取舍详见 `hergent-cn-v2/docs/舟谱导入模板-源单据号唯一性与分批追溯-方案-2026-10-24.md`。
# =====================================================================================
_ZT_PREFIX = "ZT"
_DB_PREFIX = "DB"
_DOC_SEQ_MAX = 99            # 单号序号固定两位（舟谱格式契约）——超过即**拒绝**，不再静默出三位
# 自提首次起始序号：用户 2026-10-24 定「默认也从 01 起」（账套里 ZT 段 01–20 未占用）。
# 存量租户的 `forecast_config.business_profile.zt_seq_start=21` 仍按 21 生效 —— 配置优先，
# 改代码默认值**不会**悄悄改掉用户填过的值（这是配置项该有的语义）。
_DOC_SEQ_DEFAULT_ZT = 1
_DOC_SEQ_DEFAULT_DB = 1

_DOC_SEQ_DDL = """
CREATE TABLE IF NOT EXISTS forecast_doc_seq (
  period_id    INTEGER NOT NULL DEFAULT 0,
  arrival_date TEXT    NOT NULL DEFAULT '',
  prefix       TEXT    NOT NULL,
  last_seq     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT,
  PRIMARY KEY (period_id, arrival_date, prefix)
);
CREATE TABLE IF NOT EXISTS forecast_template_exports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id    INTEGER NOT NULL DEFAULT 0,
  arrival_date TEXT    NOT NULL DEFAULT '',
  prefix       TEXT    NOT NULL,
  batch_no     INTEGER NOT NULL,
  seq_from     INTEGER NOT NULL DEFAULT 0,
  seq_to       INTEGER NOT NULL DEFAULT 0,
  doc_count    INTEGER NOT NULL DEFAULT 0,
  item_count   INTEGER NOT NULL DEFAULT 0,
  scope_label  TEXT    DEFAULT '',
  fingerprint  TEXT    NOT NULL DEFAULT '',
  filename     TEXT    DEFAULT '',
  created_by   TEXT    DEFAULT '',
  created_at   TEXT,
  voided       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (period_id, arrival_date, prefix, batch_no)
);
CREATE INDEX IF NOT EXISTS ix_fte_fp
  ON forecast_template_exports (period_id, arrival_date, prefix, fingerprint);
CREATE INDEX IF NOT EXISTS ix_fte_doc
  ON forecast_template_exports (prefix, arrival_date, seq_from, seq_to);
"""


def _ensure_doc_tables(conn):
    """幂等建表（lazy 兜底）。

    为什么不只靠 `erp_db.init_db()` 的迁移：迁移只在**某个库首次初始化**时跑，
    而新增表要立刻对**所有已存在的租户库**生效 —— 否则下一个租户库点「生成模板」
    就 500（`no such table`），且这条路径低频（一期点两三次）与低频失败叠加，
    很容易过很久才被发现。`CREATE TABLE IF NOT EXISTS` 的代价是一次 schema 读。
    """
    conn.executescript(_DOC_SEQ_DDL)


def _content_fingerprint(groups, scope_label=""):
    """本批内容的确定性指纹 —— **不含单号**（单号正是要按批次变的东西）。

    用途：手抖点两次「生成」不该白吃一段号（同内容 ⇒ 复用原批原号段）。
    排序后拼接，保证「同样的数据换个到达顺序」得到同一个指纹。
    """
    parts = ["scope=%s" % (scope_label or "")]
    for g in sorted(groups or [],
                    key=lambda x: (str(x.get("alias") or ""), str(x.get("entity") or ""))):
        parts.append("G|%s|%s" % (g.get("alias") or "", g.get("entity") or ""))
        for bc, unit, qty, price in sorted(g.get("items") or [],
                                           key=lambda t: (str(t[0]), str(t[1]))):
            parts.append("I|%s|%s|%s|%s" % (bc, unit, qty, price))
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def _scope_label(groups):
    """本批范围的人话标签（台账展示用）。≤3 个对象就列名，多了给数量 —— 不给 30 个名字。"""
    names = list(dict.fromkeys(
        [str(g.get("alias") or "").strip() for g in (groups or [])
         if str(g.get("alias") or "").strip()]))
    if not names:
        return ""
    if len(names) <= 3:
        return "、".join(names)
    return "%s 等 %d 个报单对象" % ("、".join(names[:2]), len(names))


def _alloc_doc_seqs(conn, period_id, arrival_date, prefix, count, start_seq):
    """在**调用方的事务里**占用 count 个连续序号，返回 (from, to)。

    🔴 号段只增不减：作废/重出的批次**不回收**号段。
       作废的典型原因正是「这批已在舟谱导过了、但打错了要重打」—— 重出的那批若复用
       旧号，舟谱侧立刻又是「源单据号已存在」，等于把批次冲突原封不动搬回去。
       **宁可号段留洞（…28,29,33,34），不可重号**：洞能解释，重号不能。
    🔴 不足即抛 ValueError（端点转 409）：改动前是「追加一条 warning 照样生成三位号」，
       而三位号一旦被舟谱拒收，用户会以为是「我们生成的文件坏了」，排查成本远高于当场报错。
    """
    count = int(count or 0)
    if count <= 0:
        return (0, 0)
    row = conn.execute(
        "SELECT last_seq FROM forecast_doc_seq "
        "WHERE period_id=? AND arrival_date=? AND prefix=?",
        (int(period_id or 0), arrival_date or "", prefix)).fetchone()
    if row and int(row["last_seq"] or 0) > 0:
        base = int(row["last_seq"]) + 1
    else:
        try:
            base = max(1, int(start_seq or 1))
        except Exception:
            base = 1
    end = base + count - 1
    if end > _DOC_SEQ_MAX:
        _kind = "自提" if prefix == _ZT_PREFIX else "调拨"
        raise ValueError(
            "本批需要 %d 个%s单据号（到货日 %s 的第 %d–%d 号），超出单号两位数的上限 %d"
            "（舟谱单号固定 %s+8位日期+2位序号）。已用号段不会回收，"
            "请任选其一：① 把本批拆到下一到货日生成；② 到「报单配置 → 模板参数」"
            "把自提单号起始序号调小（仅当该期次历史号段不冲突时有效）；"
            "③ 联系客服确认舟谱是否接受三位序号后再开放。"
            % (count, _kind, arrival_date or "-", base, end, _DOC_SEQ_MAX, prefix))
    conn.execute(
        "INSERT OR REPLACE INTO forecast_doc_seq"
        "(period_id, arrival_date, prefix, last_seq, updated_at) "
        "VALUES(?,?,?,?,datetime('now','localtime'))",
        (int(period_id or 0), arrival_date or "", prefix, end))
    return (base, end)


def _doc_seq_preview_start(prefix, default_start, period_id, arrival_date):
    """预览模式下「本批将从几号起」—— **只读水位，不占号**。

    🔴 预览与真实分配必须同源：预览说「第 2 批从 30 起」，真实分配就必须给到 30。
       两处各自推算（一处读水位、一处读配置）是这套唯一性方案最容易漂的地方，
       而且漂了也不报错 —— 用户只会看到「预览说 30，实际出来 21」。
    """
    try:
        with db.get_db_tx() as conn:
            _ensure_doc_tables(conn)
            row = conn.execute(
                "SELECT last_seq FROM forecast_doc_seq "
                "WHERE period_id=? AND arrival_date=? AND prefix=?",
                (int(period_id or 0), arrival_date or "", prefix)).fetchone()
        if row and int(row["last_seq"] or 0) > 0:
            return int(row["last_seq"]) + 1
    except Exception as e:
        print(f"[zhoupu-template] doc_seq 水位读取失败（按起始值预览）: {e}")
    try:
        return max(1, int(default_start or 1))
    except Exception:
        return 1


def _seq_first_of(alloc, default_start, period_id, arrival_date, prefix):
    """本批的起始序号：分配了就用分配值，没分配（预览）就按水位推。"""
    if alloc:
        try:
            return int(alloc[0])
        except Exception:
            pass
    return _doc_seq_preview_start(prefix, default_start, period_id, arrival_date)




def _zt_filename(start: str, end: str, batch_no: int = 0):
    """v665：文件名带批次号。

    🔴 改动前两批同叫 `自提订单导入模板_20261029.xlsx`，下载目录里靠浏览器自动加的
       `(1)(2)` 区分 —— 而这两批是要分别拿去舟谱导、分别打印的，发错文件的概率不低。
       批次号进文件名是最省事的防错（不用打开文件看单号）。
    """
    dc = _arrival_compact(start, end)
    _sfx = ("_第%d批" % int(batch_no)) if int(batch_no or 0) > 0 else ""
    return f"自提订单导入模板_{dc}{_sfx}.xlsx"


def _db_filename(start: str, end: str, batch_no: int = 0):
    dc = _arrival_compact(start, end)
    _sfx = ("_第%d批" % int(batch_no)) if int(batch_no or 0) > 0 else ""
    return f"调拨订单导入模板_{dc}{_sfx}.xlsx"


def _zhoupu_empty_reason(tid: str, start: str, end: str) -> str:
    """空模板时给用户的**人话解释**（v305，2026-09-28）。

    🔴 为什么必须单独写这一段：`_fetch_submissions` 只取 `role='导入'` 的单
    （舟谱模板的语义 = 「把**已导入的下单表**转成舟谱格式」—— 见其 docstring），
    而销售/老板在网页或小程序**直接报**的单**天然不参与**。
    原文案「请确认下单表已导入且报单配置已维护」把两类完全不同的原因混成一句，
    用户分不清是「我没配好」还是「这功能不认我这种单」。

    这正是用户 2026-09-28 报障「关单后导不出舟谱模板」的成因 ——
    实测期次#19：3 条 `boss`/`sales` 手工报单、0 条导入单 ⇒ 模板为空；
    而**期次状态是无关的**（期次#17 同为 closed，因为有 19 条导入单，照样出 3 行）。
    ⇒ 所以这里把**期次状态不参与**这件事直接写进文案，并把角色分布**数给他看**，
      免得他再去怀疑「是不是关单把导出锁了」。

    v361（2026-10-01）：新增「**已拦住的报单对象**」一段 —— 没有「导出配置」的报单
    不再默认进自提（见 `_build_zhoupu_data`）。模板**因此**变空时，必须把它们的名字
    数出来，否则用户只看到「没有数据」，会误以为是导入失败或系统故障。
    """
    kind = "自提订单" if tid == "zhoupu-pickup" else "调拨订单"
    hint = ("请在「报单配置」里维护该门店的归属"
            if tid == "zhoupu-pickup"
            else "请在「报单配置」中把业务员标记为「本人仓（调拨）」")
    dist = []
    _blocked = []
    try:
        with db.get_db() as conn:
            for r in conn.execute(
                "SELECT role, COUNT(*) AS n FROM forecast_submissions "
                "WHERE order_date>=? AND order_date<=? GROUP BY role ORDER BY n DESC",
                (start, end),
            ).fetchall():
                dist.append("%s %s 条" % (r["role"], r["n"]))
            # v361：本期「有导入单、却没有导出配置」的报单对象（简称不在活跃报单配置里）。
            #   它们已从模板中拦住 ⇒ 模板为空时这里是**根因**，必须点名。
            _aliases = {str(r["report_alias"] or "").strip()
                        for r in conn.execute(
                            "SELECT report_alias FROM report_mapping WHERE is_active=1"
                        ).fetchall()}
            for r in conn.execute(
                "SELECT DISTINCT store_name FROM forecast_submissions "
                "WHERE role='导入' AND order_date>=? AND order_date<=?",
                (start, end),
            ).fetchall():
                _nm = str(r["store_name"] or "").strip()
                if _nm and _nm not in _aliases:
                    _blocked.append(_nm)
    except Exception as e:
        print(f"[zhoupu-template] empty-reason 统计失败（不影响报错本身）: {e}")
    _dtxt = ("本期报单按角色：" + "、".join(dist)) if dist else "本期没有任何报单记录"
    _btxt = ""
    if _blocked:
        _bnames = "、".join("「%s」" % a for a in dict.fromkeys(_blocked))
        _btxt = ("其中 %s 没有「导出配置」（未在「报单配置」登记，或配置已停用），"
                 "已按规则从模板中**拦住**；请先到「报单配置」为它们建立归属"
                 "（门店 → 自提订单 / 本人仓 → 调拨单）。" % _bnames)
    return ("本期没有可用于%s的「下单表导入」数据。"
            "舟谱导入模板只把**从舟谱/Excel 导入的下单表**转成舟谱格式，"
            "销售在网页或小程序**直接报**的单不参与模板生成"
            "（这是口径，与期次是否关闭**无关**）。%s。%s"
            "如果这批单本来就应该进舟谱，请先把下单表导入本期，或%s。"
            % (kind, _dtxt, _btxt, hint))


def _reserve_batch(start: str, end: str, meta, tid: str, prof: dict, user_name: str = ""):
    """判幂等 → 占号 → 落台账。返回 `(seq_map, batch_map, reused)`。

    🔴 只给**本次真正要出的那种单据**占号：导自提不碰调拨号段 —— 否则导三次自提
       会把调拨的 01–99 白吃三段，用户永远想不通「调拨怎么突然从 04 起」。
    🔴 幂等靠**内容指纹**（同内容复用原批原号段），不靠时间窗：手抖点两次不该吃号。
    🔴 占号与落台账在**同一个事务**里（`get_db_tx`）—— 号位发放与批次记录必须同生共死，
       分开提交会出现「号占了但没台账（查不到批次）」或反之。
    """
    meta = meta if isinstance(meta, dict) else {}
    pid = int(meta.get("period_id") or 0)
    arr = meta.get("arrival_date") or ""
    want = []
    if tid in ("zhoupu-pickup", "zhoupu-all"):
        want.append((_ZT_PREFIX, "zt", prof.get("zt_seq_start") or _DOC_SEQ_DEFAULT_ZT))
    if tid in ("zhoupu-transfer", "zhoupu-all"):
        want.append((_DB_PREFIX, "db", _DOC_SEQ_DEFAULT_DB))

    seq_map, batch_map, reused = {}, {}, False
    with db.get_db_tx() as conn:
        _ensure_doc_tables(conn)
        for prefix, key, start_default in want:
            info = meta.get(key) or {}
            n = int(info.get("docs") or 0)
            if n <= 0:
                continue
            fp = info.get("fingerprint") or ""
            hit = None
            if fp:
                hit = conn.execute(
                    "SELECT batch_no, seq_from, seq_to FROM forecast_template_exports "
                    "WHERE period_id=? AND arrival_date=? AND prefix=? AND fingerprint=? "
                    "AND voided=0 ORDER BY id DESC LIMIT 1",
                    (pid, arr, prefix, fp)).fetchone()
            if hit:
                seq_map[prefix] = (int(hit["seq_from"]), int(hit["seq_to"]))
                batch_map[prefix] = int(hit["batch_no"])
                reused = True
                continue
            seq_from, seq_to = _alloc_doc_seqs(conn, pid, arr, prefix, n, start_default)
            row = conn.execute(
                "SELECT COALESCE(MAX(batch_no),0)+1 AS b FROM forecast_template_exports "
                "WHERE period_id=? AND arrival_date=? AND prefix=?",
                (pid, arr, prefix)).fetchone()
            batch_no = int((row["b"] if row else 1) or 1)
            seq_map[prefix] = (seq_from, seq_to)
            batch_map[prefix] = batch_no
            fname = (_zt_filename(start, end, batch_no) if prefix == _ZT_PREFIX
                     else _db_filename(start, end, batch_no))
            conn.execute(
                "INSERT INTO forecast_template_exports"
                "(period_id,arrival_date,prefix,batch_no,seq_from,seq_to,doc_count,item_count,"
                " scope_label,fingerprint,filename,created_by,created_at,voided) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),0)",
                (pid, arr, prefix, batch_no, seq_from, seq_to, n,
                 int(info.get("items") or 0), info.get("scope") or "", fp, fname,
                 user_name or ""))
    return seq_map, batch_map, reused


@router.post("/import-templates/{tid}/generate")
async def import_template_generate(request: Request, tid: str):
    """按舟谱模板格式生成导入文件（附件下载，确定性生成不依赖 LLM）。
    tid: zhoupu-pickup | zhoupu-transfer | zhoupu-all

    v665：源单据号唯一性 —— 同期次可分批多次生成，每批号段不重叠、可追溯；
    同内容重复点击复用原批（不吃号）。号段与批次台账的取舍见本文件号段基础设施段。
    """
    u = _auth(request)
    if tid not in ("zhoupu-pickup", "zhoupu-transfer", "zhoupu-all"):
        raise HTTPException(404, f"未知模版: {tid}")
    try:
        b = await request.json()
    except Exception:
        b = {}
    b = b if isinstance(b, dict) else {}
    start, end = (b.get("start") or ""), (b.get("end") or "")
    if not start or not end:
        raise HTTPException(400, "缺少 start/end 报单窗口")

    # ① 先「不占号」地构建一次，只为拿到本批的分单数 / 明细行数 / 内容指纹。
    #    为什么必须分两次 build：号段要等**判完幂等**才能定（幂等命中就不该吃号），
    #    而判幂等要指纹、指纹来自分组结果。第二次 build 用真实号段重渲染 ——
    #    数据源完全相同、只有单号列换了值，确定性有保证；代价是一次重复取数
    #    （报单窗口量级，几十毫秒，相对点一次导出的节奏可忽略）。
    meta = {}
    zt_rows, db_rows, warnings = _build_zhoupu_data(start, end, meta_out=meta)

    if tid == "zhoupu-pickup" and not zt_rows:
        raise HTTPException(400, _zhoupu_empty_reason("zhoupu-pickup", start, end))
    if tid == "zhoupu-transfer" and not db_rows:
        raise HTTPException(400, _zhoupu_empty_reason("zhoupu-transfer", start, end))
    # v305：`zhoupu-all`（合并包）此前**没有任何空检查** ⇒ 两份都空时会静默下载一个
    #   空 zip，用户打开发现没有表，还以为是自己哪里没配。空就明说（复用同一段解释）。
    if tid == "zhoupu-all" and not zt_rows and not db_rows:
        raise HTTPException(400, _zhoupu_empty_reason("zhoupu-pickup", start, end))

    # ② 占号 + 落台账。空模板在上一步已拦下 ⇒ 走到这里必然要吃号，不该有白吃的。
    _by = ""
    try:
        _by = str(u.get("username") or u.get("name") or "")
    except Exception:
        _by = ""
    prof = db.get_business_profile()
    try:
        seq_map, batch_map, reused = _reserve_batch(start, end, meta, tid, prof, _by)
    except ValueError as e:
        # 号段不足（两位序号上限）—— 必须当场说清怎么处置，见 `_alloc_doc_seqs`。
        raise HTTPException(409, str(e))

    if seq_map:
        zt_rows, db_rows, warnings = _build_zhoupu_data(start, end, seq_map=seq_map)

    _bz = int(batch_map.get(_ZT_PREFIX) or 0)
    _bd = int(batch_map.get(_DB_PREFIX) or 0)

    if tid == "zhoupu-all":
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(_zt_filename(start, end, _bz), _render_zhoupu_xlsx(zt_rows, []))
            zf.writestr(_db_filename(start, end, _bd), _render_zhoupu_xlsx([], db_rows))
        _parts = []
        if _bz:
            _parts.append("自提第%d批" % _bz)
        if _bd:
            _parts.append("调拨第%d批" % _bd)
        fname = "舟谱导入模板_%s%s.zip" % (
            _arrival_compact(start, end), ("_" + "_".join(_parts)) if _parts else "")
        body = buf.getvalue()
        media = "application/zip"
        rows_hdr = f"zt={len(zt_rows)};db={len(db_rows)}"
    elif tid == "zhoupu-pickup":
        fname = _zt_filename(start, end, _bz)
        body = _render_zhoupu_xlsx(zt_rows, [])
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        rows_hdr = str(len(zt_rows))
    else:
        fname = _db_filename(start, end, _bd)
        body = _render_zhoupu_xlsx([], db_rows)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        rows_hdr = str(len(db_rows))

    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition":
                 f"attachment; filename=\"template.xlsx\"; "
                 f"filename*=UTF-8''{quote(fname)}",
                 "X-Template-Rows": rows_hdr,
                 # v665：批次与号段回传给前端/脚本（纯 ASCII，不占那个 1500 字节的警告预算）
                 "X-Template-Batch": f"ZT={_bz};DB={_bd}",
                 "X-Template-Seq": "ZT=%s;DB=%s" % (
                     ("%02d-%02d" % seq_map[_ZT_PREFIX]) if _ZT_PREFIX in seq_map else "-",
                     ("%02d-%02d" % seq_map[_DB_PREFIX]) if _DB_PREFIX in seq_map else "-"),
                 "X-Template-Reuse": "1" if reused else "0",
                 "X-Template-Warnings": _hdr_safe_warnings(warnings)},
    )


@router.post("/zhoupu-template")
async def zhoupu_template(request: Request):
    """兼容旧接口：返回生成统计与警告（新代码请用 /import-templates/* 下载文件）。"""
    _auth(request)
    try:
        b = await request.json()
    except Exception:
        b = {}
    b = b if isinstance(b, dict) else {}
    start, end = (b.get("start") or ""), (b.get("end") or "")
    if not start or not end:
        raise HTTPException(400, "缺少 start/end 报单窗口")
    zt_rows, db_rows, warnings = _build_zhoupu_data(start, end)
    return {"success": True, "zt_rows": len(zt_rows), "db_rows": len(db_rows),
            "warnings": warnings}


@router.get("/template-exports")
def template_exports_list(request: Request, start: str = "", end: str = "", doc_no: str = ""):
    """舟谱模板导出**批次台账**（v665）。

    · `start`/`end`：该期次导过哪几批（号段、分单数、明细行数、谁导的、是否作废）
    · `doc_no`：给一个源单据号（如 `ZT2026102930`），反查它属于第几批、哪个到货日、
      什么时候导的、含哪些报单对象 —— 这是「可追溯」的落点。
    两者都给时以 `doc_no` 为准（单号是更强的定位键）。

    🔴 参数必须**显式声明**：FastAPI 对未声明的 query 参数是静默忽略的，
       写成 `**kwargs` 或从 `request.query_params` 手取都容易漏，且漏了不报错只返回空。
    """
    _auth(request)
    # 先算期次（它内部会开自己的连接）—— 放进下面的事务块里会在持写锁时再开连接
    _pid, _arr = (0, "")
    if start and end:
        try:
            _pid, _arr = _period_ctx(start, end)
        except Exception as e:
            print(f"[zhoupu-template] 期次解析失败: {e}")
    items = []
    try:
        with db.get_db_tx() as conn:
            _ensure_doc_tables(conn)
            if doc_no:
                s = str(doc_no or "").strip().upper()
                prefix, arr8, seqs = s[:2], s[2:10], s[10:]
                if prefix in (_ZT_PREFIX, _DB_PREFIX) and arr8.isdigit() and seqs.isdigit():
                    seq = int(seqs)
                    rows = conn.execute(
                        "SELECT * FROM forecast_template_exports "
                        "WHERE prefix=? AND arrival_date=? AND seq_from<=? AND seq_to>=? "
                        "ORDER BY id DESC", (prefix, arr8, seq, seq)).fetchall()
                    items = [dict(r) for r in rows]
            elif _arr:
                rows = conn.execute(
                    "SELECT * FROM forecast_template_exports "
                    "WHERE arrival_date=? ORDER BY prefix, batch_no", (_arr,)).fetchall()
                items = [dict(r) for r in rows]
    except Exception as e:
        print(f"[zhoupu-template] 台账查询失败: {e}")
    return {"success": True, "period_id": _pid, "arrival_date": _arr, "items": items}


# ---- 条码→单位映射（人工维护，生成模板时优先级最高） ----
@router.get("/barcode-units")
def barcode_units_list(request: Request, keyword: str = ""):
    """条码→单位映射清单。"""
    _auth(request)
    return {"success": True, "items": db.forecast_barcode_units_list(keyword)}


@router.post("/barcode-units")
async def barcode_units_upsert(request: Request):
    """保存单条码单位：{barcode, unit, product_name?}。"""
    _auth(request)
    b = await request.json()
    b = b if isinstance(b, dict) else {}
    res = db.forecast_barcode_units_upsert(b.get("barcode"), b.get("unit"), b.get("product_name"))
    if res.get("error"):
        raise HTTPException(400, res["error"])
    return res


@router.post("/barcode-units/bulk")
async def barcode_units_bulk(request: Request):
    """批量保存：{rows:[{barcode, unit, product_name}]}。"""
    _auth(request)
    b = await request.json()
    b = b if isinstance(b, dict) else {}
    return db.forecast_barcode_units_bulk(b.get("rows"))


@router.delete("/barcode-units/{barcode}")
def barcode_units_delete(request: Request, barcode: str):
    """删除单条码的单位映射。"""
    _auth(request)
    return db.forecast_barcode_units_delete(barcode)


@router.post("/rebate-gap")
async def rebate_gap(request: Request):
    """P2-1 返利冲档测算：{supplier_id, extra_amount} → 当前档/下一档/缺口/冲档收益（厂家采购额口径）。
    A5 (2026-07-24)：响应恒带 balances（未结返利合同清单），前端填报页返利冲刺提示
    （loadRebatePush）据此首拉清单、再逐供应商查 projection，无需额外接口。"""
    _auth(request)
    try:
        b = await request.json()
    except Exception:
        b = {}
    b = b if isinstance(b, dict) else {}
    supplier_id = int(b.get("supplier_id") or 0)
    extra = float(b.get("extra_amount") or 0)
    balances = []
    try:
        balances = db.rebate_balances_list()
    except Exception:
        balances = []
    proj = db.rebate_gap_projection(supplier_id, extra)
    if not proj:
        return {"success": True, "projection": None, "balances": balances,
                "message": "未找到该供应商的未结返利合同，先去录入返利合同"}
    # W6 优化：未绑定总指标的供应商显式标记，前端不再静默算 0
    contract = proj.get("contract") or {}
    if not contract.get("target_amount"):
        proj["needs_contract"] = True
        proj["linkage_warning"] = proj.get("linkage_warning") or "该供应商未绑定总指标，请先录入返利合同"
    return {"success": True, "projection": proj, "balances": balances}

# Rebates
@router.get("/rebates")
def rebate_list(request: Request, month: str = None):
    _auth(request)
    if not month: month = datetime.now().strftime("%Y-%m")
    return {"success": True, "rules": db.rebate_rule_list(), "calculation": db.rebate_calculate_month(month)}

@router.post("/rebates/rules")
async def rebate_create_rule(request: Request):
    _auth(request)
    b = await request.json()
    _v(FcRebateRule, b)
    rid = db.rebate_rule_create(b["brand"], b["rule_type"], b.get("threshold",0),
                                b.get("rebate_rate",0), b.get("rebate_amount",0), b.get("bonus_amount",0))
    return {"success": True, "id": rid}


# ══════════════════════════════════════════════════════════════════════════
# v765 按品牌报单日（星期）管控
#
# 判据**全部**在 `domain/brand_order_window.py`（唯一实现）。本段只做 IO：
# 取参数 → 调判定 → 包信封。🔴 这里不许出现任何「if 星期 / if 品牌」——
# 一旦路由层长出第二份判断，小程序显示、提交闸门、配置预览就会各说各话。
#
# 三个端点各司其职，**别合并**：
#   GET  /brand-window           小程序：本期各品牌可报状态 + 横幅句（轻，每屏都调）
#   GET  /brand-window/preview   Web 配置：最近 N 期 × 各品牌矩阵（「配完会怎样」）
#   PUT  /brand-window           老板：总开关
# ══════════════════════════════════════════════════════════════════════════

@router.get("/brand-window")
def brand_window(request: Request, period_id: int = 0):
    """本期品牌可报总览。`period_id` 省略时取当前 open 的最新期次。

    🔴 恒返回 200 + `success:true`，不因配置缺失/期次不存在而报错 ——
       这个接口是填报页的**装饰性附加信息**，它挂了不该让整页填不了。
       前端判据统一为 `brands[品牌].orderable`，取不到 = 可报。
    """
    _auth(request)
    from domain.brand_order_window import period_brand_windows, spec

    pid = int(period_id or 0) or None
    if not pid:
        try:
            with db.get_db_tx() as conn:
                r = conn.execute(
                    "SELECT id FROM forecast_periods WHERE status='open' "
                    "ORDER BY id DESC LIMIT 1"
                ).fetchone()
            pid = (r[0] if r else None)
        except Exception:
            pid = None

    try:
        ctx = period_brand_windows(pid)
    except Exception as e:
        logging.getLogger("hergent").warning("brand-window 判定失败，按全放行: %s", e)
        ctx = {"enabled": False, "period_id": pid, "order_end": "", "weekday_cn": "",
               "banner": "", "banner_sub": "", "brands": {}, "rules": []}
    ctx["spec"] = spec()
    return {"success": True, **ctx}


@router.get("/brand-window/preview")
def brand_window_preview(request: Request, limit: int = 8):
    """配置预览：最近 N 期 × 各品牌能不能报。

    🔴 `never_brands` 是本端点存在的**主要理由**：某品牌配了 `order_weekdays`
       但窗口内一期都命不中（例如只配周六，而期次从不在周六截止）⇒ 它会
       **永久静默断报**，页面什么都不显示、业务员以为本周无需报单。
       这里把它显性化，配置界面必须标红。
    """
    _admin(request)
    from domain.brand_order_window import (load_rules, preview, get_config, weekdays_full,
                                          normalize_brand)

    n = max(1, min(int(limit or 8), 24))
    periods = []
    try:
        with db.get_db_tx() as conn:
            rows = conn.execute(
                "SELECT id, COALESCE(NULLIF(TRIM(order_end),''), order_end_date) AS oe "
                "FROM forecast_periods ORDER BY id DESC LIMIT ?", (n,)
            ).fetchall()
        periods = [{"id": r[0], "order_end": r[1]} for r in rows]
    except Exception as e:
        logging.getLogger("hergent").warning("brand-window 预览取期次失败: %s", e)

    rules = load_rules()
    matrix = preview(rules, periods, limit=n)

    hits = {}
    for row in matrix:
        for b in row.get("brands") or []:
            if b.get("orderable"):
                hits[b["brand"]] = hits.get(b["brand"], 0) + 1

    # v765b：每条规则品牌**实际能匹配到几个商品**。
    # 🔴 这是配置界面最容易出事的一格：生产真实存在 `蒙牛酸奶` / `蒙牛酸奶-恒滋`
    #    两条规则，归一后**匹配 0 个商品** —— 规则看着配了、页面一片绿，而它对
    #    任何一次报单都不起作用。只有把商品数摆出来，配错品牌名才会当场暴露。
    counts = {}
    try:
        with db.get_db_tx() as conn:
            for b, n in conn.execute(
                "SELECT COALESCE(NULLIF(TRIM(brand),''),'') AS b, COUNT(*) "
                "FROM products WHERE is_active=1 GROUP BY 1"
            ):
                k = normalize_brand(b)
                counts[k] = counts.get(k, 0) + int(n)
    except Exception as e:
        logging.getLogger("hergent").warning("brand-window 预览取商品数失败: %s", e)

    return {
        "success": True,
        "enabled": bool(get_config().get("enabled")),
        "periods": matrix,
        "rules": [
            {"brand": k, "weekdays": v.get("weekdays"),
             "weekdays_cn": weekdays_full(v.get("weekdays") or []),
             "products": counts.get(k, 0),
             # v765e：`rule_id` 是「改报单日 ›」深链（`/rebate?tab=rules&edit_rule=<id>`）
             #   唯一能定位到「这一条」的东西。**必须在后端给** —— 前端只拿得到归一后的
             #   品牌名（`蒙牛低温`），而规则行的 `scope_key` 可能是 `蒙牛低温/鲜奶` 之类，
             #   拿品牌名反查规则就要求前端再实现一遍归一化 = 第二份实现。
             #   同理**不许**前端按列表下标猜：`rules` 是 dict 转出来的，顺序不保证稳定。
             "rule_id": v.get("rule_id")}
            for k, v in (rules or {}).items()
        ],
        # 配了规则却在这个窗口内一次都命中不了 —— 必须让配置人看见
        "never_brands": [k for k in (rules or {}) if not hits.get(k)],
        "hit_count": hits,
    }


@router.put("/brand-window")
async def brand_window_save(request: Request):
    """总开关。默认关；关着时判定恒返回「可报」= 回到上线前的行为。

    🔴 只收真正的布尔值：`"false"` 这类字符串经 `bool()` 会变成 `True`，
       开关会**反向生效且不报错**（用户以为关了，其实开着）。
    """
    u = _admin(request)
    from domain.brand_order_window import set_config

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "请求体不是合法 JSON")
    if not isinstance(body, dict) or "enabled" not in body:
        raise HTTPException(400, "缺少 enabled 字段")
    try:
        cfg = set_config(body.get("enabled"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    logging.getLogger("hergent").info(
        "brand-window 开关被 %s 改为 %s", (u or {}).get("username"), cfg.get("enabled"))
    return {"success": True, **cfg}
