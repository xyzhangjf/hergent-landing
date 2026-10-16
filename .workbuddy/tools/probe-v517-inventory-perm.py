#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v517 探针：**进程内**验证各角色对 `inventory` 的四档权限（read/create/update/delete）。

🔴 为什么必须是进程内探针而不是 curl：未登录 curl 探新端点拿 401，而假路径也是 401
   ⇒ 该探针零判别力（v500 付学费）。这里直接调后端自己的裁决函数，结果就是真实裁决结果。

阳性对照（缺了就不算验证通过）：
   · boss        —— 四档**全真**（list 格式 = 全动作放行）
   · sales/driver —— 四档**全假**（未开门，必须如此）
预期变更：
   · accountant / supervisor —— read=True, create=True, update=False, delete=False
"""
import os
import sys

sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

from core import _perm_granted  # noqa: E402
import erp_db  # noqa: E402

ACTIONS = ['read', 'create', 'update', 'delete']

for tid in (1, 10):
    print(f'\n===== tenant {tid} =====')
    try:
        table = erp_db.get_all_role_permissions(tenant_id=tid) or {}
    except Exception as e:
        print('  取权限表失败:', e)
        continue
    for role in ['boss', 'accountant', 'supervisor', 'sales', 'guide', 'driver', 'staff', '库管']:
        perms = table.get(role)
        if not perms:
            print(f'  {role:<12} (无权限记录)')
            continue
        fmt = 'list' if isinstance(perms, list) else ('dict' if isinstance(perms, dict) else '?')
        res = {a: _perm_granted(perms, 'inventory', a) for a in ACTIONS}
        print(f'  {role:<12} fmt={fmt:<4} ' + '  '.join(f'{a}={str(v):<5}' for a, v in res.items()))

print('\n===== 断言 =====')
ok = True
for tid in (1, 10):
    table = erp_db.get_all_role_permissions(tenant_id=tid) or {}
    boss = table.get('boss')
    if boss is None:
        print(f'  ❌ tenant{tid} 无 boss 记录（阳性对照缺失）')
        ok = False
        continue
    if not all(_perm_granted(boss, 'inventory', a) for a in ACTIONS):
        print(f'  ❌ tenant{tid} boss 未四档全真（阳性对照失败）')
        ok = False
    else:
        print(f'  ✅ tenant{tid} boss 四档全真（阳性对照通过）')
    for r in ('sales', 'driver'):
        p = table.get(r)
        if p and any(_perm_granted(p, 'inventory', a) for a in ACTIONS):
            print(f'  ❌ tenant{tid} {r} 竟然有 inventory 权限（应为全假）')
            ok = False
    for r in ('accountant', 'supervisor'):
        p = table.get(r)
        if not p:
            print(f'  ⚠️ tenant{tid} 无 {r} 记录')
            continue
        got = {a: _perm_granted(p, 'inventory', a) for a in ACTIONS}
        want = {'read': True, 'create': True, 'update': False, 'delete': False}
        if got == want:
            print(f'  ✅ tenant{tid} {r} 档位正确（能看能建、不能改不能删）')
        else:
            print(f'  ❌ tenant{tid} {r} 档位不符 got={got} want={want}')
            ok = False
print('\n总判定：', 'PASS' if ok else 'FAIL')
