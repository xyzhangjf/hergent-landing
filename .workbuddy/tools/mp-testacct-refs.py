#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：两个提审账号在生产数据里的引用面（决定能否安全删旧账号）。"""
import sqlite3

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def ro(p):
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    c.row_factory = sqlite3.Row
    return c


m, t = ro(MAIN), ro(T1)

print("=== tenant_1.forecast_submissions 按 user_id 分布 ===")
for r in t.execute("SELECT user_id, role, COUNT(*) n, MIN(order_date) d0, MAX(order_date) d1 "
                   "FROM forecast_submissions GROUP BY user_id, role ORDER BY n DESC").fetchall():
    print("  user_id=%s role=%s n=%s %s~%s" % (r["user_id"], r["role"], r["n"], r["d0"], r["d1"]))

print("\n=== 两账号是否出现在 forecast_submissions（tenant_1）===")
for uid, un in ((5, "mptest"), (6, "mptestsp")):
    n = t.execute("SELECT COUNT(*) FROM forecast_submissions WHERE user_id=?", (uid,)).fetchone()[0]
    print("  uid=%s %s -> %s 单" % (uid, un, n))

print("\n=== tenant_1 里其余可能引用 user_id 的表 ===")
tabs = [r[0] for r in t.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
hit = []
for tn in tabs:
    try:
        cols = [c[1] for c in t.execute("PRAGMA table_info(%s)" % tn).fetchall()]
    except Exception:
        continue
    for col in cols:
        if col in ("user_id", "created_by", "operator_id", "owner_id"):
            try:
                n = t.execute("SELECT COUNT(*) FROM %s WHERE %s IN (5,6)" % (tn, col)).fetchone()[0]
            except Exception:
                continue
            if n:
                hit.append((tn, col, n))
print("  " + (("\n  ".join("%s.%s -> %d 行" % x for x in hit)) if hit else "(无)"))

print("\n=== 主库 erp.db 里 users 5/6 的引用 ===")
mtabs = [r[0] for r in m.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
mhit = []
for tn in mtabs:
    try:
        cols = [c[1] for c in m.execute("PRAGMA table_info(%s)" % tn).fetchall()]
    except Exception:
        continue
    for col in cols:
        if col in ("user_id", "created_by", "operator_id", "owner_id"):
            try:
                n = m.execute("SELECT COUNT(*) FROM %s WHERE %s IN (5,6)" % (tn, col)).fetchone()[0]
            except Exception:
                continue
            if n:
                mhit.append((tn, col, n))
print("  " + (("\n  ".join("%s.%s -> %d 行" % x for x in mhit)) if mhit else "(无)"))

print("\n=== sessions 引用 user 5/6 ===")
for r in m.execute("SELECT id, user_id, created_at, expires_at FROM sessions WHERE user_id IN (5,6)").fetchall():
    print("  %s" % dict(r))
print("  sessions 总行数 =", m.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])

m.close(); t.close()
print("\n[DONE]")
