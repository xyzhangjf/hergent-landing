#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v277 S7 端到端验收 —— 商品目标「按占比分配加/减单」全链。

对象：隔离沙箱租户 9997（克隆自 tenant_1，生产真实租户**一行不碰**）。
路径：真实 HTTP → 真实后端 → 沙箱库。
样本复刻用户原话：「经理加 60 箱、刘善涛占 10% 即加 6 箱」。

覆盖：需求 6（按比例分配加/减单）+ 需求 5（负数=减单）+ 需求 7（定稿通知）
      + 需求 4（差额合计的按人拆解数据源）+ 幂等（清空加单清掉旧分配）
"""
import json, sys, urllib.request, urllib.error

BASE = "https://hergent.cn"
TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
TID = sys.argv[2] if len(sys.argv) > 2 else "9997"
PID_PERIOD = 18
START, END = "", ""                          # 动态取自期次自身窗口（见 STEP 0）
PMONTH = "2026-09"

RESULTS = []


def is_ok(resp):
    """成功判据：后端成功体用 `success`（save-matrix）/ `ok`（product-targets），两者都认。"""
    return isinstance(resp, dict) and (resp.get("success") is True or resp.get("ok") is True)


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, str(detail)))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   | " + str(detail)) if detail else ""))
    return bool(cond)


def call(method, path, body=None):
    url = BASE + path
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Tenant-Id", str(TID))
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return -1, str(e)


print("=" * 78)
print("STEP 0  读期次自身窗口（save-matrix 按请求体窗口落库，extra-alloc 按期次窗口读，必须一致）")
print("=" * 78)
st, pr = call("GET", "/api/forecast/periods")
prow = next((x for x in ((pr or {}).get("periods") or []) if int(x.get("id") or 0) == PID_PERIOD), None)
if not ok("S0 期次存在且可写（status=open 且 order_end >= 今天）",
          bool(prow) and prow.get("status") == "open" and (prow.get("order_end") or "") >= "2026-09-25",
          "" if not prow else "status=%s %s ~ %s" % (prow.get("status"), prow.get("order_start"), prow.get("order_end"))):
    sys.exit(1)
START, END = prow.get("order_start") or "", prow.get("order_end") or ""
print("  使用窗口 start=%s end=%s" % (START, END))

print()
print("=" * 78)
print("STEP 1  挑样本商品 / 承接人")
print("=" * 78)
st, prods = call("GET", "/api/product-targets/products?limit=500")
items = (prods or {}).get("items") or []
cands = [p for p in items if p.get("can_target")]
print("  可选商品总数 %d，其中有换算(can_target) %d" % (len(items), len(cands)))
# 选「无歧义」的商品：小单位 ≠ 大单位，且 小单位 ≠ 中单位 ⇒ per_case 恒 == large_ratio
unamb = [p for p in cands
         if (p.get("unit") or "").strip() != (p.get("large_unit") or "").strip()
         and (p.get("unit") or "").strip() != (p.get("medium_unit") or "").strip()]
P = unamb[0] if unamb else (cands[0] if cands else None)
if not ok("S0a 找到可设目标的商品（有换算）", bool(P), "" if not P else
          "id=%s %s | spec=%s unit=%s large=%s×%s medium=%s×%s" % (
              P.get("id"), P.get("name"), P.get("spec"), P.get("unit"),
              P.get("large_unit"), P.get("large_ratio"), P.get("medium_unit"), P.get("medium_ratio"))):
    sys.exit(1)
ok("S0b 样本商品走「无歧义」分支（per_case == large_ratio）", P in unamb)

st, emps = call("GET", "/api/product-targets/employees")
elist = (emps or {}).get("items") or []
byname = {e.get("name"): e for e in elist}
ALLOCS = []
for nm, ratio in (("刘善涛", 10), ("刘小顶", 30), ("张俊峰", 60)):
    e = byname.get(nm)
    if e:
        ALLOCS.append({"employee_id": e["id"], "employee_name": nm, "ratio": ratio})
print("  承接人: %s" % [(a["employee_name"], a["employee_id"], a["ratio"]) for a in ALLOCS])
if not ok("S0c 三位承接人齐备且合计 100%", len(ALLOCS) == 3 and sum(a["ratio"] for a in ALLOCS) == 100):
    sys.exit(1)

PC = float(P.get("large_ratio") or 0)          # per_case（无歧义分支）
UNIT = (P.get("unit") or "").strip()
LU = (P.get("large_unit") or "").strip()
print("  换算：1 %s = %s %s" % (LU, PC, UNIT))

print()
print("=" * 78)
print("STEP 2  建商品目标（需求 1：自动分解 + 手动占比）")
print("=" * 78)
st, ex = call("GET", "/api/product-targets?month=" + PMONTH)
for t in ((ex or {}).get("items") or []):
    if int(t.get("product_id") or 0) == int(P["id"]):
        call("DELETE", "/api/product-targets/%s" % t["id"])
        print("  清掉沙箱里同商品的旧目标 id=%s" % t["id"])
st, cr = call("POST", "/api/product-targets", {
    "name": "v277验收·%s目标" % P.get("name"),
    "period_month": PMONTH, "product_id": P["id"], "basis": "qty",
    "target_qty": 150, "target_unit": LU, "allocs": ALLOCS})
ok("S2a 目标创建成功", st == 200 and is_ok(cr), "HTTP %s %s" % (st, cr))
TARGET_ID = (cr or {}).get("id")

st, ex = call("GET", "/api/product-targets?month=" + PMONTH)
trow = next((t for t in ((ex or {}).get("items") or [])
             if int(t.get("product_id") or 0) == int(P["id"])), None)
ok("S2b 目标可按月检索到", bool(trow), "" if not trow else
   "target_qty=%s 单位=%s allocs=%s" % (trow.get("target_qty"), trow.get("target_unit"),
                                        [(a.get("employee_name"), a.get("ratio")) for a in (trow.get("allocs") or [])]))

# 违法占比必须被硬拒（后端硬校验，不是前端提示）
st, bad = call("POST", "/api/product-targets", {
    "name": "v277验收·非法占比", "period_month": PMONTH, "product_id": P["id"],
    "basis": "qty", "target_qty": 10, "target_unit": LU,
    "allocs": [{"employee_id": ALLOCS[0]["employee_id"], "employee_name": ALLOCS[0]["employee_name"], "ratio": 90}]})
ok("S2c Σ占比≠100% 被后端 422 硬拒", st == 422, "HTTP %s %s" % (st, str(bad)[:110]))
if st == 422:
    st2, ex2 = call("GET", "/api/product-targets?month=" + PMONTH)
    n = len([t for t in ((ex2 or {}).get("items") or []) if int(t.get("product_id") or 0) == int(P["id"])])
    ok("S2d 被拒的请求没留下目标行（失败不留半成品）", n == 1, "该商品目标行数=%d" % n)

print()
print("=" * 78)
print("STEP 3  先落「本期报单」（按客户列建单，store_name = 列名）")
print("=" * 78)
# report_mapping 别名 → 员工：刘善涛→6 / 美联保康→4(刘小顶) / 东津→7(张俊峰) / 永诺旗舰店→8
CUST = ["刘善涛", "美联保康", "东津", "永诺旗舰店"]
BOX0 = {"刘善涛": 5, "美联保康": 8, "东津": 12, "永诺旗舰店": 20}      # 期望「原报单(箱)」
qty0 = {c: round(BOX0[c] * PC, 3) for c in CUST}
row = {"product_id": P["id"], "product_name": P.get("name"), "spec": P.get("spec"),
       "unit": UNIT, "price": 1.0, "qty_by_unit": qty0}
st, r1 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": START, "end": END,
    "customers": CUST, "rows": [row]})
ok("S3a 第 1 轮保存（建立报单，未填加单）成功", st == 200 and is_ok(r1),
   "HTTP %s %s" % (st, str(r1)[:220]))
ok("S3b 未填加单 ⇒ 不产生分配行", not ((r1 or {}).get("extra_alloc")), str((r1 or {}).get("extra_alloc"))[:120])

st, ea0 = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
ok("S3c extra-alloc 此刻为空（没有加单就没有分配）",
   st == 200 and not ((ea0 or {}).get("data") or {}).get("items"),
   "HTTP %s items=%s" % (st, list((((ea0 or {}).get("data") or {}).get("items") or {}).keys())))

print()
print("=" * 78)
print("STEP 4  ★ 需求 6 主场景：经理加 60 箱 ⇒ 按占比 10/30/60 分到人")
print("=" * 78)
row2 = dict(row, extra_qty=60)
st, r2 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": START, "end": END,
    "customers": CUST, "rows": [row2]})
ok("S4a 保存携带加单 60 箱成功", st == 200 and is_ok(r2), "HTTP %s %s" % (st, str(r2)[:200]))

st, ea = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
dd = ((ea or {}).get("data") or {})
got = list(((dd.get("items") or {}).get(str(P["id"])) or {}).get("rows") or [])
print("  extra-alloc 返回 %d 行 / total_delta=%s" % (
    len(got), ((dd.get("items") or {}).get(str(P["id"])) or {}).get("total_delta")))

EXP = {"刘善涛": (10, 5.0, 6.0, 11.0), "刘小顶": (30, 8.0, 18.0, 26.0), "张俊峰": (60, 12.0, 36.0, 48.0)}
ok("S4b 分配行数 == 承接人数", len(got) == 3, "实际 %d" % len(got))
for r in got:
    nm = r.get("employee_name")
    e = EXP.get(nm)
    if not ok("S4c[%s] 行存在且在预期内" % nm, e is not None, "ratio=%s rep=%s alloc=%s final=%s"
              % (r.get("ratio"), r.get("reported_box"), r.get("alloc_box"), r.get("final_box"))):
        continue
    ratio, rep, alc, fin = e
    ok("S4d[%s] 占比 %s%%" % (nm, ratio), abs(float(r.get("ratio") or 0) - ratio) < 1e-6, r.get("ratio"))
    ok("S4e[%s] 原报单 = %s 箱（按 store_name→别名→员工 归到本人）" % (nm, rep),
       abs(float(r.get("reported_box") or 0) - rep) < 1e-6, r.get("reported_box"))
    ok("S4f[%s] 加单 = 60 × %s%% = %s 箱" % (nm, ratio, alc),
       abs(float(r.get("alloc_box") or 0) - alc) < 1e-6, r.get("alloc_box"))
    ok("S4g[%s] 调整后 = %s + %s = %s 箱" % (nm, rep, alc, fin),
       abs(float(r.get("final_box") or 0) - fin) < 1e-6, r.get("final_box"))
S = sum(float(r.get("alloc_box") or 0) for r in got)
ok("S4h Σ加单 == 经理填的 60（不重不漏）", abs(S - 60.0) < 1e-6, "Σ=%s" % round(S, 6))

print()
print("=" * 78)
print("STEP 5  需求 5：加单填负数 = 减单，按占比同法扣减")
print("=" * 78)
row3 = dict(row, extra_qty=-10)
st, r3 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": START, "end": END,
    "customers": CUST, "rows": [row3]})
ok("S5a 保存携带减单 -10 箱成功", st == 200 and is_ok(r3), "HTTP %s" % st)
st, ea = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
got = list(((((ea or {}).get("data") or {}).get("items") or {}).get(str(P["id"])) or {}).get("rows") or [])
EXPN = {"刘善涛": (5.0, -1.0, 4.0), "刘小顶": (8.0, -3.0, 5.0), "张俊峰": (12.0, -6.0, 6.0)}
ok("S5b 减单后仍是 3 行（**整体替换**，不是追加）", len(got) == 3, "实际 %d" % len(got))
for r in got:
    nm = r.get("employee_name")
    e = EXPN.get(nm)
    if not ok("S5c[%s] 行在预期内" % nm, e is not None, r):
        continue
    rep, alc, fin = e
    ok("S5d[%s] 减单 %s 箱 / 调整后 %s 箱" % (nm, alc, fin),
       abs(float(r.get("alloc_box") or 0) - alc) < 1e-6 and abs(float(r.get("final_box") or 0) - fin) < 1e-6,
       "alloc=%s final=%s" % (r.get("alloc_box"), r.get("final_box")))

print()
print("=" * 78)
print("STEP 6  幂等：把加单清回 0 ⇒ 旧分配必须一起清掉（不留幽灵）")
print("=" * 78)
row4 = dict(row, extra_qty=0)
st, r4 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": START, "end": END,
    "customers": CUST, "rows": [row4]})
ok("S6a 清空加单保存成功", st == 200 and is_ok(r4), "HTTP %s" % st)
st, ea = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
rows6 = list(((((ea or {}).get("data") or {}).get("items") or {}).get(str(P["id"])) or {}).get("rows") or [])
ok("S6b 清空加单后分配行归零（幽灵数据已清）", len(rows6) == 0, "实际 %d 行" % len(rows6))

print()
print("=" * 78)
print("STEP 7  复原：重新加 60 箱，给前端探针留一个可见状态")
print("=" * 78)
st, r5 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": START, "end": END,
    "customers": CUST, "rows": [row2]})
st, ea = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
it = ((((ea or {}).get("data") or {}).get("items") or {}).get(str(P["id"])) or {})
ok("S7a 复原后分配行 = 3 且 Σ=60", len(it.get("rows") or []) == 3
   and abs(sum(float(r.get("alloc_box") or 0) for r in (it.get("rows") or [])) - 60) < 1e-6,
   "rows=%d" % len(it.get("rows") or []))
CAL = ((ea or {}).get("data") or {}).get("caliber")
ok("S7b extra-alloc 带口径说明（供前端悬停展示算法）", bool(CAL), str(CAL)[:200])

print()
print("=" * 78)
print("STEP 8  需求 4：avg-target 的「按业务员差额」数据源")
print("=" * 78)
st, avg = call("GET", "/api/product-targets/avg-target?period_id=%d" % PID_PERIOD)
it2 = (((avg or {}).get("items") or {}) or {}).get(str(P["id"])) if isinstance(avg, dict) else None
ok("S8a avg-target 返回结构正常（items 为按 product_id 索引的字典）",
   isinstance(avg, dict) and isinstance((avg or {}).get("items"), dict),
   "HTTP %s type=%s" % (st, type((avg or {}).get("items")).__name__))
if it2:
    print("  avg-target[%s]: reported_box=%s achieved_box=%s achieved_src=%s avg_box=%s prefill_box=%s"
          % (P["id"], it2.get("reported_box"), it2.get("achieved_box"),
             it2.get("achieved_src"), it2.get("avg_box"), it2.get("prefill_box")))
    print("  per_unit: %s" % json.dumps(it2.get("per_unit"), ensure_ascii=False)[:220])
    ok("S8b 目标商品的「本期已报单」能被读到（= 加单列差额的数据源）",
       abs(float(it2.get("reported_box") or 0) - 45.0) < 1e-6,
       "reported_box=%s 期望 45（5+8+12+20）" % it2.get("reported_box"))
    ok("S8c 带三件套口径说明", all(k in ((avg or {}).get("caliber") or {}) for k in ("achieved", "gap", "prefill")),
       str(list(((avg or {}).get("caliber") or {}).keys())))
else:
    ok("S8b 目标商品出现在 avg-target 里", False, "items 键=%s" % list(((avg or {}).get("items") or {}).keys())[:8])

print()
print("=" * 78)
print("STEP 9  ★ 需求 3：达成填报·商品维度（已达成不再恒 0）—— 用有真实销售的商品 1449")
print("=" * 78)
P2 = {"id": 1449, "name": "蒙牛0蔗糖原味百利包150g*5袋*8包", "spec": "150g*5袋*8包",
      "unit": "袋", "large_unit": "件", "large_ratio": 40.0}
# 先确认它确实是「无可填报达成」的商品（rebate_achievements.product 全库 0 行）
st, ex9 = call("GET", "/api/product-targets?month=" + PMONTH)
have = next((t for t in ((ex9 or {}).get("items") or [])
             if int(t.get("product_id") or 0) == P2["id"]), None)
if have:
    call("DELETE", "/api/product-targets/%s" % have["id"])
st, cr9 = call("POST", "/api/product-targets", {
    "name": "v277验收·达成商品维度", "period_month": PMONTH, "product_id": P2["id"],
    "basis": "qty", "target_qty": 3000, "target_unit": "件",
    "allocs": [{"employee_id": ALLOCS[0]["employee_id"], "employee_name": ALLOCS[0]["employee_name"], "ratio": 100}]})
ok("S9a 为有销售的商品建目标成功", st == 200 and is_ok(cr9), "HTTP %s %s" % (st, str(cr9)[:120]))
st, avg9 = call("GET", "/api/product-targets/avg-target?period_id=%d" % PID_PERIOD)
it9 = (((avg9 or {}).get("items") or {}) or {}).get(str(P2["id"])) if isinstance(avg9, dict) else None
if ok("S9b avg-target 里能拿到该商品", bool(it9), str(it9)[:160]):
    ach = float(it9.get("achieved_box") or 0)
    src = it9.get("achieved_src")
    print("  achieved_box=%s  src=%s  单位=%s  目标=%s 箱  可报单数=%s"
          % (ach, src, it9.get("unit"), it9.get("target_box"), it9.get("remaining_periods")))
    ok("S9c ★ 已达成不再恒 0（从销售单自动汇总）", ach > 0, "achieved_box=%s" % ach)
    ok("S9d 来源标记为 sales（不是静默混人工填报）", src == "sales", "src=%s" % src)
    # 独立复算：9 月已签收销量 92,180 袋 ÷ 40 袋/件 = 2304.5 件
    exp_box = 92180 / 40.0
    ok("S9e 数值与独立复算一致（92,180 袋 ÷ 40 = %.1f 件）" % exp_box,
       abs(ach - exp_box) < 0.5, "实测 %s vs 复算 %s" % (ach, exp_box))
    ok("S9f 均单目标随之变小（= 报告里说的「系统性偏大」被修正）",
       it9.get("avg_box") is not None and float(it9.get("avg_box") or 0) < float(it9.get("target_box") or 0),
       "avg_box=%s < target_box=%s" % (it9.get("avg_box"), it9.get("target_box")))

print()
print("=" * 78)
NP = sum(1 for c, _, _ in RESULTS if c)
print("结果：%d / %d 通过" % (NP, len(RESULTS)))
bad = [n for c, n, _ in RESULTS if not c]
if bad:
    print("未通过：")
    for n in bad:
        print("   - " + n)
print("=" * 78)
sys.exit(0 if not bad else 1)
