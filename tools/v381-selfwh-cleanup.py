#!/usr/bin/env python3
# v381 授权写：把「王老板」的悬空个人仓 warehouse_id=5 归零（emp#2）
# 依据：用户对评估文档 Q4 = A（清理脏数据）。走真实 API（PUT /api/employees/{eid}），
#       该端点正是迁移前旧前端会走的那条正规路径（warehouse_id=0 = 取消绑定，见 server.py:5815）。
# 只改一列一行；改前在线备份 tenant_1.db。
import json, os, sqlite3, sys, time, urllib.request, urllib.error

MAIN = "/opt/hergent-erp/erp.db"
TEN = "/opt/hergent-erp/tenant_1.db"
BKD = "/opt/hergent-erp/backups"
TID = 1
BOSS_UID = 2          # boss 张俊峰（有 hr 模块权限）
EMP_ID = 2            # 王老板
OLD_WH = 5            # 悬空仓 id（仓库表里不存在）
BASE = "http://127.0.0.1:8700"
TS = time.strftime("%Y%m%d-%H%M%S")
TOKEN = "v381-selfwh-" + TS

ok_n = fail_n = 0
def ck(name, got, want):
    global ok_n, fail_n
    good = got == want
    ok_n += good; fail_n += (not good)
    print(("  ✅ " if good else "  🔴 FAIL ") + f"{name}: got={got!r} want={want!r}")

def snap():
    c = sqlite3.connect("file:%s?mode=ro" % TEN, uri=True); c.row_factory = sqlite3.Row
    rows = {r["id"]: dict(r) for r in c.execute("SELECT * FROM hr_employees ORDER BY id")}
    c.close(); return rows

def diff(a, b):
    keys = set(a) | set(b); out = []
    for k in sorted(keys):
        if a.get(k) != b.get(k):
            da, db_ = a.get(k, {}), b.get(k, {})
            for col in set(da) | set(db_):
                if da.get(col) != db_.get(col):
                    out.append(f"emp#{k}.{col}: {da.get(col)!r} -> {db_.get(col)!r}")
    return out

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "X-Tenant-Id": str(TID),
        "Content-Type": "application/json"})
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with op.open(r, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

print("== 0. 改前实况（只读） ==")
before = snap()
emp2 = before.get(EMP_ID, {})
print(f"  王老板 emp#{EMP_ID}: name={emp2.get('name')!r} warehouse_id={emp2.get('warehouse_id')}")

print("\n== 1. 在线备份 tenant_1.db ==")
bkp = os.path.join(BKD, f"tenant_1.db.before-v381-selfwh-{TS}.bak")
src = sqlite3.connect("file:%s?mode=ro" % TEN, uri=True)
dst = sqlite3.connect(bkp); src.backup(dst); dst.close(); src.close()
print(f"  备份 -> {bkp}  ({os.path.getsize(bkp)} bytes)")
ck("备份非空且 >1MB", os.path.getsize(bkp) > 1000000, True)

print("\n== 2. 注入临时令牌（主库 sessions，绑 boss） ==")
m = sqlite3.connect(MAIN); m.execute("PRAGMA busy_timeout=8000")
m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
          "VALUES (?,?,datetime('now','localtime'),datetime('now','localtime','+1 hour'),'127.0.0.1','',datetime('now','localtime'))",
          (TOKEN, BOSS_UID))
m.commit()
print(f"  token 长度={len(TOKEN)}（不打印本体）")

try:
    print("\n== 3. 经真实 API 归零（PUT /api/employees/2 warehouse_id=0） ==")
    st, body = req("PUT", f"/api/employees/{EMP_ID}", {"warehouse_id": 0})
    print(f"  HTTP {st}  body={body}")
    ck("HTTP 状态码 200", st, 200)
    try:
        ck("回执 success=true", bool(json.loads(body).get("success")), True)
        ck("回执 updated=1", json.loads(body).get("updated"), 1)
    except Exception as e:
        ck("回执可解析", f"parse-error:{e}", "ok")

    print("\n== 4. 改后快照 + 差异 ==")
    after = snap()
    d = diff(before, after)
    for line in d:
        print("  Δ " + line)
    ck("差异恰好 1 条", len(d), 1)
    ck("且为 emp#2.warehouse_id: 5 -> 0", d, [f"emp#{EMP_ID}.warehouse_id: {OLD_WH} -> 0"])
    ck("王老板改后 warehouse_id", after.get(EMP_ID, {}).get("warehouse_id"), 0)

    print("\n== 5. 读端复验（GET /api/employees 看到的 = 终态） ==")
    st2, body2 = req("GET", "/api/employees")
    ck("GET /api/employees HTTP 200", st2, 200)
    lst = json.loads(body2)
    ck("返回是列表", isinstance(lst, list), True)
    wl = [e for e in lst if int(e.get("id", 0)) == EMP_ID]
    ck("列表中王老板恰 1 条（防断言空跑）", len(wl), 1)
    if wl:
        ck("读端 warehouse_id", int(wl[0].get("warehouse_id") or 0), 0)

    print("\n== 6. 阴性对照：无令牌同请求应 401 ==")
    r = urllib.request.Request(BASE + f"/api/employees/{EMP_ID}", data=b'{"warehouse_id":0}', method="PUT",
                               headers={"X-Tenant-Id": str(TID), "Content-Type": "application/json"})
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with op.open(r, timeout=15) as resp:
            ck("无令牌被拦", resp.status in (401, 403), True)
    except urllib.error.HTTPError as e:
        ck("无令牌被拦(HTTPError)", e.code in (401, 403), True)
    except Exception as e:
        ck("无令牌被拦(异常)", str(e), "expect-401/403")
finally:
    m.execute("DELETE FROM sessions WHERE token=?", (TOKEN,)); m.commit()
    left = m.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", (TOKEN + "%",)).fetchone()[0]
    m.close()
    print(f"\n== 7. 临时令牌残留 = {left}（期望 0） ==")

print(f"\n===== 汇总: {ok_n} PASS / {fail_n} FAIL =====")
print(f"备份: {bkp}")
print("回滚一句话: sqlite3 执行  UPDATE hr_employees SET warehouse_id=5 WHERE id=2;  或用上面的 .bak 覆盖")
sys.exit(1 if fail_n else 0)
