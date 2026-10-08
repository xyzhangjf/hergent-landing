#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 端到端验收 —— 归属键「窗口 → period_id」的**反例对照**验证。

对象：隔离沙箱租户 9997（克隆自 tenant_1；生产业务表一行不碰）。
路径：真实 HTTP(127.0.0.1:8700) → 真实后端 → 沙箱库；库内直读做反例对照。

验收主张（用户 2026-09-26 拍板方案 A）：
  ① 落库窗口**锚定期次自身**，请求体传什么窗口都不影响            → STEP 3
  ② 期次窗口被改后，分配明细仍读得到（v277 在此时读空、零报错）    → STEP 4 ★核心
  ③ 幂等：重复保存不产生重复行、清空加单清掉旧分配                → STEP 5
  ④ 通知 event_key 用 period_id（窗口改名不再让去重失效）        → STEP 6
"""
import json
import sys
import sqlite3
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8700"
TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
TID = sys.argv[2] if len(sys.argv) > 2 else "9997"
SANDBOX_DB = "/opt/hergent-erp/tenant_9997.db"
PID_PERIOD = 18
PMONTH = "2026-09"

RES = []


def is_ok(r):
    return isinstance(r, dict) and (r.get("success") is True or r.get("ok") is True)


def ok(name, cond, detail=""):
    RES.append((bool(cond), name, str(detail)))
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   | " + str(detail)) if detail else ""))
    return bool(cond)


_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Tenant-Id", str(TID))
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with _opener.open(req, timeout=60) as r:
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


def db_rows(where, args, cols="period_id, period_start, period_end, product_id, employee_id, "
                               "employee_name, ratio, reported_box, alloc_box, final_box"):
    c = sqlite3.connect("file:%s?mode=ro" % SANDBOX_DB, uri=True)
    try:
        return [tuple(r) for r in c.execute(
            "SELECT %s FROM forecast_extra_alloc WHERE %s ORDER BY employee_id" % (cols, where),
            args)]
    finally:
        c.close()


def db_exec(sql, args=()):
    c = sqlite3.connect(SANDBOX_DB)
    try:
        c.execute(sql, args)
        c.commit()
    finally:
        c.close()


print("=" * 80)
print("STEP 0  期次与承接人")
print("=" * 80)
st, pr = call("GET", "/api/forecast/periods")
prow = next((x for x in ((pr or {}).get("periods") or []) if int(x.get("id") or 0) == PID_PERIOD), None)
if not ok("S0a 沙箱期次 18 存在且可写", bool(prow) and prow.get("status") == "open"
          and (prow.get("order_end") or "") >= "2026-09-26",
          "" if not prow else "status=%s %s ~ %s" % (prow["status"], prow["order_start"], prow["order_end"])):
    sys.exit(1)
A_START, A_END = prow["order_start"], prow["order_end"]
print("  期次窗口 A = %s ~ %s" % (A_START, A_END))

st, prods = call("GET", "/api/product-targets/products?limit=500")
items = (prods or {}).get("items") or []
cands = [p for p in items if p.get("can_target")]
unamb = [p for p in cands
         if (p.get("unit") or "").strip() != (p.get("large_unit") or "").strip()
         and (p.get("unit") or "").strip() != (p.get("medium_unit") or "").strip()]
P = next((x for x in unamb if int(x.get("id") or 0) == 1556), unamb[0] if unamb else None)
if not ok("S0b 选出「无歧义」样本商品（per_case == large_ratio）", bool(P) and P in unamb,
          "" if not P else "id=%s %s | spec=%s unit=%s large=%s×%s" % (
              P.get("id"), P.get("name"), P.get("spec"), P.get("unit"),
              P.get("large_unit"), P.get("large_ratio"))):
    sys.exit(1)
PC = float(P.get("large_ratio") or 0)
UNIT = (P.get("unit") or "").strip()
LU = (P.get("large_unit") or "").strip()
print("  换算：1 %s = %s %s（per_case=%s）" % (LU, PC, UNIT, PC))

st, emps = call("GET", "/api/product-targets/employees")
byname = {e.get("name"): e for e in ((emps or {}).get("items") or [])}
ALLOCS = []
for nm, ratio in (("刘善涛", 10), ("刘小顶", 30), ("张俊峰", 60)):
    e = byname.get(nm)
    if e:
        ALLOCS.append({"employee_id": e["id"], "employee_name": nm, "ratio": ratio})
ok("S0c 三位承接人齐备且合计 100%", len(ALLOCS) == 3 and sum(a["ratio"] for a in ALLOCS) == 100,
   str([(a["employee_name"], a["employee_id"], a["ratio"]) for a in ALLOCS]))

print()
print("=" * 80)
print("STEP 1  建目标（150 箱 · 占比 10/30/60）")
print("=" * 80)
st, ex = call("GET", "/api/product-targets?month=" + PMONTH)
for t in ((ex or {}).get("items") or []):
    if int(t.get("product_id") or 0) == int(P["id"]):
        call("DELETE", "/api/product-targets/%s" % t["id"])
st, cr = call("POST", "/api/product-targets", {
    "name": "v279验收·%s目标" % P.get("name"), "period_month": PMONTH,
    "product_id": P["id"], "basis": "qty", "target_qty": 150, "target_unit": LU,
    "allocs": ALLOCS})
ok("S1a 目标创建成功", st == 200 and is_ok(cr), "HTTP %s %s" % (st, str(cr)[:150]))

print()
print("=" * 80)
print("STEP 2  baseline 报单（用期次窗口 A；**不填加单**）")
print("=" * 80)
CUST = ["刘善涛", "美联保康", "东津", "永诺旗舰店"]
BOX0 = {"刘善涛": 5, "美联保康": 8, "东津": 12, "永诺旗舰店": 20}
qty0 = {c: round(BOX0[c] * PC, 3) for c in CUST}
base_row = {"product_id": P["id"], "product_name": P.get("name"), "spec": P.get("spec"),
            "unit": UNIT, "price": 1.0, "qty_by_unit": qty0}
st, r1 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": A_START, "end": A_END, "customers": CUST, "rows": [base_row]})
ok("S2a baseline 保存成功", st == 200 and is_ok(r1), "HTTP %s %s" % (st, str(r1)[:180]))
ok("S2b 未填加单 ⇒ 不产生分配行", not db_rows("1=1", ()))

print()
print("=" * 80)
print("STEP 3  ★ 请求体窗口错位（B=09-24~09-25 ≠ 期次窗口 A）时保存加单 60 箱")
print("=" * 80)
B_END = "2026-09-25"
print("  期次窗口 A = %s ~ %s ；请求体窗口 B = %s ~ %s" % (A_START, A_END, A_START, B_END))
st, r2 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": A_START, "end": B_END, "customers": CUST,
    "rows": [dict(base_row, extra_qty=60)]})
ok("S3a 错窗口保存成功（保存本身不因此失败——这正是 v277 的迷惑之处）",
   st == 200 and is_ok(r2), "HTTP %s %s" % (st, str(r2)[:200]))

raw = db_rows("1=1", ())
ok("S3b 落库 3 行（= 承接人数）", len(raw) == 3, "实际 %d" % len(raw))
ok("S3c 落库 period_id 全 == %d" % PID_PERIOD, all(r[0] == PID_PERIOD for r in raw),
   str(sorted({r[0] for r in raw})))
ok("S3d ★落库窗口 == **期次窗口 A**（锚定期次，不再锚请求体窗口 B）",
   all((r[1], r[2]) == (A_START, A_END) for r in raw),
   "库里窗口=%s" % sorted({(r[1], r[2]) for r in raw}))
ok("S3e 库里不存在以请求体窗口 B 落库的行",
   not db_rows("period_end=?", (B_END,)), "按 B 查到 %d 行" % len(db_rows("period_end=?", (B_END,))))

st, ea = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
got = ((((ea or {}).get("data") or {}).get("items") or {}).get(str(P["id"])) or {}).get("rows") or []
EXP = {"刘善涛": (10, 5.0, 6.0, 11.0), "刘小顶": (30, 8.0, 18.0, 26.0), "张俊峰": (60, 12.0, 36.0, 48.0)}
ok("S3f HTTP 读回 3 行", len(got) == 3, "HTTP %s 行数=%d" % (st, len(got)))
for r in got:
    nm = r.get("employee_name")
    e = EXP.get(nm)
    if not ok("S3g[%s] 行在预期内" % nm, e is not None, str(r)):
        continue
    ratio, rep, alc, fin = e
    ok("S3h[%s] 占比%s%% / 原报%.0f / 加%.0f / 定稿%.0f" % (nm, ratio, rep, alc, fin),
       abs(float(r["ratio"]) - ratio) < 1e-6 and abs(float(r["reported_box"]) - rep) < 1e-6
       and abs(float(r["alloc_box"]) - alc) < 1e-6 and abs(float(r["final_box"]) - fin) < 1e-6,
       "ratio=%s rep=%s alloc=%s final=%s" % (r["ratio"], r["reported_box"], r["alloc_box"], r["final_box"]))
ok("S3i Σ加单 == 60（不重不漏）",
   abs(sum(float(r["alloc_box"]) for r in got) - 60.0) < 1e-6,
   "Σ=%s" % sum(float(r["alloc_box"]) for r in got))

print()
print("=" * 80)
print("STEP 4  ★★ 核心：把期次窗口改掉之后，分配明细还读得到吗")
print("=" * 80)
before_vals = sorted(db_rows("period_id=?", (PID_PERIOD,)))
C_END = "2026-11-30"
db_exec("UPDATE forecast_periods SET order_end=? WHERE id=?", (C_END, PID_PERIOD))
print("  期次窗口 A(%s) → C(%s)" % (A_END, C_END))

n_oldkey = len(db_rows("period_start=? AND period_end=?", (A_START, A_END)))
n_newkey = len(db_rows("period_start=? AND period_end=?", (A_START, C_END)))
ok("S4a 【反例·旧键】按**当前**期次窗口(%s~%s) 查 ⇒ 0 行（v277 的 GET 此刻读空且零报错）"
   % (A_START, C_END), n_newkey == 0, "查到 %d 行" % n_newkey)
ok("S4a2 同一条数据：按**落库时**的窗口(%s~%s) 查有 %d 行 ⇒ 读取结果取决于期次窗口"
   "**此刻的值** = 「窗口当键」的脆弱性根源" % (A_START, A_END, n_oldkey), n_oldkey == 3)
n_new = len(db_rows("period_id=?", (PID_PERIOD,)))
ok("S4b 【正例·新键】按 period_id 查 ⇒ 仍 3 行", n_new == 3, "查到 %d 行" % n_new)

st, ea2 = call("GET", "/api/product-targets/extra-alloc?period_id=%d" % PID_PERIOD)
got2 = ((((ea2 or {}).get("data") or {}).get("items") or {}).get(str(P["id"])) or {}).get("rows") or []
ok("S4c 【HTTP】改窗口后 GET /extra-alloc 仍返回 3 行", len(got2) == 3,
   "HTTP %s 行数=%d" % (st, len(got2)))
after_vals = sorted(db_rows("period_id=?", (PID_PERIOD,)))
ok("S4d 改窗口前后，落库数据**逐字节相同**（窗口只是属性，不参与归属）", before_vals == after_vals,
   "before=%s after=%s" % (len(before_vals), len(after_vals)))
pr_now = ((ea2 or {}).get("data") or {}).get("period") or {}
ok("S4e 接口回执里的期次窗口已是新值（展示用窗口随之更新）",
   (pr_now.get("order_end") or "") == C_END, str(pr_now))

print()
print("=" * 80)
print("STEP 5  幂等：重复保存同值 / 清空加单")
print("=" * 80)
st, r3 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": A_START, "end": A_END, "customers": CUST,
    "rows": [dict(base_row, extra_qty=60)]})
ok("S5a 以**正确窗口 A** 重复保存加单 60 成功", st == 200 and is_ok(r3), "HTTP %s" % st)
ok("S5b 重复保存**不产生重复行**（新唯一键 (period_id,product,employee) 生效）",
   len(db_rows("period_id=?", (PID_PERIOD,))) == 3,
   "行数=%d" % len(db_rows("period_id=?", (PID_PERIOD,))))

st, r4 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": A_START, "end": A_END, "customers": CUST,
    "rows": [dict(base_row, extra_qty=0)]})
ok("S5c 加单清回 0 保存成功", st == 200 and is_ok(r4), "HTTP %s" % st)
ok("S5d 旧分配一起清掉（不留幽灵）", not db_rows("period_id=?", (PID_PERIOD,)),
   "残留 %d 行" % len(db_rows("period_id=?", (PID_PERIOD,))))

print()
print("=" * 80)
print("STEP 6  通知：event_key 用 period_id")
print("=" * 80)
st, r5 = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID_PERIOD, "start": A_START, "end": A_END, "customers": CUST,
    "rows": [dict(base_row, extra_qty=60)]})
ok("S6a 再保存加单 60 成功", st == 200 and is_ok(r5), "HTTP %s" % st)
ok("S6b 回执带 notified 条数", int((r5 or {}).get("notified") or 0) >= 1,
   "notified=%s" % (r5 or {}).get("notified"))
c = sqlite3.connect("file:%s?mode=ro" % SANDBOX_DB, uri=True)
c.row_factory = sqlite3.Row
msgs = [dict(r) for r in c.execute(
    "SELECT id,title,recipients,dup_count,event_key FROM message_center "
    "WHERE event_key LIKE 'forecast_extra_alloc|%' ORDER BY id").fetchall()]
c.close()
ok("S6c 通知已落库且 event_key 形如 forecast_extra_alloc|18|<商品>",
   len(msgs) >= 1 and all(m["event_key"].split("|")[1] == str(PID_PERIOD) for m in msgs),
   str([(m["recipients"], m["event_key"]) for m in msgs]))
ok("S6d 收件人是 employee_id（6/4/7），不是 0",
   all(int(m["recipients"] or 0) > 0 for m in msgs), str([m["recipients"] for m in msgs]))

print()
print("=" * 80)
print("STEP 7  旁证：avg-target 接口可达（需求 2/3 的数据源，小程序侧将消费）")
print("=" * 80)
st, av = call("GET", "/api/product-targets/avg-target?period_id=%d" % PID_PERIOD)
# 🔴 实测：`avg-target` 的 items 在**顶层**（不像 `/extra-alloc` 有个 `data` 包裹）
# —— 探针断言别再套 `.get("data")`，否则恒判 False（自己骗自己）。
av_items = (av or {}).get("items") or {}
av_one = av_items.get(str(P["id"])) or {}
ok("S7a GET /avg-target 可达且含该商品", st == 200 and bool(av_one),
   "HTTP %s items_keys=%s" % (st, list(av_items.keys())[:5]))
ok("S7b 均单目标按**填报单位**给值（需求 2 直接取 per_unit[填报单位]）",
   isinstance(av_one.get("per_unit"), dict) and UNIT in av_one["per_unit"],
   "per_unit=%s" % av_one.get("per_unit"))
ok("S7c 逐人差额齐备（需求 4 的数据源）：每人都有 reported_box / gap_box",
   bool(av_one.get("operators")) and all("gap_box" in o for o in (av_one.get("operators") or [])),
   str([(o.get("employee_name"), o.get("reported_box"), o.get("gap_box"))
        for o in (av_one.get("operators") or [])]))

print()
print("=" * 80)
nP = len([x for x in RES if x[0]])
print("v279 E2E 汇总：通过 %d / 失败 %d" % (nP, len(RES) - nP))
for x in RES:
    if not x[0]:
        print("   FAILED:", x[1], x[2])
print("=" * 80)
sys.exit(0 if nP == len(RES) else 1)
