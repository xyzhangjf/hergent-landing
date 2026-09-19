#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读审计（第三版）：用户说他「只删了『永诺旗舰店』那一列」就失败了。

这会挑战上一版结论（"只有删光所有客户列才会失败"）。要回答两个问题：
  Q1 哪个租户的客户名册里含「永诺旗舰店」？它有几个客户列？
  Q2 那个租户的每个期次里，客户列实际有几个（all_units 是租户级，但期次内可能更少）？

判据：若用户租户的客户名册**只有 1 个**（永诺旗舰店），则"删最后一列" == "删光"，
上一版结论方向正确但**严重低估了触发概率**（不是连点 21 次，是 1 次）。
"""
import glob
import os
import sqlite3

BASE = "/opt/hergent-erp"
KEYS = ("永诺",)

print("=" * 110)
print("Q1 各租户客户名册 —— 找含『永诺』的租户 + 名册规模")
print("=" * 110)
hits = []
for path in sorted(glob.glob(os.path.join(BASE, "tenant_*.db"))):
    tid = os.path.basename(path)[len("tenant_"):-len(".db")]
    try:
        c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        c.row_factory = sqlite3.Row
        names = [r[0] for r in c.execute(
            "SELECT DISTINCT store_name FROM forecast_submissions "
            "WHERE status!='rejected' AND store_name IS NOT NULL AND store_name!='' "
            "ORDER BY store_name").fetchall()]
        n_sub = c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
        if n_sub:
            mark = ""
            for k in KEYS:
                if any(k in (n or "") for n in names):
                    mark = "  <<<< 命中『%s』" % k
                    hits.append(tid)
                    break
            print("tenant_%-5s all_units=%-4d submissions=%-6d %s%s"
                  % (tid, len(names), n_sub, names[:12], mark))
        c.close()
    except Exception as e:
        print("tenant_%-5s [skip] %s" % (tid, e))

print()
print("=" * 110)
print("Q2 命中租户：每个期次内的客户列数（all_units 会打底，但期次内可能有区别）")
print("=" * 110)
for tid in hits:
    path = os.path.join(BASE, "tenant_%s.db" % tid)
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    c.row_factory = sqlite3.Row
    print("\n--- tenant_%s ---" % tid)
    rows = c.execute(
        "SELECT period_id, COUNT(DISTINCT store_name) u, COUNT(*) n "
        "FROM forecast_submissions WHERE status!='rejected' AND store_name IS NOT NULL AND store_name!='' "
        "GROUP BY period_id ORDER BY period_id").fetchall()
    for r in rows:
        print("  period_id=%-4s 期次内客户列=%-4d 报单行数=%-6d" % (r["period_id"], r["u"], r["n"]))
    # 该租户各客户的报单量（找"永诺旗舰店"是不是唯一/最后）
    print("  各客户名+报单行数：")
    for r in c.execute(
            "SELECT store_name, COUNT(*) n FROM forecast_submissions "
            "WHERE status!='rejected' AND store_name IS NOT NULL AND store_name!='' "
            "GROUP BY store_name ORDER BY store_name").fetchall():
        print("     %-24s %d" % (r["store_name"], r["n"]))
    c.close()

print()
print("=" * 110)
print("Q3 主库租户表：租户 id ↔ 名称（确认用户是哪个租户）")
print("=" * 110)
try:
    c = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, "erp.db"), uri=True)
    c.row_factory = sqlite3.Row
    cols = [r[1] for r in c.execute("PRAGMA table_info(tenants)").fetchall()]
    print("tenants 列：", cols)
    for r in c.execute("SELECT * FROM tenants").fetchall():
        d = dict(r)
        print("  ", {k: d[k] for k in d if k in ("id", "name", "code", "status", "created_at")})
    c.close()
except Exception as e:
    print("[erp.db skip]", e)
