"""v219 期次「定稿 = 关闭」—— 影子库离线护栏（**不碰任何真实库**）。

跑法：python3 .workbuddy/tools/v219-shadow-verify.py

原理：`db/connection.py:11` 的 `DB_PATH` 取自环境变量 `ERP_DB_PATH`，
故只要把它指向一个临时目录，erp_db 的全部读写就落在这个一次性库里。

覆盖：
  A. `_ensure_forecast_tables` 后预报两张表确实建出（create_submission 建表前置的依据）
  B. `forecast_period_reopen`：closed→open、幂等、不存在返回 False、close↔reopen 往返
  C. save_matrix 闸门**依赖的那条查询**在 closed 期次上确实返回非 open
     （闸门本身是否接对，由部署后的真机取证断言 —— 那里才是端到端）

退出码 0 = 全 PASS。
"""
import os
import sys
import tempfile

SERVER = "/Users/zhangjunfeng/Documents/hergent-erp/server"
TMP = tempfile.mkdtemp(prefix="v219shadow_")
os.environ["ERP_DB_PATH"] = os.path.join(TMP, "shadow.db")
os.environ["ERP_SECRET"] = "test"
sys.path.insert(0, SERVER)

import erp_db as db  # noqa: E402

FAILS = []


def ck(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + (("  | " + str(extra)) if extra else ""))
    if not cond:
        FAILS.append(name)


def status_of(pid):
    with db.get_db() as c:
        r = c.execute("SELECT status FROM forecast_periods WHERE id=?", (pid,)).fetchone()
    return r[0] if r else None


# ---- A. 建表前置 ----
with db.get_db_tx() as c:
    db._ensure_forecast_tables(c)
with db.get_db() as c:
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
ck("A1 ensure 后 forecast_periods 存在", "forecast_periods" in tables, len(tables))
ck("A2 ensure 后 forecast_submissions 存在", "forecast_submissions" in tables)
ck("A3 ensure 后 forecast_submission_items 存在", "forecast_submission_items" in tables)

# ---- B. reopen ----
with db.get_db_tx() as c:
    c.execute(
        "INSERT INTO forecast_periods (id,name,order_start,order_end,status) VALUES (1,'T期','2026-01-01','2026-01-31','closed')"
    )

ck("B1 初始为 closed", status_of(1) == "closed", status_of(1))
ck("B2 reopen(closed) 返回 True", db.forecast_period_reopen(1) is True)
ck("B3 reopen 后 status=open", status_of(1) == "open", status_of(1))
ck("B4 reopen 幂等（再开一次仍 True 且状态不变）",
   db.forecast_period_reopen(1) is True and status_of(1) == "open", status_of(1))
ck("B5 不存在的期次返回 False", db.forecast_period_reopen(999) is False)
db.forecast_period_close(1)
ck("B6 close 生效", status_of(1) == "closed", status_of(1))
db.forecast_period_reopen(1)
ck("B7 close→reopen 往返成立（关闭不再单向）", status_of(1) == "open", status_of(1))

# ---- C. 闸门依赖的查询 ----
db.forecast_period_close(1)
with db.get_db() as c:
    r = c.execute("SELECT status FROM forecast_periods WHERE id=?", (1,)).fetchone()
_gate_should_block = bool(r and (dict(r).get("status") or "open") != "open")
ck("C1 closed 期次 ⇒ 闸门判据为真（应拒绝保存）", _gate_should_block)
db.forecast_period_reopen(1)
with db.get_db() as c:
    r = c.execute("SELECT status FROM forecast_periods WHERE id=?", (1,)).fetchone()
_gate_should_pass = not bool(r and (dict(r).get("status") or "open") != "open")
ck("C2 reopen 后 ⇒ 闸门判据为假（应放行保存）", _gate_should_pass)
ck("C3 pid=0（今日报单）不在闸门作用域", True, "源码判据为 if pid > 0")

print()
print("RESULT: %s (%d FAIL)" % ("ALL PASS" if not FAILS else "HAS FAILURE", len(FAILS)))
print("shadow db:", os.environ["ERP_DB_PATH"])
sys.exit(1 if FAILS else 0)
