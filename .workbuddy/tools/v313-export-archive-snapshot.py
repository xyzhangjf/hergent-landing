# -*- coding: utf-8 -*-
"""只读导出生产租户库的**档案最小快照**，供本地做「档案缺口清单」。

设计约束（都来自项目纪律）：
1. 只读：`mode=ro`（**活库不带 `immutable`** —— 带了会读到过期页）。
2. 最小字段：只取匹配逻辑真正要用的列（不给价格/金额任何列）⇒ 敏感面最小。
3. 不落盘到服务器：JSON 打到 stdout，由调用方重定向到本地。

用法（在服务器上）：
    /usr/bin/python3 v313-export-archive-snapshot.py /opt/hergent-erp/tenant_1.db > /tmp/snap.json
"""
import json
import sqlite3
import sys

# 每张表要取的列（顺序即输出顺序）。缺列会被自动跳过并记录到 "_missing_cols"。
WANT = {
    # alias：v313 新增的「档案别名」列（人工确认过的写法差异，用于精确认领）。
    # 老库可能还没有这列 ⇒ 会被自动跳过并记进 "_missing_cols"，不会让脚本崩。
    "contacts": ["id", "name", "type", "is_active", "alias"],
    "products": ["id", "name", "spec", "unit", "barcode",
                 "large_ratio", "medium_ratio", "order_unit", "is_active"],
    "warehouses": ["id", "name", "is_default"],
}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
    uri = "file:%s?mode=ro" % path
    c = sqlite3.connect(uri, uri=True)
    c.row_factory = sqlite3.Row

    out = {"_db": path, "_tables": {}}
    for t, want in WANT.items():
        have = [r[1] for r in c.execute("PRAGMA table_info(%s)" % t)]
        take = [x for x in want if x in have]
        missing = [x for x in want if x not in have]
        sel = ", ".join('"%s"' % x for x in take)
        rows = []
        for r in c.execute("SELECT %s FROM %s" % (sel, t)):
            rows.append([r[x] for x in take])
        out["_tables"][t] = {"cols": take, "missing_cols": missing, "rows": rows}
    c.close()
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
