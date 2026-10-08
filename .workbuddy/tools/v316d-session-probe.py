#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读诊断：生产 sessions 表现状（不打印 username / token 本身）。"""
import sqlite3

DB = "/opt/hergent-erp/erp.db"
conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

print("模型时间(本机) =", conn.execute("SELECT datetime('now','localtime')").fetchone()[0])
print("")

cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
print("sessions 列 =", cols)
print("")

n = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
print("sessions 总行数 =", n)

rows = conn.execute(
    "SELECT u.role AS role, u.is_active AS act, s.expires_at AS exp, s.last_activity AS la, "
    "s.created_at AS ca, length(s.token) AS tl FROM sessions s JOIN users u ON s.user_id=u.id "
    "ORDER BY COALESCE(s.last_activity, s.created_at) DESC LIMIT 12").fetchall()
for r in rows:
    print("  role=%-10s active=%s expires=%-20s last_act=%-20s created=%-20s tok_len=%s"
          % (r["role"], r["act"], r["exp"], r["la"], r["ca"], r["tl"]))

print("")
nv = conn.execute(
    "SELECT COUNT(*) FROM sessions s JOIN users u ON s.user_id=u.id "
    "WHERE u.is_active=1 AND u.role IN ('boss','admin') "
    "AND (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime'))").fetchone()[0]
print("仍然有效的 boss/admin 会话数 =", nv)

ne = conn.execute(
    "SELECT COUNT(*) FROM sessions WHERE expires_at IS NOT NULL "
    "AND expires_at <= datetime('now','localtime')").fetchone()[0]
print("已过期会话数 =", ne)
conn.close()
