#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v205 生产冒烟 —— **一次性残留回收**。

## 为什么要单独写一个

`v205-prod-smoke.py` 给 `sessions` 加了第 4 个 token（sales 对断）时，忘了同步
`DELETE ... IN (?,?,?)` 的占位符个数 ⇒ `sqlite3.ProgrammingError: Incorrect number of
bindings supplied` ⇒ **cleanup 在第一条 DELETE 就崩了，四项残留全部留在生产**：
4 个 session、临时账号 9993、它的成员关系、以及 tenant_1.db 里的角色 `_smoke_v205`。

⚠️ 教训（值得记进技能）：**冒烟脚本的 cleanup 必须与 setup 用同一个数据结构**（这里就是
`TOKS`），不要在两处各写一遍占位符。清理路径的回归是最贵的 —— 它失败时没有第二次机会。

## 回收顺序（角色走真实接口，为的是顺带 `reload_perms`）

角色若直接 `DELETE FROM role_permissions` 删掉，**运行中的服务内存缓存里还留着它**
（`_PERMS_CACHE[1]`），那是一条看不见的残留。走 `DELETE /api/role-permissions/<name>`
才会调 `reload_perms(tid)` 把该租户缓存失效。

用法：`runuser -u hergent -- python3 /tmp/v205-prod-cleanup.py`
"""
import datetime
import glob
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

PROD = '/opt/hergent-erp'
MASTER = os.path.join(PROD, 'erp.db')
BASE = 'http://127.0.0.1:8700'

TOKS = ('smkv205_a_7f3c91', 'smkv205_b_2d8e04', 'smkv205_s_5b17a2', 'smkv205_sl_9a2c40')
UID_SMOKE = 9993
ROLE_SMOKE = '_smoke_v205'
UID_BOSS = 2
TOK_CLEAN = 'smkv205_cl_1e6b73'

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(tok, tid, method, path):
    req = urllib.request.Request(BASE + path, method=method.upper())
    req.add_header('Authorization', 'Bearer ' + tok)
    if tid:
        req.add_header('X-Tenant-Id', str(tid))
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return -1, 'CONNECT_FAIL: %r' % (e,)


def rp_rows():
    out = {}
    for f in ['erp.db'] + sorted(os.path.basename(x) for x in glob.glob(os.path.join(PROD, 'tenant_*.db'))):
        p = os.path.join(PROD, f)
        try:
            out[f] = sorted(r[0] for r in sqlite3.connect(p).execute('SELECT role_name FROM role_permissions'))
        except Exception:
            out[f] = None
    return out


P, F = [], []


def ok(name, cond, detail=''):
    (P if cond else F).append(name)
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))


def main():
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    exp = (datetime.datetime.now() + datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')

    # 🔴 幂等：本脚本自己也要用一个 session（走接口删角色），而 `sessions.token` 有 UNIQUE 约束
    # ⇒ 重跑时裸 INSERT 会 `IntegrityError`。先 `INSERT OR REPLACE` 清出干净的一行。
    # 🔴 另一条同类教训：**基线必须在插入自己的 session 之后读** ——
    # 第一版 pre/post 两次读数之间夹了一次自己的 INSERT，却没减掉，R1 直接假 FAIL（现=2）。
    c = sqlite3.connect(MASTER)
    c.execute('INSERT OR REPLACE INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)',
              (TOK_CLEAN, UID_BOSS, now, exp))
    c.commit()
    c.close()

    print('=' * 72)
    print('回收前状态')
    print('=' * 72)
    c = sqlite3.connect(MASTER)
    pre = {
        'users': c.execute('SELECT COUNT(*) FROM users').fetchone()[0],
        'user_tenants': c.execute('SELECT COUNT(*) FROM user_tenants').fetchone()[0],
        'sessions': c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],
        'left_sessions': c.execute('SELECT COUNT(*) FROM sessions WHERE token IN (%s)'
                                   % ','.join('?' * len(TOKS)), TOKS).fetchone()[0],
    }
    c.close()
    pre_rp = rp_rows()
    print('  users=%s user_tenants=%s sessions=%s（含回收脚本自己的 1 条；本轮残留 session %s 条）'
          % (pre['users'], pre['user_tenants'], pre['sessions'], pre['left_sessions']))
    print('  tenant_1 角色：%s' % pre_rp.get('tenant_1.db'))
    print('')

    # ① 角色走真实接口（顺带 reload_perms 失效租户缓存）
    s, b = call(TOK_CLEAN, 1, 'delete', '/api/role-permissions/' + ROLE_SMOKE)
    print('  ① DELETE /api/role-permissions/%s → %s %s' % (ROLE_SMOKE, s, b[:80]))

    # ② 直删临时账号/成员关系/session
    c = sqlite3.connect(MASTER)
    try:
        n_s = c.execute('DELETE FROM sessions WHERE token IN (%s)' % ','.join('?' * len(TOKS)),
                        TOKS).rowcount
        n_ut = c.execute('DELETE FROM user_tenants WHERE user_id=?', (UID_SMOKE,)).rowcount
        n_u = c.execute('DELETE FROM users WHERE id=?', (UID_SMOKE,)).rowcount
        c.commit()
    finally:
        c.close()
    print('  ② 直删 session=%d 条 / user_tenants=%d 条 / users=%d 条' % (n_s, n_ut, n_u))
    print('')

    print('=' * 72)
    print('回收后零残留核对')
    print('=' * 72)
    c = sqlite3.connect(MASTER)
    post = {
        'users': c.execute('SELECT COUNT(*) FROM users').fetchone()[0],
        'user_tenants': c.execute('SELECT COUNT(*) FROM user_tenants').fetchone()[0],
        'sessions': c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],
    }
    c.close()
    post_rp = rp_rows()
    # 🔴 断言要写**绝对不变量**（"不存在"），不要写相对量（"比 pre 少 1"）——
    # 相对量在第二次（幂等）运行时会假 FAIL：账号第一次就删掉了，无从再减。
    # 第一版三条（R1/R2/R3）都写成了相对量，重跑时 R2/R3 直接假 FAIL。
    c2 = sqlite3.connect(MASTER)
    n_left_sess = c2.execute('SELECT COUNT(*) FROM sessions WHERE token IN (%s)'
                             % ','.join('?' * len(TOKS)), TOKS).fetchone()[0]
    n_left_user = c2.execute('SELECT COUNT(*) FROM users WHERE id=? OR username=?',
                             (UID_SMOKE, '_smoke_v205_acct')).fetchone()[0]
    n_left_ut = c2.execute('SELECT COUNT(*) FROM user_tenants WHERE user_id=?',
                           (UID_SMOKE,)).fetchone()[0]
    c2.close()
    ok('R1  本轮临时 session 一条不剩', n_left_sess == 0, '残留 %d 条' % n_left_sess)
    ok('R2  临时账号不存在（按 id 与 username 双查）', n_left_user == 0, '残留 %d 行' % n_left_user)
    ok('R3  临时成员关系不存在', n_left_ut == 0, '残留 %d 行' % n_left_ut)
    ok('R3b 总分账：users/user_tenants 与回收前一致（回收是幂等的，前后都不该动）',
       post['users'] == pre['users'] and post['user_tenants'] == pre['user_tenants'],
       'users %s→%s user_tenants %s→%s'
       % (pre['users'], post['users'], pre['user_tenants'], post['user_tenants']))
    left = [f for f, r in post_rp.items() if r and ROLE_SMOKE in r]
    ok('R4  🔴 任何库里都不再有 `%s`' % ROLE_SMOKE, not left, '残留：%s' % left)
    ok('R5  没有 `_smoke_evil` 之类越权写入的痕迹',
       not [f for f, r in post_rp.items() if r and '_smoke_evil' in r])
    ok('R6  tenant_1 角色清单回到「只有库管」',
       post_rp.get('tenant_1.db') == ['supervisor', '库管'],
       '现=%s' % post_rp.get('tenant_1.db'))
    ok('R7  主库 role_permissions 未被写入',
       post_rp.get('erp.db') == ['supervisor'], '现=%s' % post_rp.get('erp.db'))

    # 缓存里也不能留：走接口删过 ⇒ 已 reload；再用 boss 读一次确认角色集不含它
    s, b = call(TOK_CLEAN, 1, 'get', '/api/role-permissions')
    roles = sorted(json.loads(b).get('roles', {})) if s == 200 else []
    ok('R8  🔴 运行中服务的租户缓存里也没有它（读接口回读角色集）', s == 200 and ROLE_SMOKE not in roles,
       'status=%s 角色集=%s' % (s, roles))
    c = sqlite3.connect(MASTER)
    c.execute('DELETE FROM sessions WHERE token=?', (TOK_CLEAN,))
    c.commit()
    c.close()
    ok('R9  回收用的临时 session 也已删除',
       sqlite3.connect(MASTER).execute('SELECT COUNT(*) FROM sessions WHERE token=?',
                                       (TOK_CLEAN,)).fetchone()[0] == 0)

    print('')
    print('-' * 72)
    print('回收：%d/%d 通过' % (len(P), len(P) + len(F)))
    if F:
        for x in F:
            print('   - ' + x)
    return 1 if F else 0


if __name__ == '__main__':
    sys.exit(main())
