#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清理 v195 沙箱测试残留：商品 source='v195http'/'v195_sbx' + 待审 raw_name LIKE 'v195%'。
只在沙箱租户（>=9997）上执行。"""
import os
import sys

sys.path.insert(0, "/opt/hergent-erp")
os.chdir("/opt/hergent-erp")
import erp_db as db  # noqa: E402
from db import connection as C  # noqa: E402

TID = int(sys.argv[1]) if len(sys.argv) > 1 else 9997
if TID < 9997:
    print("拒绝：只允许沙箱租户")
    sys.exit(2)
C.set_tenant_context(TID)
with db.get_db_tx() as conn:
    n1 = conn.execute("DELETE FROM products WHERE source IN ('v195http','v195_sbx') OR name LIKE 'v195%'").rowcount
    try:
        n2 = conn.execute("DELETE FROM brand_pending WHERE raw_name LIKE 'v195%'").rowcount
    except Exception as e:
        n2 = "n/a(%s)" % e
with db.get_db() as c:
    left_p = c.execute("SELECT COUNT(*) FROM products WHERE source IN ('v195http','v195_sbx') OR name LIKE 'v195%'").fetchone()[0]
    try:
        left_b = c.execute("SELECT COUNT(*) FROM brand_pending WHERE raw_name LIKE 'v195%'").fetchone()[0]
    except Exception:
        left_b = "n/a"
    npend = c.execute("SELECT COUNT(*) FROM brand_pending WHERE status='pending'").fetchone()[0]
print("删除：商品 %s 行 / 待审品牌 %s 行" % (n1, n2))
print("回读残留：商品 %s / 待审品牌 %s" % (left_p, left_b))
print("待审队列 pending 现有 %s 条" % npend)
print("ZERO_RESIDUE:", left_p == 0 and left_b == 0)
