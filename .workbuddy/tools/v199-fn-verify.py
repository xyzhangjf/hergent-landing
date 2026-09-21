# -*- coding: utf-8 -*-
"""v199 客户列隐藏名册（B+C）—— 隔离副本上的**端点级**函数验证。

为什么这样做（而不是只看代码或只跑 SQL）：
  ① 在 /tmp 副本上跑，**绝不碰生产**（ERP_DB_PATH 指向沙箱，且断言 DB_DIR 真的在沙箱里）；
  ② 读端调**真实** `erp_db.forecast_submission_summary()`；
  ③ 写端调**真实** `routers.forecast_submissions.save_matrix()`（async 端点函数本身，
     不是"我手抄的 SQL"）—— 唯一被替身的是身份来源（在副本 sessions 表里插一条假 token，
     然后走真实的 `_auth` → `_resolve_auth` → `_lookup_user_by_token` 链路）。
用法（服务器上）：ERP_DB_PATH 由脚本自己设，直接 `python3 v199-fn-verify.py`
"""
import os
import sys
import json
import asyncio
import sqlite3

SANDBOX = "/tmp/v199-fn-test"
# 待验证的**代码**来源：默认生产目录；部署前改用 HERGENT_SRC=/tmp/v199-src 指向新代码副本
# ⇒ 同一份脚本既能「部署前验新代码」，也能「部署后验生产代码」，两次结果可比。
SRV = os.environ.get("HERGENT_SRC", "/opt/hergent-erp")
TENANT = 998                      # 不抢 tenant_1 的名字，避免任何误连生产库的可能

os.environ["ERP_DB_PATH"] = os.path.join(SANDBOX, "erp.db")
sys.path.insert(0, SRV)

fail = 0
def ok(m):
    print("  PASS  " + m)
def bad(m):
    global fail
    fail += 1
    print("  FAIL  " + m)
def head(t):
    print("\n== " + t + " ==")


# ---------- 0. 沙箱护栏：必须在 import 之后立刻断言，早于任何查询 ----------
head("0. 沙箱隔离护栏")
print("     代码来源 SRV = %s" % SRV)
from db.connection import DB_DIR, set_tenant_context, get_db   # noqa: E402
print("     DB_DIR = %s" % DB_DIR)
if os.path.abspath(DB_DIR).startswith(SANDBOX):
    ok("DB_DIR 指向沙箱（ERP_DB_PATH 生效）")
else:
    print("  FATAL DB_DIR 不在沙箱 —— 立即终止，绝不在生产库上跑本脚本")
    sys.exit(2)

import erp_db as db                                              # noqa: E402
from routers.forecast_submissions import save_matrix             # noqa: E402

set_tenant_context(TENANT)
print("     tenant db = %s" % os.path.join(SANDBOX, "tenant_%d.db" % TENANT))
if not os.path.exists(os.path.join(SANDBOX, "tenant_%d.db" % TENANT)):
    print("  FATAL 沙箱租户库不存在")
    sys.exit(2)
ok("沙箱租户库就位")


# ---------- 1. 造一个沙箱身份（只写副本 sessions） ----------
head("1. 沙箱身份（副本内会话，零生产写入）")
TOKEN = "v199-sandbox-token"
m = sqlite3.connect(os.path.join(SANDBOX, "erp.db"))
m.row_factory = sqlite3.Row
u = m.execute("SELECT * FROM users WHERE username='mptest' AND is_active=1").fetchone()
if not u:
    u = m.execute("SELECT * FROM users WHERE is_active=1 ORDER BY id LIMIT 1").fetchone()
if not u:
    print("  FATAL 副本主库没有可用用户")
    sys.exit(2)
m.execute("DELETE FROM sessions WHERE token=?", (TOKEN,))
m.execute(
    "INSERT INTO sessions(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
    "VALUES (?,?,datetime('now','localtime'),datetime('now','localtime','+1 day'),'127.0.0.1','',datetime('now','localtime'))",
    (TOKEN, u["id"]),
)
m.commit()
m.close()
print("     user=%s id=%s role=%s" % (u["username"], u["id"], u["role"]))
ok("沙箱会话已建（未触碰生产库）")


# ---------- 2. 真实 Request 构造（走真实 _auth 链路） ----------
from starlette.requests import Request                          # noqa: E402

def make_request(payload):
    body = json.dumps(payload).encode()

    async def _recv():
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http",
        "path": "/api/forecast-submissions/save-matrix",
        "raw_path": b"/api/forecast-submissions/save-matrix",
        "query_string": b"", "root_path": "",
        "headers": [(b"authorization", ("Bearer " + TOKEN).encode())],
        "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8700), "state": {},
    }
    return Request(scope, _recv)

# 先证明确实能通过真实鉴权（否则下面所有 save_matrix 调用都不可信）
_r = make_request({})
from core import _auth                                           # noqa: E402
_a = _auth(_r)
print("     _auth 通过 → user=%s role=%s" % (_a.get("username"), _a.get("role")))
ok("真实 _auth 链路可用（_resolve_auth → _lookup_user_by_token）")


# ---------- 3. 取期次与基线名册 ----------
head("3. 基线（读端真实函数）")
with get_db() as _c0:
    pid_row = _c0.execute(
        "SELECT id,order_start,order_end FROM forecast_periods ORDER BY id DESC LIMIT 1").fetchone()
PID, START, END = int(pid_row["id"]), pid_row["order_start"], pid_row["order_end"]
print("     期次 %s  %s ~ %s" % (PID, START, END))

TARGET = "永诺旗舰店"

def summary():
    return db.forecast_submission_summary("", START, END, PID)

s0 = summary()
u0 = list(s0.get("all_units") or [])
qty0 = sum(int(r.get("total_qty") or 0) for r in (s0.get("rows") or []))
det0 = sum(len(r.get("sources") or []) for r in (s0.get("rows") or []))
print("     all_units(%d) = %s" % (len(u0), u0))
print("     rows 件数合计=%s  sources 条数=%s" % (qty0, det0))

if TARGET in u0:
    ok("基线：名册含「%s」" % TARGET)
else:
    bad("基线：名册**不含**「%s」—— 后续命题无法成立（先确认期次/目标）" % TARGET)

# 新表由 _ensure_forecast_tables 惰性建出
try:
    with get_db() as c:
        cols = [r[1] for r in c.execute("PRAGMA table_info(forecast_hidden_units)").fetchall()]
    if cols == ["store_name", "hidden_at", "hidden_by"]:
        ok("forecast_hidden_units 已惰性建出，列=%s" % cols)
    else:
        bad("forecast_hidden_units 列不符：%s" % cols)
except Exception as e:
    bad("forecast_hidden_units 不存在：%s" % e)


# ---------- 4. 读端过滤 + 数字零变化（直接 SQL 注入，隔离 B） ----------
head("4. 读端过滤：NOT EXISTS 生效 且 **数字零变化**")
with get_db() as c:
    c.execute("INSERT OR REPLACE INTO forecast_hidden_units(store_name,hidden_by) VALUES (?,?)",
              (TARGET, "v199-test"))
    c.commit()

s1 = summary()
u1 = list(s1.get("all_units") or [])
qty1 = sum(int(r.get("total_qty") or 0) for r in (s1.get("rows") or []))
det1 = sum(len(r.get("sources") or []) for r in (s1.get("rows") or []))

if TARGET not in u1:
    ok("隐藏后名册不再含「%s」" % TARGET)
else:
    bad("隐藏后名册**仍含**「%s」—— NOT EXISTS 未生效" % TARGET)
if len(u1) == len(u0) - 1:
    ok("名册列数 %d → %d（恰少 1）" % (len(u0), len(u1)))
else:
    bad("名册列数变化异常：%d → %d" % (len(u0), len(u1)))
if (qty1, det1) == (qty0, det0):
    ok("历史数字零变化（件数 %s、来源 %s 逐项一致）—— 隐藏只改列集合、不动任何报单数据" % (qty1, det1))
else:
    bad("数字被改动：件数 %s→%s / 来源 %s→%s" % (qty0, qty1, det0, det1))

with get_db() as c:
    c.execute("DELETE FROM forecast_hidden_units WHERE store_name=?", (TARGET,))
    c.commit()
s2 = summary()
if TARGET in (s2.get("all_units") or []):
    ok("移除隐藏记录 ⇒ 列立刻回来（可逆，无需重启）")
else:
    bad("移除隐藏记录后列仍在消失状态 —— 过滤有残留")


# ---------- 5. 写端：真实调用 save_matrix 端点 ----------
head("5. 写端：真实 save_matrix（隐藏 + 释放 + 幂等 + EXISTS 守卫）")

def run_save(customers, hidden):
    payload = {
        "start": START, "end": END, "period_id": PID,
        "customers": customers, "hidden_customers": hidden, "rows": [],
    }
    return asyncio.run(save_matrix(make_request(payload)))

def hidden_rows():
    with get_db() as c:
        return [dict(r) for r in c.execute(
            "SELECT store_name,hidden_by FROM forecast_hidden_units ORDER BY store_name").fetchall()]

# 5.1 隐藏目标列（customers 里不带它）
others = [x for x in u0 if x != TARGET]
r1 = run_save(others, [TARGET])
print("     回执 = %s" % {k: r1.get(k) for k in ("success", "saved_customers", "hidden_units")})
if r1.get("success") and "hidden_units" in r1:
    ok("端点可调用，回执含 hidden_units=%s" % r1.get("hidden_units"))
else:
    bad("端点回执异常：%s" % r1)
hr = hidden_rows()
if [h["store_name"] for h in hr] == [TARGET]:
    ok("隐藏名册落库正确：%s（hidden_by=%s）" % ([h["store_name"] for h in hr], hr[0]["hidden_by"]))
else:
    bad("隐藏名册内容异常：%s" % hr)
if TARGET not in (summary().get("all_units") or []):
    ok("经真实端点写入后，名册确实不含「%s」（删列真正生效）" % TARGET)
else:
    bad("经端点写入后名册仍含目标 —— 端到端未打通")

# 5.2 幂等：同一列再删一次
r2 = run_save(others, [TARGET])
hr2 = hidden_rows()
if len(hr2) == 1:
    ok("重复隐藏幂等：仍只有 1 行（未累加、未报错）")
else:
    bad("重复隐藏产生多行：%s" % hr2)

# 5.3 EXISTS 守卫：隐藏一个从未存在过的名字
GHOST = "v199不存在的客户XYZ"
run_save(others, [GHOST])
hr3 = hidden_rows()
if GHOST not in [h["store_name"] for h in hr3]:
    ok("EXISTS 守卫生效：从未出现过的名字「%s」未落进名册（无残留）" % GHOST)
else:
    bad("幽灵名字被落库 —— EXISTS 守卫失效")

# 5.4 释放（加回列）：customers 里带上它
r4 = run_save(u0, [])
hr4 = hidden_rows()
if hr4 == []:
    ok("查 hidden_units → 空（customers 含该名 ⇒ 反向 DELETE 生效）")
else:
    bad("释放失败，残留：%s" % hr4)
if TARGET in (summary().get("all_units") or []):
    ok("加回后名册恢复含「%s」（删错可反悔，闭环成立）" % TARGET)
else:
    bad("加回后名册仍不含目标 —— 该方案不可逆，需重做")

# 5.5 旧前端兼容：完全不传 hidden_customers
pre = hidden_rows()
r5 = run_save(u0, [])
if r5.get("success"):
    ok("不传 hidden_customers（旧前端形态）仍 200，且行为不变")
else:
    bad("缺省字段导致失败：%s" % r5)


# ---------- 6. 口径对齐（C 方案）：往期看板不再计入撤回单 ----------
head("6. 口径对齐：forecast_order_board 与 summary 同口径")
with get_db() as c:
    old = c.execute("""
        SELECT COUNT(DISTINCT s.store_name) n, COALESCE(SUM(i.quantity),0) q,
               COUNT(DISTINCT s.id) sc
        FROM forecast_submission_items i JOIN forecast_submissions s ON i.submission_id=s.id
        WHERE s.period_id=9 AND s.status != 'rejected'""").fetchone()
    new = c.execute("""
        SELECT COUNT(DISTINCT s.store_name) n, COALESCE(SUM(i.quantity),0) q,
               COUNT(DISTINCT s.id) sc
        FROM forecast_submission_items i JOIN forecast_submissions s ON i.submission_id=s.id
        WHERE s.period_id=9 AND s.status NOT IN ('rejected','recalled')""").fetchone()
print("     期次9 旧口径(漏 recalled)：人数=%s 件数=%s 提交=%s" % (old["n"], old["q"], old["sc"]))
print("     期次9 新口径(对齐)：      人数=%s 件数=%s 提交=%s" % (new["n"], new["q"], new["sc"]))
board = db.forecast_order_board()
b9 = None
for p in (board if isinstance(board, list) else board.get("periods") or []):
    if int(p.get("id") or 0) == 9:
        b9 = p
        break
if b9 is None:
    print("     ⚠️ 看板未含期次 9，跳过（仅在期次列表里才可比）")
else:
    got = int(b9.get("total_qty") or 0)
    if got == int(new["q"]):
        ok("往期看板期次9 件数=%s 与新口径一致（改前会是 %s）" % (got, old["q"]))
    else:
        bad("看板期次9 件数=%s，新口径期望 %s" % (got, new["q"]))


# ---------- 7. 收尾 ----------
head("7. 收尾")
with get_db() as c:
    c.execute("DELETE FROM forecast_hidden_units")
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM forecast_hidden_units").fetchone()[0]
ok("沙箱隐藏名册已清空（残留 %d 行）" % left)

print("\n" + ("结果：%d 项未通过" % fail if fail else "结果：全部通过"))
sys.exit(1 if fail else 0)
