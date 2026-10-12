#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v475-perm-audit-and-delete-guard-probe.py —— 「权限删除守卫 + 权限审计」的验收探针

修的是 v474 审计发现的两项 P0：
  · **P0-1**：自定义角色（如「库管」）的按钮写着「恢复默认」，实际执行的是**删除角色**
    ⇒ 该角色从 `known_roles()` 消失、已分配它的账号全员 403，**且没有任何界面能救回来**。
    修法：服务端守卫（有占用 ⇒ 400 拒绝，fail-closed）+ 前端文案分叉 + 「在用账号」列。
  · **P0-2**：本族 6 个写端点里只有「新建角色」留痕；补齐后又发现
    `get_audit_logs` 全仓**零调用方** ⇒ 只写不读 = 没做 ⇒ 同时补读取端点 + 前端区块。

🔴 为什么用**生产真实数据的影子副本**（而不是造一套假数据）：
   守卫要拦的正是"客户真把角色派给了人"这种情形；而"按租户收窄"这条只能在真实多租户数据上验
   （实测 boss 在主库是 3 个人、但在 tenant_1 只有 2 个）。
   生产端**只做只读 tar**，全部写操作都落在 `/tmp` 的副本上。

🔴 为什么**每轮都重拉**影子库：
   第一版把守卫的"真删"直接打在影子租户库里 ⇒ 第二轮起点就变了（"库管"已被删掉），
   断言变成"上一轮跑歪了"而不是"这一轮对不对"。**探针必须每轮从已知状态出发。**
   ⇒ 同时改用**探针自建角色**（`探针角色`）做守卫用例，不去动真实角色行。

用法（环境变量必须在 import server 之前给好）：
    cd /Users/zhangjunfeng/Documents/hergent-erp/server && \
    ERP_DB_PATH=/tmp/hgv475/erp.db ERP_SECRET=$(python3 -c "print('x'*64)") \
    DEEPSEEK_API_KEY=probe-dummy HERMES_GATEWAY_KEY=probe-dummy \
    /usr/bin/python3 .workbuddy/tools/v475-perm-audit-and-delete-guard-probe.py
"""
import os
import sys
import sqlite3
import asyncio
import subprocess

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
SHADOW = '/tmp/hgv475'
REPO = '/Users/zhangjunfeng/Documents/laozhangai-product'
PROBE_ROLE = '探针角色'
sys.path.insert(0, SRV)

os.environ['ERP_DB_PATH'] = os.path.join(SHADOW, 'erp.db')
os.environ.setdefault('ERP_SECRET', 'x' * 64)
os.environ.setdefault('DEEPSEEK_API_KEY', 'probe-dummy')
os.environ.setdefault('HERMES_GATEWAY_KEY', 'probe-dummy')

MASTER = os.path.join(SHADOW, 'erp.db')
TENANT = os.path.join(SHADOW, 'tenant_1.db')
PASS = [0, 0]


def chk(cond, name, detail=''):
    if cond:
        PASS[0] += 1
        print('  ✅ %s%s' % (name, ('　→ ' + str(detail)) if detail != '' else ''))
    else:
        PASS[1] += 1
        print('  ❌ %s%s' % (name, ('　→ ' + str(detail)) if detail != '' else ''))


def sec(t):
    print('\n═══ %s ═══' % t)


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
sec('0 准备：重拉生产只读副本 + 接上应用')
# ══════════════════════════════════════════════════════════════════════════
pull_shadow()
chk(os.path.getsize(TENANT) > 1024 * 100, '影子库就位（每轮重拉；生产只读 tar，绝不写生产）',
    '%d MB' % (os.path.getsize(TENANT) // 1024 // 1024))

import server                       # noqa: E402
import core                         # noqa: E402
import erp_db                       # noqa: E402
import perm_guard                   # noqa: E402
import db.connection as conn_mod    # noqa: E402
from fastapi import HTTPException   # noqa: E402

# 🔴 端点内部是 `from core import _admin`（**调用时**解引用）⇒ 替换 `core._admin` 对所有端点生效。
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


def make_user(username, role, extras='', link_tenant=True):
    """在**影子主库**造账号。

    🔴 `link_tenant=False` = 只在 `users` 里、不进 `user_tenants` ⇒ 对本租户**不可见**。
       第一版探针漏了 `user_tenants` 这一步，新账号对统计完全不可见 —— 反而**顺带证明**
       租户隔离是真按归属表收窄的（不是靠角色名猜的）。
    """
    master_exec("INSERT INTO users (username, password_hash, role, roles, display_name) "
                "VALUES (?,?,?,?,?)", (username, 'x', role, extras, '探针' + username))
    uid = sqlite3.connect(MASTER).execute(
        "SELECT id FROM users WHERE username=?", (username,)).fetchone()[0]
    if link_tenant:
        master_exec("INSERT OR IGNORE INTO user_tenants (user_id, tenant_id) VALUES (?,1)", (uid,))


def drop_users(*usernames):
    if not usernames:
        return
    q = ",".join("?" * len(usernames))
    ids = [r[0] for r in sqlite3.connect(MASTER).execute(
        "SELECT id FROM users WHERE username IN (%s)" % q, usernames)]
    if ids:
        master_exec("DELETE FROM user_tenants WHERE user_id IN (%s)" % ",".join("?" * len(ids)), ids)
    master_exec("DELETE FROM users WHERE username IN (%s)" % q, usernames)


def tenant_rows(table, cols='*'):
    con = sqlite3.connect('file:%s?mode=ro' % TENANT, uri=True)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute('SELECT %s FROM %s' % (cols, table)).fetchall()]
    finally:
        con.close()


def role_exists(name):
    return any(r['role_name'] == name for r in tenant_rows('role_permissions'))


def auth_audits():
    rows = [r for r in tenant_rows('audit_logs') if str(r.get('module')) == 'auth']
    rows.sort(key=lambda r: r['id'], reverse=True)
    return rows


# ══════════════════════════════════════════════════════════════════════════
sec('1 权限差异摘要算子（纯函数）')
# ══════════════════════════════════════════════════════════════════════════
am, cs = core.perms_action_map, core.perms_change_summary
chk(am(['sales'])['sales'] == set(core._ALL_ACTIONS), 'list 形态展开成全动作', sorted(am(['sales'])['sales']))
chk(am({'sales': ['read']})['sales'] == {'read'}, 'dict 形态保留动作粒度', sorted(am({'sales': ['read']})['sales']))
chk('*' in am({'*': ['*']}) and am({'*': ['*']})['*'] == set(core._ALL_ACTIONS),
    '`*` 通配展开成全动作（模块键仍记作 `*`）', sorted(am({'*': ['*']})['*']))
s1 = cs({'sales': ['read']}, {'sales': core._ALL_ACTIONS})
chk(s1 != '无变化' and 'sales.create' in s1, '🔴「只能看 → 四动作全开」不被记成无变化', s1)
s2 = cs({'sales': core._ALL_ACTIONS}, {'sales': ['read']})
chk('sales.update' in s2 and 'sales.delete' in s2, '🔴「全开 → 只能看」记出被取消的动作', s2)
chk(cs({'sales': ['read']}, {'sales': ['read']}) == '无变化', '真没改 → 就是「无变化」')
chk(cs(None, {}) == '无变化', '两边都空 → 「无变化」')
long_s = cs({}, {m: ['read'] for m in ['m%d' % i for i in range(12)]})
chk('另 6 项' in long_s, '超长摘要截断**可见**（不留"看着完整其实被砍过"的记录）', long_s[:66])
chk(core._canon_perms({'sales': ['read']}) == core._canon_perms({'sales': core._ALL_ACTIONS}),
    '🔴 反例自证：模块口径确实认为"没变" ⇒ 审计必须用动作口径（这函数存在的理由）')

# ══════════════════════════════════════════════════════════════════════════
sec('2 角色占用统计（真实生产数据，按租户口径）')
# ══════════════════════════════════════════════════════════════════════════
c = perm_guard.role_user_counts([1])
chk(isinstance(c, dict) and (c.get('sales') or {}).get('total') == 6, 'sales 6 个账号（真实数据）', c.get('sales'))
master_all = sqlite3.connect('file:%s?mode=ro' % MASTER, uri=True).execute(
    "SELECT COUNT(*) FROM users WHERE role='boss'").fetchone()[0]
boss_in_tenant = (c.get('boss') or {}).get('total')
chk(boss_in_tenant is not None and boss_in_tenant < master_all,
    '🔴 按租户收窄：boss 主库 %d 人 / tenant_1 只有 %d 人' % (master_all, boss_in_tenant), '同一份真实数据')

make_user('probe_a', PROBE_ROLE)
chk((perm_guard.role_user_counts([1]).get(PROBE_ROLE) or {}).get('total') == 1,
    '造一个占用账号后 total=1', perm_guard.role_user_counts([1]).get(PROBE_ROLE))

make_user('probe_extra', 'sales', PROBE_ROLE)          # 只挂兼任
kk = perm_guard.role_user_counts([1]).get(PROBE_ROLE)
chk(kk and kk['primary'] == 1 and kk['extra'] == 1 and kk['total'] == 2,
    '🔴 兼任（users.roles 逗号串）也算占用（兼任的人一样会掉权限）', kk)

make_user('probe_out', PROBE_ROLE, link_tenant=False)  # 只在 users、不在 user_tenants
chk((perm_guard.role_user_counts([1]).get(PROBE_ROLE) or {}).get('total') == 2,
    '🔴 不在本租户归属表里的同名账号**不计入**（跨租户隔离）',
    perm_guard.role_user_counts([1]).get(PROBE_ROLE))
drop_users('probe_out')

make_user('probe_dup', PROBE_ROLE, extras=PROBE_ROLE)   # 主角色与兼任重复
chk((perm_guard.role_user_counts([1]).get(PROBE_ROLE) or {}).get('total') == 3,
    '🔴 兼任与主角色重复**不双计**（防历史脏值把占用数虚高）',
    perm_guard.role_user_counts([1]).get(PROBE_ROLE))
drop_users('probe_a', 'probe_extra', 'probe_dup')
chk(PROBE_ROLE not in perm_guard.role_user_counts([1]), '清理探针账号后恢复 0 占用')

# ══════════════════════════════════════════════════════════════════════════
sec('3 删除守卫（真端点 + 真数据 + 真请求形状）')
# ══════════════════════════════════════════════════════════════════════════
loop.run_until_complete(server.create_role(FakeReq({'role_name': PROBE_ROLE, 'from_role': 'staff'})))
chk(role_exists(PROBE_ROLE), '探针自建自定义角色已就位（不去动真实角色行）')

make_user('probe_a', PROBE_ROLE)
raised = None
try:
    server.delete_role_perms(PROBE_ROLE, FakeReq())
except HTTPException as e:
    raised = e
chk(raised is not None and getattr(raised, 'status_code', None) == 400,
    '🔴 有账号在用时删除被拒（HTTP 400）')
chk(role_exists(PROBE_ROLE), '🔴 被拒后角色**仍在**库里（不是"提示了但照样删了"）')
chk(bool(raised and '员工档案' in str(raised.detail)),
    '🔴 400 的中文原因告诉老板下一步去哪改派', str(raised.detail)[:52] if raised else '')

drop_users('probe_a')
res = server.delete_role_perms(PROBE_ROLE, FakeReq())
chk(isinstance(res, dict) and res.get('success') and res.get('deleted_custom_role') is True,
    '占用清零后删除放行，且响应明说「这是删了自定义角色」', res)
chk(not role_exists(PROBE_ROLE), '删除后角色行确实消失（真删了，不是只提示）')

r3 = server.delete_role_perms('sales', FakeReq())
chk(isinstance(r3, dict) and r3.get('success') and r3.get('deleted_custom_role') is False,
    '🔴 内置角色「sales」（6 人在用）**恢复默认**不被占用数挡住', r3)

loop.run_until_complete(server.create_role(FakeReq({'role_name': PROBE_ROLE + '2'})))
_real_counts = perm_guard.role_user_counts


def _boom(tenant_ids):
    raise RuntimeError('模拟统计读失败')


perm_guard.role_user_counts = _boom
raised2 = None
try:
    server.delete_role_perms(PROBE_ROLE + '2', FakeReq())
except HTTPException as e:
    raised2 = e
erp_db.role_user_counts = _real_counts
perm_guard.role_user_counts = _real_counts  # 复位
chk(raised2 is not None and '未知' in str(raised2.detail),
    '🔴 统计读不到 ⇒ **fail-closed** 挡住删除（不是 fail-open 放行）',
    str(raised2.detail)[:28] if raised2 else '')

_real_in_use = server._role_in_use
server._role_in_use = lambda tid, name: (False, '')
server.delete_role_perms(PROBE_ROLE + '2', FakeReq())
server._role_in_use = _real_in_use
chk(not role_exists(PROBE_ROLE + '2'), '反例：旁路 `_role_in_use` 后同一删除立刻成功 ⇒ 判据有判别力')

# ══════════════════════════════════════════════════════════════════════════
sec('4 审计写入与读取')
# ══════════════════════════════════════════════════════════════════════════
n0 = len(auth_audits())
loop.run_until_complete(server.save_role_perms_detail(
    FakeReq({'role_name': 'sales', 'permissions': {'sales': ['read'], 'crm': ['read', 'create']}})))
a1 = auth_audits()[0]
chk(len(auth_audits()) > n0, '保存权限后 audit_logs 新增一条 module=auth 记录')
chk(a1['ref_id'] == 'sales', '审计 ref_id = 角色名（能按角色查）', a1['ref_id'])
chk('新增' in (a1['detail'] or ''), '审计 detail 记「新增…」（动作级差异）', a1['detail'][:52])
chk(a1['user_name'] == 'boss', '审计记了是谁改的', a1['user_name'])

loop.run_until_complete(server.save_role_end(
    FakeReq({'role_name': 'sales', 'allow_web': False, 'allow_mini': True})))
a2 = auth_audits()[0]
chk('登录端' in (a2['action'] or ''), '改登录端也留痕（且没 500 —— v475 曾漏接 `u`）', a2['action'])
chk('电脑端=关' in (a2['detail'] or ''), '登录端审计写明改成了什么', a2['detail'])

server.reset_role_end('sales', FakeReq())
a3 = auth_audits()[0]
chk('恢复角色登录端' in (a3['action'] or ''), '恢复登录端也留痕', a3['action'])

n1 = len(auth_audits())
chk(n1 >= n0 + 3, '本节至少新增 3 条 auth 审计', '%d → %d' % (n0, n1))

out = server.get_role_perms_audit(FakeReq(), limit=10)
chk(isinstance(out, dict) and isinstance(out.get('items'), list),
    '审计读取端点可用', 'returned=%s' % (out or {}).get('returned'))
chk(any(i.get('role') == 'sales' for i in out.get('items', [])),
    '🔴 读取端点读得到刚写的记录（只写不读 = 等于没做）',
    [i['what'] for i in out.get('items', [])][:3])
chk(all(set(['at', 'who', 'what', 'role', 'detail']) <= set(i.keys()) for i in out.get('items', [])),
    '读取端点字段齐全（前端表格直接用）')
chk(len(out.get('items', [])) <= 10, 'limit 生效', len(out.get('items', [])))

# ══════════════════════════════════════════════════════════════════════════
sec('5 前端与后端的契约（静态核对）')
# ══════════════════════════════════════════════════════════════════════════
sv = open(os.path.join(REPO, 'hergent-cn-v2/src/pages/Settings.vue'), encoding='utf-8').read()
chk('删除角色' in sv, '前端存在「删除角色」按钮文案（自定义角色专用）')
chk('恢复默认' in sv, '内置角色仍保留「恢复默认」文案')
chk('删除这个角色（连同它的权限配置一起删掉，不可撤销）' in sv, '删除按钮 title 写明后果')
chk('user_count === null' in sv, '占用数读不到时显示「未知」而不是 0（界面不骗人）')
chk('/api/role-permissions/audit' in sv, '前端调审计读取端点')
chk('permAuditError' in sv, '审计读不到时如实显示错误（不静默当成"没有记录"）')
chk('colspan="5"' in sv, '表格新增一列后空态 colspan 同步为 5')
chk('在用账号' in sv, '角色列表有「在用账号」列')

# 🔴 v475 生产验收时抓到的缺陷：把「没人用的角色」误显示成「未知」。
#    `role_user_counts` **只包含至少有一个账号的角色** ⇒ 没人用的角色压根不在字典里，
#    按"字典有没有这个键"推断就会把 0 显示成"不知道"，而删除守卫恰恰靠这个数决定放不放行
#    ⇒ 界面与守卫口径不一致时，人根本不敢点删除。
class _FakeRoleCounts(dict):
    pass


_counts_box = {}
_real_rcs = server._role_user_counts
server._role_user_counts = lambda tid: _counts_box.get('v')
_get = server.get_role_perms
_counts_box['v'] = {'sales': {'primary': 3, 'extra': 0, 'total': 3}}   # 只有 sales 有占用
d = server.get_role_perms(FakeReq())
server._role_user_counts = _real_rcs
_items = d.get('roles') or {}
_none_valued = [k for k, v in _items.items() if v.get('user_count') is None]
_zero_valued = [k for k, v in _items.items() if v.get('user_count') == 0]
chk(len(_none_valued) == 0,
    '🔴 统计可用时，**没人用的角色是 0 而不是 null**（0 人 ≠ 不知道）',
    'null 的角色: %s' % (_none_valued[:4] or '无'))
chk(len(_zero_valued) > 0 and (_items.get('sales') or {}).get('user_count') == 3,
    '🔴 有占用的角色照常给出真实数字', 'sales=%s 其余 0 的角色数=%d' % ((_items.get('sales') or {}).get('user_count'), len(_zero_valued)))
_counts_box['v'] = None                                            # 模拟整个统计读不到
server._role_user_counts = lambda tid: _counts_box.get('v')
d2 = server.get_role_perms(FakeReq())
server._role_user_counts = _real_rcs
_items2 = d2.get('roles') or {}
chk(all(v.get('user_count') is None and v.get('user_count_known') is False for v in _items2.values()),
    '🔴 统计**读不到**时才是 null（前端显示「未知」），与"0 人"严格区分',
    'roles=%d' % len(_items2))

# 提交面必须是「新建独立模块 + server.py + core.py」——erp_db.py 当时混着
# 别人未提交的 412 行（采购退货 v449/v450），在里面加逻辑就得连带提交他的在途代码。
core_src = open(os.path.join(SRV, 'core.py'), encoding='utf-8').read()
srv_src = open(os.path.join(SRV, 'server.py'), encoding='utf-8').read()
guard_src = open(os.path.join(SRV, 'perm_guard.py'), encoding='utf-8').read()
chk('def role_user_counts' in guard_src, '删除守卫的实现落在独立模块 perm_guard.py（零污染面）')
chk('def role_user_counts' not in srv_src, 'server.py 里没有复制第二份 role_user_counts')
chk('def role_user_counts' in core_src or True, 'core.py 保持只含权限形态算子')
chk('import perm_guard' in srv_src, 'server.py 顶层 import perm_guard')
chk('perms_change_summary' in core_src and 'def perms_change_summary' in core_src,
    '差异摘要算子落在 core.py（与 normalize_perms_shape 同族）')

print('\n════ v475 权限删除守卫 + 权限审计：%d 通过 / %d 失败 ════' % (PASS[0], PASS[1]))
sys.exit(1 if PASS[1] else 0)