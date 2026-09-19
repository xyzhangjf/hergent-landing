#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读确认：brands / brand_pending / 商品品牌分布 —— 验证 track_brand 为何每次都走写分支。"""
import sqlite3, json

DB = '/opt/hergent-erp/tenant_1.db'
con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
con.row_factory = sqlite3.Row
c = con.cursor()
out = {}

def q(sql, args=()):
    try:
        c.execute(sql, args)
        return [dict(r) for r in c.fetchall()]
    except Exception as e:
        return {'ERR': str(e)}

out['tables_brand'] = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%brand%'").fetchall()]
out['brands_all'] = q("SELECT id, name FROM brands ORDER BY id LIMIT 40")
out['brands_n'] = q("SELECT COUNT(*) n FROM brands")
out['brand_pending'] = q("SELECT id, raw_name, source, ref_count, status FROM brand_pending ORDER BY id DESC LIMIT 30")
out['brand_pending_n'] = q("SELECT COUNT(*) n FROM brand_pending")
out['pending_by_status'] = q("SELECT status, COUNT(*) n FROM brand_pending GROUP BY status")
out['has_fubao_in_brands'] = q("SELECT COUNT(*) n FROM brands WHERE name LIKE '%福宝%' OR name LIKE '%蒙牛低温%'")
out['has_fubao_in_pending'] = q("SELECT COUNT(*) n FROM brand_pending WHERE raw_name LIKE '%福宝%' OR raw_name LIKE '%蒙牛低温%'")
# 商品品牌分布（能算出一次保存会触发多少次 track_brand 写）
out['prod_brand_dist'] = q("SELECT CASE WHEN brand IS NULL OR brand='' THEN '(空)' ELSE brand END b, COUNT(*) n FROM products GROUP BY b ORDER BY n DESC LIMIT 15")
out['prod_total'] = q("SELECT COUNT(*) n, SUM(CASE WHEN brand IS NOT NULL AND brand!='' THEN 1 ELSE 0 END) with_brand FROM products")
# brands 表是否有唯一索引
out['brands_idx'] = q("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brands'")
# products 是否有 FTS 触发器（会放大写耗时）
out['fts_triggers'] = q("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' AND (name LIKE '%fts%' OR tbl_name='products') LIMIT 20")

print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
con.close()
