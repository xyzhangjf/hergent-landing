#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 后端补丁 B：采购退货单补「业务员」(handler) —— 与 A 同一套范式。

为什么退货单也要补：采购退货页的「经办人」格此前是**只读显示当前登录人**
（`operatorName`），而 `operator_id` 的语义是"谁**建**的"。老板要求全站统一叫
「业务员」后，那一格若还只读地显示创建人，就是**把创建人冒充业务员** ——
下一轮必然被当成 bug 报回来。所以给它补一个真正可选、可落库的字段。
"""
import os
import sys
import time
import shutil
import py_compile

ROOT = "/opt/hergent-erp"
STAMP = time.strftime("%Y%m%d%H%M%S")
DRY = "--dry-run" in sys.argv

PATCHES = [
    ("erp_db.py", "主库迁移：purchase_returns 加 handler",
     """    _safe_migrate('v686_ro_handler', "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''")""",
     """    _safe_migrate('v686_ro_handler', "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''")
    # v686：采购退货单同理 —— 它此前**只有** `operator_id`（谁建的），
    #   页面上却把那一格标成「经办人」（把创建人冒充业务员）。补一个真正可选的字段。
    _safe_migrate('v686_pr_handler', "ALTER TABLE purchase_returns ADD COLUMN handler TEXT DEFAULT ''")"""),

    ("erp_db.py", "租户列清单：purchase_returns.handler",
     """                    ("return_orders.handler", "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''"),""",
     """                    ("return_orders.handler", "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''"),
                    ("purchase_returns.handler", "ALTER TABLE purchase_returns ADD COLUMN handler TEXT DEFAULT ''"),"""),

    ("erp_db.py", "purchase_return_create 签名加 handler",
     """                           department_id=0, draft=False):""",
     """                           department_id=0, draft=False, handler=""):"""),

    ("erp_db.py", "purchase_return_create 动态列加 handler",
     """            _opt = [("warehouse_id", wh), ("order_date", order_date), ("note", note)]""",
     """            # v686：业务员（空串 ⇒ 循环里 `continue` 跳过 ⇒ INSERT 与改动前逐字一致）
            _opt = [("warehouse_id", wh), ("order_date", order_date), ("note", note),
                    ("handler", handler)]"""),

    ("routers/psi.py", "采购退货 POST 透传 handler",
     """        department_id=dept, draft=draft,
    )""",
     """        department_id=dept, draft=draft,
        # v686：业务员（空串 ⇒ db 层不写该列）
        handler=str(body.get("handler") or "").strip(),
    )"""),
]


def main():
    for f, desc, old, new in PATCHES:
        path = os.path.join(ROOT, f)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            print(f"❌ 命中 {n} 次（要求 1）：{f} :: {desc}")
            return 2
    print(f"✅ 全部 {len(PATCHES)} 处片段均已精确定位")
    if DRY:
        print("（--dry-run，未写盘）")
        return 0

    by_file = {}
    for f, desc, old, new in PATCHES:
        by_file.setdefault(f, []).append((old, new))
    for f, items in by_file.items():
        path = os.path.join(ROOT, f)
        shutil.copy2(path, f"{path}.bak-v686b-{STAMP}")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for old, new in items:
            src = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src)
        print(f"  ✍️ {f}（{len(items)} 处）→ .bak-v686b-{STAMP}")
    bad = 0
    for f in by_file:
        try:
            py_compile.compile(os.path.join(ROOT, f), doraise=True)
            print(f"  ✅ 语法 OK：{f}")
        except Exception as e:
            bad += 1
            print(f"  ❌ 语法错：{f} :: {e}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
