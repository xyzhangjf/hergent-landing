#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读核查：用户那次「改单删列→保存失败」在 tenant_1 留下的痕迹。mode=ro，不写任何东西。"""
import sqlite3, json

DB = '/opt/hergent-erp/tenant_1.db'
con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
con.row_factory = sqlite3.Row
c = con.cursor()

out = {}

def q(sql, args=()):
    c.execute(sql, args)
    return [dict(r) for r in c.fetchall()]

# 1) 期次确认（save_matrix 成功必写；confirmed_at 是 CST 本地时间）
out['period_confirm'] = q("SELECT period_start, period_end, confirmed_by, confirmed_at FROM forecast_period_confirm ORDER BY confirmed_at DESC LIMIT 15")

# 2) 期次列表
out['periods'] = q("SELECT id, name, order_start, order_end, status FROM forecast_periods ORDER BY id DESC LIMIT 12")

# 3) 永诺旗舰店在各期次的报单
out['yongnuo'] = q("SELECT period_id, order_date, role, status, COUNT(*) n FROM forecast_submissions WHERE store_name='永诺旗舰店' GROUP BY period_id, order_date, role, status ORDER BY order_date DESC LIMIT 20")

# 4) 永诺旗舰店 汇总
out['yongnuo_total'] = q("SELECT COUNT(*) n, MIN(order_date) mn, MAX(order_date) mx FROM forecast_submissions WHERE store_name='永诺旗舰店'")[0]

# 5) 最近 25 条报单（看 09-17/09-18 有没有导入活动）
out['recent_subs'] = q("SELECT id, period_id, order_date, store_name, role, status, created_at FROM forecast_submissions ORDER BY id DESC LIMIT 25")

# 6) 各期次的 role='导入' 客户数（看删列是否落库）
out['import_by_period'] = q("SELECT period_id, order_date, COUNT(DISTINCT store_name) customers, COUNT(*) rows FROM forecast_submissions WHERE role='导入' GROUP BY period_id, order_date ORDER BY order_date DESC LIMIT 15")

# 7) 客户名册规模 + 永诺是否在其中
out['all_units_n'] = q("SELECT COUNT(DISTINCT store_name) n FROM forecast_submissions WHERE status!='rejected' AND store_name IS NOT NULL AND store_name!=''")[0]

# 8) 审计里与保存相关的最近条目
try:
    out['audit_save'] = q("SELECT id, period_id, action, detail, created_at FROM forecast_audit_logs WHERE action IN ('save_changes','import') ORDER BY id DESC LIMIT 25")
except Exception as e:
    out['audit_save_err'] = str(e)
    try:
        con2 = c
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%audit%'")
        out['audit_tables'] = [r[0] for r in c.fetchall()]
    except Exception as e2:
        out['audit_tables_err'] = str(e2)

print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
con.close()
