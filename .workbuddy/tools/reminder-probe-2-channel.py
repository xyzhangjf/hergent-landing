#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：核对提醒渠道是否真接通（企微/飞书/站内信），以及通知相关表。"""
import sqlite3

PATHS = [('tenant_1', '/opt/hergent-erp/tenant_1.db')]


def q(conn, sql, args=()):
    try:
        return conn.execute(sql, args).fetchall(), None
    except Exception as e:
        return [], str(e)


for tag, path in PATHS:
    print('=' * 60)
    print('###', tag)
    conn = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    conn.row_factory = sqlite3.Row

    # 渠道表结构 + 内容（只打类型/启用状态，不打凭据）
    for t in ('notification_channels', 'notification_prefs', 'notify_logs'):
        rows, err = q(conn, "SELECT * FROM %s LIMIT 5" % t)
        if err:
            print('--- %s: %s' % (t, err))
            continue
        cols = [d[0] for d in (conn.execute("SELECT * FROM %s LIMIT 1" % t).description or [])]
        cnt, _ = q(conn, "SELECT COUNT(*) c FROM %s" % t)
        print('--- %s 行数=%s 列=%s' % (t, cnt[0][0] if cnt else '?', cols))
        for r in rows:
            d = dict(r)
            safe = {}
            for k, v in d.items():
                kl = str(k).lower()
                if any(x in kl for x in ('secret', 'token', 'key', 'password', 'webhook', 'url')):
                    safe[k] = ('<len=%d>' % len(str(v))) if v else ''
                else:
                    safe[k] = v
            print('      ', safe)

    # 企微 / 飞书 是否有配置（在 settings 之类的表）
    rows, err = q(conn, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    names = [r[0] for r in rows]
    for n in names:
        if any(k in n for k in ('setting', 'channel', 'webhook', 'integration')):
            cnt, e2 = q(conn, "SELECT COUNT(*) c FROM %s" % n)
            if not e2:
                print('--- 表 %s 行数=%s' % (n, cnt[0][0]))

    # message_center 最近 10 条（看最近到底有什么通知到了）
    rows, err = q(conn, "SELECT * FROM message_center ORDER BY id DESC LIMIT 10")
    if err:
        print('--- message_center:', err)
    else:
        print('--- message_center 最近 10 条 ---')
        for r in rows:
            d = dict(r)
            print('   #%s [%s] %s | 收件=%s | %s' % (
                d.get('id'), d.get('level') or d.get('type'),
                str(d.get('title'))[:34],
                str(d.get('recipients'))[:20],
                str(d.get('created_at'))[:19]))
        cnt, _ = q(conn, "SELECT COUNT(*) c FROM message_center")
        print('   总条数 =', cnt[0][0] if cnt else '?')

    conn.close()
