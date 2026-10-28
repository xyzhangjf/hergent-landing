#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v714 C 组：真实 HTTP 接口（生产）。

核心判据（改前实测：`?month=2026-10`、`?month=2026-06`、不带 month **三次同一组数**）：
  - 三个不同月份必须返回**三个不同**的销售/净利
  - 2026-10 的销售必须是 0（该月 signed 单为 0，改前显示全期 878 万）
  - GL 有凭证的月份标 `basis=accrual`；无凭证的月份标 `basis=cash` + `source=fallback_business_docs`
  - 不带 month 的返回与改前基线逐分一致（仪表盘 KPI 非回归）

用法：python3 probe_v714_http.py
"""
import json
import sqlite3
import sys
import urllib.request

BASE = "http://127.0.0.1:8700"
PROD = "/opt/hergent-erp"
BASE_ALL_NET = 7891969.115999988
BASE_ALL_SALES = 8786105.849999988

R = []


def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)


def near(a, b, tol=0.005):
    return abs(float(a) - float(b)) < tol


def token():
    """优先读 /tmp/v714_token（探针插的临时登录态），否则回落到 sessions 表。"""
    import os
    p = "/tmp/v714_token"
    if os.path.exists(p):
        v = open(p).read().strip()
        if v:
            return v
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    t = con.execute("SELECT token FROM sessions ORDER BY created_at DESC LIMIT 1").fetchone()
    con.close()
    return t[0] if t else None


def get(path):
    req = urllib.request.Request(BASE + path, headers={
        "Cookie": "erp_token=%s; hergent_auth=1" % TOK, "X-Tenant-Id": "1"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.loads(r.read().decode())
            return d.get("data") if isinstance(d.get("data"), dict) else d
    except Exception as e:
        return {"ERR": str(e)[:150]}


TOK = token()
if not TOK:
    print("🔴 拿不到 session token")
    sys.exit(2)

# ---------- 1. GL 有凭证的月份 ----------
a6 = get("/api/reports/pnl?month=2026-06")
ok("C1 2026-06 basis=accrual（GL 分支终于走得到）",
   a6.get("basis") == "accrual", str(a6.get("basis")))
ok("C2 2026-06 收入 = 98325", near(a6.get("revenue", -1), 98325), "实际 %s" % a6.get("revenue"))
ok("C3 2026-06 净利 = 98325", near(a6.get("net_profit", -1), 98325), "实际 %s" % a6.get("net_profit"))
ok("C4 2026-06 带 has_data=True", a6.get("has_data") is True, str(a6.get("has_data")))

# ---------- 2. GL 无凭证的月份 ⇒ 现金制按月 ----------
a10 = get("/api/reports/pnl?month=2026-10")
ok("C5 2026-10 basis=cash（不再冒充当月）", a10.get("basis") == "cash", str(a10.get("basis")))
ok("C6 2026-10 source=fallback_business_docs",
   a10.get("source") == "fallback_business_docs", str(a10.get("source")))
ok("C7 2026-10 销售 = 0（该月无签收单；改前显示 878 万）",
   near(a10.get("sales", -1), 0), "实际 %s" % a10.get("sales"))
ok("C8 2026-10 带 month 与 note 字段",
   a10.get("month") == "2026-10" and bool(a10.get("note")), str(a10.get("note"))[:40])
a1 = get("/api/reports/pnl?month=2026-01")
ok("C9 2026-01 销售 = 739061.01", near(a1.get("sales", -1), 739061.01), "实际 %s" % a1.get("sales"))
a7 = get("/api/reports/pnl?month=2026-07")
ok("C10 2026-07 销售 = 1115360.04", near(a7.get("sales", -1), 1115360.04), "实际 %s" % a7.get("sales"))

# ---------- 3. 反向对照：同口径（都是 cash 回落）的三个月必须给出三个不同的数
# 🔴 第一版把 accrual 的 `revenue` 和 cash 的 `sales` 混在一起比 —— GL 结构里
# 根本没有 `sales` 字段，取到 None，等于在比"有值 vs 没值"。判据必须同口径。
vals = [a1.get("sales"), a7.get("sales"), a10.get("sales")]
distinct = len({round(float(v or 0), 2) for v in vals})
ok("C11 三个月（同口径）销售互不相同（改前三次同一组数 878 万）",
   distinct == 3, str(vals))
ok("C12 且没有一个是全期累计 878 万（改前全是）",
   all(not near(float(v or 0), BASE_ALL_SALES) for v in vals), str(vals))

# ---------- 4. 非回归：不带 month ----------
aall = get("/api/reports/pnl")
ok("C13 不带 month 净利与基线逐分一致", near(aall.get("net_profit", 0), BASE_ALL_NET),
   "改后 %.2f vs 基线 %.2f" % (aall.get("net_profit", 0), BASE_ALL_NET))
ok("C14 不带 month 销售与基线逐分一致", near(aall.get("sales", 0), BASE_ALL_SALES),
   "改后 %.2f vs 基线 %.2f" % (aall.get("sales", 0), BASE_ALL_SALES))
ok("C15 不带 month 不带 basis 字段（老结构未被污染）", "basis" not in aall, str(list(aall.keys()))[:80])

# ---------- 5. 资产负债表未受影响 ----------
bs = get("/api/reports/balance-sheet")
ok("C16 资产负债表资产仍 2258504.26",
   near((bs.get("assets") or {}).get("total", 0), 2258504.26),
   "实际 %s" % (bs.get("assets") or {}).get("total"))
ok("C17 资产负债表仍 balanced=True", bs.get("balanced") is True, str(bs.get("balanced")))

bad = sum(1 for x, _, _ in R if not x)
print("RESULT %d/%d" % (len(R) - bad, len(R)))
sys.exit(1 if bad else 0)
