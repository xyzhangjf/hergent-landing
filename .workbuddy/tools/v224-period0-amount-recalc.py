#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 期次 0 历史金额按 v223 新口径重算（用户 2026-09-21 明确授权：「测试阶段，删掉都可以」）。

背景
----
期次 0 = 2026-08-22~28 那批历史导入，611 行、库内金额合计 942,862.18。
这些 amount 是**旧公式**产物：`金额 = 数量 × 厂价`（厂价是元/箱，却乘了散数）⇒ 放大约 3.6 倍。

新口径（v223 已上线的前端口径，逐字复刻）
------------------------------------------
    perCase(spec, unit, arc)  → 每箱有几个报单单位（档案换算优先 → 规格解析回退）
    boxes   = round(qty / perCase, 3)                 # Forecast.vue::boxesOf（不取整）
    finalQty= ceil(boxes - 1e-9)                      # Forecast.vue::rowFinalQty（厂商不拆零，向上取整）
    amount  = finalQty * price                        # price = 行内单价 = 厂价(元/箱)

只改 `forecast_submission_items.amount` 一列；`quantity` / `price` 一律不动（它们是原始录入事实）。
同步重算 `forecast_submissions.total_amount`（= 该单明细金额之和），使父子自洽。

安全
----
- 默认 dry-run（零写入）。`--apply` 才写。
- `--apply` 前置：① 在线 sqlite3 `.backup` 备份到 `/opt/hergent-erp/backups/`；② 备份文件大小 > 0 且可打开。
- 写入在一个事务内；写前逐行算好、写后**逐行回读断言**（新值 == 预算值）。
- 打印回滚语句。
"""
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time

APPLY = "--apply" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
TDB = args[0] if args else "/opt/hergent-erp/tenant_1.db"

DB = sqlite3.connect(TDB)
DB.row_factory = sqlite3.Row


# ---------- 逐字复刻 Forecast.vue::perCase（档案优先 → 规格回退） ----------
def per_case(spec, unit, arc):
    lr = float((arc["large_ratio"] if arc else 0) or 0)
    if lr > 0:
        u0 = str(unit if unit is not None else "").strip()
        lu = str((arc["large_unit"] if arc else "") or "").strip()
        mu = str((arc["medium_unit"] if arc else "") or "").strip()
        mr = float((arc["medium_ratio"] if arc else 0) or 0)
        if u0 and lu and u0 == lu:
            return 1.0
        if u0 and mu and u0 == mu and mr > 0:
            return lr / mr
        return lr
    s = str(spec if spec is not None else "")
    segs = []
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)", s):
        n = float(m.group(1))
        if n > 0:
            segs.append((n, str(m.group(2) or "").strip()))
    if not segs:
        return 0.0
    last_n, last_u = segs[-1]
    if not last_u:
        return last_n
    u0 = str(unit if unit is not None else "").strip()
    if not u0 or u0 == last_u:
        return last_n
    for i, (n, u) in enumerate(segs):
        if u == u0 and i < len(segs) - 1:
            p = 1.0
            for n2, _ in segs[i:]:
                p *= n2
            return p
    return last_n


def boxes_of(total, pc):
    t = float(total or 0)
    if not (pc > 0) or not t:
        return 0.0
    return round(t / pc * 1000) / 1000


def new_amount(qty, pc, price):
    import math
    b = boxes_of(qty, pc)
    final = math.ceil(b - 1e-9)
    return round(final * float(price), 2)


import math  # noqa: E402

# ---------- 载入商品档案 ----------
prods = {}
for r in DB.execute(
        "SELECT id, name, spec, unit, large_unit, medium_unit, large_ratio, medium_ratio, "
        "       factory_price, purchase_price FROM products"):
    prods[r["id"]] = dict(r)
print("商品档案载入 = %d 条" % len(prods))

# ---------- 取期次 0 明细 ----------
rows = DB.execute(
    "SELECT i.id, i.submission_id, i.product_id, i.product_name, i.spec, i.unit, "
    "       i.quantity, i.price, i.amount "
    "FROM forecast_submission_items i JOIN forecast_submissions s ON s.id = i.submission_id "
    "WHERE s.period_id = 0 ORDER BY i.id").fetchall()
print("期次 0 明细行 =", len(rows))

plan = []          # (item_id, old, new, pc, qty, price, name)
skipped = []
for r in rows:
    p = prods.get(r["product_id"])
    pc = per_case(p["spec"] if p else r["spec"], r["unit"], p)
    qty = float(r["quantity"] or 0)
    price = float(r["price"] or 0)
    if not (pc > 0):
        skipped.append(("缺每箱数(换算不出来)", r["id"], r["product_name"], r["spec"],
                        r["unit"], qty, price, float(r["amount"] or 0)))
        continue
    if not (price > 0):
        skipped.append(("行内单价<=0", r["id"], r["product_name"], r["spec"],
                        r["unit"], qty, price, float(r["amount"] or 0)))
        continue
    na = new_amount(qty, pc, price)
    plan.append((r["id"], float(r["amount"] or 0), na, pc, qty, price, r["product_name"]))

old_sum = sum(x[1] for x in plan)
new_sum = sum(x[2] for x in plan)
skip_sum = sum(x[7] for x in skipped)

print("\n" + "=" * 96)
print("可重算 = %d 行   跳过 = %d 行" % (len(plan), len(skipped)))
print("  可重算部分：旧合计 %14.2f  →  新合计 %14.2f   （旧/新 = %.3f）"
      % (old_sum, new_sum, (old_sum / new_sum) if new_sum else 0))
if skipped:
    print("  跳过部分（金额 %0.2f，原样保留）：" % skip_sum)
    for s in skipped[:20]:
        print("     %-22s item=%-6s %-28s spec=%-10r unit=%-4s qty=%-8.2f price=%.2f amount=%.2f"
              % (s[0], s[1], str(s[2])[:28], s[3], s[4], s[5], s[6], s[7]))

print("\n--- 对照样本（前 18 行）---")
print("%-7s %-28s %-6s %-6s %-9s %-9s %-13s %-13s" %
      ("item", "product", "pc", "qty", "price", "箱数", "旧金额", "新金额"))
for x in plan[:18]:
    b = boxes_of(x[4], x[3])
    print("%-7s %-28s %-6.0f %-6.0f %-9.2f %-9.3f %-13.2f %-13.2f"
          % (x[0], str(x[6])[:28], x[3], x[4], x[5], b, x[1], x[2]))

print("\n--- 金额变化最大的 10 行 ---")
for x in sorted(plan, key=lambda y: -(y[1] - y[2]))[:10]:
    print("   item=%-6s %-28s pc=%-5.0f qty=%-7.0f %10.2f → %10.2f  (×%.0f)"
          % (x[0], str(x[6])[:28], x[3], x[4], x[1], x[2], (x[1] / x[2]) if x[2] else 0))

# ---------- 父表 ----------
subs = DB.execute("SELECT id, period_id, total_amount, total_qty FROM forecast_submissions "
                  "WHERE period_id=0 ORDER BY id").fetchall()
bymap = {}
for x in plan:
    pass
sub_old = {}
for r in DB.execute(
        "SELECT s.id AS sid, SUM(i.amount) AS amt, SUM(i.quantity) AS qty "
        "FROM forecast_submissions s JOIN forecast_submission_items i ON i.submission_id = s.id "
        "WHERE s.period_id=0 GROUP BY s.id"):
    sub_old[r["sid"]] = (r["amt"] or 0, r["qty"] or 0)
# 🔴 父表新值必须由 plan 算出 —— 不能从库里 SUM（那是**旧**值 ⇒ 会写成「新旧相同」的假绿）
sub_new = {sid: (0.0, 0.0) for sid in sub_old}
sub_of = {r["id"]: r["submission_id"] for r in rows}
for x in plan:
    sid = sub_of[x[0]]
    a, q = sub_new.get(sid, (0.0, 0.0))
    sub_new[sid] = (a + x[2], q + x[4])
print("\n--- 单头 total_amount（%d 张单）---" % len(subs))
tot_old = sum(float(r["total_amount"] or 0) for r in subs)
tot_new = sum(float(sub_new.get(r["id"], (0, 0))[0]) for r in subs)
for r in subs[:10]:
    print("   sub=%-5s 旧 total_amount=%-13.2f 新=%13.2f"
          % (r["id"], float(r["total_amount"] or 0), float(sub_new.get(r["id"], (0, 0))[0])))
print("   单头合计: %.2f → %.2f" % (tot_old, tot_new))

if not APPLY:
    print("\n[DRY-RUN] 未写入任何数据。加 --apply 才落盘。")
    sys.exit(0)

# ================= APPLY =================
print("\n" + "#" * 96)
print("# APPLY 模式 —— 先在线备份")
bkdir = "/opt/hergent-erp/backups"
os.makedirs(bkdir, exist_ok=True)
stamp = time.strftime("%Y%m%d-%H%M%S")
bk = os.path.join(bkdir, "tenant_1.prep224-%s.db" % stamp)
src = sqlite3.connect("file:" + TDB + "?mode=ro", uri=True)
dst = sqlite3.connect(bk)
with dst:
    src.backup(dst)
dst.close()
src.close()
if not (os.path.exists(bk) and os.path.getsize(bk) > 0):
    print("!! 备份失败，中止")
    sys.exit(1)
chk = sqlite3.connect("file:" + bk + "?mode=ro", uri=True)
n_chk = chk.execute("SELECT COUNT(*) FROM forecast_submission_items").fetchone()[0]
chk.close()
print("  备份 → %s （%d 字节，回读 items 行数=%d）" % (bk, os.path.getsize(bk), n_chk))
if n_chk != DB.execute("SELECT COUNT(*) FROM forecast_submission_items").fetchone()[0]:
    print("!! 备份行数与源不一致，中止")
    sys.exit(1)

print("# 事务内写入 + 逐行回读断言")
DB.execute("BEGIN IMMEDIATE")
try:
    for x in plan:
        DB.execute("UPDATE forecast_submission_items SET amount=? WHERE id=?", (x[2], x[0]))
    for sid, (amt, _q) in sub_new.items():
        DB.execute("UPDATE forecast_submissions SET total_amount=? WHERE id=?", (round(amt, 2), sid))
    DB.commit()
except Exception as e:
    DB.rollback()
    print("!! 写入异常已回滚:", e)
    sys.exit(1)

bad = 0
for x in plan:
    got = DB.execute("SELECT amount FROM forecast_submission_items WHERE id=?", (x[0],)).fetchone()[0]
    if abs(float(got) - x[2]) > 0.005:
        bad += 1
        if bad <= 5:
            print("   ✗ item=%s 期望 %.2f 实得 %.2f" % (x[0], x[2], float(got)))
print("  逐行回读断言：%d 行通过 / %d 行不符" % (len(plan) - bad, bad))

chk2 = DB.execute(
    "SELECT COUNT(*) c, SUM(amount) s FROM forecast_submission_items i "
    "JOIN forecast_submissions s2 ON s2.id=i.submission_id WHERE s2.period_id=0").fetchone()
print("  写后期次0：行数=%d 金额合计=%.2f" % (chk2["c"], chk2["s"] or 0))
chk3 = DB.execute("SELECT SUM(total_amount) s FROM forecast_submissions WHERE period_id=0").fetchone()
print("  写后单头合计 = %.2f" % (chk3["s"] or 0))
print("\n回滚方式（如需）：cp %s %s && systemctl restart hergent-erp" % (bk, TDB))
DB.close()
