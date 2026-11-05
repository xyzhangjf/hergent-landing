#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v779 生产真跑对照（只读，不改任何数据）。

目的：证明两件事，各用生产 tenant_1 的真实规则与期次：
  ① 43 期（11-06 周五截止）的「简爱」由**拦**转**放**（旧口径判不可报）；
  ② 被拦时的弹窗不再给日历虚构日期（旧文案「请在 11月7日填报」）。

以及两条防误伤：
  ③ 所有 `order_max_early_days = 0` 的品牌，逐期结论与旧口径 Δ0；
  ④ 判定内核确实读的是 tenant_1 库（打印 engine 行核对文件名）。

用法（生产机）：
    cd /opt/hergent-erp && ERP_DB_PATH=/opt/hergent-erp/tenant_1.db \
        python3 /tmp/v779-prod-verify.py
"""
import json
import os
import sqlite3
import sys
import traceback

DB = os.environ.get("ERP_DB_PATH") or "/opt/hergent-erp/tenant_1.db"
sys.path.insert(0, "/opt/hergent-erp")

fails = []
total = 0


def ok(cond, msg):
    global total
    total += 1
    print(("  \u2705 " if cond else "  \u274c ") + msg)
    if not cond:
        fails.append(msg)


def main():
    print("=== 0 环境自检（不许读错库）===")
    print("  ERP_DB_PATH =", DB)
    ok(os.path.basename(DB) == "tenant_1.db", "0a 指向 tenant_1.db")
    ok(os.path.exists(DB), "0b 文件存在")

    raw = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    raw.row_factory = sqlite3.Row
    rules_rows = [dict(r) for r in raw.execute(
        "SELECT * FROM rebate_target_rules WHERE dimension='brand' AND is_active=1"
    )]
    per_rows = [dict(r) for r in raw.execute("SELECT * FROM forecast_periods ORDER BY id")]
    cfg_row = raw.execute(
        "SELECT payload FROM forecast_config WHERE kind='forecast_brand_window'"
    ).fetchone()
    raw.close()

    master = os.path.join(os.path.dirname(DB), "erp.db")
    print("  master(erp.db) 存在 =", os.path.exists(master))

    def pick(d, *names):
        for n in names:
            v = d.get(n)
            if v not in (None, ""):
                return str(v).strip()
        return ""

    print("\n=== 1 生产规则（品牌维度，启用中）===")
    for r in rules_rows:
        print("  · %-10s 星期=%-8r 提前=%-3r lead=%r" % (
            r.get("scope_key"), r.get("order_weekdays"),
            r.get("order_max_early_days"), r.get("order_lead_days")))
    ok(len(rules_rows) >= 1, "1a 至少读到 1 条品牌规则（读到 0 条 = 又读错库了）")

    print("\n=== 2 生产期次（尾部 6 期 + 总数）===")
    print("  期次总数 =", len(per_rows))
    for p in per_rows[-6:]:
        print("  · id=%-3s start=%-12s end=%-12s" % (
            p.get("id"), pick(p, "order_start", "order_start_date"),
            pick(p, "order_end", "order_end_date")))
    ok(len(per_rows) > 0, "2a 期次表非空")

    # ── 进入内核 ────────────────────────────────────────────────
    from domain.brand_order_window import (
        load_rules, judge, window_hit, _future_periods,
        period_brand_windows, weekday_of, weekdays_short,
    )
    from db.connection import get_db

    with get_db() as conn:
        rules = load_rules(conn)
        conn_ro = conn
        print("\n=== 3 内核装配（rules_from_rows 的输出）===")
        for k, v in rules.items():
            print("  · %-10s weekdays=%s max_early=%s rule_id=%s" % (
                k, v.get("weekdays"), v.get("max_early"), v.get("rule_id")))
        ok(bool(rules), "3a load_rules 非空（空 = 开关关着或列名不匹配）")

        def old_ok(ws, oe):
            wd = weekday_of(oe)
            return bool(wd is not None and wd in ws)

        print("\n=== 4 新旧口径逐期对照（生产全部期次）===")
        flips = []
        zero_brands = [k for k, v in rules.items() if not (v.get("max_early") or 0)]
        delta_zero = 0
        for p in per_rows:
            oe = pick(p, "order_end", "order_end_date")
            if not oe:
                continue
            for k, v in rules.items():
                ws = v.get("weekdays") or []
                new = window_hit(oe, ws, v.get("max_early") or 0)
                old = old_ok(ws, oe)
                if new != old:
                    flips.append((p.get("id"), k, oe, old, new, v.get("max_early")))
                if k in zero_brands:
                    delta_zero += 1
                    if new != old:
                        fails.append("4x 提前=0 的品牌 %s 在 %s 期被改判" % (k, p.get("id")))
        print("  改判期次 %d 条：" % len(flips))
        for f in flips:
            print("  · 期次 %-3s %-8s 截止=%s 旧=%s → 新=%s（提前 %s 天）" % (
                f[0], f[1], f[2], f[3], f[4], f[5]))
        ok(len(flips) >= 1, "4a 🔴 确实存在「由拦转放」的期次（否则本次改动在生产无效果）")
        for f in flips:
            ok(f[3] is False and f[4] is True, "4b 改判方向只允许「拦→放」：期次 %s %s" % (f[0], f[1]))
        if zero_brands:
            print("  提前=0 的品牌：%s，共比对 %d 个(期次×品牌)组合" % (zero_brands, delta_zero))
            ok(not [x for x in fails if x.startswith("4x")],
               "4c 🔴 提前=0 的品牌逐期结论与旧口径 Δ0（零误伤）")

        # ── 43 期（用户报障的那一期）─────────────────────────
        print("\n=== 5 报障期次 43 实跑 period_brand_windows(43) ===")
        ctx = period_brand_windows(43, conn=conn)
        print("  enabled=%s order_end=%s weekday=%s" % (
            ctx.get("enabled"), ctx.get("order_end"), ctx.get("weekday_cn")))
        print("  banner = %r" % (ctx.get("banner"),))
        for k, v in (ctx.get("brands") or {}).items():
            print("  · %-8s orderable=%-5s next_date=%r lock_msg=%r" % (
                k, v.get("orderable"), v.get("next_date"), v.get("lock_msg")))
        ok(ctx.get("enabled") is True, "5a 开关是打开的（生产现状）")
        ok(ctx.get("order_end") == "2026-11-06", "5b 43 期截止日 = 2026-11-06（周五）")
        jl = (ctx.get("brands") or {}).get("简爱") or {}
        ok(jl.get("orderable") is True,
           "5c 🔴 简爱在 43 期可报（旧口径：%s）" % (old_ok(jl.get("weekdays") or [], "2026-11-06"),))
        ok("简爱" in (ctx.get("banner") or ""), "5d 横幅把简爱列进可报品牌")
        ok(jl.get("lock_msg") == "", "5e 可报品牌不得带拦截句")
        for k, v in (ctx.get("brands") or {}).items():
            if k == "简爱":
                continue
            oe = ctx.get("order_end") or ""
            ws = rules.get(k, {}).get("weekdays") or []
            if not (rules.get(k, {}).get("max_early") or 0):
                ok(v.get("orderable") == old_ok(ws, oe),
                   "5f 其它品牌 %s 与旧口径一致" % k)

        # ── 被拦时的弹窗：不许给虚构日期 ─────────────────────
        print("\n=== 6 被拦期次的弹窗日期（不许日历虚构）===")
        blocked = None
        for p in reversed(per_rows):
            oe = pick(p, "order_end", "order_end_date")
            if not oe:
                continue
            fut = _future_periods(conn_ro, oe)
            d = judge("简爱", oe, rules, True, None, fut)
            if d["orderable"] is False:
                blocked = (p.get("id"), oe, d, fut)
                break
        if blocked is None:
            print("  （生产所有期次都放行，无被拦样本 —— 用未来期次存在性单独验证）")
        else:
            pid, oe, d, fut = blocked
            print("  期次 %s 截止 %s → next_date=%r" % (pid, oe, d.get("next_date")))
            print("  lock_msg = %r" % (d.get("lock_msg"),))
            print("  真实未来期次数 = %d" % len(fut))
            # 核心：给了日期就必须能在真实期次表里找到那一天
            # 🔴 比对必须按「月/日」比，不能拿 '11月3日' 去撞 '2026-11-03' ——
            #    两种格式永远不相等，会成全绿的假失败（本脚本首版就踩了）。
            nd = d.get("next_date") or ""
            if nd:
                import re as _re
                mm = _re.search(r"(\d{1,2})月(\d{1,2})日", nd)
                ok(mm is not None, "6b 🔴 弹窗日期格式可解析：%r" % nd)
                if mm:
                    md = (int(mm.group(1)), int(mm.group(2)))
                    hits = []
                    for p in per_rows:
                        for fld in ("order_start", "order_start_date",
                                    "order_end", "order_end_date"):
                            v = pick(p, fld)
                            if len(v) >= 10:
                                try:
                                    pd = (int(v[5:7]), int(v[8:10]))
                                except ValueError:
                                    continue
                                if pd == md:
                                    hits.append((p.get("id"), fld, v))
                    ok(bool(hits),
                       "6c 🔴 弹窗给的 %r 必须落在真实期次表里（命中 %r）" % (nd, hits))
                    print("    命中期次：", hits)
            else:
                ok("本期已无可报日" in (d.get("lock_msg") or ""),
                   "6d 🔴 查不到真实期次 ⇒ 退到「本期已无可报日」，不给假日期")
                ok("11月7日" not in (d.get("lock_msg") or ""),
                   "6e 🔴 旧文案「请在 11月7日填报」已不再出现")
        print("  43 期之后的真实期次 =", _future_periods(conn_ro, "2026-11-06"))

        print("\n=== 7 末期（无未来期次）被拦时的兜底文案 ===")
        fut0 = _future_periods(conn_ro, "2026-11-06")
        ok(fut0 == [], "7a 43 期之后确实一条未来期次都没有（旧弹窗却敢给 11月7日）")
        fake = {"测试品牌": {"weekdays": [7], "max_early": 0, "rule_id": -1}}
        d0 = judge("测试品牌", "2026-11-06", fake, True, None, fut0)
        print("  next_date=%r lock_msg=%r" % (d0.get("next_date"), d0.get("lock_msg")))
        ok(d0["orderable"] is False, "7b 构造样本确实被拦（否则兜底分支没被走到）")
        ok(d0.get("next_date") == "", "7c 🔴 无真实未来期次 ⇒ next_date 空串，不编日期")
        ok(d0.get("lock_msg") == "测试品牌 只能在每周日报单，本期已无可报日",
           "7d 兜底文案 = %r" % (d0.get("lock_msg"),))
        ok("11月" not in (d0.get("lock_msg") or ""), "7e 🔴 文案里不再出现任何虚构日期")

    print("\n" + ("\u274c 失败 %d 项" % len(fails) if fails else
                  "\u2713 生产对照全部通过（%d 项）" % total))
    return 1 if fails else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
