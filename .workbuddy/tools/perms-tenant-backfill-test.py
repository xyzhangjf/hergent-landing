#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300 租户库补漏判据单测 —— 用**真 `_DEFAULT_PERMS`** 跑正反例。

🔴 为什么必须正反例都有：判据的"保守"是靠**拒绝补**体现的，而拒绝是**看不见的**
   （不补就是什么都不发生）。只测"该补的补了"，测不出"该拒的拒了" —— 后者才是
   这条判据的核心风险（把客户有意收紧的模块补回去 = 覆盖客户的决策）。

跑法：
    python3 .workbuddy/tools/perms-tenant-backfill-test.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'bk', os.path.join(HERE, 'perms-tenant-backfill.py'))
bk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bk)

DEFAULTS = bk.load_default_perms()
PASS, FAIL = [], []


def case(title, rows, expect_plan, expect_skip_kw=None):
    """expect_plan = 期望补的 (role, module) 集合；expect_skip_kw = 期望在跳过理由里出现的关键词。"""
    plan, skipped = bk.plan_for(DEFAULTS, rows)
    got = sorted((r, m) for r, m, _ in plan)
    ok = (got == sorted(expect_plan))
    detail = ''
    if not ok:
        detail = '得到 %s / 期望 %s' % (got, sorted(expect_plan))
    elif expect_skip_kw is not None:
        blob = ' | '.join('%s:%s' % (r, w) for r, w in skipped)
        if expect_skip_kw not in blob:
            ok = False
            detail = '跳过理由里找不到「%s」；实际 %s' % (expect_skip_kw, blob)
    (PASS if ok else FAIL).append(title)
    print(('  PASS  ' if ok else '  FAIL  ') + title + (('   [' + detail + ']') if detail else ''))
    return ok


print('权威源 = %s（%d 个角色）' % (bk.CORE_PY, len(DEFAULTS)))
print('')

print('== 正例（该补的必须补上）==')
case('① staff 缺 chat（默认有、白名单内、行未偏离）⇒ 补 chat',
     {'staff': ["data", "stock", "cron"]}, [('staff', 'chat')])
case('② supervisor 缺 sales（v293 新增）⇒ 补 sales',
     {'supervisor': ["data", "dashboard", "cron"]}, [('supervisor', 'sales')])
case('③ driver 缺 chat ⇒ 也补（chat 白名单对全部内置角色开放）',
     {'driver': ["dashboard", "stock"]}, [('driver', 'chat')])
case('④ supervisor 同时缺 sales/cron/bid ⇒ **只补 sales**（白名单外的默认模块一律拒）',
     {'supervisor': ["dashboard", "data"]}, [('supervisor', 'sales')])

print('')
print('== 反例（不该补的必须拒 —— 这些才是判据的保守性所在）==')
case('⑤ `bid` 不在白名单（v296 迁移已单独处理，不在这里补）⇒ 拒',
     {'sales': ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "data", "chat", "cron"]},
     [], expect_skip_kw='不在')
case('⑥ `tasks` 不在白名单 ⇒ 拒',
     {'boss': ["dashboard", "ops-workbench", "data", "sales", "buying", "stock", "accounts", "crm",
               "marketing", "hr", "payroll", "projects", "perf", "goals", "reports", "chat", "cron", "bid"]},
     [], expect_skip_kw='不在')
case('⑦ 🔴 该行**多了** payroll ⇒ 已偏离默认（有人管过）⇒ 整行跳过，连 chat 也不补',
     {'staff': ["data", "stock", "cron", "payroll"]}, [], expect_skip_kw='多了')
case('⑧ `sales` 的补漏**只给 supervisor**：guide 缺 sales 时不补（白名单限定）',
     {'guide': ["dashboard", "ops-workbench", "buying", "stock", "crm", "chat"]},
     [], expect_skip_kw='白名单限定')
case('⑨ admin 永不处理（= `["*"]` 通配），但必须**留痕**以便审计',
     {'admin': ["dashboard"]}, [], expect_skip_kw='留痕')
case('⑩ 权限是 CRUD dict 形态 ⇒ 保守跳过',
     {'staff': {"data": ["read"], "stock": ["read"]}}, [], expect_skip_kw='CRUD')
case('⑪ 租户库无该行 ⇒ 走默认值，不算缺',
     {}, [], expect_skip_kw='无该行')
case('⑫ 行与默认值完全一致 ⇒ 无缺项',
     {'driver': ["dashboard", "stock", "chat"]}, [], expect_skip_kw='无缺项')

print('')
print('-' * 62)
print('通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
if FAIL:
    for f in FAIL:
        print('   ✗ ' + f)
sys.exit(1 if FAIL else 0)
