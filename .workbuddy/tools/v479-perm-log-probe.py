#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v479-perm-log-probe.py —— 「操作日志」模块（角色权限页「日志」按钮）后端验收探针。

本版把 v475 的「页脚最近 30 条」升级成独立日志模块，探针据此覆盖**新增的那部分**：

  S1 范围白名单：登录/登出/改密码/自助注册等会话与自助事件**不进日志**
     （生产实测 266 行 auth 里 256 行是这类噪音 —— 不拦=日志里找不到权限变更）；
     A/B 自证：同一份库，"老口径（module='auth' 全量）"与"新口径"行数差异巨大。
  S2 类型归一：12 类操作各自的标签/对象类别；**老格式行**（"修改角色 42 -> x"）
     仍能归进账号角色变更（前缀兼容，不许丢历史）。
  S3 🔴 主库联合：`/api/users/*` 的审计落在**主库**（生产实证），日志必须联合查询；
     且必须按 user_tenants 收窄 —— **别租户账号的变更一条都不过来看**（反例自证）。
  S4 筛选：操作人/类型/对象/关键词/起止日期（边界含当天）/组合 + 负对照。
  S5 分页与总量：翻页拼回全量 = 一次取的总数；类型计数不含类型筛选本身。
  S6 端点层：坏日期 400、坏类型 400、limit 钳制、响应结构。
  S7 真实写路径闭环：6 类写端点各产生恰好 1 条、内容含"改前 → 改后"；
     含**员工换角色**（走主库的那条端到端路径）。
  S8 排序：时间倒序；同秒稳定。

🔴 纪律（沿用 v475）：影子库**每轮从生产重拉**（ssh tar，只读），全部写落在 /tmp；
   探针自建角色/账号，不碰真实角色行；判别力自证（换个写法结论必须不同）。

用法：
    cd /Users/zhangjunfeng/Documents/hergent-erp/server && \
    ERP_DB_PATH=/tmp/hgv479/erp.db ERP_SECRET=$(python3 -c "print('x'*64)") \
    DEEPSEEK_API_KEY=probe-dummy HERMES_GATEWAY_KEY=probe-dummy \
    /usr/bin/python3 .workbuddy/tools/v479-perm-log-probe.py
"""
import os
import sys
import sqlite3
import asyncio
import subprocess

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
SHADOW = '/tmp/hgv479'
PROBE_ROLE = '日志探针角'
PROBE_ROLE2 = '日志探针角二'
PROBE_USER = '探针员工甲'
sys.path.insert(0, SRV)

os.environ['ERP_DB_PATH'] = os.path.join(SHADOW, 'erp.db')
os.environ.setdefault('ERP_SECRET', 'x' * 64)
os.environ.setdefault('DEEPSEEK_API_KEY', 'probe-dummy')
os.environ.setdefault('HERMES_GATEWAY_KEY', 'probe-dummy')

MASTER = os.path.join(SHADOW, 'erp.db')
TENANT = os.path.join(SHADOW, 'tenant_1.db')
P = [0, 0]


def chk(cond, name, detail=''):
    if cond:
        P[0] += 1
        print('  OK  %s%s' % (name, ('  -> ' + str(detail)) if detail != '' else ''))
    else:
        P[1] += 1
        print('  NG  %s%s' % (name, ('  -> ' + str(detail)) if detail != '' else ''))


def sec(t):
    print('\n' + '=' * 74)
    print('== %s' % t)
    print('=' * 74)


def pull_shadow():
    subprocess.run(['rm', '-rf', SHADOW], check=False)
    os.makedirs(SHADOW, exist_ok=True)
    cmd = ['ssh', '-o', 'ConnectTimeout=30', 'root@47.113.224.140',
           'cd /opt/hergent-erp && tar cf - erp.db tenant_1.db 2>/dev/null']
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    dump = os.path.join(SHADOW, '_dump.tar')
    with open(dump, 'wb') as f:
        f.write(p.stdout)
    subprocess.run(['tar', 'xf', dump, '-C', SHADOW], check=False)
    os.remove(dump)


class FakeReq(object):
    def __init__(self, payload=None):
        self._payload = payload if payload is not None else {}

    async def json(self):
        return self._payload


# ══════════════════════════════════════════════════════════════════════════
sec('S0 准备：重拉生产只读副本 + 接上应用')
# ══════════════════════════════════════════════════════════════════════════
pull_shadow()
chk(os.path.getsize(TENANT) > 1024 * 100, '影子库就位（每轮重拉；生产只读 tar）',
    '%d MB' % (os.path.getsize(TENANT) // 1024 // 1024))

import server                       # noqa: E402
import core                         # noqa: E402
import erp_db                       # noqa: E402
import perm_guard                   # noqa: E402
import db.connection as conn_mod    # noqa: E402
from fastapi import HTTPException   # noqa: E402

core._admin = lambda request: {'id': 1, 'username': 'boss', 'display_name': '老板', 'role': 'boss'}
conn_mod.set_tenant_context(1)
loop = asyncio.get_event_loop()


def master_exec(sql, args=()):
    con = sqlite3.connect(MASTER)
    try:
        con.execute(sql, args)
        con.commit()
    finally:
        con.close()


def seed_audit(user, action, ref_id='', detail='', at=None):
    """经**真实写入口** `db.audit_log` 落一行（哈希链保持一致），必要时再改显示时间。

    ⚠️ created_at 不在哈希链 payload 里（payload = user|action|module|ref_id|detail|prev）
       ⇒ 事后改 created_at **不会**破坏链，可安全用于日期筛选用例。
    """
    erp_db.audit_log(user, action, 'auth', ref_id, detail)
    if at:
        con = sqlite3.connect(TENANT)
        try:
            lid = con.execute('SELECT MAX(id) FROM audit_logs').fetchone()[0]
            con.execute('UPDATE audit_logs SET created_at=? WHERE id=?', (at, lid))
            con.commit()
        finally:
            con.close()


def seed_master_audit(user, action, ref_id='', detail=''):
    """主库侧播种：切到主库上下文走**同一个** `db.audit_log`（哈希链一致，不手写 INSERT）。"""
    prev = conn_mod.get_tenant_context()
    conn_mod.set_tenant_context(None)
    try:
        erp_db.audit_log(user, action, 'auth', ref_id, detail)
    finally:
        conn_mod.set_tenant_context(prev)


def log_rows(**kw):
    items, total, counts = perm_guard.perm_audit_rows(1, **kw)
    return items, total, counts


# ══════════════════════════════════════════════════════════════════════════
sec('S1 范围白名单：会话/自助噪音不进日志（生产真实数据 + 自种噪音）')
# ══════════════════════════════════════════════════════════════════════════
con = sqlite3.connect('file:%s?mode=ro' % TENANT, uri=True)
auth_total = con.execute("SELECT COUNT(*) FROM audit_logs WHERE module='auth'").fetchone()[0]
noise_in_prod = con.execute(
    "SELECT COUNT(*) FROM audit_logs WHERE module='auth' AND action NOT LIKE '登录成功%' "
    "AND action NOT LIKE '登出' AND action NOT LIKE '登录被拒%' AND action NOT LIKE '自助注册%' "
    "AND action NOT LIKE '重置密码失败%' AND action NOT LIKE '修改密码' "
    "AND action NOT LIKE '通过重置码%' AND action NOT LIKE '修改个人资料'").fetchone()[0]
con.close()
chk(auth_total >= 250, '生产租户库 auth 行数（噪音基底）', auth_total)

# A/B 自证（必须在**播种之前**取基线）：老口径 module='auth' 全量、按 id 倒序，
# 生产真实数据下前 3 条全是会话噪音 —— 这就是"必须换口径"的实证。
con0 = sqlite3.connect('file:%s?mode=ro' % TENANT, uri=True)
old_top = [r[0] for r in con0.execute(
    "SELECT action FROM audit_logs WHERE module='auth' ORDER BY id DESC LIMIT 3").fetchall()]
con0.close()
chk(any('登录成功' in a or a == '登出' for a in old_top),
    'A/B 自证：老口径的前 3 条是会话噪音（所以必须换口径）', old_top)

# 自种：每条噪音 + 每条白名单，各一行
for i, act in enumerate(['登录成功 (IP: 1.2.3.4)', '登出', '登录被拒：不允许从此端登录',
                         '自助注册: 噪音公司', '重置密码失败: 用户名或重置码不正确',
                         '修改密码', '通过重置码自助修改密码', '修改个人资料']):
    seed_audit('噪音人%d' % i, act, '2' if i % 2 else '')
# 白名单行（租户库侧）
seed_audit('探针甲', '保存角色权限（模块×动作）', PROBE_ROLE, '新增 1 项（hr.read）；取消 1 项（sales.delete）')
seed_audit('探针乙', '角色改名', PROBE_ROLE, '「%s」→「%s」，跟着改的账号 1 个（主角色 1 / 兼任 0）' % (PROBE_ROLE, PROBE_ROLE2))

items, total, counts = log_rows(limit=200)
acts = [r['action'] for r in items]
chk(all('登录成功' not in a and a not in ('登出', '修改密码', '修改个人资料')
        and '自助注册' not in a and '登录被拒' not in a and '重置密码失败' not in a
        and '通过重置码' not in a for a in acts),
    '自种 8 条噪音 + 生产 %d 条噪音，一条都不在日志里' % (auth_total - noise_in_prod))
chk(any(a.startswith('保存角色权限') for a in acts) and any(a == '角色改名' for a in acts),
    '白名单行（保存角色权限/角色改名）在日志里')
chk(not any('登录成功' in a or a == '登出' for a in acts[:3]),
    '新口径的前 3 条无会话噪音', acts[:3])

# ══════════════════════════════════════════════════════════════════════════
sec('S2 类型归一：12 类 + 老格式兼容')
# ══════════════════════════════════════════════════════════════════════════
cases = [
    ('保存角色权限（模块×动作）', 'perm_save', '保存角色权限', 'role'),
    ('保存角色权限（旧矩阵形态）', 'perm_save', '保存角色权限', 'role'),
    ('新建角色 库管（复制自 sales）', 'role_create', '新建角色', 'role'),
    ('角色改名', 'role_rename', '角色改名', 'role'),
    ('删除自定义角色', 'role_delete', '删除角色', 'role'),
    ('恢复内置角色默认权限', 'role_reset', '恢复默认', 'role'),
    ('改角色登录端', 'role_end', '登录端变更', 'role'),
    ('恢复角色登录端为默认', 'role_end', '登录端变更', 'role'),
    ('修改角色', 'user_role', '账号角色变更', 'account'),
    ('修改角色 999917 -> staff（兼任：sales）', 'user_role', '账号角色变更', 'account'),
    ('修改登录范围', 'user_scope', '登录范围变更', 'account'),
    ('修改登录账号 999900: a → b', 'user_rename', '账号改名', 'account'),
    ('生成重置码 -> sbx', 'reset_code', '生成重置码', 'account'),
    ('修改外部客户名称 5 -> 新名', 'ext_rename', '外部客户改名', 'account'),
    ('配置SAML SSO', 'sso', '登录方式配置', 'none'),
    ('配置LDAP', 'sso', '登录方式配置', 'none'),
    ('登录成功 (IP: x)', '', '其他变更', 'none'),
    ('把某人提升为终身老板', '', '其他变更', 'none'),
]
for act, key, label, kind in cases:
    got = perm_guard.perm_log_type_of(act)
    chk(got == key, 'type_of(%s) = %s' % (act[:22], key or '(不在范围)'), got or '(空)')
r = [x for x in log_rows(limit=200)[0] if x['action'].startswith('保存角色权限')]
chk(r and r[0]['type_label'] == '保存角色权限' and r[0]['target_kind'] == 'role'
    and r[0]['target'] == PROBE_ROLE,
    '行级归一：标签/对象类别/对象名都对', r[0] if r else None)

# ══════════════════════════════════════════════════════════════════════════
sec('S3 🔴 主库联合查询 + 跨租户隔离（反例自证）')
# ══════════════════════════════════════════════════════════════════════════
# 造两个账号：一个属租户 1（应可见），一个只属租户 10（应不可见）
def make_user(username, role, tenants):
    master_exec("INSERT INTO users (username, password_hash, role, roles, display_name) "
                "VALUES (?,?,?,?,?)", (username, 'x', role, '', '探针' + username))
    uid = sqlite3.connect(MASTER).execute(
        "SELECT id FROM users WHERE username=?", (username,)).fetchone()[0]
    for t in tenants:
        master_exec("INSERT OR IGNORE INTO user_tenants (user_id, tenant_id) VALUES (?,?)", (uid, t))
    return uid


uid_in = make_user(PROBE_USER, 'sales', [1])
uid_out = make_user('别租户员工', 'sales', [10])
# 主库侧两行：本租户账号（旧格式 ref_id=uid）+ 别租户账号
seed_master_audit('boss', '修改角色', str(uid_in), '「%s」：sales → accountant' % PROBE_USER)
seed_master_audit('boss', '修改角色', str(uid_out), '「别租户员工」：sales → accountant')
items, total, counts = log_rows(limit=200)
hits = [r for r in items if r['action'] == '修改角色' and r['src'] == 'master']
chk(any(r['target'] == str(uid_in) and r['detail'].startswith('「%s」' % PROBE_USER) for r in hits),
    '主库行（本租户账号，旧格式 ref_id=uid）出现在日志里', [h['target'] for h in hits])
chk(not any(r['detail'].startswith('「别租户员工」') for r in items),
    '🔴 反例：别租户账号的变更一条都不过来看（user_tenants 收窄生效）')
# 新格式（ref_id=用户名）也应命中 membership 的 username 分支
seed_master_audit('boss', '修改角色', PROBE_USER, '「%s」：accountant → warehouse' % PROBE_USER)
items, total, counts = log_rows(limit=200)
chk(any(r['src'] == 'master' and r['target'] == PROBE_USER and 'accountant → warehouse' in r['detail']
        for r in items), '主库行（新格式 ref_id=用户名）也命中')

# ══════════════════════════════════════════════════════════════════════════
sec('S4 筛选：各维度 + 负对照')
# ══════════════════════════════════════════════════════════════════════════
base_items, base_total, _ = log_rows(limit=500)
chk(base_total == len(base_items), 'total == 本页行数（一页装得下时）', base_total)

it, t, _ = log_rows(who='探针甲')
chk(t >= 1 and all('探针甲' == r['who'] for r in it), '按操作人筛（精确到人）', t)
it, t, _ = log_rows(who='不存在的老板')
chk(t == 0 and it == [], '负对照：操作人不存在 ⇒ 0 条', t)

it, t, _ = log_rows(type_key='role_rename')
chk(t >= 1 and all(r['type_key'] == 'role_rename' for r in it), '按操作类型筛', t)
it, t, _ = log_rows(type_key='user_role')
chk(t >= 3 and all(r['type_key'] == 'user_role' for r in it), '主库+租户的账号角色变更合在一起筛', t)

it, t, _ = log_rows(role=PROBE_ROLE)
chk(t >= 1 and all(PROBE_ROLE in r['target'] for r in it), '按变更对象筛（角色名部分匹配）', t)
it, t, _ = log_rows(role='绝不可能的角色名zzz')
chk(t == 0, '负对照：变更对象不存在 ⇒ 0 条', t)

it, t, _ = log_rows(keyword='绝不可能出现的关键字zzz')
chk(t == 0, '负对照：关键词不存在 ⇒ 0 条', t)
seed_audit('探针丙', '改角色登录端', PROBE_ROLE, '电脑端=开 手机端=关')
it, t, _ = log_rows(keyword='电脑端=开')
chk(t >= 1 and all('电脑端=开' in (r['detail'] + r['action']) for r in it), '按关键词筛（命中 detail）', t)
it, t, _ = log_rows(keyword='绝不可能出现的关键字zzz')
chk(t == 0, '负对照：关键词不存在 ⇒ 0 条', t)

# 日期边界：给两行钉死日期
seed_audit('探针丁', '保存角色权限（模块×动作）', PROBE_ROLE, '新增 1 项（hr.read）', at='2026-03-01 10:00:00')
seed_audit('探针戊', '保存角色权限（模块×动作）', PROBE_ROLE, '新增 1 项（hr.update）', at='2026-03-02 10:00:00')
it, t, _ = log_rows(date_from='2026-03-02')
chk(t >= 1 and all(r['at'] >= '2026-03-02' for r in it) and any(r['who'] == '探针戊' for r in it),
    'date_from 含当天（03-02 那条在）', t)
it, t, _ = log_rows(date_to='2026-03-01')
chk(t >= 1 and all(r['at'] < '2026-03-02' for r in it) and any(r['who'] == '探针丁' for r in it)
    and not any(r['who'] == '探针戊' for r in it), 'date_to 含当天、不含其后', t)
it, t, _ = log_rows(date_from='2026-03-01', date_to='2026-03-01', who='探针丁')
chk(t == 1 and it[0]['who'] == '探针丁', '组合筛（日期 + 操作人）', t)

# ══════════════════════════════════════════════════════════════════════════
sec('S5 分页 / 总量 / 类型计数')
# ══════════════════════════════════════════════════════════════════════════
# 再种 10 行同类型，凑足一页以上
for i in range(10):
    seed_audit('分页探针%d' % i, '新建角色 分页角色%d' % i, '分页角色%d' % i)
full, ftotal, fcounts = log_rows(limit=500)
chk(ftotal == len(full), 'limit=500 一页装下 ⇒ total == 行数', ftotal)
chk(ftotal >= 20, '种子行数足够测分页', ftotal)

p1, t1, _ = log_rows(limit=7, offset=0)
p2, t2, _ = log_rows(limit=7, offset=7)
p3, t3, _ = log_rows(limit=500, offset=14)
chk(t1 == t2 == t3 == ftotal, '三页的 total 一致（都是过滤后总量）', (t1, t2, t3))
chk(len(p1) == 7 and len(p2) == 7, '前两页各 7 条', (len(p1), len(p2)))
merged = p1 + p2 + p3
chk(len(merged) == ftotal, '翻页拼回行数 == 总量', (len(merged), ftotal))
chk([r['at'] for r in merged] == sorted([r['at'] for r in merged], reverse=True),
    '合并后严格时间倒序')
ids = [(r['src'], r['id']) for r in merged]
chk(len(set(ids)) == len(ids), '翻页无重复无遗漏（src+id 唯一）')

_, _, c1 = log_rows(type_key='role_create')
_, _, c2 = log_rows(type_key='role_create', who='分页探针1')
chk(c1.get('role_create', 0) >= 10, '类型计数：新建角色 >= 10', c1)
chk(c2.get('role_create', 0) == 1, '类型计数**不含**类型筛选本身、按操作人收窄',
    (c1.get('role_create'), c2.get('role_create')))
chk(set(c2.keys()) <= set(perm_guard.PERM_LOG_TYPE_KEYS), '计数键全部是合法类型', sorted(c2))

# ══════════════════════════════════════════════════════════════════════════
sec('S6 端点层：校验 + 结构')
# ══════════════════════════════════════════════════════════════════════════
resp = server.get_role_perms_audit(FakeReq(), limit=3)
chk(resp['limit'] == 3 and len(resp['items']) <= 3 and resp['total'] >= 3,
    '端点默认结构（items/total/limit/offset/types/returned）',
    {k: resp[k] for k in ('limit', 'offset', 'returned', 'total')})
_it0 = resp['items'][0] if resp['items'] else None
chk(_it0 and _it0.get('what') == _it0.get('action') and _it0.get('role') == _it0.get('target'),
    '旧前端兼容字段（what/role）同义下发 —— 后端先上线时旧区块不渲染空行',
    (_it0 or {}).get('what'))
chk(len(resp['types']) == 12 and all('label' in t and 'count' in t for t in resp['types']),
    'types 下拉数据齐备（12 类，标签+计数）', [t['key'] for t in resp['types']])
resp = server.get_role_perms_audit(FakeReq(), limit=9999)
chk(resp['limit'] == 200, 'limit 钳到 200', resp['limit'])
resp = server.get_role_perms_audit(FakeReq(), offset=-5)
chk(resp['offset'] == 0, 'offset 负值钳到 0', resp['offset'])
for bad, kw in [('2026-13-01', 'date_from'), ('20260301', 'date_to')]:
    try:
        server.get_role_perms_audit(FakeReq(), **{kw: bad})
        chk(False, '坏日期 %s=%s 必须 400' % (kw, bad))
    except HTTPException as e:
        chk(e.status_code == 400, '坏日期 %s=%s ⇒ 400（不静默忽略筛选）' % (kw, bad), e.detail)
try:
    server.get_role_perms_audit(FakeReq(), log_type='黑客自造类型')
    chk(False, '未知操作类型必须 400')
except HTTPException as e:
    chk(e.status_code == 400, '未知操作类型 ⇒ 400', e.detail)

# ══════════════════════════════════════════════════════════════════════════
sec('S7 真实写路径闭环：6 类写端点各 +1 条，内容含"改前 → 改后"')
# ══════════════════════════════════════════════════════════════════════════
def count_now(**kw):
    return log_rows(**kw)[1]


async def _create_role():
    return await server.create_role(FakeReq({'role_name': PROBE_ROLE, 'from_role': 'sales'}))


async def _save_detail(role, perms):
    return await server.save_role_perms_detail(FakeReq({'role_name': role, 'permissions': perms}))


async def _save_end(role, web, mini):
    return await server.save_role_end(FakeReq({'role_name': role, 'allow_web': web, 'allow_mini': mini}))


async def _rename(f, t):
    return await server.rename_role(FakeReq({'from_role': f, 'to_role': t}))


# ① 新建角色
before = count_now(type_key='role_create')
loop.run_until_complete(_create_role())
after = count_now(type_key='role_create')
chk(after == before + 1, '新建角色 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='role_create', limit=1)
chk(it and it[0]['target'] == PROBE_ROLE and '复制自 sales' in (it[0]['detail'] + it[0]['action']),
    '新建角色行：对象=角色名、内容含来源', it[0] if it else None)

# ② 保存角色权限（模块×动作）—— 从 sales 全量复制后收窄，detail 必须是动作级差异
before = count_now(type_key='perm_save')
loop.run_until_complete(_save_detail(PROBE_ROLE, {'hr': ['read'], 'sales': ['read', 'update']}))
after = count_now(type_key='perm_save')
chk(after == before + 1, '保存角色权限 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='perm_save', limit=1)
chk(it and it[0]['target'] == PROBE_ROLE and '取消' in it[0]['detail'] and 'hr' in it[0]['detail'],
    '权限保存行：detail 是"新增/取消"动作级差异（不是"无变化"）', it[0]['detail'] if it else None)

# ③ 改登录端
before = count_now(type_key='role_end')
loop.run_until_complete(_save_end(PROBE_ROLE, True, False))
after = count_now(type_key='role_end')
chk(after == before + 1, '改登录端 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='role_end', limit=1)
chk(it and '电脑端=开 手机端=关' in it[0]['detail'], '登录端行：改后状态可读', it[0]['detail'] if it else None)

# ④ 角色改名
before = count_now(type_key='role_rename')
loop.run_until_complete(_rename(PROBE_ROLE, PROBE_ROLE2))
after = count_now(type_key='role_rename')
chk(after == before + 1, '角色改名 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='role_rename', limit=1)
chk(it and '「%s」→「%s」' % (PROBE_ROLE, PROBE_ROLE2) in it[0]['detail'],
    '改名行：改前 → 改后都在', it[0]['detail'] if it else None)

# ⑤ 删除自定义角色（守卫要求无人占用 —— 探针角色没有账号，放行）
before = count_now(type_key='role_delete')
server.delete_role_perms(PROBE_ROLE2, FakeReq())
after = count_now(type_key='role_delete')
chk(after == before + 1, '删除自定义角色 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='role_delete', limit=1)
chk(it and it[0]['target'] == PROBE_ROLE2, '删除行：对象是被删的角色名', it[0] if it else None)

# ⑥ 恢复内置角色默认（先改 sales 再恢复）
loop.run_until_complete(_save_detail('sales', {'hr': ['read']}))
before = count_now(type_key='role_reset')
server.delete_role_perms('sales', FakeReq())
after = count_now(type_key='role_reset')
chk(after == before + 1, '恢复内置角色默认 ⇒ 恰好 +1 条', (before, after))
it, _, _ = log_rows(type_key='role_reset', limit=1)
chk(it and it[0]['target'] == 'sales' and '无变化' not in it[0]['detail'],
    '恢复默认行：记的是"恢复后等价于什么"的差异，不是"无变化"', it[0]['detail'] if it else None)

# ⑦ 🔴 员工换角色（/api/users/* 走**主库**上下文的那条端到端路径）
conn_mod.set_tenant_context(None)          # 与生产中间件对该前缀的行为一致
before_master = sqlite3.connect(MASTER).execute(
    "SELECT COUNT(*) FROM audit_logs WHERE action='修改角色'").fetchone()[0]
try:
    loop.run_until_complete(server.update_user_role(
        uid_in, FakeReq({'role': 'accountant', 'roles': []})))
    ok_call = True
except Exception as e:
    ok_call = False
    print('    （update_user_role 调用异常：%r）' % e)
finally:
    conn_mod.set_tenant_context(1)
after_master = sqlite3.connect(MASTER).execute(
    "SELECT COUNT(*) FROM audit_logs WHERE action='修改角色'").fetchone()[0]
chk(ok_call and after_master == before_master + 1,
    '员工换角色 ⇒ 主库审计恰好 +1 条（真实端点）', (before_master, after_master))
it, _, _ = log_rows(type_key='user_role', limit=1)
chk(it and it[0]['src'] == 'master' and it[0]['target'] == PROBE_USER
    and 'sales → accountant' in it[0]['detail'],
    '员工换角色行：落在主库、对象=用户名、内容含"改前 → 改后"',
    (it[0]['src'], it[0]['target'], it[0]['detail']) if it else None)

# ══════════════════════════════════════════════════════════════════════════
sec('S8 排序稳定性 + 汇总')
# ══════════════════════════════════════════════════════════════════════════
it, _, _ = log_rows(limit=500)
ats = [r['at'] for r in it]
chk(ats == sorted(ats, reverse=True), '全量严格时间倒序', (ats[0], ats[-1]))
dup_secs = {a for a in ats if ats.count(a) > 1}
chk(len(dup_secs) > 0, '同秒多行确实存在（%d 个同秒组）—— 下面验稳定性' % len(dup_secs))
o1 = [(r['src'], r['id']) for r in log_rows(limit=500)[0]]
o2 = [(r['src'], r['id']) for r in log_rows(limit=500)[0]]
chk(o1 == o2, '同秒组的相对顺序两次查询完全一致（排序键含 src+id，确定性强）')
print('\n' + '=' * 74)
print('v479 后端探针：%d 通过 / %d 失败' % (P[0], P[1]))
print('=' * 74)
sys.exit(1 if P[1] else 0)
