#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300 探针：产出 `GET /api/role-permissions` 对**本租户**的**真实序列化产物**（只读）。

为什么需要它：
  真机 E2E 要验「角色下拉值域是不是动态」。用一个**我编的** mock 去喂，只能证明
  "前端能渲染 mock"；必须用**后端自己会吐的那份 JSON**去喂，才等价于
  "老板登录后亲眼看到的那份"。本探针跑的就是端点原样的三行序列化
  （`server.py::get_role_perms` 第 1116-1122 行），只是把 `_admin(request)` 换成显式 tid。

只读：只调 `db.get_all_role_permissions`（SELECT）与 `core._DEFAULT_PERMS`（常量），
      没有任何写路径。

跑法（生产上）：
    runuser -u hergent -- /usr/bin/python3 /tmp/v300-role-perms-payload-probe.py
"""
import json
import os
import sys


def load_env(path='/opt/hergent-erp/.env'):
    """最小 .env 解析（不 source shell —— 躲开引号/转义坑）。"""
    try:
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


load_env()
sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

import erp_db as db              # noqa: E402  （server.py:14 就是 `import erp_db as db`）
from core import _DEFAULT_PERMS  # noqa: E402


def endpoint_payload(tid):
    """逐行照抄 server.py::get_role_perms 的组装逻辑（只读部分）。"""
    custom = db.get_all_role_permissions(tenant_id=tid)
    all_roles = {}
    for role, perms in {**_DEFAULT_PERMS, **custom}.items():
        all_roles[role] = {
            "permissions": perms,
            "is_custom": role in custom,
            "is_default": role in _DEFAULT_PERMS,
        }
    return {"roles": all_roles, "tenant_id": tid}


for tid in (1, 10):
    p = endpoint_payload(tid)
    names = list(p['roles'].keys())
    print('=== tenant_%d ===' % tid)
    print('role 数 = %d' % len(names))
    print('角色名（按序列化顺序）= %s' % json.dumps(names, ensure_ascii=False))
    print('自定义角色 = %s' % json.dumps(
        [r for r, v in p['roles'].items() if v['is_custom']], ensure_ascii=False))
    print('--- 端点原样 JSON（可直接喂给 E2E mock）---')
    print(json.dumps(p, ensure_ascii=False, sort_keys=False))
    print('')
