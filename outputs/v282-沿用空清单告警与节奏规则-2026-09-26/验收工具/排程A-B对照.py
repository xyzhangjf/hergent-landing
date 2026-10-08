# -*- coding: utf-8 -*-
"""v282 前置验证：把「蒙牛鲜奶」加进自动开表的排程集合后，排程是否**逐条不变**。

只在本地跑纯函数 `build_period_plan`，不碰生产、不写库。
判据 = 两次输出的 periods 逐字段全等（不是「看起来差不多」）。
"""
import os
import sys
import json

sys.path.insert(0, "/Users/zhangjunfeng/Documents/hergent-erp/server")
os.environ.setdefault("ERP_SECRET", "wont-be-used")

from domain.arrival_schedule import build_period_plan  # noqa: E402

# ---- 生产真实规则行（2026-09-26 20:06 只读导出，逐字段照录）----
MONNIU_DI = {
    "id": 10, "rule_name": "蒙牛低温2026年目标", "dimension": "brand",
    "scope_key": "蒙牛低温", "scope_name": "蒙牛低温",
    "order_mode": "interval", "order_cadence_days": 2, "order_weekdays": "",
    "order_first_date": "2026-08-28", "order_lead_days": 4, "order_max_early_days": 1,
    "arrival_mode": "interval", "arrival_cadence_days": 2, "arrival_first_dom": 1,
    "arrival_weekdays": "", "arrival_count_override": 15,
    "auto_period_enabled": 1, "auto_open_time": "16:00",
    "auto_close_time": "10:00", "supplier_deadline_time": "12:00",
    "is_active": 1, "priority": 0,
}
XIANNAI_NEW = {
    **MONNIU_DI, "id": 11, "rule_name": "蒙牛鲜奶到货节奏（同蒙牛低温）",
    "scope_key": "蒙牛鲜奶", "scope_name": "蒙牛鲜奶",
    "auto_period_enabled": 0,      # 🔴 绝不抢 carrier
}
JIANAI = {
    "id": 9, "rule_name": "简爱9月目标", "dimension": "brand",
    "scope_key": "简爱", "scope_name": "简爱",
    "order_mode": "interval", "order_cadence_days": 0, "order_weekdays": "",
    "order_first_date": "", "order_lead_days": 4, "order_max_early_days": 1,
    "arrival_mode": "weekday", "arrival_cadence_days": 0, "arrival_first_dom": 1,
    "arrival_weekdays": "2,5", "arrival_count_override": 8,
    "auto_period_enabled": 0, "auto_open_time": "20:00",
    "auto_close_time": "10:00", "supplier_deadline_time": "12:00",
    "is_active": 1, "priority": 0,
}

PASS, FAIL = [], []


def ck(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (("  <<< " + str(extra)) if (extra and not cond) else ""))


def plan_of(rules):
    """完全复刻 scheduler._check_auto_period 的入参组装。"""
    plan_rules = [{**r, "name": r.get("scope_name") or r.get("rule_name") or ""}
                  for r in rules if (r.get("order_first_date") or "").strip()]
    carrier = None
    for r in rules:
        if int(r.get("auto_period_enabled") or 0) == 1:
            carrier = r
            break
    assert carrier, "生产必然有 carrier（蒙牛低温）"
    cname = carrier.get("scope_name") or carrier.get("rule_name") or ""
    if not any(x["name"] == cname for x in plan_rules):
        plan_rules.append({**carrier, "name": cname})
    return build_period_plan(plan_rules, horizon_days=14,
                             open_time="16:00", close_time="10:00",
                             supplier_time="12:00"), [x["name"] for x in plan_rules]


print("=" * 70)
print("v282 A/B：加「蒙牛鲜奶」前后，自动开表排程是否逐条不变")
print("=" * 70)

before, names_before = plan_of([JIANAI, MONNIU_DI])
after, names_after = plan_of([JIANAI, MONNIU_DI, XIANNAI_NEW])

print("\n排程集合（改前）=", names_before)
print("排程集合（改后）=", names_after)

def strip_brands(pl):
    """去掉显示层字段（brands / brand_detail）—— 它们是从日期**派生**的，不参与日期计算。"""
    out = []
    for p in (pl.get("periods") or []):
        out.append({k: v for k, v in p.items() if k not in ("brands", "brand_detail")})
    return json.dumps(out, ensure_ascii=False, sort_keys=True)


print("\n改前 periods 条数 =", len(before.get("periods") or []))
print("改后 periods 条数 =", len(after.get("periods") or []))
ck("期次条数一致", len(before.get("periods") or []) == len(after.get("periods") or []))
ck("🔴 排程日期逐字段全等（去掉显示层 brands 后）", strip_brands(before) == strip_brands(after))
ck("plan 其余键全等（main_brand / main_interval / missed / warnings）",
   json.dumps({k: v for k, v in before.items() if k != "periods"}, ensure_ascii=False, sort_keys=True)
   == json.dumps({k: v for k, v in after.items() if k != "periods"}, ensure_ascii=False, sort_keys=True))
ck("无漏报（missed 与改前一致、且为空）", before.get("missed") == after.get("missed") == [])

# 唯一的差异必须**只是** brands/brand_detail 多了一个「蒙牛鲜奶」，且它的到货日/提前天数与蒙牛低温**完全一致**
_delta_ok, _delta_msg = True, []
for pb_, pa_ in zip(before.get("periods") or [], after.get("periods") or []):
    if pb_["brands"] != ["蒙牛低温"]:
        _delta_ok, _delta_msg = False, "改前 brands 不是只有蒙牛低温: %r" % (pb_["brands"],)
        break
    if set(pa_["brands"]) != {"蒙牛鲜奶", "蒙牛低温"}:
        _delta_ok, _delta_msg = False, "改后 brands 不是两条: %r" % (pa_["brands"],)
        break
    _d = {x["name"]: (x["early_days"], x["arrival_date"]) for x in pa_["brand_detail"]}
    if _d.get("蒙牛鲜奶") is None or _d.get("蒙牛鲜奶") != _d.get("蒙牛低温"):
        _delta_ok, _delta_msg = False, "蒙牛鲜奶的 early_days/arrival_date 与蒙牛低温不一致: %r" % (_d,)
        break
ck("唯一差异 = 每条期次多一个「蒙牛鲜奶」，且其到货日/提前天数与蒙牛低温逐字相同", _delta_ok, _delta_msg)

print("\n--- 前 3 条期次明细（改后，供人工过目）---")
for p in (after.get("periods") or [])[:3]:
    print("   ", json.dumps(p, ensure_ascii=False))

print("\n" + "=" * 70)
print("通过 %d / 共 %d" % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print("失败项：", FAIL)
    sys.exit(1)
print("RESULT: ALL PASS")
