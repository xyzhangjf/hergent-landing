#!/usr/bin/env python3
"""v684 判别力自证：把「提醒」故意错做成「拦截」，看 e2e 的 K 组能不能抓红。

用法：python3 neginject_v684.py inject | restore

注入内容 = 在 `purchase_return_create` 开头加一句「商品 1002 不在该供应商采购记录中 ⇒ 拒绝」。
这正是老板明确**不要**的行为（原话：「仅给出提醒，但仍允许其继续完成退货」）。
如果 K 组抓不红，说明那条断言是摆设。
"""
import os
import shutil
import sys

P = "/opt/hergent-erp/erp_db.py"
BAK = "/root/v684/erp_db.py.good"
MARK = "NEG-INJECT v684"

ANCHOR = """    from db.queries.units import ratio_to_base
    try:
        with get_db_tx() as db:
            po_id = int(purchase_order_id or 0)"""

INJECTED = """    from db.queries.units import ratio_to_base
    # NEG-INJECT v684 判别力自证：把「提醒」错做成「拦截」
    if any(int((it or {}).get("product_id") or 0) == 1002 for it in items):
        return {"error": "NEG-INJECT：该商品不在该供应商的采购记录中"}
    try:
        with get_db_tx() as db:
            po_id = int(purchase_order_id or 0)"""


def main(mode):
    s = open(P, encoding="utf-8").read()
    if mode == "inject":
        if MARK in s:
            print("already injected")
            return 0
        if ANCHOR not in s:
            sys.exit("anchor not found — 代码漂移，人工核对")
        shutil.copy2(P, BAK)
        open(P, "w", encoding="utf-8").write(s.replace(ANCHOR, INJECTED, 1))
        print("injected (backup %s)" % BAK)
        return 0
    if mode == "restore":
        if MARK not in s:
            print("not injected, nothing to restore")
            return 0
        shutil.copy2(BAK, P)
        print("restored from %s; mark left: %d" % (BAK, open(P, encoding="utf-8").read().count(MARK)))
        return 0
    sys.exit("usage: inject | restore")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "inject"))
