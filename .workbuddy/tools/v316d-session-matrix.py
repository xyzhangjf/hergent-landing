#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 会话 × 租户可见性矩阵（只读）。

对每个活跃会话，用「token 自带租户」的方式打 /api/contacts 的 total，
看它落在哪个租户。不打印 token、不打印 username。
诊断一律走 stderr；stdout 只输出挑中的那个 token。
"""
import json
import sqlite3
import ssl
import sys
import urllib.request

DB = "/opt/hergent-erp/erp.db"
CTX = ssl._create_unverified_context()
L = lambda s: sys.stderr.write(s + "\n")   # noqa: E731

conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT s.token AS t, u.role AS r, u.is_active AS act, s.expires_at AS e "
    "FROM sessions s JOIN users u ON s.user_id=u.id "
    "WHERE (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime')) "
    "ORDER BY u.role, COALESCE(s.last_activity, s.created_at) DESC").fetchall()
conn.close()

L("活跃会话数 = %d" % len(rows))
L("%-12s %-8s %-20s %-24s %s" % ("role", "tok_len", "expires", "status", "可见客户数"))
usable = []
for r in rows:
    tok = (r["t"] or "").strip()
    if not tok:
        continue
    req = urllib.request.Request(
        "https://127.0.0.1/api/contacts?type=customer&limit=1",
        headers={"Authorization": "Bearer " + tok, "Host": "hergent.cn"})
    st, tot = "-", "-"
    try:
        with urllib.request.urlopen(req, timeout=15, context=CTX) as resp:
            st = resp.status
            tot = json.loads(resp.read().decode()).get("total")
            if st == 200:
                usable.append((r["r"], tot, tok))
    except Exception as ex:
        st = str(ex)[:22]
    L("%-12s %-8d %-20s %-24s %s" % (r["r"], len(tok), r["e"], st, tot))

# 🔴 必须挑**同时满足**两个条件的角色，否则探针会跑在错误的页面上：
#    ① 角色 ∈ `pages.js::BIZ_ROLES`（admin/boss/accountant/sales/supervisor）；
#    ② 该角色在**这个租户**里有 `crm` 模块（`/archive/customers` 的 module 是 crm）。
#    实测 tenant_1 的 role_permissions：
#      boss/sales/guide 有 crm；supervisor(缺 crm)/accountant/distributor 没有。
#    ⚠️ 2026-09-30 踩过：挑了 supervisor ⇒ 页签不渲染 ⇒ 页面落到 `#/archive/brands`
#       ⇒ 探针 17/48，全是「在品牌档案页上查客户档案特征」的**假结论**。
L("")
WANT = ['sales', 'guide', 'boss', 'admin']
for w in WANT:
    for role, tot, tok in usable:
        if role == w and tot and tot > 100:
            L("=== 命中：role=%s 可见客户=%s ===" % (role, tot))
            sys.stdout.write(tok)
            sys.exit(0)
L("没有「BIZ_ROLES ∩ 有 crm 模块」且可见客户数 > 100 的会话")
sys.exit(1)
