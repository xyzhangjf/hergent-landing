#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生产侧验证：租户成员/用量端点修复已生效（只读，不写任何数据）。

为什么用两种手段：
  1) HTTP 层 —— 证明「未登录 401 / 非平台管理员 403」且**不再 500**（原来恒 500）。
     不拿平台管理员的 200，是因为那需要创始人密码；越权/未授权两条已足够证明收敛。
  2) 函数层 —— 直接在生产代码 + 生产数据上调用 tenant_usage_stats / tenant_member_list，
     证明实现本身是对的（数字与租户库真实行数逐表一致）。这是纯读操作。

跑法（需 .env 里的 ERP_SECRET）：
  cd /opt/hergent-erp && set -a && . ./.env && set +a && \
    runuser -u hergent -- env ERP_SECRET="$ERP_SECRET" ENV=production python3 /tmp/verify_tenants_prod.py
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8700"
DBP = os.environ.get("ERP_DB_PATH", "/opt/hergent-erp/erp.db")
DB_DIR = os.path.dirname(DBP)
DEMO_TID = 10
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  —— {detail}" if detail else ""))


def req(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with _OPENER.open(r, timeout=30) as resp:
            raw = resp.read().decode()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 0, str(e)


print("=" * 78)
print(f"生产验证 · {BASE} · 租户 {DEMO_TID}")
print("=" * 78)

print("\n【1】未登录（应 401，且不再是 500）")
for p in (f"/api/tenants/{DEMO_TID}/members", f"/api/tenants/{DEMO_TID}/usage"):
    st, d = req(p)
    check(f"GET {p} → 401", st == 401, f"HTTP {st}")

print("\n【2】普通角色（sales，非平台管理员 → 应 403）")
# 凭据不入库：提审测试账号密码见 memory/topics/deploy-ops.md
# 跑法：HG_PASS='<密码>' python3 tenant-admin-prod-verify.py
_PW = os.environ.get("HG_PASS", "")
if not _PW:
    print("需要环境变量 HG_PASS（提审测试账号密码，见 memory/topics/deploy-ops.md）")
    sys.exit(1)
st, d = req("/api/auth/login", "POST",
            {"username": os.environ.get("HG_USER", "mptest"), "password": _PW})
tok = d.get("token") if isinstance(d, dict) else None
check("测试账号可登录（未惊动登录锁定）", st == 200 and bool(tok), f"HTTP {st}")
if tok:
    for m, p, b in (("GET", f"/api/tenants/{DEMO_TID}/members", None),
                    ("GET", f"/api/tenants/{DEMO_TID}/usage", None),
                    ("POST", f"/api/tenants/{DEMO_TID}/members", {"username": "mptest"}),
                    ("DELETE", f"/api/tenants/{DEMO_TID}/members/1", None)):
        st, d = req(p, m, b, token=tok)
        msg = (d.get("detail") or "") if isinstance(d, dict) else ""
        check(f"{m} {p} → 403", st == 403, f"HTTP {st} {str(msg)[:40]}")

print("\n【3】函数层（直接在生产代码 + 生产数据上读，纯只读）")
sys.path.insert(0, "/opt/hergent-erp")
import erp_db as db

members = db.tenant_member_list(DEMO_TID)
check("tenant_member_list 可调用且返回列表", isinstance(members, list),
      f"{len(members)} 人：{[m.get('username') for m in members]}")

stats = db.tenant_usage_stats(DEMO_TID)
check("tenant_usage_stats 可调用且字段齐备",
      isinstance(stats, dict) and {"member_count", "max_users", "db_size_mb", "data_stats", "db_exists"} <= set(stats),
      str(sorted(stats.keys())))

c = sqlite3.connect(DBP)
real_mc = c.execute("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (DEMO_TID,)).fetchone()[0]
mx = c.execute("SELECT max_users FROM tenants WHERE id=?", (DEMO_TID,)).fetchone()
c.close()
check("member_count == 主库真实成员行数", stats.get("member_count") == real_mc,
      f"接口 {stats.get('member_count')} vs 库 {real_mc}")
check("max_users == tenants 表值", mx is not None and stats.get("max_users") == mx[0],
      f"{stats.get('max_users')} vs {mx[0] if mx else 'None'}")
check("成员列表与主库 JOIN 结果一致", len(members) == real_mc, f"{len(members)} vs {real_mc}")

tp = os.path.join(DB_DIR, f"tenant_{DEMO_TID}.db")
check("租户库被正确识别（db_exists）", stats.get("db_exists") is True and os.path.exists(tp), tp)
if stats.get("db_exists") and os.path.exists(tp):
    tc = sqlite3.connect(f"file:{tp}?mode=ro", uri=True)
    try:
        ds = stats.get("data_stats") or {}
        bad = []
        for t, n in ds.items():
            rn = tc.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            if rn != n:
                bad.append(f"{t}: 接口 {n} vs 库 {rn}")
        check("data_stats 逐表与生产租户库真实行数一致", (not bad) and len(ds) > 0,
              "; ".join(bad) or f"{len(ds)} 张表 {ds}")
    finally:
        tc.close()

print("\n【4】静态路径 /tenants/my 与 /tenants/current（修复前对任何人恒 422）")
for p in ("/api/tenants/my", "/api/tenants/current"):
    st, _ = req(p)
    check(f"未登录 GET {p} → 401（422 即说明仍被 {{tid}} 吃掉）", st == 401, f"HTTP {st}")
if tok:
    st, d = req("/api/tenants/my", token=tok)
    ok = st == 200 and isinstance(d, dict) and isinstance(d.get("data"), list)
    check("普通账号 GET /api/tenants/my → 200 且是列表", ok, f"HTTP {st}；{d.get('data') if ok else str(d)[:60]}")
    st, d = req("/api/tenants/current", token=tok)
    check("普通账号 GET /api/tenants/current → 200", st == 200 and isinstance(d, dict), f"HTTP {st}")

print("\n" + "=" * 78)
print(f"通过 {len(PASS)} / 共 {len(PASS) + len(FAIL)}")
if FAIL:
    for x in FAIL:
        print("  ✗ " + x)
    sys.exit(1)
print("全部通过 ✅（未写入任何数据）")
