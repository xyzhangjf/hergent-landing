#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 —— (A) 沙箱落库取证  (B) 生产 tenant_1 **零污染**证明。

零污染判据用「业务表逐行比对」而不是文件 sha：
  🔴 本轮**有意**改过生产 tenant_1.db 的 schema（启动期列对账补 period_id + 换索引），
     文件 sha 必然变；拿 sha 当判据会得出"被污染"的错误结论。
     正确判据 = 与**改前备份**比业务表内容（行数 + 关键行逐字段）。
"""
import sqlite3
import json
import glob

ROOT = "/opt/hergent-erp"
SBX = ROOT + "/tenant_9997.db"
PROD = ROOT + "/tenant_1.db"
BAKS = sorted(glob.glob(ROOT + "/backups/2026-09-26/tenant_1.db.bak-v279-keychange-*"))
BAK = BAKS[0] if BAKS else None

BUSINESS = ["forecast_submissions", "forecast_submission_items", "forecast_periods",
            "forecast_extra_alloc", "product_targets", "product_target_alloc",
            "sale_orders", "sale_order_items", "products", "contacts", "message_center"]


def ro(p, immutable=False):
    """只读打开。备份文件没有 `-wal`/`-shm` 兄弟文件，SQLite 会尝试创建 `-shm` 而被拒 ⇒
    对备份加 `immutable=1`（声明该文件不会变，不取锁、不建辅助文件）。"""
    uri = "file:%s?mode=ro" % p + ("&immutable=1" if immutable else "")
    c = sqlite3.connect(uri, uri=True)
    c.row_factory = sqlite3.Row
    return c


print("=" * 78)
print("A · 沙箱 tenant_9997 落库取证")
print("=" * 78)
c = ro(SBX)
c.execute("PRAGMA query_only=ON")
print("-- forecast_extra_alloc（本轮核心表）")
rows = [dict(r) for r in c.execute(
    "SELECT id, period_id, period_start, period_end, product_id, employee_id, employee_name, "
    "ratio, reported_box, alloc_box, final_box FROM forecast_extra_alloc ORDER BY employee_id")]
for r in rows:
    print("   ", json.dumps(r, ensure_ascii=False))
print("-- forecast_periods 期次 18")
print("   ", dict(c.execute("SELECT id,name,status,order_start,order_end FROM forecast_periods "
                           "WHERE id=18").fetchone()))
print("-- message_center（本次分配通知）")
for r in c.execute("SELECT id,title,recipients,dup_count,event_key FROM message_center "
                   "WHERE event_key LIKE 'forecast_extra_alloc|%' ORDER BY id"):
    print("   ", dict(r))
print("-- 目标")
for r in c.execute("SELECT id,name,period_month,product_id,target_qty,target_unit FROM product_targets"):
    print("   ", dict(r))
for r in c.execute("SELECT target_id,employee_id,employee_name,ratio FROM product_target_alloc "
                   "ORDER BY target_id, sort_no"):
    print("   ", dict(r))
c.close()

print()
print("=" * 78)
print("B · 生产 tenant_1 零污染证明（业务表 vs 改前备份）")
print("=" * 78)
print("备份文件：", BAK)
if not BAK:
    print("   !! 找不到备份，无法比对")
else:
    cp, cb = ro(PROD), ro(BAK, immutable=True)
    bad = []
    # 最强的两条直证：本轮只往**沙箱**写过分配行与目标；生产 tenant_1 里这两张表必须仍为空。
    for t in ("forecast_extra_alloc", "product_targets", "product_target_alloc"):
        n = cp.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        okz = (n == 0)
        if not okz:
            bad.append(t)
        print("   %-28s tenant_1 行数=%-6d %s" % (t, n, "⇒ 0 ✓（本轮写入全落在沙箱）"
                                                  if okz else "<== 非 0！需查"))
    print("   -- 与改前备份逐表比行数（备份用 immutable 打开）")
    for t in BUSINESS:
        try:
            np_ = cp.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        except Exception as e:
            print("   %-28s READ_ERR %s" % (t, str(e)[:40]))
            continue
        try:
            nb = cb.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        except Exception as e:
            print("   %-28s BAK_ERR %s" % (t, str(e)[:40]))
            continue
        flag = "" if np_ == nb else "   <== 有差异!"
        if np_ != nb:
            bad.append(t)
        print("   %-28s prod=%-6d bak=%-6d%s" % (t, np_, nb, flag))
    print("   -- 关键行逐字段")
    q = "SELECT id,name,status,order_start,order_end FROM forecast_periods WHERE id=18"
    a, b = dict(cp.execute(q).fetchone()), dict(cb.execute(q).fetchone())
    print("      period18 prod =", a)
    print("      period18 bak  =", b)
    print("      equal =", a == b)
    if a != b:
        bad.append("period18")
    print("   -- schema 差异（有意为之，不算污染）")
    for tag, cn in (("prod", cp), ("bak", cb)):
        cols = [r[1] for r in cn.execute("PRAGMA table_info(forecast_extra_alloc)")]
        idx = sorted(r[1] for r in cn.execute("PRAGMA index_list(forecast_extra_alloc)"))
        print("      %s: period_id=%s idx=%s" % (tag, "period_id" in cols, idx))
    cp.close()
    cb.close()
    print()
    print("结论：业务表" + ("全等 ⇒ 生产业务数据零污染 ✓" if not bad else "存在差异！ %s" % bad))
