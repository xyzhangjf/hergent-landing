#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v244 报单保存门禁 · 四阶段验证（技能 §8「先验后部署」：真 Request + 真鉴权 + 真实端点函数）。

阶段（顺序执行，后一阶段会改副本库的期次状态）：
  A 有 open 期次      → 放行（不误伤），且归属到该期次
  B 期次全 closed     → 拒绝（事故场景）
  C 走既定流程        → 新建期次 → 门开 → 保存成功且归属新期次
  D 零期次            → 拒绝（400）

所有写操作只落在 /tmp/v244-sim 的副本库；生产一个字节都不动。
被拦阶段额外做「库快照前后一字不差」取证。
"""
import os, sys, json, asyncio, sqlite3, hashlib

SCRATCH = "/tmp/v244-sim"
SRV = os.environ.get("HERGENT_SRC", "/tmp/v244-src")
os.environ["ERP_DB_PATH"] = os.path.join(SCRATCH, "erp.db")
os.environ.setdefault("ERP_SECRET", "v244-local-verify-only")
sys.path.insert(0, SRV)

import erp_db                                  # noqa: E402
from db import connection                      # noqa: E402
from core import _auth                         # noqa: E402,F401

assert os.path.abspath(connection.DB_DIR) == SCRATCH, "护栏失败: %s" % connection.DB_DIR
TID = 998
connection.set_tenant_context(TID)
assert connection._tenant_db.get() == os.path.join(SCRATCH, "tenant_998.db"), connection._tenant_db.get()
print("护栏通过  DB_DIR=%s  租户库=%s" % (connection.DB_DIR, os.path.basename(connection._tenant_db.get())))
print("代码来源  SRV=%s" % SRV)
print()

import routers.forecast_submissions as F     # noqa: E402
from starlette.requests import Request        # noqa: E402
from fastapi import HTTPException             # noqa: E402

print("端点函数模块 =", F.__file__)
print()

MAIN = os.path.join(SCRATCH, "erp.db")
TDB = os.path.join(SCRATCH, "tenant_998.db")
TOK = "v244-verify-token-fixed"
UID = 1

# ---------- 注入令牌（副本主库；绑真实租户 1 的 admin） ----------
m = sqlite3.connect(MAIN)
m.execute("DELETE FROM sessions WHERE token=?", (TOK,))
m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
          "VALUES(?,?,datetime('now','localtime'),datetime('now','localtime','+2 hours'),'127.0.0.1','',datetime('now','localtime'))",
          (TOK, UID))
try:
    m.execute("INSERT OR IGNORE INTO user_tenants(user_id,tenant_id) VALUES(?,?)", (UID, TID))
except Exception as e:
    print("user_tenants 注入:", e)
m.commit()
m.close()
print("已注入令牌（副本内）user_id=%d tenant=%d" % (UID, TID))
print()


def request_with(payload):
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "POST", "scheme": "http",
             "path": "/api/forecast-submissions/save-matrix",
             "raw_path": b"/api/forecast-submissions/save-matrix", "query_string": b"", "root_path": "",
             "headers": [(b"authorization", ("Bearer " + TOK).encode()),
                         (b"x-tenant-id", str(TID).encode()),
                         (b"content-type", b"application/json")],
             "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8700), "state": {}}

    async def _recv():
        return {"type": "http.request", "body": json.dumps(payload).encode(), "more_body": False}

    return Request(scope, _recv)


def call_save(payload):
    """直连端点函数（不经任何前端）→ (status, detail_or_body)"""
    try:
        r = asyncio.run(F.save_matrix(request_with(payload)))
        return 200, r
    except HTTPException as e:
        return e.status_code, e.detail
    except Exception as e:
        return 500, "%s: %s" % (type(e).__name__, e)


def q(sql, args=()):
    c = sqlite3.connect("file:%s?mode=ro" % TDB, uri=True)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, args)]
    finally:
        c.close()


def snapshot():
    c = sqlite3.connect("file:%s?mode=ro" % TDB, uri=True)
    try:
        return {
            "subs": c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0],
            "items": c.execute("SELECT COUNT(*) FROM forecast_submission_items").fetchone()[0],
            "import_subs": c.execute("SELECT COUNT(*) FROM forecast_submissions WHERE role='导入'").fetchone()[0],
            "periods": c.execute("SELECT COUNT(*) FROM forecast_periods").fetchone()[0],
        }
    finally:
        c.close()


def exec_sql(sql, args=()):
    c = sqlite3.connect(TDB)
    c.execute("PRAGMA busy_timeout=8000")
    c.execute(sql, args)
    c.commit()
    c.close()


# 取一个真实在售商品 + 客户名，保证载荷能过数量判据与商品过滤
prod = q("SELECT id, name FROM products WHERE is_active=1 ORDER BY id LIMIT 1")
assert prod, "副本里没有在售商品"
PID_GOOD = prod[0]["id"]
PNAME = prod[0]["name"]
CUST = "唐成"
print("载荷基准: product_id=%s name=%s 客户=%s" % (PID_GOOD, PNAME[:16], CUST))
print()

results = []


def ok(name, passed, detail=""):
    results.append((name, bool(passed), str(detail)))
    print("  %s %s   %s" % ("✅" if passed else "❌", name, detail))


def payload_for(start, end, period_id=None):
    p = {"start": start, "end": end, "customers": [CUST],
         "rows": [{"product_id": PID_GOOD, "product_name": PNAME, "spec": "", "unit": "件",
                   "price": 1, "qty_by_unit": {CUST: 3}}]}
    if period_id is not None:
        p["period_id"] = period_id
    return p


PERIODS = q("SELECT id,name,order_start,order_end,status FROM forecast_periods ORDER BY id")
print("副本初始期次:", PERIODS)
print()

# ==================== 阶段 A：有 open 期次 ====================
print("=" * 70)
print("阶段 A：有进行中期次 → 必须放行（不误伤）")
print("=" * 70)
opens = [p for p in PERIODS if p["status"] == "open"]
if not opens:
    new_id = erp_db.forecast_period_create("v244-A-open", "2026-09-22", "2026-09-23", "2026-09-27")
    opens = q("SELECT id,name,order_start,order_end,status FROM forecast_periods WHERE id=?", (new_id,))
    print("  副本无 open 期次，已新建:", opens)
P = opens[0]
print("  使用期次 #%s %s(%s~%s)" % (P["id"], P["name"], P["order_start"], P["order_end"]))

before = snapshot()
st, body = call_save(payload_for(P["order_start"], P["order_end"], P["id"]))
after = snapshot()
print("  A1 传 period_id → HTTP %s  %s" % (st, str(body)[:120]))
ok("A1 显式传 period_id 保存成功", st == 200 and isinstance(body, dict) and body.get("success") is True,
   "status=%s" % st)
rows = q("SELECT DISTINCT period_id FROM forecast_submissions WHERE role='导入'")
ok("A1 落库归属 = 该期次", any(r["period_id"] == P["id"] for r in rows), "实际=%s" % [r["period_id"] for r in rows])

st2, body2 = call_save(payload_for(P["order_start"], P["order_end"]))
print("  A2 不传 period_id（走窗口解析）→ HTTP %s  %s" % (st2, str(body2)[:120]))
ok("A2 不传 period_id 也放行（窗口可解析到 open 期次）", st2 == 200, "status=%s" % st2)

st3, body3 = call_save(payload_for("2026-09-22", "2026-09-22"))
print("  A3 窗口=(今天,今天)（= 前端「今日报单」形态）→ HTTP %s  %s" % (st3, str(body3)[:130]))
print("     注：此刻库里有 open 期次 #%s，故该形态由 v244 闸决定是否放行" % P["id"])

# ==================== 阶段 B：期次全 closed（事故场景） ====================
print()
print("=" * 70)
print("阶段 B：★事故场景 —— 期次全 closed → 必须拒（且一个字节都不写）")
print("=" * 70)
exec_sql("UPDATE forecast_periods SET status='closed'")
print("  已将全部期次置 closed")
b_before = snapshot()
stB, bodyB = call_save(payload_for(P["order_start"], P["order_end"], P["id"]))
b_after = snapshot()
print("  B1 传 period_id 保存 → HTTP %s  %s" % (stB, str(bodyB)[:130]))
ok("B1 被拒", stB in (400, 409), "status=%s" % stB)
ok("B1 库快照前后一字不差", b_before == b_after, "%s -> %s" % (b_before, b_after))

stB2, bodyB2 = call_save(payload_for("2026-09-22", "2026-09-22"))
b2_after = snapshot()
print("  B2 今日报单窗口保存 → HTTP %s  %s" % (stB2, str(bodyB2)[:130]))
ok("B2 被拒", stB2 in (400, 409), "status=%s" % stB2)
ok("B2 库快照前后一字不差", b_after == b2_after, "%s -> %s" % (b_after, b2_after))

# ==================== 阶段 C：走既定流程（新建期次 → 门开） ====================
print()
print("=" * 70)
print("阶段 C：走既定流程（新建期次 → 门开 → 保存且归属正确）")
print("=" * 70)
NEW = erp_db.forecast_period_create("v244-C-新期次", "2026-09-22", "2026-09-25", "2026-09-29")
print("  已新建期次 #%s" % NEW)
c_before = snapshot()
stC, bodyC = call_save(payload_for("2026-09-22", "2026-09-25", NEW))
c_after = snapshot()
print("  C1 保存 → HTTP %s  %s" % (stC, str(bodyC)[:120]))
ok("C1 门开后可保存", stC == 200 and isinstance(bodyC, dict) and bodyC.get("success") is True, "status=%s" % stC)
rowsC = q("SELECT DISTINCT period_id FROM forecast_submissions WHERE role='导入'")
ok("C1 归属 = 新期次 #%s" % NEW, any(r["period_id"] == NEW for r in rowsC),
   "实际=%s" % [r["period_id"] for r in rowsC])
ok("C1 无 period_id=0 的孤儿行", not any((r["period_id"] or 0) == 0 for r in rowsC),
   "实际=%s" % [r["period_id"] for r in rowsC])

# ==================== 阶段 D：零期次 ====================
print()
print("=" * 70)
print("阶段 D：零期次 → 必须拒（400）")
print("=" * 70)
exec_sql("DELETE FROM forecast_periods")
print("  已清空全部期次，剩余 %s 条" % q("SELECT COUNT(*) n FROM forecast_periods")[0]["n"])
d_before = snapshot()
stD, bodyD = call_save(payload_for("2026-09-22", "2026-09-22"))
d_after = snapshot()
print("  D1 今日报单窗口保存 → HTTP %s  %s" % (stD, str(bodyD)[:140]))
ok("D1 被拒且是 400（v244 新闸）", stD == 400, "status=%s" % stD)
ok("D1 文案含「新建期次」指路", "新建期次" in str(bodyD), "detail=%s" % str(bodyD)[:90])
ok("D1 库快照前后一字不差", d_before == d_after, "%s -> %s" % (d_before, d_after))

stD2, bodyD2 = call_save(payload_for("2026-09-22", "2026-09-22"))
d2_after = snapshot()
print("  D2 ★连调两次 → HTTP %s（不因重试而漏）" % stD2)
ok("D2 连调两次仍 400", stD2 == 400, "status=%s" % stD2)
ok("D2 库快照仍一字不差", d_after == d2_after, "%s -> %s" % (d_after, d2_after))

# ==================== 汇总 ====================
print()
print("=" * 70)
npass = sum(1 for _, p, _ in results if p)
print("结果：%d/%d 通过" % (npass, len(results)))
for n, p, d in results:
    if not p:
        print("  ❌ %s  %s" % (n, d))
print("=" * 70)
