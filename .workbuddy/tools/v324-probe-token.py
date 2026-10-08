#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v324 真机探针的令牌供给器（**只读**，跑在生产服务器上）。

用法：
    python3 v324-probe-token.py

行为：
  ① 以 `mode=ro` 打开主库，按「最近活动」倒序取 boss/admin 的活跃会话候选；
  ② 逐个用 `GET /api/forecast/periods` **真调一次**验证可用（200 且能解析）；
  ③ **只**把第一个可用的令牌单独打印一行到 stdout，不带任何其它输出（便于 `$( )` 捕获）。

🔴 绝不写入：本脚本只 SELECT，绝不 INSERT/DELETE sessions ——
   与 `probe_token.py` 的「插临时令牌」路线不同，本脚本**复用现有会话**，零残留。
🔴 令牌只用于本地探针进程的 localStorage 注入，**不打印到任何日志**。
"""
import json
import sqlite3
import sys
import urllib.request

DB = "/opt/hergent-erp/erp.db"
BASE = "http://127.0.0.1:8700"


def main():
    conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT s.token AS token FROM sessions s JOIN users u ON s.user_id = u.id "
            "WHERE u.is_active = 1 AND u.role IN ('boss','admin') "
            "  AND (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime')) "
            "ORDER BY COALESCE(s.last_activity, s.created_at) DESC LIMIT 8"
        ).fetchall()
    finally:
        conn.close()

    for r in rows:
        tok = (r["token"] or "").strip()
        if not tok:
            continue
        req = urllib.request.Request(
            BASE + "/api/forecast/periods",
            headers={"Authorization": "Bearer " + tok, "X-Tenant-Id": "1", "X-Client": "web"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200 and json.loads(resp.read().decode("utf-8") or "{}"):
                    sys.stdout.write(tok)
                    return 0
        except Exception:
            continue
    sys.stderr.write("no usable session token\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
