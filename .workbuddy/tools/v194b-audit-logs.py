#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：列出保存相关接口按天/按小时的分布 + audit_logs 里的保存与登录痕迹。"""
import sqlite3, json, subprocess, re, collections

DB = '/opt/hergent-erp/tenant_1.db'
con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
con.row_factory = sqlite3.Row
c = con.cursor()
out = {}

def q(sql, args=()):
    c.execute(sql, args)
    return [dict(r) for r in c.fetchall()]

# audit_logs 结构
c.execute("PRAGMA table_info(audit_logs)")
out['audit_cols'] = [r['name'] for r in c.fetchall()]
# 列可能叫 created_at / at / ts
cols = out['audit_cols']
tcol = next((x for x in ['created_at', 'at', 'ts', 'time'] if x in cols), None)
out['audit_time_col'] = tcol
if tcol:
    out['audit_recent'] = q("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 30")

print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
con.close()
