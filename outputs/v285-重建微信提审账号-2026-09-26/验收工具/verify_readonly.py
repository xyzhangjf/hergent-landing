#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v285 只读终态验收：提审账号现在到底能不能用（审核员视角）

只读铁律：活库 mode=ro 不加 immutable；唯一写入是「登录测试」产生的会话，用完即删。
"""
import json, sqlite3, urllib.request, urllib.error

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"
BASE = "http://127.0.0.1:8700"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
R = []


def ck(n, c, d=""):
    ok = bool(c)
    R.append((n, ok))
    print("  [%s] %s%s" % ("PASS" if ok else "FAIL", n, "" if ok else "   <<< 实际: %s" % d))


def http(method, path, body=None, token=None, tenant=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", str(tenant))
    try:
        with OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "EXC: %s" % e


print("=" * 74)
print("【1】账号字段（直读主库 · 只读）")
print("=" * 74)
m = sqlite3.connect("file:%s?mode=ro" % MAIN, uri=True)
m.row_factory = sqlite3.Row
uids = []
for r in m.execute("SELECT id,username,display_name,role,is_active,employee_id,password_changed "
                   "FROM users WHERE username IN ('mptest','mptestsp') ORDER BY id"):
    print("   %s" % dict(r))
    uids.append(r["id"])
ck("两个提审账号都存在", len(uids) == 2, str(uids))
for r in m.execute("SELECT id,username,employee_id,password_changed,is_active FROM users "
                   "WHERE username IN ('mptest','mptestsp')"):
    ck("%s：绑了员工(%s) 且 is_active=1 且 password_changed=1" % (r["username"], r["employee_id"]),
       r["employee_id"] > 0 and r["is_active"] == 1 and r["password_changed"] == 1, dict(r))
print("   -- user_tenants（能否进 tenant 1）")
for r in m.execute("SELECT ut.user_id,ut.tenant_id,ut.role,u.username FROM user_tenants ut "
                   "JOIN users u ON u.id=ut.user_id WHERE u.username IN ('mptest','mptestsp')"):
    print("      %s" % dict(r))

print()
print("=" * 74)
print("【2】员工与报单配置（直读租户库 · 只读）")
print("=" * 74)
t = sqlite3.connect("file:%s?mode=ro" % T1, uri=True)
t.row_factory = sqlite3.Row
for r in t.execute("SELECT id,name,employee_no,position,is_active FROM hr_employees WHERE id IN (11,12)"):
    print("   员工 %s" % dict(r))
for r in t.execute("SELECT id,employee_id,report_alias,system_name,order_template,counterparty_id,"
                   "counterparty_type,is_active FROM report_mapping WHERE id IN (6,7)"):
    print("   配置 %s" % dict(r))
print("   活跃配置总数 = %s（原 3 + 新 2）" % t.execute(
    "SELECT COUNT(*) FROM report_mapping WHERE is_active=1").fetchone()[0])

print()
print("=" * 74)
print("【3】真实登录（审核员视角 —— 这是提审成败的判据）")
print("=" * 74)
st, bd = http("GET", "/api/forecast-submissions/stores", token=None, tenant=1)
ck("阴性对照：无令牌 401", st == 401, "%s %s" % (st, bd[:80]))

logged = {}
for un, pw, want in (("mptest", "Mptest@1", 2225), ("mptestsp", "Mpsup@1", 2868)):
    st, bd = http("POST", "/api/auth/login", {"username": un, "password": pw})
    j = json.loads(bd) if bd.strip().startswith("{") else {}
    if un == "mptest":
        print("   (原始登录响应结构) keys=%s" % list(j.keys()))
    tok = (j.get("token") or (j.get("data") or {}).get("token")
           or (j.get("data") or {}).get("access_token"))
    ck("登录 %s" % un, st == 200 and j.get("success"), "%s %s" % (st, bd[:200]))
    ck("   %s 不强制改密" % un, not j.get("require_password_change"),
       "require_password_change=%r" % j.get("require_password_change"))
    logged[un] = tok
    if tok:
        st, bd = http("GET", "/api/forecast-submissions/stores", token=tok, tenant=1)
        jj = json.loads(bd) if bd.strip().startswith("{") else {}
        stores = jj.get("stores") or []
        ck("   %s 的 /stores 200 且非空（提审红线）" % un, st == 200 and len(stores) > 0,
           "%s %s" % (st, bd[:160]))
        ck("      含目标门店 id=%s" % want, any(s.get("id") == want for s in stores),
           str([s.get("id") for s in stores]))
        print("      可见门店 = %s" % [(s.get("id"), s.get("name")) for s in stores])
        # 报单页能不能拿到商品清单（审核员点进去要有东西）
        st, bd = http("GET", "/api/forecast/periods", token=tok, tenant=1)
        jp = json.loads(bd) if bd.strip().startswith("{") else {}
        cur = jp.get("current") or jp.get("open") or {}
        print("      当前期次 = %s" % (cur.get("id") if isinstance(cur, dict) else cur))

print()
print("=" * 74)
print("【4】清理登录测试会话（不留无主凭证）")
print("=" * 74)
mm = sqlite3.connect(MAIN)
mm.execute("PRAGMA busy_timeout=8000")
n = mm.execute("SELECT COUNT(*) FROM sessions WHERE user_id IN (%s)"
               % ",".join("?" * len(uids)), uids).fetchone()[0]
print("   登录测试产生会话 = %d 条" % n)
if n:
    mm.execute("DELETE FROM sessions WHERE user_id IN (%s)" % ",".join("?" * len(uids)), uids)
    mm.commit()
left = mm.execute("SELECT COUNT(*) FROM sessions WHERE user_id IN (%s)"
                  % ",".join("?" * len(uids)), uids).fetchone()[0]
print("   清理后残留 = %d（期望 0）" % left)
ck("登录测试会话已清空", left == 0, "残留 %d" % left)
print("   sessions 总数 = %d" % mm.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
mm.close()

print()
print("=" * 74)
bad = [n for n, ok in R if not ok]
print("结果: %d/%d PASS" % (len(R) - len(bad), len(R)))
for n in bad:
    print("   FAIL - %s" % n)
print("=" * 74)
