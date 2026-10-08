#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读探针：核对「报单提醒」配置是否被消费、实际有没有推出去。
红线：只打数量与配置，绝不打印客户名 / 金额个体。"""
import sqlite3, json, sys

DBS = [('tenant_1', '/opt/hergent-erp/tenant_1.db'),
       ('tenant_10', '/opt/hergent-erp/tenant_10.db')]


def q(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchall(), None
    except Exception as e:
        return [], str(e)


def run(tag, path):
    print('=' * 64)
    print('### %s  %s' % (tag, path))
    try:
        conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    except Exception as e:
        print('  连接失败:', e)
        return
    conn.row_factory = sqlite3.Row

    rows, err = q(conn, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    names = [r[0] for r in rows]
    print('--- 表总数 %d ---' % len(names))
    hit = [n for n in names if any(k in n for k in ('forecast', 'message', 'remind', 'notif', 'notify'))]
    for n in hit:
        print('   ', n)

    # 1) reminder 配置
    if 'forecast_config' in names:
        rows, err = q(conn, "SELECT * FROM forecast_config")
        if err:
            print('--- forecast_config 读失败:', err)
        else:
            print('--- forecast_config 全部 kind ---')
            for r in rows:
                d = dict(r)
                kind = d.get('kind') or d.get('key') or '?'
                payload = d.get('value') or d.get('config') or d.get('data') or ''
                if isinstance(payload, (bytes, bytearray)):
                    payload = payload.decode('utf-8', 'replace')
                p = str(payload)
                print('   kind=%-18s len=%d' % (kind, len(p)))
                if 'remind' in str(kind):
                    print('        >>> 原文:', p[:900])

    # 2) 期次
    rows, err = q(conn, "SELECT id,name,status,order_start,order_end,arrival_date FROM forecast_periods ORDER BY id DESC LIMIT 6")
    if err:
        print('--- forecast_periods 读失败:', err)
    else:
        print('--- 最近 6 个期次 ---')
        for r in rows:
            d = dict(r)
            print('   #%s %-22s status=%-8s %s ~ %s  到货%s' % (
                d.get('id'), str(d.get('name'))[:22], d.get('status'),
                d.get('order_start'), d.get('order_end'), d.get('arrival_date')))
        rows2, _ = q(conn, "SELECT COUNT(*) c FROM forecast_periods WHERE status='open'")
        print('   status=open 共 %s 个' % (rows2[0][0] if rows2 else '?'))

    # 3) 催单候选：近 30 天非导入报单过的单元数（_forecast_reminder_state 的 cand）
    rows, err = q(conn,
        "SELECT COUNT(DISTINCT store_name) c FROM forecast_submissions "
        "WHERE role!='导入' AND store_name!='' AND order_date >= date('now','localtime','-30 days')")
    if err:
        print('--- 候选统计失败:', err)
    else:
        print('--- 近30天 非导入 报单单元数(候选 cand) =', rows[0][0])

    rows, err = q(conn, "SELECT COUNT(*) c, MAX(order_date) m FROM forecast_submissions")
    if not err:
        print('--- forecast_submissions 总行数 = %s，最近报单日 = %s' % (rows[0][0], rows[0][1]))

    # 4) 站内通知里有没有催单痕迹
    for t in ('message_center', 'messages', 'notifications'):
        if t in names:
            rows, err = q(conn,
                "SELECT COUNT(*) c FROM %s WHERE title LIKE '%%催单%%' OR title LIKE '%%预报%%'" % t)
            if not err:
                print('--- %s 中「催单/预报」标题条数 = %s' % (t, rows[0][0]))
                rows2, err2 = q(conn,
                    "SELECT id,title,event_key,created_at FROM %s "
                    "WHERE title LIKE '%%催单%%' OR title LIKE '%%预报%%' "
                    "ORDER BY id DESC LIMIT 8" % t)
                if not err2:
                    for r in rows2:
                        d = dict(r)
                        print('      #%s %s | %s | %s' % (
                            d.get('id'), str(d.get('title'))[:40],
                            d.get('event_key'), d.get('created_at')))

    # 5) forecast_config 之外是否存在 reminder 相关表
    for n in names:
        if 'remind' in n:
            rows, err = q(conn, "SELECT COUNT(*) c FROM %s" % n)
            if not err:
                print('--- 表 %s 行数 = %s' % (n, rows[0][0]))

    conn.close()


for tag, path in DBS:
    run(tag, path)
