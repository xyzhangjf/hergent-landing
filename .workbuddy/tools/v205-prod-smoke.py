#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P0（权限表按租户分叉）+ P1（`payroll` 窄模块）+ v205（工资条读端）—— **生产真机冒烟**。

## 为什么不能只靠影子库

影子库证明了「换租户头返回不同」「会计拿不到银行账号」。但影子库跑的是**副本**，
它证明不了三件事：

1. 生产进程真的加载了新代码（`__pycache__` / 半途中断的 scp / 进错子目录都会让服务照常 200）；
2. 生产**真实数据**下的判据成立 —— 生产 `tenant_1.db` 里有一个自定义角色 **`库管`**，
   而 `tenant_10.db` / `tenant_9.db` / 主库都没有。**修复前**（权限表全平台一份，
   且读 `/api/*` 恒落主库）每个租户的老板都会看到 `库管` ⇒ 这一条是零写入的决定性判据；
3. 真实 RBAC 中间件（不是 TestClient 里的那份）在同一令牌换租户头时的裁决。

## 两段，风险等级不同

* **第一段 · 零写入**：只读 `/api/role-permissions`，两个租户的 boss 各读一次。
* **第二段 · 可逆写入**：造一个临时角色 `_smoke_v205`（只含 `payroll`）+ 一个临时账号，
  验证「能算工资、不能看身份证/银行」这条边界，然后**全部回收**。
  临时账号的 `password_hash` 写死 `!disabled!`（不可登录），只有临时 session 能用。

## 零残留判据

写前记基线行数（`users`/`user_tenants`/`sessions` + 四个库的 `role_permissions` 行数），
收尾逐项比对回基线；并断言 `_smoke_v205` 这个名字在**任何**库里都不再出现。

用法（生产上以 hergent 身份跑）：
    runuser -u hergent -- python3 /tmp/v205-prod-smoke.py
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

TID_A, TID_B = 1, 10                    # tenant_1 有自定义角色「库管」；tenant_10 没有
UID_A, UID_B = 2, 4                     # boss / demo_boss（生产实际账号）
UID_SALES = 5                           # mptest（生产实际 sales 账号，绑 tenant_1）
ROLE_SMOKE = '_smoke_v205'
UID_SMOKE = 9993
CUSTOM_MARK = '库管'                     # 生产已存在的自定义角色名（第一段的判据）

TOK_A, TOK_B, TOK_S = ('smkv205_a_7f3c91', 'smkv205_b_2d8e04', 'smkv205_s_5b17a2')
TOK_SALES = 'smkv205_sl_9a2c40'
TOKS = (TOK_A, TOK_B, TOK_S, TOK_SALES)

# 无条件禁代理：本机/服务器 HTTP_PROXY 会劫持**回环**请求 → 502，看起来完全像"服务挂了"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

P, F, NOTES = [], [], []


def ok(name, cond, detail=''):
    (P if cond else F).append(name)
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))
    return cond


def note(msg):
    NOTES.append(msg)
    print('  NOTE  ' + msg)


def call(tok, tid, method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method.upper())
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req.data = data
        req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer ' + tok)
    if tid:
        req.add_header('X-Tenant-Id', str(tid))
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:                       # 连接层失败要显式暴露，别当成 4xx
        return -1, 'CONNECT_FAIL: %r' % (e,)


def q(sql, path=MASTER, args=()):
    c = sqlite3.connect(path)
    try:
        return c.execute(sql, args).fetchall()
    finally:
        c.close()


def ph(seq):
    """占位符串。🔴 **必须由 `len(seq)` 现算**，不要手写 `(?,?,?)` ——
    本轮真实踩坑：给 `TOKS` 加了第 4 个 token（sales 对断）却忘了同步手写的 `(?,?,?)`，
    `sqlite3.ProgrammingError: Incorrect number of bindings supplied` 让 cleanup 在
    **第一条 DELETE 就崩**，四项残留全留在生产，只能另写一个回收脚本救。
    → 冒烟/回收这类脚本，**setup 与 cleanup 必须共用同一个数据结构**。"""
    return ','.join('?' * len(seq))


def count(sql, path=MASTER, args=()):
    try:
        return q(sql, path, args)[0][0]
    except Exception:
        return None


def rp_rows():
    """四个库的 role_permissions 行数 + 角色名集合（收尾比基线用）。"""
    out = {}
    for f in ['erp.db'] + sorted(os.path.basename(x) for x in glob.glob(os.path.join(PROD, 'tenant_*.db'))):
        p = os.path.join(PROD, f)
        try:
            out[f] = sorted(r[0] for r in q('SELECT role_name FROM role_permissions', p))
        except Exception:
            out[f] = None
    return out


def baseline():
    return {
        'users': count('SELECT COUNT(*) FROM users'),
        'user_tenants': count('SELECT COUNT(*) FROM user_tenants'),
        'sessions': count('SELECT COUNT(*) FROM sessions'),
        'rp': rp_rows(),
    }


def make_sessions():
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    exp = (datetime.datetime.now() + datetime.timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')
    c = sqlite3.connect(MASTER)
    try:
        for tok, uid in ((TOK_A, UID_A), (TOK_B, UID_B), (TOK_SALES, UID_SALES)):
            # `INSERT OR REPLACE`：上一轮若中途崩过，同一 token 会撞 UNIQUE 约束
            c.execute('INSERT OR REPLACE INTO sessions(token,user_id,created_at,expires_at) '
                      'VALUES(?,?,?,?)', (tok, uid, now, exp))
        c.commit()
    finally:
        c.close()
    return now, exp


def make_smoke_identity(now, exp):
    """临时角色走**真实写接口**（顺带验写路径落点）；临时账号只能直插库
    （`core.normalize_role` 白名单会拒掉 `_smoke_v205` 这种名字，这正是它的用途）。"""
    s, b = call(TOK_A, TID_A, 'post', '/api/role-permissions',
                {'role_name': ROLE_SMOKE, 'permissions': ['payroll']})
    ok('W1  用真实接口在 tenant_1 建临时角色 `payroll`', s == 200, 'status=%s' % s)
    hit_t1 = count("SELECT COUNT(*) FROM role_permissions WHERE role_name=?",
                   os.path.join(PROD, 'tenant_1.db'), (ROLE_SMOKE,))
    hit_master = count("SELECT COUNT(*) FROM role_permissions WHERE role_name=?", MASTER, (ROLE_SMOKE,))
    ok('W2  🔴 落在 tenant_1.db（P0 的写端判据）', hit_t1 == 1, 'tenant_1 命中 %s' % hit_t1)
    ok('W3  🔴 **没有**落进主库 erp.db', hit_master == 0, '主库命中 %s' % hit_master)

    c = sqlite3.connect(MASTER)
    try:
        c.execute("INSERT OR REPLACE INTO users(id,username,password_hash,display_name,role,is_active,created_at) "
                  "VALUES(?,?,?,?,?,1,?)",
                  (UID_SMOKE, '_smoke_v205_acct', '!disabled!', '冒烟账号', ROLE_SMOKE, now))
        c.execute("INSERT OR REPLACE INTO user_tenants(user_id,tenant_id,role,created_at) VALUES(?,?,?,?)",
                  (UID_SMOKE, TID_A, 'member', now))
        c.execute('INSERT OR REPLACE INTO sessions(token,user_id,created_at,expires_at) '
                  'VALUES(?,?,?,?)', (TOK_S, UID_SMOKE, now, exp))
        c.commit()
    finally:
        c.close()


def cleanup():
    """回收：接口删角色 + 直删临时账号/session。"""
    s, _ = call(TOK_A, TID_A, 'delete', '/api/role-permissions/' + ROLE_SMOKE)
    c = sqlite3.connect(MASTER)
    try:
        c.execute('DELETE FROM sessions WHERE token IN (%s)' % ph(TOKS), TOKS)
        c.execute('DELETE FROM user_tenants WHERE user_id=?', (UID_SMOKE,))
        c.execute('DELETE FROM users WHERE id=?', (UID_SMOKE,))
        c.commit()
    finally:
        c.close()
    return s


def main():
    print('=' * 72)
    print('生产真机冒烟 —— P0 权限表按租户分叉 / P1 payroll 窄模块 / v205 工资条读端')
    print('=' * 72)
    print('  NOTE  探测目标 %s；库目录 %s' % (BASE, PROD))
    base = baseline()
    note('基线：users=%s user_tenants=%s sessions=%s' %
         (base['users'], base['user_tenants'], base['sessions']))
    now_exp = make_sessions()

    try:
        # ── 第一段：零写入 ────────────────────────────────────────────────
        print('')
        print('-' * 72)
        print('第一段 · 零写入：同一接口换租户头')
        print('-' * 72)
        sa, ba = call(TOK_A, TID_A, 'get', '/api/role-permissions')
        sb, bb = call(TOK_B, TID_B, 'get', '/api/role-permissions')
        ra = json.loads(ba).get('roles', {}) if sa == 200 else {}
        rb = json.loads(bb).get('roles', {}) if sb == 200 else {}
        ok('P1  tenant_1 的 boss 读权限表 200', sa == 200, 'status=%s' % sa)
        ok('P2  tenant_10 的 demo_boss 读权限表 200', sb == 200, 'status=%s' % sb)
        ok('P3  tenant_1 能看到自己的自定义角色「%s」' % CUSTOM_MARK, CUSTOM_MARK in ra,
           '角色集=%s' % sorted(ra))
        ok('P4  🔴 tenant_10 **看不到** tenant_1 的「%s」（修复前必然看得到）' % CUSTOM_MARK,
           CUSTOM_MARK not in rb, '角色集=%s' % sorted(rb))
        ok('P5  🔴 两份返回确实不同（不再是「逐字相同」）', ba != bb,
           'tenant_1=%d 字节 / tenant_10=%d 字节' % (len(ba), len(bb)))
        ok('P6  返回体带 tenant_id 且各自正确',
           json.loads(ba).get('tenant_id') == TID_A and json.loads(bb).get('tenant_id') == TID_B,
           'a=%s b=%s' % (json.loads(ba).get('tenant_id'), json.loads(bb).get('tenant_id')))
        # 不带租户头：要么 fail-closed 400，要么中间件已按归属解析出 tenant_1 ——
        # **唯独不允许**“悄悄读写主库那份”。
        s_none, b_none = call(TOK_A, None, 'get', '/api/role-permissions')
        if s_none == 200:
            same_as_a = b_none == ba
            ok('P7  不带 X-Tenant-Id → 200 且内容 == tenant_1 那份（中间件按归属解析，没回主库）',
               same_as_a, 'status=200 tenant_id=%s' % json.loads(b_none).get('tenant_id'))
        else:
            ok('P7  不带 X-Tenant-Id → 明确拒绝（fail-closed，不回落主库）',
               s_none == 400, 'status=%s body=%s' % (s_none, b_none[:90]))
        s_m, b_m = call(TOK_A, TID_A, 'get', '/api/permissions/modules')
        mods = {m.get('id'): m.get('label') for m in json.loads(b_m).get('modules', [])} if s_m == 200 else {}
        ok('P8  🔴 权限页的模块清单里已有 `payroll`，且中文名是中文（不是英文原样）',
           mods.get('payroll') == '算工资', 'status=%s payroll=%r' % (s_m, mods.get('payroll')))
        # P9 🔴 豁免的只是**模块判定**，不是整个访问控制 —— 真实的 sales 账号必须读不到
        # （`_admin` 按角色名把关；原实现由 `hr` 模块拦着，豁免若不补角色闸 = 读权限被放大）
        s, _ = call(TOK_SALES, TID_A, 'get', '/api/role-permissions')
        ok('P9  🔴 真实 sales 账号（mptest）读权限表 403，不是 200', s == 403, 'status=%s' % s)
        s, _ = call(TOK_SALES, TID_A, 'get', '/api/role-permissions/detail')
        ok('P9b 🔴 sales 读 CRUD 明细也 403', s == 403, 'status=%s' % s)
        # ⚠️ POST/DELETE 上 CSRF 中间件先于端点鉴权（未登录也 403），所以**单看状态码**
        # 证明不了"是 `_admin` 挡的"。真正的判据是**零副作用**：任何库里都不许出现这个名字。
        s, _ = call(TOK_SALES, TID_A, 'post', '/api/role-permissions',
                    {'role_name': '_smoke_evil', 'permissions': ['hr']})
        hit_evil = [f for f, roles in rp_rows().items() if roles and '_smoke_evil' in roles]
        ok('P9c 🔴 sales 写权限表被拒且**零副作用**', s == 403 and not hit_evil,
           'status=%s 残留=%s' % (s, hit_evil))

        # ── 第二段：可逆写入 ──────────────────────────────────────────────
        print('')
        print('-' * 72)
        print('第二段 · 可逆写入：payroll 窄模块的边界（能算工资 / 看不到实名与银行）')
        print('-' * 72)
        now, exp = now_exp
        make_smoke_identity(now, exp)

        s, b = call(TOK_S, TID_A, 'get', '/api/payroll-workflow/recipe')
        ok('B1  🔴 只给 `payroll` 的账号**能**算工资', s == 200, 'status=%s' % s)
        s, b = call(TOK_S, TID_A, 'get', '/api/salary-details?month=2026-09')
        ok('B2  也能读工资明细（`payroll`）', s == 200, 'status=%s' % s)
        for path in ('/api/employees', '/api/payroll/bank-file', '/api/salary-bank-file'):
            s, _ = call(TOK_S, TID_A, 'get', path)
            ok('B3  🔴 %-26s 403（无 `hr` ⇒ 拿不到身份证/银行账号）' % path, s == 403,
               'status=%s' % s)
        s, b = call(TOK_S, TID_A, 'post', '/api/salary-send/preview/1',
                    {'month': '2026-09', 'channel': 'wechat'})
        ok('B4  🔴 v205 修复：工资条预览不再是 500', s == 200,
           'status=%s body=%s' % (s, b[:120]))
        # 对照组：boss 有 hr，三个入口必须都能通（否则 B3 的 403 可能是"路径根本不存在"）
        for path in ('/api/employees', '/api/payroll/bank-file'):
            s, _ = call(TOK_A, TID_A, 'get', path)
            ok('B5  对照组 · boss 有 `hr`，%-24s 200' % path, s == 200, 'status=%s' % s)
        s, b = call(TOK_A, TID_A, 'get', '/api/payroll-workflow/recipe')
        ok('B6  对照组 · boss 同时有 `payroll`（新模块没把老板自己挡在外面）', s == 200,
           'status=%s' % s)

    finally:
        print('')
        print('-' * 72)
        print('收尾 · 零残留')
        print('-' * 72)
        sc = cleanup()
        ok('C1  接口删除临时角色 200', sc == 200, 'status=%s' % sc)
        left_rp = []
        for f, roles in rp_rows().items():
            if roles and ROLE_SMOKE in roles:
                left_rp.append(f)
        ok('C2  🔴 任何库里都不再有 `%s`' % ROLE_SMOKE, not left_rp, '残留：%s' % left_rp)
        ok('C3  临时账号已删除',
           count('SELECT COUNT(*) FROM users WHERE id=?', MASTER, (UID_SMOKE,)) == 0)
        ok('C4  临时成员关系已删除',
           count('SELECT COUNT(*) FROM user_tenants WHERE user_id=?', MASTER, (UID_SMOKE,)) == 0)
        ok('C5  临时 session 已删除',
           count('SELECT COUNT(*) FROM sessions WHERE token IN (%s)' % ph(TOKS), MASTER, TOKS) == 0)
        after = baseline()
        for k in ('users', 'user_tenants', 'sessions'):
            ok('C6  %-12s 回到基线（%s）' % (k, base[k]), after[k] == base[k],
               '现=%s 基线=%s' % (after[k], base[k]))
        ok('C7  🔴 四个库的角色清单逐字回到基线', after['rp'] == base['rp'],
           '差异=%s' % ([k for k in after['rp'] if after['rp'][k] != base['rp'].get(k)] or '无'))

    print('')
    print('-' * 72)
    print('生产冒烟：%d/%d 通过' % (len(P), len(P) + len(F)))
    if F:
        print('失败项:')
        for x in F:
            print('   - ' + x)
    return 1 if F else 0


if __name__ == '__main__':
    sys.exit(main())
