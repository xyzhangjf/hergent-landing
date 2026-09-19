#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v196 归并后「全库残留引用」结构化核查（只读）

为什么不能只看列名：上一版只查了列名含 brand/scope 的列，而品牌名完全可能落在
`rebate_rules.name`、`targets.title`、`audit_log.detail` 这类"名字里没有 brand"的列里。
⇒ 改成：遍历**所有表的全部列**，找**值精确等于**旧品牌名的单元格。
   （不做子串匹配 —— 商品名里本来就含「福宝/恒滋」字样，那是名称不是品牌，会假阳性。）

只为回答一个问题：归并后，还有没有哪个地方"记着"旧品牌名？
"""
import sqlite3

DBS = [("tenant_1", "/opt/hergent-erp/tenant_1.db"), ("main", "/opt/hergent-erp/erp.db")]
OLD = ["蒙牛低温（福宝）", "蒙牛低温（恒滋）"]

for name, path in DBS:
    print("\n" + "=" * 70)
    print("库: %s (%s)" % (name, path))
    print("=" * 70)
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    cur = c.cursor()
    tabs = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    print("表数 =", len(tabs))
    hits = 0
    scanned_cells = 0
    for tb in tabs:
        try:
            cols = [r[1] for r in cur.execute("PRAGMA table_info(%s)" % tb)]
        except Exception:
            continue
        if not cols:
            continue
        for col in cols:
            try:
                n = cur.execute(
                    'SELECT COUNT(*) FROM "%s" WHERE CAST("%s" AS TEXT) IN (?,?)' % (tb, col),
                    tuple(OLD)).fetchone()[0]
            except Exception:
                continue
            scanned_cells += 1
            if n:
                ids = cur.execute(
                    'SELECT rowid FROM "%s" WHERE CAST("%s" AS TEXT) IN (?,?) LIMIT 5' % (tb, col),
                    tuple(OLD)).fetchall()
                print("   ⚠️ %s.%s = %d 行  rowid=%s" % (tb, col, n, [x[0] for x in ids]))
                hits += 1
    print("   扫描 (表,列) 组合 =", scanned_cells, "| 命中 =", hits)
    print("   结论:", "✅ 全库零残留引用" if hits == 0 else "⚠️ 仍有残留，见上")

    # 附带：确认目标品牌
    if name == "tenant_1":
        n = cur.execute("SELECT COUNT(*) FROM products WHERE brand='蒙牛低温'").fetchone()[0]
        print("   products.brand='蒙牛低温' 行数 =", n)
    c.close()
print("\n[READ-ONLY] done.")
