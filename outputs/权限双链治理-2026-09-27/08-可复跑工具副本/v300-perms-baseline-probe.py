#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300 权限基线/复验探针 —— 在**新进程**里读 `perms_rev` / `custom_roles` / `perms_for`。

🔴 为什么必须"新进程"：`perms_for(tid)` 有**进程级缓存、无 TTL**（`core._PERMS_CACHE`），
   而 `perms_rev` / `custom_roles` 是**直读库**（`_read_custom_perms` 不缓存）。
   ⇒ 本探针只能证明「**库里**是什么」；运行中那个后端进程读到什么，要**重启**才等价
     （重启 = 进程重建 = 缓存为空）。两者分工必须在报告里写清，别混为一谈。

跑法（生产上）：
    runuser -u hergent -- /usr/bin/python3 /tmp/v300-perms-baseline-probe.py <标签>
"""
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

from core import perms_rev, custom_roles, perms_for  # noqa: E402

tag = sys.argv[1] if len(sys.argv) > 1 else 'baseline'
print('=== %s（新进程冷读库）===' % tag)
for tid in (1, 10):
    print('tenant_%d  perms_rev = %s' % (tid, perms_rev(tid)))
    print('           custom_roles = %s' % (custom_roles(tid),))
    pf = perms_for(tid)
    for r in ('staff', 'supervisor', 'sales', 'accountant'):
        print('           %-11s = %s' % (r, pf.get(r)))
    # 关键：让位判据是否会因本次改动而变化（内容 == 默认 ⇒ 退出 custom_roles ⇒ 页面对它收窄）
    print('           staff 在 custom_roles 里？  %s' % ('staff' in custom_roles(tid)))
    print('           supervisor 在 custom_roles 里？ %s' % ('supervisor' in custom_roles(tid)))
