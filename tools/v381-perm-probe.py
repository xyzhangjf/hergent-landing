#!/usr/bin/env python3
# v381 权限正反验证 —— 证明「迁移后会计/主管真的能用」而「迁移前他们进不去」
# 零写入：所有 POST 都发**必然被业务层拒绝的空 body**（门禁放行 → handler 返 error 200），
#         用它来证明「门禁放行了写路径」，而不会真的写任何一行。
import json, sqlite3, sys, time, urllib.request, urllib.error

MAIN = "/opt/hergent-erp/erp.db"; BASE = "http://127.0.0.1:8700"; TID = 1
USERS = {"boss": 2, "accountant": 999915, "supervisor": 999906}

ok_n = fail_n = 0
def ck(name, got, want):
    global ok_n, fail_n
    good = got == want; ok_n += good; fail_n += (not good)
    print(("  [OK]   " if good else "  [FAIL] ") + f"{name}: got={got!r} want={want!r}")

def req(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + tok, "X-Tenant-Id": str(TID), "Content-Type": "application/json"})
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with op.open(r, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def counts():
    c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
    r = (c.execute("SELECT COUNT(*) FROM report_mapping").fetchone()[0],
         c.execute("SELECT COUNT(*) FROM hr_employees").fetchone()[0])
    c.close(); return r

N_MAP0, N_EMP0 = counts()

m = sqlite3.connect(MAIN); m.execute("PRAGMA busy_timeout=8000")
TOKENS = {}
try:
    print("== 注入 3 个临时令牌（boss / accountant / supervisor） ==")
    for role, uid in USERS.items():
        t = "v381-perm-%s-%d" % (role, int(time.time()))
        m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
                  "VALUES (?,?,datetime('now','localtime'),datetime('now','localtime','+1 hour'),'127.0.0.1','',datetime('now','localtime'))",
                  (t, uid))
        TOKENS[role] = t
    m.commit()
    print("  已注入:", {k: len(v) for k, v in TOKENS.items()}, "（只打长度）")

    # --- A. 老入口（员工档案 / hr 模块）：会计/主管进不去 ---
    print("\n== A. 员工档案接口 `/api/employees`（模块 hr，迁移前的唯一入口） ==")
    for role, want in (("boss", 200), ("accountant", 403), ("supervisor", 403)):
        st, body = req("GET", "/api/employees", TOKENS[role])
        print(f"  {role:11s} GET  /api/employees -> {st}  {body[:90]}")
        ck(f"{role} GET /api/employees", st, want)
    for role, want in (("accountant", 403), ("supervisor", 403)):
        st, body = req("PUT", "/api/employees/2", TOKENS[role], {"warehouse_id": 0})
        print(f"  {role:11s} PUT  /api/employees/2 -> {st}  {body[:90]}")
        ck(f"{role} PUT /api/employees/2（老入口写）", st, want)

    # --- B. 新入口（报单配置 / data 模块）：会计/主管可用 ---
    print("\n== B. 报单配置接口 `/api/report-mappings`（模块 data，迁移后的入口） ==")
    for role in ("boss", "accountant", "supervisor"):
        st, body = req("GET", "/api/report-mappings", TOKENS[role])
        ck(f"{role} GET /api/report-mappings（读）", st, 200)
        print(f"  {role:11s} GET  -> {st}")

    # 写路径：发空 body —— 门禁若放行，handler 会返业务错误(200)；门禁若拦，返 403。
    # 断言「非 403」即证明「会计/主管能走到写路径」，且零写入（body 立即被业务层拒绝）。
    print("\n  -- 写路径门禁（空 body：放行=200业务错误 / 拦截=403） --")
    for role in ("boss", "accountant", "supervisor"):
        st, body = req("POST", "/api/report-mappings", TOKENS[role], {})
        print(f"  {role:11s} POST /api/report-mappings {{}} -> {st}  {body[:110]}")
        ck(f"{role} POST 写门禁放行(非403)", st != 403, True)
        ck(f"{role} 空 body 被业务层拒（零写入）", json.loads(body).get("error") is not None, True)

    # --- C. 负例：无令牌必须 401/403（证明门禁真在，不是没人拦） ---
    print("\n== C. 阴性对照：无令牌 ==")
    r = urllib.request.Request(BASE + "/api/report-mappings", headers={"X-Tenant-Id": str(TID)})
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with op.open(r, timeout=15) as resp:
            ck("无令牌 GET /api/report-mappings 被拦", resp.status in (401, 403), True)
    except urllib.error.HTTPError as e:
        ck("无令牌 GET /api/report-mappings 被拦", e.code in (401, 403), True)

    # --- 复核：写门禁测试确实零写入（report_mapping / hr_employees 未变） ---
    print("\n== D. 零写入核对（POST 空 body 前后行数） ==")
    n_map, n_emp = counts()
    print(f"  改前 report_mapping={N_MAP0} hr_employees={N_EMP0} → 改后 {n_map} / {n_emp}")
    ck("report_mapping 行数未变", n_map, N_MAP0)
    ck("hr_employees 行数未变", n_emp, N_EMP0)
finally:
    for t in TOKENS.values():
        m.execute("DELETE FROM sessions WHERE token=?", (t,))
    m.commit()
    left = m.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE 'v381-perm-%'").fetchone()[0]
    m.close()
    print(f"\n== 临时令牌残留 = {left}（期望 0） ==")

print(f"\n##### 权限正反: {ok_n} PASS / {fail_n} FAIL #####")
sys.exit(1 if fail_n else 0)
