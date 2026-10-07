#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v392 只读侦察：生产会话 / 角色 / 进销存数据底数（**只读，零写入**）。

仅 sqlite3 mode=ro，不 import 任何 server 模块（避免触发模块级 DDL 重放）。
"""
import sqlite3
import json

DB = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def q(c, sql, args=()):
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    except Exception as e:
        return {"__err__": str(e)}


def main():
    c = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    out = {}
    out["活跃会话（role × 最近活动）"] = q(c, """
        SELECT u.id AS uid, u.username, u.role, u.is_active,
               COALESCE(s.last_activity, s.created_at) AS last,
               (s.expires_at IS NULL OR s.expires_at > datetime('now','localtime')) AS live
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE u.is_active = 1
        ORDER BY COALESCE(s.last_activity, s.created_at) DESC LIMIT 15""")
    out["users 角色分布"] = q(c, "SELECT role, COUNT(*) n FROM users WHERE is_active=1 GROUP BY role ORDER BY n DESC")
    out["租户"] = q(c, "SELECT id, name FROM tenants ORDER BY id LIMIT 10")
    c.close()

    c2 = sqlite3.connect("file:" + T1 + "?mode=ro", uri=True)
    c2.row_factory = sqlite3.Row
    out["tenant_1 进销存底数"] = q(c2, """
        SELECT 'purchase_orders' t, COUNT(*) n FROM purchase_orders
        UNION ALL SELECT 'purchase_order_items', COUNT(*) FROM purchase_order_items
        UNION ALL SELECT 'sale_orders', COUNT(*) FROM sale_orders
        UNION ALL SELECT 'sale_order_items', COUNT(*) FROM sale_order_items
        UNION ALL SELECT 'inventory', COUNT(*) FROM inventory""")
    out["tenant_1 库存效期覆盖"] = q(c2, """
        SELECT COUNT(*) AS 批次行,
               SUM(CASE WHEN COALESCE(expiry_date,'')='' THEN 1 ELSE 0 END) AS 无到期日,
               SUM(CASE WHEN COALESCE(batch_no,'')='' THEN 1 ELSE 0 END) AS 无批次号
        FROM inventory""")
    out["tenant_1 仓库"] = q(c2, "SELECT id, name, is_default FROM warehouses ORDER BY id")
    c2.close()
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
