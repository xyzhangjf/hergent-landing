#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 真机「业务员 → 自动带出部门」e2e 的**准备/还原**脚本（跑在服务器上）。

为什么需要它：演示租户 0 人配部门、0 个部门 ⇒ 浏览器探针只能验「没配部门」的提示分支，
「带出部门」那条在演示租户**测不到**（SKIP 不是通过）。而带出是老板要的主行为。

做法（只动一个 INTEGER 配置列 + 一条临时 session，全部可回滚）：
  prepare  : 给 uid 999903（测试账号「微信审核-销售」，不是老板）设 department_id=2（销售部）
             + 插一条 1 小时有效的 session，把 token 打到 stdout 给浏览器探针用
  teardown : department_id 还原 0 + 删 session + 自证残留为 0

🔴 时间列必须是**本地时间字符串**，不能是 unix 整数（`_lookup_user_by_token` 用
   `datetime(expires_at) > datetime('now','localtime')` 比较，整数会让 datetime() 返回 NULL
   ⇒ 恒不成立 ⇒ 探针自己 401，看起来像 auth 坏了）。
"""
import os
import secrets
import sqlite3
import sys
import time

DB = "/opt/hergent-erp/erp.db"
UID = 999903
DEPT = 2
TENANT_ID = 1


def conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def prepare():
    c = conn()
    row = c.execute("SELECT id, display_name AS name, department_id FROM users WHERE id=?", (UID,)).fetchone()
    if not row:
        print(f"FATAL 主库没有 uid={UID} 这个账号")
        return 1
    prev = int(row["department_id"] or 0)
    # 部门必须真的存在于该租户，否则带出来的是「部门被删」分支
    tdb = f"/opt/hergent-erp/tenant_{TENANT_ID}.db"
    td = sqlite3.connect(tdb, timeout=10)
    td.row_factory = sqlite3.Row
    dep = td.execute("SELECT id, name FROM departments WHERE id=?", (DEPT,)).fetchone()
    td.close()
    if not dep:
        print(f"FATAL tenant_{TENANT_ID}.db 里没有 departments.id={DEPT}")
        return 1

    token = "v686dept-" + secrets.token_hex(12)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 3600))
    c.execute("UPDATE users SET department_id=? WHERE id=?", (DEPT, UID))
    c.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at, ip_address, user_agent_hash, last_activity)"
        " VALUES (?,?,?,?,?,?,?)",
        (token, 2, now, exp, "127.0.0.1", "", now))
    c.commit()
    c.close()
    with open("/tmp/v686_dept_prev.txt", "w") as f:
        f.write(str(prev))
    print(f"PREV={prev}")
    print(f"USER={row['name']}")
    print(f"DEPT_NAME={dep['name']}")
    print(f"TOKEN={token}")
    return 0


def teardown():
    prev = 0
    if os.path.exists("/tmp/v686_dept_prev.txt"):
        prev = int(open("/tmp/v686_dept_prev.txt").read().strip() or 0)
    c = conn()
    c.execute("UPDATE users SET department_id=? WHERE id=?", (prev, UID))
    n_sess = c.execute("DELETE FROM sessions WHERE token LIKE 'v686dept-%'").rowcount
    c.commit()
    left = c.execute("SELECT department_id FROM users WHERE id=?", (UID,)).fetchone()[0]
    sess_left = c.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE 'v686dept-%'").fetchone()[0]
    total_sess = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    c.close()
    if os.path.exists("/tmp/v686_dept_prev.txt"):
        os.remove("/tmp/v686_dept_prev.txt")
    print(f"还原 department_id={left}（应为 {prev}）")
    print(f"删除 session {n_sess} 条；残留 {sess_left} 条；sessions 总数 {total_sess}")
    return 0 if (left == prev and sess_left == 0) else 1


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "prepare":
        sys.exit(prepare())
    elif cmd == "teardown":
        sys.exit(teardown())
    print("usage: dept_e2e.py prepare|teardown")
    sys.exit(2)
