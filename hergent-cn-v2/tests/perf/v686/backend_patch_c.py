#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 后端补丁 C：销售单/退货单列表下发 `handler_name`（业务员姓名）。

为什么必须在这一层做：列表的「业务员」列要显示**姓名**，而库里存的是主库
`users.id` 的字符串（与 `operator_id` 同取值域）。前端拿 id 无法翻译（它没有
主库账号表），直接显示 id 用户读不懂。解析只能复用 `_creator_names`
（**唯一入口**，读主库 users），不能在前端另写一份。
"""
import os
import sys
import time
import shutil
import py_compile

ROOT = "/opt/hergent-erp"
STAMP = time.strftime("%Y%m%d%H%M%S")
DRY = "--dry-run" in sys.argv

FN = '''

def _inject_handler_names(r):
    """给列表返回体里的每一行补 `handler_name`（业务员姓名）。v686。

    🔴 为什么单独一个函数而不是每处写一遍 for 循环：销售订单列表、销售退货列表
       两个出口（将来还会有采购退货）的返回体形制不同（list / `{rows}` / `{orders}`），
       逐处抄一遍就会漏掉某一处 —— 而漏掉的表现只是「那一列恒显示 —」，
       不报错、不告警，最难发现。
    🔴 解析走 `_creator_names`（读主库 users 的**唯一入口**），不在本函数里另写 SQL：
       两份解析必然分叉（一处加了 is_active 过滤、另一处没加，就会显示成另一个人）。
    ⚠️ 任何异常都**不让列表失败** —— 业务员姓名是附加信息，读不出来就当没有，
       绝不能让「翻一页单据」因为解析姓名而 500。
    """
    try:
        rows = None
        if isinstance(r, list):
            rows = r
        elif isinstance(r, dict):
            for _k in ("rows", "orders", "data", "list", "items"):
                if isinstance(r.get(_k), list):
                    rows = r[_k]
                    break
        if rows is None:
            return r
        _keys = [str(x.get("handler") or "").strip() for x in rows if isinstance(x, dict)]
        _m = _creator_names([k for k in _keys if k])
        for x in rows:
            if not isinstance(x, dict):
                continue
            _hk = str(x.get("handler") or "").strip()
            x["handler_name"] = _m.get(_hk, "") if _hk else ""
    except Exception as e:
        logging.getLogger("hergent").warning(f"[psi] handler_name 注入失败: {e}")
    return r

'''

PATCHES = [
    ("routers/psi.py", "新增 _inject_handler_names",
     """    except Exception as e:
        logging.getLogger("hergent").warning(f"[psi] 部门名解析失败: {e}")
    return m
""",
     """    except Exception as e:
        logging.getLogger("hergent").warning(f"[psi] 部门名解析失败: {e}")
    return m
""" + FN),

    ("routers/psi.py", "销售订单列表注入 handler_name",
     """    return _legacy_list_sale(request, status, customer_id, date_from, date_to,
                             operator_id, driver_id, order_type=order_type, limit=limit,
                             offset=offset, order_by=order_by, order_dir=order_dir,
                             exclude_status=exclude_status)""",
     """    # v686：补业务员姓名（`handler` 是主库 users.id 字符串，界面不能直接显示 id）
    return _inject_handler_names(
        _legacy_list_sale(request, status, customer_id, date_from, date_to,
                          operator_id, driver_id, order_type=order_type, limit=limit,
                          offset=offset, order_by=order_by, order_dir=order_dir,
                          exclude_status=exclude_status))"""),

    ("routers/psi.py", "销售退货 + 采购退货列表注入 handler_name（**两处同款 return**，都要注入）",
     """    return {"success": True, "rows": rows, "count": len(rows), "total": total, "counts": counts}""",
     """    # v686：补业务员姓名（与销售订单列表同一条口径）
    return _inject_handler_names(
        {"success": True, "rows": rows, "count": len(rows), "total": total, "counts": counts})"""),
]

# 允许命中多次的补丁（同一行代码在两处出现，且两处**都**要改）
ALLOW_MULTI = {"销售退货 + 采购退货列表注入 handler_name（**两处同款 return**，都要注入）"}


def main():
    for f, desc, old, new in PATCHES:
        path = os.path.join(ROOT, f)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        exp = 2 if desc in ALLOW_MULTI else 1
        if n != exp:
            print(f"❌ 命中 {n} 次（要求 {exp}）：{f} :: {desc}")
            return 2
    print(f"✅ 全部 {len(PATCHES)} 处片段均已精确定位")
    if DRY:
        print("（--dry-run，未写盘）")
        return 0

    by_file = {}
    for f, desc, old, new in PATCHES:
        by_file.setdefault(f, []).append((desc, old, new))
    for f, items in by_file.items():
        path = os.path.join(ROOT, f)
        shutil.copy2(path, f"{path}.bak-v686d-{STAMP}")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for desc, old, new in items:
            cnt = -1 if desc in ALLOW_MULTI else 1
            src = src.replace(old, new, cnt) if cnt == -1 else src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src)
        print(f"  ✍️ {f}（{len(items)} 处）→ .bak-v686d-{STAMP}")
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
