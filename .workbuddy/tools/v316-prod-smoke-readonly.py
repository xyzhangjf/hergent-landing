#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316 生产只读冒烟 —— 证明改动**在生产库 + 生产代码**上真的跑得通。

只读：不写任何一行。所有断言都读真实生产数据。
脱敏：**不打印任何客户名 / 电话 / 地址**（客户名是红线）—— 只打印计数与候选个数。
"""
import os
import sys

sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

import routers.data                     # noqa: E402  导入即验证：路由模块能加载（含新增 import）
import routers.import_router            # noqa: E402  导入即验证：列识别/模板定义能加载
from db.queries.contacts import (       # noqa: E402
    contact_count, contact_options, contact_list, normalize_ctype)
from db.connection import set_tenant_context   # noqa: E402
from routers.data import router as data_router  # noqa: E402
from routers.import_router import _guess_mapping, _TEMPLATE_FIELDS  # noqa: E402

set_tenant_context(1)

n_cust = contact_count('', 'customer')
n_supp = contact_count('', 'supplier')
n_all = contact_count('')
rows = contact_list('', 'customer', limit=5, offset=0)
opts = contact_options('customer')

print('[COUNT] customer=' + str(n_cust) + '  supplier=' + str(n_supp) + '  全类型=' + str(n_all))
print('[PAGE] 第 1 页返回 ' + str(len(rows)) + ' 行（limit=5）')
print('[OPTS] 业态候选=' + str(len(opts.get('channel') or []))
      + '  片区候选=' + str(len(opts.get('region') or []))
      + '  业务员候选=' + str(len(opts.get('assigned_salesperson') or [])))
print('[CTYPE] 员工->' + str(normalize_ctype('员工'))
      + '  客户->' + str(normalize_ctype('客户'))
      + '  供应商->' + str(normalize_ctype('供应商'))
      + '  employee(default=None)->' + str(normalize_ctype('employee', default=None)))

# 路由注册顺序（若 /contacts/options 排在 /contacts/{cid} 之后会被吞成 422）
paths = [getattr(r, 'path', '') for r in data_router.routes]
io = paths.index('/api/contacts/options') if '/api/contacts/options' in paths else -1
ic = paths.index('/api/contacts/{cid}') if '/api/contacts/{cid}' in paths else -1
print('[ROUTE] options@' + str(io) + '  {cid}@' + str(ic) + '  顺序正确=' + str(0 <= io < ic))

# 模板 13 列能否被识别器认出（生产侧同一份定义）
hdrs = [l + ('*' if r is True else '') for l, r in _TEMPLATE_FIELDS['contacts']]
gm = _guess_mapping(hdrs, 'contacts')
unrec = [hdrs[i] for i in range(len(hdrs)) if i not in gm]
print('[TPL] 模板列=' + str(len(hdrs)) + '  未识别=' + str(unrec))

ok = (n_cust > 0 and len(rows) == min(5, n_cust) and not unrec
      and 0 <= io < ic and normalize_ctype('员工') == 'customer'
      and len(opts.get('channel') or []) > 0)
print('SMOKE_' + ('OK' if ok else 'FAILED'))
sys.exit(0 if ok else 1)
