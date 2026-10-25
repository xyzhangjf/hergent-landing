#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 HTTP 探针（只读 + 一次可回滚的写）。跑在服务器上，直接打 127.0.0.1:8700。

覆盖：
  1. refs?kind=users 是否下发 department_id（部门带出的**唯一**数据源）
  2. refs?kind=departments 是否可用
  3. 销售订单列表 / 销售退货列表是否下发 handler_name
  4. GET /api/users 是否带 department_id
  5. PUT /api/users/{uid}/department 能否真正落库（**改完立刻改回**，用测试账号）
  6. 模块门禁：/api/users/{uid}/department 不能是 403 MODULE_NOT_CONFIGURED

🔴 纪律：探针只在**只读**接口 + 一个可回滚的写接口上跑；结束后删除自建 session，
   并自证 sessions 行数回到跑之前的数。
"""
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8700"
DB = "/opt/hergent-erp/erp.db"
UID_TEST = 999903          # 「微信审核-销售」—— 测试账号，不是老板账号
TENANT = "1"

ok_n = 0
bad_n = 0


def ok(cond, label, extra=""):
    global ok_n, bad_n
    if cond:
        ok_n += 1
        print(f"  ✅ {label}")
    else:
        bad_n += 1
        print(f"  ❌ {label}  {extra}")


def make_session():
    token = "v686probe-" + secrets.token_hex(12)
    """🔴 时间列必须是**本地时间字符串**，不能是 unix 时间戳 ——
    `core._lookup_user_by_token` 用 `datetime(s.expires_at) > datetime('now','localtime')`
    比较，塞进去一个整数会让 `datetime()` 返回 NULL ⇒ 比较恒不成立 ⇒ 探针自己 401，
    看起来像"auth 坏了"（实测踩过一次）。"""
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 3600))
    c = sqlite3.connect(DB)
    c.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at, ip_address, user_agent_hash, last_activity)"
        " VALUES (?,?,?,?,?,?,?)",
        (token, 2, now, exp, "127.0.0.1", "", now))
    c.commit()
    c.close()
    return token


def drop_session(token):
    c = sqlite3.connect(DB)
    c.execute("DELETE FROM sessions WHERE token=?", (token,))
    c.commit()
    c.close()


def call(path, method="GET", body=None, token="", csrf=""):
    url = BASE + path
    data = None
    headers = {
        "Cookie": f"erp_token={token}; hergent_auth=1; csrf_token={csrf}",
        "X-Tenant-Id": TENANT,
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw[:1] in "[{" else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def main():
    c0 = sqlite3.connect(DB)
    n_before = c0.execute("SELECT count(*) FROM sessions").fetchone()[0]
    # 顺手记下测试账号的部门原值，结束时必须还原
    try:
        dept_before = c0.execute(
            "SELECT department_id FROM users WHERE id=?", (UID_TEST,)).fetchone()[0]
    except Exception:
        dept_before = None
    c0.close()

    token = make_session()
    csrf = secrets.token_hex(8)
    try:
        print("\n1) 基础资料 refs")
        st, d = call("/api/psi/refs?kind=users,departments", token=token, csrf=csrf)
        ok(st == 200, f"GET /api/psi/refs 200（实际 {st}）", str(d)[:200])
        users = (d or {}).get("users") if isinstance(d, dict) else None
        depts = (d or {}).get("departments") if isinstance(d, dict) else None
        ok(isinstance(users, list) and len(users) > 0, f"refs.users 非空（{len(users or [])} 个）")
        ok(isinstance(users, list) and "department_id" in (users[0] if users else {}),
           "refs.users 每项含 department_id（部门带出的唯一数据源）",
           str((users or [])[:1])[:200])
        ok(isinstance(depts, list) and len(depts) > 0, f"refs.departments 非空（{len(depts or [])} 个）")

        print("\n2) 销售订单列表 handler_name")
        st, d = call("/api/psi/sale-orders?limit=3", token=token, csrf=csrf)
        rows = None
        if isinstance(d, dict):
            for k in ("rows", "orders", "data", "list"):
                if isinstance(d.get(k), list):
                    rows = d[k]
                    break
        elif isinstance(d, list):
            rows = d
        ok(st == 200, f"GET /api/psi/sale-orders 200（实际 {st}）", str(d)[:160])
        ok(rows is not None, "列表返回可解析的行数组", type(d).__name__)
        if rows:
            ok("handler_name" in rows[0], "每行含 handler_name 键（业务员列取它，不是 id）",
               str(rows[0])[:200])

        print("\n3) 销售退货列表 handler_name")
        st, d = call("/api/psi/sale-return-orders?limit=3", token=token, csrf=csrf)
        ok(st == 200, f"GET /api/psi/sale-return-orders 200（实际 {st}）", str(d)[:160])
        rrows = (d or {}).get("rows") if isinstance(d, dict) else None
        ok(isinstance(rrows, list), "退货列表返回 rows")
        if rrows:
            ok("handler_name" in rrows[0], "退货行含 handler_name")

        print("\n4) 账号列表 department_id")
        st, d = call("/api/users", token=token, csrf=csrf)
        ok(st == 200, f"GET /api/users 200（实际 {st}）", str(d)[:160])
        ulist = d if isinstance(d, list) else (d or {}).get("data") if isinstance(d, dict) else None
        ok(isinstance(ulist, list) and len(ulist) > 0, f"账号列表非空（{len(ulist or [])}）")
        if ulist:
            ok("department_id" in ulist[0], "账号项含 department_id", str(ulist[0])[:200])

        print("\n5) 部门字典")
        st, d = call("/api/departments", token=token, csrf=csrf)
        ok(st == 200, f"GET /api/departments 200（实际 {st}）", str(d)[:160])
        ok(isinstance(d, list) and len(d) >= 1, f"部门非空（{len(d) if isinstance(d, list) else '?'}）")

        print(f"\n6) PUT /api/users/{UID_TEST}/department（写 → 读回 → 还原）")
        target = 2
        st, d = call(f"/api/users/{UID_TEST}/department", method="PUT",
                     body={"department_id": target}, token=token, csrf=csrf)
        forbidden = isinstance(d, dict) and str(d.get("detail") or d.get("error") or "").find("MODULE") >= 0
        ok(st == 200, f"PUT 返回 200（实际 {st}）", str(d)[:200])
        ok(not forbidden, "不是 MODULE_NOT_CONFIGURED（前缀已在 _PATH_MODULE_MAP 里）", str(d)[:200])
        cc = sqlite3.connect(DB)
        got = cc.execute("SELECT department_id FROM users WHERE id=?", (UID_TEST,)).fetchone()
        cc.close()
        ok(got and int(got[0] or 0) == target, f"库里真的写进去了（读回 {got[0] if got else 'None'}）")
        # 非法部门必须被拦（不是静默接受）
        st2, d2 = call(f"/api/users/{UID_TEST}/department", method="PUT",
                       body={"department_id": 999999}, token=token, csrf=csrf)
        ok(st2 == 400, f"不存在的部门被拦（实际 {st2}，期望 400）", str(d2)[:160])
        # 还原
        restore = int(dept_before or 0)
        st3, _ = call(f"/api/users/{UID_TEST}/department", method="PUT",
                      body={"department_id": restore}, token=token, csrf=csrf)
        cc = sqlite3.connect(DB)
        got2 = cc.execute("SELECT department_id FROM users WHERE id=?", (UID_TEST,)).fetchone()
        cc.close()
        ok(int(got2[0] or 0) == restore, f"已还原为原值 {restore}（当前 {got2[0]}）")
    finally:
        drop_session(token)
        c1 = sqlite3.connect(DB)
        n_after = c1.execute("SELECT count(*) FROM sessions").fetchone()[0]
        left = c1.execute("SELECT count(*) FROM sessions WHERE token LIKE 'v686probe-%'").fetchone()[0]
        c1.close()
        print(f"\n清理：sessions {n_before} → {n_after}，探针残留 {left}")
        ok(n_after == n_before and left == 0, "探针 session 已清理干净")

    print(f"\n结果：{ok_n} 通过 / {bad_n} 失败")
    return 1 if bad_n else 0


if __name__ == "__main__":
    sys.exit(main())
