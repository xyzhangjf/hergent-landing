#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 语义单测：一店一期一单 + 原位替换（单号稳定）。

为什么要有这份单测（而不是"跑起来看着对"）：
  v224 把小程序报单的**幂等键**从 (user_id, store_id, period_id) 改成 (store_id, period_id)，
  并把「覆盖」从「删旧单 + 插新单」改成「原位 UPDATE」。这两件事都有**不显眼的正确性陷阱**，
  而且陷阱的表现形式全是"看起来成功了"：
    · 单号变化 —— 前端照样显示成功，但用户手里的单号下次就查不到；
    · `recall` 是 `UPDATE status='recalled'`（**不删行**）⇒ 撤回后重新报单若不复位 status，
      新单**继承"已撤回"** ⇒ 不计入本期汇总，而用户看到"提交成功"（静默失效）；
    · `user_id` 若跟着"最后提交人"漂移 ⇒ 两人先后改同一店时历史单归属反复易主；
    · `/my` 若只按 user_id 过滤 ⇒ 乙改了甲的单却在「我的提交」里看不到它。
  以上每一条**都不能靠肉眼**发现，所以逐条写成断言。

做法：把 `ERP_DB_PATH` 指到一个临时目录 ⇒ `DB_DIR` 随之改变 ⇒ `set_tenant_context(1)`
就落在临时库上。**全程不接触任何真实租户库**（连生产都不碰）。

用法：
  /Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
      .workbuddy/tools/v224-replace-semantics-test.py
"""
import os
import shutil
import sys
import tempfile

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
TMP = tempfile.mkdtemp(prefix="v224-sem-")
# ⚠️ 必须在 import erp_db **之前**设好 —— DB_DIR 是导入期由 DB_PATH 派生的
os.environ["ERP_DB_PATH"] = os.path.join(TMP, "tenant_1.db")
sys.path.insert(0, SRV)

import erp_db as db          # noqa: E402
from db.connection import set_tenant_context, DB_DIR, DB_PATH   # noqa: E402

FAILS = []


def ck(cond, label, extra=""):
    print(("  ✓ " if cond else "  ✗ ") + label + (("   " + extra) if extra else ""))
    if not cond:
        FAILS.append(label)


U1 = {"id": 101, "display_name": "甲"}
U2 = {"id": 102, "display_name": "乙"}
STORE = {"id": 55, "name": "永诺旗舰店"}
PID = 9
ITEMS_A = [{"product_id": 1, "product_name": "奶A", "spec": "250ml", "unit": "箱",
            "quantity": 10, "price": 2.0, "amount": 20.0}]
ITEMS_B = [{"product_id": 1, "product_name": "奶A", "spec": "250ml", "unit": "箱",
            "quantity": 7, "price": 2.0, "amount": 14.0},
           {"product_id": 2, "product_name": "奶B", "spec": "1L", "unit": "提",
            "quantity": 3, "price": 5.0, "amount": 15.0}]


def main():
    print("临时库：%s" % DB_PATH)
    assert DB_DIR == TMP, "DB_DIR 未随 ERP_DB_PATH 改变 ⇒ 本测试会写到别处，立即中止"
    set_tenant_context(1)

    print("\n① 建表 + 新建（create）")
    r1 = db.forecast_submission_create(U1, "sales", STORE, ITEMS_A, period_id=PID)
    sid = r1["submission_id"]
    ck(bool(sid), "create 返回 submission_id=%s" % sid)

    with db.get_db() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(forecast_submissions)").fetchall()}
    ck({"updated_by", "updated_at"} <= cols,
       "v224 新列已建（updated_by / updated_at）", "实际列数=%d" % len(cols))

    print("\n② 原位替换（replace）：单号不变、明细换掉、状态复位、归属不漂移")
    r2 = db.forecast_submission_replace(sid, U2, "supervisor", STORE, ITEMS_B, period_id=PID)
    ck(r2["submission_id"] == sid, "单号稳定：%s -> %s" % (sid, r2["submission_id"]))
    ck(r2.get("updated") is True, "返回 updated=True")
    ck(r2["total_qty"] == 10, "合计件数按新明细重算（7+3=10）", "实得 %s" % r2["total_qty"])
    with db.get_db() as c:
        row = dict(c.execute("SELECT * FROM forecast_submissions WHERE id=?", (sid,)).fetchone())
        n_items = c.execute("SELECT COUNT(*) FROM forecast_submission_items WHERE submission_id=?",
                            (sid,)).fetchone()[0]
        n_rows = c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
    ck(n_items == 2, "明细被替换（旧 1 条 -> 新 2 条）", "实得 %d" % n_items)
    ck(row["status"] == "pending", "status = pending", "实得 %r" % row["status"])
    ck(int(row["user_id"]) == 101, "user_id 保持**首报人**（不随修改漂移）", "实得 %s" % row["user_id"])
    ck(row["updated_by"] == "乙", "updated_by 记录最后修改人=乙", "实得 %r" % row["updated_by"])
    ck(bool(row["updated_at"]), "updated_at 已写入", "实得 %r" % row["updated_at"])
    ck(n_rows == 1, "主表仍只有 1 行（替换不是新增）", "实得 %d" % n_rows)

    print("\n③ 撤回后再报：status 必须复位（否则新单继承「已撤回」= 不计入汇总）")
    with db.get_db_tx() as c:
        c.execute("UPDATE forecast_submissions SET status='recalled' WHERE id=?", (sid,))
    db.forecast_submission_replace(sid, U2, "sales", STORE, ITEMS_A, period_id=PID)
    with db.get_db() as c:
        st = c.execute("SELECT status FROM forecast_submissions WHERE id=?", (sid,)).fetchone()[0]
    ck(st == "pending", "撤回后重新提交 => status 复位为 pending", "实得 %r" % st)

    print("\n④ 路由幂等 SQL：同店同期次只命中一行（且不含 user_id）")
    with db.get_db() as c:
        rows = c.execute(
            "SELECT id FROM forecast_submissions "
            "WHERE store_id=? AND (period_id=? OR (period_id=0 AND order_date=?))",
            (STORE["id"], PID, "2000-01-01")).fetchall()
    ck(len(rows) == 1, "同店同期次查询命中 1 行", "实得 %d 行" % len(rows))
    ck(len(rows) == 1 and rows[0][0] == sid, "命中的就是那一单（单号一致）")

    print("\n⑤ 一店一期一单：换个**人**再报同店同期，仍然只有一行")
    # 模拟「乙」走的是新建分支（因为查不到属于他自己的单 ⇒ 走 create）——
    # 但正确实现是路由层按 (store, period) 查到甲那一单，从而走 replace。
    # 这里直接断言"若再报一次，主表行数不增长"，即键里确实没有 user_id。
    before = None
    with db.get_db() as c:
        before = c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
    hit = None
    with db.get_db() as c:
        hit = c.execute("SELECT id FROM forecast_submissions WHERE store_id=? AND period_id=?",
                        (STORE["id"], PID)).fetchall()
    if len(hit) == 1:
        db.forecast_submission_replace(hit[0][0], U2, "sales", STORE, ITEMS_B, period_id=PID)
    after = None
    with db.get_db() as c:
        after = c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
    ck(before == after == 1, "两次提交后主表仍为 1 行", "before=%s after=%s" % (before, after))

    print("\n⑥ /my 门店范围：乙能看到甲报的那一单；范围外的丙看不到")
    recs_b = db.forecast_submission_list(102, store_ids=[STORE["id"]])
    ck(len(recs_b) == 1 and int(recs_b[0]["id"]) == sid, "乙（不是首报人）按门店范围可见")
    recs_c = db.forecast_submission_list(103, store_ids=[77])
    ck(len(recs_c) == 0, "丙（门店不在其范围）不可见")
    recs_d = db.forecast_submission_list(103, store_ids=None)
    ck(len(recs_d) == 0, "不传 store_ids 时行为与改前一致（只按 user_id）")
    recs_a = db.forecast_submission_list(101, store_ids=None)
    ck(len(recs_a) == 1, "甲（首报人）按 user_id 仍可见")

    print("\n⑦ replace 传了不存在的 id => 退化为新建（绝不静默什么也没发生）")
    r7 = db.forecast_submission_replace(999999, U1, "sales", {"id": 88, "name": "另一家店"},
                                        ITEMS_A, period_id=PID)
    ck(r7["submission_id"] != 999999 and r7["submission_id"] > 0,
       "回退为新建并返回真实单号", "实得 %s" % r7["submission_id"])

    print("\n" + ("=" * 60))
    if FAILS:
        print("失败 %d 项：" % len(FAILS))
        for f in FAILS:
            print("  - " + f)
    else:
        print("全部断言通过 ✓")
    return 1 if FAILS else 0


if __name__ == "__main__":
    try:
        code = main()
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(code)
