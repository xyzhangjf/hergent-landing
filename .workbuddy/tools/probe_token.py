#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UI 探针用的临时会话令牌：插入 / 删除 / 回读计数。

用法（在服务器上）：
    python3 probe_token.py insert <token>   → 插入令牌（user=1, admin），打印基线计数
    python3 probe_token.py delete <token>   → 删除令牌并回读计数（应回到基线）
    python3 probe_token.py count            → 只回读计数

为什么单独一个文件：真机 UI 探针跑在本地（走公网 hergent.cn），
但令牌必须直接写生产库 —— 拆开后「插令牌 / 跑探针 / 删令牌」三步都留痕，
最后一步的计数回读就是零残留的证据。
"""
import secrets
import sqlite3
import sys

DB = '/opt/hergent-erp/erp.db'


def one(sql, params=()):
    """⚠️ 必须在函数内取完行再关连接 —— 返回 cursor 会在关库后炸。"""
    c = sqlite3.connect(DB)
    try:
        rows = c.execute(sql, params).fetchall()
        c.commit()
        return rows
    finally:
        c.close()


def counts():
    s = one("SELECT COUNT(*) FROM sessions")[0][0]
    u = one("SELECT COUNT(*) FROM users")[0][0]
    return s, u


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'count'
    if cmd == 'insert':
        tok = sys.argv[2] if len(sys.argv) > 2 else ('sbxui-' + secrets.token_hex(8))
        s0, u0 = counts()
        one("INSERT INTO sessions (token,user_id,expires_at) "
            "VALUES (?,?,datetime('now','+2 hours','localtime'))", (tok, 1))
        s1, u1 = counts()
        print('插入前 sessions=%d users=%d' % (s0, u0))
        print('插入后 sessions=%d users=%d' % (s1, u1))
        print('TOKEN=%s' % tok)
        assert s1 == s0 + 1 and u1 == u0, '插入未生效或多写了 users'
    elif cmd == 'delete':
        tok = sys.argv[2]
        n = one("SELECT COUNT(*) FROM sessions WHERE token=?", (tok,))[0][0]
        one("DELETE FROM sessions WHERE token=?", (tok,))
        s, u = counts()
        print('删除令牌 %s：命中 %d 行；删除后 sessions=%d users=%d' % (tok, n, s, u))
        assert n == 1 and one("SELECT COUNT(*) FROM sessions WHERE token=?", (tok,))[0][0] == 0, \
            '令牌未删净'
    else:
        s, u = counts()
        print('sessions=%d users=%d' % (s, u))


if __name__ == '__main__':
    main()
