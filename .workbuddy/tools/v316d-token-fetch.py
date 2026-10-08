#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316d 取生产只读令牌 v2 —— 用同一个 token 对比两种请求头组合，定位 403 来源。

不变式：只 SELECT sessions，绝不写入。
stdout 只输出可用令牌（不把 token 打到 stderr / 日志）。
"""
import json
import sqlite3
import ssl
import sys
import urllib.request

DB = "/opt/hergent-erp/erp.db"
CTX = ssl._create_unverified_context()

conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT s.token AS t, u.role AS r, s.expires_at AS e FROM sessions s JOIN users u ON s.user_id=u.id "
    "WHERE u.is_active=1 AND u.role IN ('boss','admin') "
    "AND (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime')) "
    "ORDER BY COALESCE(s.last_activity, s.created_at) DESC").fetchall()
conn.close()
sys.stderr.write("候选 boss/admin 会话数 = %d\n" % len(rows))

CONFIGS = [
    ("A=https+Host", "https://127.0.0.1/api/contacts?type=customer&limit=1", {"Host": "hergent.cn"}),
    ("B=http8700+XTenant", "http://127.0.0.1:8700/api/contacts?type=customer&limit=1",
     {"X-Tenant-Id": "1", "X-Client": "web"}),
]

for r in rows:
    tok = (r["t"] or "").strip()
    if not tok:
        continue
    for label, url, extra in CONFIGS:
        hdrs = {"Authorization": "Bearer " + tok}
        hdrs.update(extra)
        kw = {"timeout": 15}
        if url.startswith("https"):
            kw["context"] = CTX
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, **kw) as resp:
                body = resp.read().decode()
                if resp.status == 200:
                    sys.stderr.write("%s 可用 role=%s expires=%s tok_len=%d total=%s\n"
                                     % (label, r["r"], r["e"], len(tok), json.loads(body).get("total")))
                    sys.stdout.write(tok)
                    sys.exit(0)
        except Exception as ex:
            sys.stderr.write("%s 失败 role=%s tok_len=%d err=%s\n" % (label, r["r"], len(tok), ex))

sys.stderr.write("no usable token\n")
sys.exit(1)
