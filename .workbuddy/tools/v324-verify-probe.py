# -*- coding: utf-8 -*-
"""v324 生产验收探针（**只读**）：证明「目标月 = 到货月」+「分母 = 报单窗口未关」已在生产生效。

用法（生产）：
    cd /opt/hergent-erp && ERP_SERVER_DIR=/opt/hergent-erp python3 /tmp/v324-verify-probe.py

三条纪律：
  ① 数据库一律 `mode=ro`（**不带 immutable**，因为这是活库）；
  ② 探针**先自证判别力**：同一输入把**旧写法**也算一遍，两侧必须不等（否则断言是空转）；
  ③ 只 import 已部署的模块（`routers.product_targets`），**不碰运行中的服务**。
"""
import os
import re
import sqlite3
import sys

SERVER = os.environ.get("ERP_SERVER_DIR", "/opt/hergent-erp")
sys.path.insert(0, SERVER)

DB = os.path.join(os.path.dirname(SERVER), "tenant_1.db")
if not os.path.exists(DB):
    DB = "/opt/hergent-erp/tenant_1.db"

FAILS = []
N = [0]


def check(name, cond, extra=""):
    N[0] += 1
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + extra) if extra else ""))
    if not cond:
        FAILS.append(name)


ro = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
ro.row_factory = sqlite3.Row
print("库 =", DB)
print()

# ───────────────────────── 1. 真实期次（进行中的那期） ─────────────────────────
print("=" * 78)
print("1. 生产真实期次（老板报障的那一期）")
print("=" * 78)
open_rows = [dict(r) for r in ro.execute(
    "SELECT id,name,order_start,order_end,arrival_date,status FROM forecast_periods "
    "WHERE status='open' ORDER BY id")]
for p in open_rows:
    print("   期次#%s %-14s 报单 %s~%s  到货 %s  (%s)"
          % (p["id"], p["name"], p["order_start"], p["order_end"], p["arrival_date"], p["status"]))
check("P1 存在进行中的期次", len(open_rows) >= 1, "n=%d" % len(open_rows))

import routers.product_targets as pt            # noqa: E402  已部署的代码
from domain import product_targets as algo      # noqa: E402
from domain import arrival_schedule as ar       # noqa: E402

P = open_rows[0]
_old = pt._month_of(P.get("order_start"))
_new = pt._target_month_of_period(P)
print()
print("   旧写法 `_month_of(order_start)`  → %r" % _old)
print("   新写法 `_target_month_of_period` → %r" % _new)
check("P2 新锚点 = 到货月（期次 %s 到货 %s ⇒ %s）"
      % (P["id"], P["arrival_date"], str(P["arrival_date"])[:7]),
      _new == str(P["arrival_date"])[:7], "new=%r" % _new)
check("P3 反例：旧写法给出的是**报单月**，与新值不等（证明断言有判别力）",
      _old == pt._month_of(P["order_start"]) and _old != _new,
      "old=%r new=%r" % (_old, _new))

# ───────────────────────── 2. 真实到货规则 → 日历 + 提前天数 ─────────────────────────
print()
print("=" * 78)
print("2. 真实到货规则 → 到货日历与提前天数（分母的两侧）")
print("=" * 78)
rules = [dict(r) for r in ro.execute(
    "SELECT * FROM rebate_target_rules WHERE is_active=1 AND dimension='brand'")]
print("   启用中的品牌规则 %d 条" % len(rules))

Y, M = int(_new[:4]), int(_new[5:7])
today = ar._date.today().isoformat()


class _Cur:
    def __init__(self, row):
        self._row = row

    def execute(self, sql, params=()):
        return self

    def fetchone(self):
        return self._row

    def fetchall(self):
        return [self._row] if self._row else []


class _Ctx:
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        return _Cur(self._row)

    def __exit__(self, *a):
        return False


seen = set()
for r in rules:
    br = (r.get("scope_key") or r.get("scope_name") or r.get("name") or "").strip()
    if not br or br in seen:
        continue
    seen.add(br)
    pt.get_db = (lambda row: (lambda *a, **k: _Ctx(row)))(r)
    dates, eff, reason, lead = pt._arrival_ctx(br, Y, M)
    if reason or not dates:
        print("   %-10s  %s 月：无可算日历（reason=%s）" % (br, _new, reason))
        continue
    old_rem, total = algo.remaining_periods(dates, today, 0)
    new_rem, _ = algo.remaining_periods(dates, today, lead)
    print("   %-10s  %s 月 到货日 %2d 个  lead=%d 天 | 旧分母 %d / 新分母 %d  (今天 %s)"
          % (br, _new, total, lead, old_rem, new_rem, today))
    check("P4 [%s] 日历非空且 lead 有值" % br, total > 0 and lead > 0)
    check("P5 [%s] 新分母 ≤ 旧分母（窗口判据只会**收紧**，不会放宽）" % br, new_rem <= old_rem)
    if lead > 0 and total:
        check("P6 [%s] 真实日历上两侧**不等**（说明修正确实生效，不是空转）" % br,
              old_rem != new_rem, "old=%d new=%d" % (old_rem, new_rem)
              if old_rem != new_rem else "⚠️ 恰好相等：今天没有处在窗口边界的期次")

# ───────────────────────── 3. 目标表：报单页现在会读到哪几条 ─────────────────────────
print()
print("=" * 78)
print("3. 目标表现状 —— 修好之后报单页读的是哪个月")
print("=" * 78)
for m in (str(P["order_start"])[:7], _new):
    rows = [dict(r) for r in ro.execute(
        "SELECT id,period_month,product_name,target_qty,target_unit,status "
        "FROM product_targets WHERE period_month=? ORDER BY id", (m,))]
    print("   %s 桶：%d 条" % (m, len(rows)))
    for r in rows:
        print("      #%s %-30s %s %s (%s)"
              % (r["id"], r["product_name"], r["target_qty"], r["target_unit"], r["status"]))
print()
print("   ⇒ 报单页（期次#%s，到货 %s）现在读 **%s** 桶" % (P["id"], P["arrival_date"], _new))

# ───────────────────────── 4. 生效判据：沙箱挡不住「服务内取数」的坑 ###
print()
print("=" * 78)
print("4. 结论")
print("=" * 78)
if FAILS:
    print("FAILED %d / %d" % (len(FAILS), N[0]))
    for f in FAILS:
        print("   - " + f)
    sys.exit(1)
print("ALL PASS  %d / %d" % (N[0], N[0]))
