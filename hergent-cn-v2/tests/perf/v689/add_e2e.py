#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v689 真机写探针的服务器侧 prepare / teardown。

prepare  —— 只造一条临时 session（不动任何业务数据），把 token 打到 stdout。
teardown —— 删 session，并把探针建的**那一条**商品删掉；两者都自证残留 0。

用法：
    python3 tools/v689_add_e2e.py prepare
    python3 tools/v689_add_e2e.py teardown
"""
import secrets
import sqlite3
import sys
import time

DB_MAIN = "/opt/hergent-erp/erp.db"
DB_TENANT = "/opt/hergent-erp/tenant_1.db"
MARK = "v689probe"
UID = 2            # 与既有探针同一个账号（有 data/create 权限）


def make_session():
    token = MARK + "-" + secrets.token_hex(12)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 3600))
    c = sqlite3.connect(DB_MAIN)
    c.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at, ip_address, user_agent_hash, last_activity)"
        " VALUES (?,?,?,?,?,?,?)", (token, UID, now, exp, "127.0.0.1", "", now))
    c.commit()
    c.close()
    return token


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'prepare':
        print(make_session())
        return 0

    if mode == 'teardown':
        ct = sqlite3.connect(DB_TENANT)
        ct.row_factory = sqlite3.Row
        rows = ct.execute(
            "SELECT id, name, barcode, alias, medium_unit, medium_ratio, large_unit, large_ratio,"
            " can_return, order_unit, arrival_lead_days, description"
            " FROM products WHERE name LIKE ?", (MARK + '%',)).fetchall()
        print('== 探针建出来的商品（删除前先看一眼落库内容）==')
        for r in rows:
            print('  id=%s name=%s' % (r['id'], r['name']))
            print('     barcode=%r alias=%r' % (r['barcode'], r['alias']))
            print('     中单位=%r/%r 大单位=%r/%r' % (r['medium_unit'], r['medium_ratio'],
                                                    r['large_unit'], r['large_ratio']))
            print('     can_return=%r order_unit=%r arrival=%r desc=%r' % (
                r['can_return'], r['order_unit'], r['arrival_lead_days'], r['description']))
        n_del = 0
        for r in rows:
            for t in ('unit_prices', 'product_unit_prices'):
                try:
                    ct.execute("DELETE FROM %s WHERE product_id=?" % t, (r['id'],))
                except Exception:
                    pass
            ct.execute("DELETE FROM products WHERE id=?", (r['id'],))
            n_del += 1
        ct.commit()
        left = ct.execute("SELECT COUNT(*) FROM products WHERE name LIKE ?", (MARK + '%',)).fetchone()[0]
        ct.close()
        print('  已删除 %d 条，残留 %d 条' % (n_del, left))

        cm = sqlite3.connect(DB_MAIN)
        cm.execute("DELETE FROM sessions WHERE token LIKE ?", (MARK + '%',))
        cm.commit()
        s_left = cm.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", (MARK + '%',)).fetchone()[0]
        s_total = cm.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        cm.close()
        print('  session 残留 %d 条，sessions 总数 %d' % (s_left, s_total))
        return 0 if (left == 0 and s_left == 0) else 1

    print('用法: prepare | teardown')
    return 2


if __name__ == '__main__':
    sys.exit(main())
