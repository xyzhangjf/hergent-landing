#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v211 沙箱验收（**先验后部署**）：用生产源码副本 + 生产库副本，跑真中间件 + 真鉴权。

覆盖三块改动：
  A) 埋点：mp_events 表下发 / ingest / stats / `/api/track` 端点
  B) RBAC 403 文案：error_code=MODULE_DENIED + 中文模块名 + 可操作指引
  C) `/summary` 名单去掉 accountant（用「沙箱内给会计加 data」做**隔离**证明）
用法：HERGENT_SRC=/tmp/v211-src python3 /tmp/v211-verify.py
"""
import os, sys, json, sqlite3, traceback

SRC = os.environ.get("HERGENT_SRC", "/tmp/v211-src")
SCRATCH = "/tmp/v211-db"
os.environ["ERP_DB_PATH"] = os.path.join(SCRATCH, "erp.db")
sys.path.insert(0, SRC)

FAIL = []
def chk(name, got, want):
    ok = (got == want)
    print("  %s %s: got=%r want=%r" % ("✅" if ok else "❌", name, got, want))
    if not ok:
        FAIL.append(name)
    return ok

def info(name, val):
    print("  · %s = %r" % (name, val))

# ---------- 0) 库副本 ----------
def copy_db(src, dst):
    s = sqlite3.connect(src); d = sqlite3.connect(dst); s.backup(d); d.close(); s.close()

print("### 0) 准备库副本（SQLite backup，别 cp —— WAL 会漏）")
for f in ("erp.db", "tenant_1.db", "tenant_10.db"):
    p = "/opt/hergent-erp/" + f
    if os.path.exists(p):
        copy_db(p, os.path.join(SCRATCH, f))
        print("  copied", f)

# ---------- 1) import 真代码 ----------
print("\n### 1) import 真代码（源码 = HERGENT_SRC）")
from db import connection
info("connection.DB_DIR", connection.DB_DIR)
if os.path.abspath(connection.DB_DIR) != SCRATCH:
    print("❌ 护栏失败：DB_DIR 不是沙箱，中止（防误写生产）")
    raise SystemExit(1)
info("import 的 server.py", sys.modules.get("server") or "pending")
import erp_db
import server as srv
info("srv.__file__", srv.__file__)
if not os.path.abspath(str(srv.__file__)).startswith(os.path.abspath(SRC)):
    print("❌ 护栏失败：server 不是从沙箱源码 import 的，中止")
    raise SystemExit(1)

# ---------- 2) 建/清理事件表 + 造测试账号 ----------
print("\n### 2) 沙箱内造测试身份（accountant 无 data / 会计+data / 主管）")
tp = os.path.join(SCRATCH, "tenant_1.db")
mp = os.path.join(SCRATCH, "erp.db")
m = sqlite3.connect(mp); m.row_factory = sqlite3.Row
t = sqlite3.connect(tp)

def mk_user(uid, un, role):
    m.execute("INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, is_active, "
              "employee_id, employee_code, password_changed) VALUES (?,?,?,?,?,1,0,'',1)",
              (uid, un, "x", un, role))
    m.execute("INSERT OR IGNORE INTO user_tenants (user_id, tenant_id, role) VALUES (?,1,'member')", (uid,))

for uid, un, role in ((9501, "v211_acct", "accountant"), (9502, "v211_sup", "supervisor"),
                      (9503, "v211_admin", "admin")):
    mk_user(uid, un, role)

TOKENS = {}
for uid, un in ((9501, "v211_acct"), (9502, "v211_sup"), (9503, "v211_admin")):
    tk = "v211tok%d" % uid
    m.execute("INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at, ip_address, "
              "user_agent_hash, last_activity) VALUES (?,?,datetime('now','localtime'),"
              "datetime('now','localtime','+1 day'),'127.0.0.1','',datetime('now','localtime'))", (tk, uid))
    TOKENS[un] = tk
m.commit()
info("tokens", {k: v[:8] + "…" for k, v in TOKENS.items()})

# 清掉沙箱库里的历史事件，保证断言从 0 开始
t.execute("DELETE FROM mp_events")
t.commit()

# ---------- 3) 表 / 索引下发 ----------
print("\n### 3) 租户库是否拿到 mp_events（证明 ddl_map + INDEX_SQLS 下发生效）")
have = t.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mp_events'").fetchone()
chk("tenant_1.mp_events 表存在", bool(have), True)
hidx = t.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_mp_events_event_time'").fetchone()
chk("tenant_1.idx_mp_events_event_time 索引存在", bool(hidx), True)

# ---------- 4) ingest / stats 直调 ----------
print("\n### 4) mp_event_ingest / mp_event_stats 直调（真函数、沙箱库）")
r = erp_db.mp_event_ingest(
    [{"event": "login_success", "props": {"role": "accountant"}, "page": "pages/login/login", "ts": 1},
     {"event": "no_permission_view", "props": {"role": "accountant"}, "page": "no-permission", "ts": 2},
     "not-a-dict",
     {"event": ""}],
    user_id=9501, username="v211_acct", role="accountant", tenant_id=1)
info("ingest 回执", r)
chk("accepted", r.get("accepted"), 2)
chk("dropped（非字典 1 + 空事件名 1）", r.get("dropped"), 2)

st = erp_db.mp_event_stats(days=7)
info("stats.total", st["total"])
ev = {e["event"]: e["n"] for e in st["by_event"]}
chk("stats.by_event 计数集", ev, {"login_success": 1, "no_permission_view": 1})
chk("stats.by_event 首项（并列时按事件名升序，保证可复现）", st["by_event"][0]["event"], "login_success")
chk("stats.by_role 首项角色", st["by_role"][0]["role"], "accountant")
chk("stats.by_user 首项 user_id", st["by_user"][0]["user_id"], 9501)

# 批量上限
big = [{"event": "bulk", "ts": 1} for _ in range(60)]
r2 = erp_db.mp_event_ingest(big, user_id=9501, role="accountant", tenant_id=1)
chk("批量上限（60 条只收 50）", r2.get("accepted"), 50)
t.execute("DELETE FROM mp_events")
t.commit()

# ---------- 5) 端点级（真中间件 + 真鉴权） ----------
print("\n### 5) 端点级：真中间件 + 真鉴权（TestClient）")
from fastapi.testclient import TestClient
cli = TestClient(srv.app)

def H(un):
    return {"Authorization": "Bearer " + TOKENS[un], "X-Tenant-Id": "1"}

# 5.1 无令牌必须 401（别把「功能正常」与「根本没人拦」搞混）
resp = cli.post("/api/track", json={"events": [{"event": "x"}]}, headers={"X-Tenant-Id": "1"})
chk("POST /api/track 无令牌 → 401", resp.status_code, 401)

# 5.2 会计（无 data）：业务端点 403 + **新文案**
resp = cli.get("/api/products", headers=H("v211_acct"))
chk("GET /api/products（会计）→ 403", resp.status_code, 403)
b = resp.json()
info("403 回执", b)
chk("error_code", b.get("error_code"), "MODULE_DENIED")
chk("module", b.get("module"), "data")
chk("module_label（中文）", b.get("module_label"), "报单数据")
chk("文案含中文角色名", "会计" in (b.get("error") or ""), True)
chk("文案含可操作指引", "角色权限" in (b.get("error") or ""), True)
chk("文案不含内部模块名原文", "'data'模块" in (b.get("error") or ""), False)

# 5.3 会计**仍能上报埋点**（这正是豁免的意义）
resp = cli.post("/api/track", headers=H("v211_acct"),
                json={"events": [{"event": "no_permission_view", "props": {"role": "accountant"}}],
                      "page": "pages/no-permission/no-permission"})
chk("POST /api/track（会计，无 data）→ 200", resp.status_code, 200)
tb = resp.json()
info("track 回执", tb)
chk("accepted", tb.get("accepted"), 1)
chk("落库事件的 page 用了整批公共字段",
    t.execute("SELECT page FROM mp_events ORDER BY id DESC LIMIT 1").fetchone()[0],
    "pages/no-permission/no-permission")

# 5.4 读端必须收窄：会计读 stats → 403；admin → 200
resp = cli.get("/api/track/stats", headers=H("v211_acct"))
chk("GET /api/track/stats（会计）→ 403", resp.status_code, 403)
resp = cli.get("/api/track/stats?days=7", headers=H("v211_admin"))
chk("GET /api/track/stats（admin）→ 200", resp.status_code, 200)
if resp.status_code == 200:
    sb = resp.json()
    info("admin 看到的 total", sb.get("total"))
    chk("admin 能看到会计刚写的事件", any(e["event"] == "no_permission_view" for e in sb.get("by_event", [])), True)

# 5.5 空事件体 / 单条形态
resp = cli.post("/api/track", headers=H("v211_acct"), json={"events": []})
chk("空 events → 200 且 accepted=0", (resp.status_code, resp.json().get("accepted")), (200, 0))
resp = cli.post("/api/track", headers=H("v211_acct"), json={"event": "single_form"})
chk("单条形态 {event:...} → 200 且 accepted=1", (resp.status_code, resp.json().get("accepted")), (200, 1))

# ---------- 6) /summary 名单（用「沙箱内给会计加 data」做隔离证明） ----------
print("\n### 6) /summary 角色名单：会计被**路由**拒（不只是被中间件拒）")
# 6.1 sales（有 data、但不在名单）→ 路由名单 403，且是新文案
m.execute("INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, is_active, "
          "employee_id, employee_code, password_changed) VALUES (9504,'v211_sales','x','v211_sales','sales',1,0,'',1)")
m.execute("INSERT OR IGNORE INTO user_tenants (user_id, tenant_id, role) VALUES (9504,1,'member')")
m.execute("INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at, ip_address, "
          "user_agent_hash, last_activity) VALUES ('v211tok9504',9504,datetime('now','localtime'),"
          "datetime('now','localtime','+1 day'),'127.0.0.1','',datetime('now','localtime'))")
m.commit()
TOKENS["v211_sales"] = "v211tok9504"
resp = cli.get("/api/forecast-submissions/summary?period_id=0", headers=H("v211_sales"))
chk("GET /summary（业务员,sales,有 data）→ 403", resp.status_code, 403)
info("路由 403 文案", (resp.json() or {}).get("detail") or (resp.json() or {}).get("error"))
chk("文案提到「主管」", "主管" in json.dumps(resp.json(), ensure_ascii=False), True)

# 6.2 沙箱内给 accountant 补 data（**仅沙箱**）⇒ 中间件放行，只剩路由名单能拦
t.execute("INSERT OR REPLACE INTO role_permissions (role_name, permissions) VALUES ('accountant', '[\"data\",\"dashboard\"]')")
t.commit()
try:
    srv.reload_perms(1)
except Exception as e:
    print("  (reload_perms 不可用，忽略:", e, ")")
try:
    from core import reload_perms as _rp
    _rp(1)
except Exception:
    pass
resp = cli.get("/api/products", headers=H("v211_acct"))
info("给会计补 data 后 /api/products 状态码", resp.status_code)
chk("会计+data 能过中间件（证明隔离成立）", resp.status_code, 200)
resp = cli.get("/api/forecast-submissions/summary?period_id=0", headers=H("v211_acct"))
chk("GET /summary（会计,**已给 data**）→ 403（名单已移除会计）", resp.status_code, 403)
info("→ 改前这里会是 200（假入口）；文案", (resp.json() or {}).get("detail") or (resp.json() or {}).get("error"))

# 6.3 主管仍可看汇总
resp = cli.get("/api/forecast-submissions/summary?period_id=0", headers=H("v211_sup"))
chk("GET /summary（主管）→ 200", resp.status_code, 200)

# ---------- 7) 收尾 ----------
print("\n### 7) 汇总")
if FAIL:
    print("❌ 失败项 %d 个：%s" % (len(FAIL), FAIL))
    sys.exit(2)
print("✅ 全部断言通过")
