#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""丁（角色白名单）生产真机验证 —— 走**真实 HTTP 接口**，零业务写入。

做法：临时插一条 sessions 令牌（user=admin）→ 打 4 个请求 → 删令牌 → 回读三张表证明零残留。
所有用例都设计成「被拒绝」或「幂等（supervisor→supervisor）」，不改任何业务数据。
"""
import json
import secrets
import sqlite3
import sys
import urllib.error
import urllib.request

DB = '/opt/hergent-erp/erp.db'
BASE = 'http://127.0.0.1:8700'
TOKEN = 'sbxrolechk-' + secrets.token_hex(8)

results = []


def db(sql, params=()):
    """⚠️ 必须**在函数内取完行**再关连接 —— 返回 cursor 会在 finally 关库后炸
    `Cannot operate on a closed database`（2026-09-19 踩过一次）。"""
    c = sqlite3.connect(DB)
    try:
        rows = c.execute(sql, params).fetchall()
        c.commit()
        return rows
    finally:
        c.close()


def api(method, path, body=None):
    req = urllib.request.Request(
        BASE + path, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def ck(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))


u_before = db("SELECT id,username,role,is_active FROM users ORDER BY id")
s_before = db("SELECT COUNT(*) FROM sessions")[0][0]
print('基线：users=%d 行, sessions=%d 行' % (len(u_before), s_before))
print('')

db("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+2 hours','localtime'))",
   (TOKEN, 1))

try:
    st, body = api('PUT', '/api/users/5/role', {'role': 'promoter'})
    ck('A 改角色为后端不存在的 promoter → 400', st == 400, 'HTTP %s  %s' % (st, body[:130]))

    st, body = api('PUT', '/api/users/5/role', {'role': ''})
    ck('B 空角色 → 400「角色不能为空」', st == 400 and '不能为空' in body, 'HTTP %s  %s' % (st, body[:90]))

    st, body = api('PUT', '/api/users/6/role', {'role': 'supervisor'})
    ck('C 合法角色 supervisor 放行 → 200（幂等，值未变）', st == 200, 'HTTP %s  %s' % (st, body[:90]))

    st, body = api('POST', '/api/forecast-submissions/staff-accounts',
                   {'employee_id': 1, 'username': 'sbxrolechk_x', 'password': 'Abcd1234',
                    'display_name': 'x', 'role': 'admin'})
    # ⚠️ 注意本用例的断言语义：`admin` 是**合法角色名**，白名单本就不该拦它。
    #    这条要证的是「白名单不误伤合法值」—— 所以期望的是**穿过白名单、抵达后续业务校验**
    #    （员工 1 已有关联账号 ⇒ 返回该提示），而不是 400。
    ck('D 合法角色不被白名单误伤（穿闸 → 抵达后续「已有关联账号」校验）',
       st == 200 and '已有关联账号' in body, 'HTTP %s  %s' % (st, body[:150]))
    print('  NOTE  「白名单」只关掉「写进任意角色名」，**不**阻止 admin/boss 给别人派 admin ——')
    print('        那需要一条策略（谁能派全权限角色），属业务决定，本轮未替用户拍板。')

    st, body = api('POST', '/api/forecast-submissions/staff-accounts',
                   {'employee_id': 1, 'username': 'sbxrolechk_x', 'password': 'Abcd1234',
                    'display_name': 'x', 'role': 'promoter'})
    ck('E 开账号时传后端不存在的 promoter 被拒 → 400', st == 400, 'HTTP %s  %s' % (st, body[:150]))
finally:
    db("DELETE FROM sessions WHERE token=?", (TOKEN,))

u_after = db("SELECT id,username,role,is_active FROM users ORDER BY id")
s_after = db("SELECT COUNT(*) FROM sessions")[0][0]
ck('F 全部用户 role 一字未变', u_before == u_after,
   '变了: %s' % [x for x in u_after if x not in u_before] if u_before != u_after else '')
ck('G 临时会话已删（零残留）', s_after == s_before, 'sessions %d → %d' % (s_before, s_after))
ck('H 没有凭空多出账号', not db("SELECT 1 FROM users WHERE username LIKE 'sbxrolechk%'"))
ck('I 临时令牌已失效', api('GET', '/api/auth/me')[0] == 401)

print('')
print('-' * 62)
ok_n = sum(1 for _, ok, _ in results if ok)
print('真机断言 %d/%d 通过' % (ok_n, len(results)))
sys.exit(0 if ok_n == len(results) else 1)
