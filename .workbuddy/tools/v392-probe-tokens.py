#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v392 双角色令牌供给器（**只读，零写入**，跑在生产服务器上）。

用法：python3 v392-probe-tokens.py <role>[,<role>...]
输出：每行 `role<TAB>token`，仅取「真调一次只读接口返回 200」的活跃会话。
"""
import json
import sqlite3
import sys
import urllib.error
import urllib.request

DB = "/opt/hergent-erp/erp.db"
BASE = "http://127.0.0.1:8700"
ALIVE = "/api/auth/permissions"   # 任何登录用户都能调 ⇒ 用它判「令牌有效」
TARGET = "/api/psi/meta"          # 本轮靶接口：boss 应 200、其他角色应 403


def hit(path, tok, tenant="1"):
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": "Bearer " + tok,
                 "X-Tenant-Id": tenant, "X-Client": "web"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)


def main():
    roles = (sys.argv[1] if len(sys.argv) > 1 else "boss").split(",")
    conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        for role in roles:
            rows = conn.execute(
                "SELECT s.token AS token, u.username AS uname FROM sessions s "
                "JOIN users u ON s.user_id = u.id "
                "WHERE u.is_active = 1 AND u.role = ? "
                "  AND (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime')) "
                "ORDER BY COALESCE(s.last_activity, s.created_at) DESC LIMIT 8",
                (role,)).fetchall()
            for r in rows:
                tok = (r["token"] or "").strip()
                if not tok:
                    continue
                st, _ = hit(ALIVE, tok)
                if st != 200:
                    continue
                tst, tbody = hit(TARGET, tok)
                sys.stdout.write("%s\t%s\t%s\t%s\t%s\n"
                                 % (role, r["uname"], tok, tst,
                                    tbody[:200].replace("\n", " ")))
                break
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
