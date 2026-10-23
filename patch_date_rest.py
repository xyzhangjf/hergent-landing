# -*- coding: utf-8 -*-
"""v645 P0-② 续：剩余报表端点补日期过滤（后端先行）。
🔴 逐函数作用域 + 显式字符串替换 + 断言：任一处不匹配即整体失败（Fail fast，绝不静默半改）。
🔴 日期列取自 tenant_1 真实 schema 实测。
🔴 注入位置规则（上一版踩坑修正）：
     · 原 SQL **无 WHERE** ⇒ `FROM t WHERE 1=1" + dc` （dc 片段以 " AND " 开头，必须有 WHERE 打头）
     · 原 SQL **已有 WHERE** ⇒ 只在 `ORDER BY` 前追加 ` + dc + `（不得再插 WHERE，否则双 WHERE 语法错）
     · 有 GROUP BY ⇒ WHERE 放在 GROUP BY **之前**
   `_date_cond` 片段恒以 " AND " 开头 + 参数绑定，杜绝 SQL 拼接注入。
"""
import re, sys

P = '/opt/hergent-erp/routers/reports.py'
with open(P, encoding='utf-8') as f:
    src = f.read()

if 'v645_DATE_ALL' in src:
    print('ALREADY_PATCHED')
    sys.exit(0)

# (函数名, 日期列, 表, 模式, 可选：已有WHERE时的 ORDER BY 子句原文)
T = [
    ('report_fee_summary',      'order_date',   'expense_orders',   'nowhere', None),
    ('report_income_summary',   'order_date',   'income_orders',    'nowhere', None),
    ('report_receipt_detail',   'paid_at',      'payment_receipts', 'nowhere', None),
    ('report_payment_detail',   'period_start', 'period_payments',  'nowhere', None),
    ('report_account_flow',     'bill_date',    'fund_flow',        'nowhere', None),
    ('report_fee_usage',        'created_at',   'expense_requests', 'nowhere', None),
    ('report_attendance',       'date',         'attendance',       'nowhere', None),
    ('report_visit_log',        'created_at',   'visit_logs',       'nowhere', None),
    ('report_visit_achv',       'plan_date',    'visit_plans',      'nowhere', None),
    ('report_online_receipt',   'paid_at',      'payment_receipts', 'where',
     'ORDER BY paid_at DESC LIMIT 500""")'),
    ('report_other_receivable', 'created_at',   'receivables',      'where',
     'ORDER BY created_at DESC LIMIT 500""")'),
    ('report_other_inout',      'created_at',   'inventory_logs',   'groupby', None),
]
# 特殊：裸 c.execute（_auth 写成 u = _auth(request)），无 _safe/_scalar
SPECIAL = [
    {'name': 'mkt_visit_plans', 'cond': 'dc, dp = _date_cond("plan_date", date_from, date_to)',
     'reps': [('ORDER BY plan_date DESC, id DESC")',
               'WHERE 1=1" + dc + " ORDER BY plan_date DESC, id DESC", dp)')]},
    {'name': 'invoice_sales', 'cond': 'dc, dp = _date_cond("invoice_date", date_from, date_to)',
     'reps': [('ORDER BY invoice_date DESC, id DESC")',
               'WHERE 1=1" + dc + " ORDER BY invoice_date DESC, id DESC", dp)'),
              ('"FROM einvoices")', '"FROM einvoices WHERE 1=1" + dc, dp)')]},
    {'name': 'invoice_purchase',
     'cond': ('dc, dp = _date_cond("invoice_date", date_from, date_to)\n'
              '    dca, _ = _date_cond("invoice_date", date_from, date_to, "a.")'),
     'reps': [('ORDER BY a.invoice_date DESC, a.id DESC")',
               'WHERE 1=1" + dca + " ORDER BY a.invoice_date DESC, a.id DESC", dp)'),
              ('"FROM ap_invoices")', '"FROM ap_invoices WHERE 1=1" + dc, dp)')]},
]


def span(name):
    m = re.search(r'\ndef ' + name + r'\(', src)
    if not m:
        raise SystemExit('FUNC_NOT_FOUND: ' + name)
    s = m.start()
    nxt = re.search(r'\n(?=@router\.|\ndef |\n# ===)', src[s + 1:])
    return s, (s + 1 + nxt.start() if nxt else len(src))


patches = []

for name, col, table, mode, order_clause in T:
    s, e = span(name)
    body = src[s:e]
    orig = body

    old_sig = f'\ndef {name}(request: Request):'
    assert old_sig in body, f'SIG_NOT_FOUND: {name}'
    body = body.replace(old_sig, f'\ndef {name}(request: Request, date_from: str = "", date_to: str = ""):', 1)

    assert '\n    _auth(request)' in body, f'AUTH_NOT_FOUND: {name}'
    body = body.replace('\n    _auth(request)',
                        f'\n    _auth(request)\n    dc, dp = _date_cond("{col}", date_from, date_to)', 1)

    if mode == 'nowhere':
        old = f'FROM {table} ORDER BY'
        assert old in body, f'NO_FROM_ORDER: {name}'
        body = body.replace(old, f'FROM {table} WHERE 1=1""" + dc + """ ORDER BY', 1)
        assert 'LIMIT 500""")' in body, f'NO_CLOSE: {name}'
        body = body.replace('LIMIT 500""")', 'LIMIT 500""", dp)', 1)
    elif mode == 'where':
        assert order_clause in body, f'NO_ORDER_CLAUSE: {name}'
        # order_clause 形如 'ORDER BY x DESC LIMIT 500""")'（结尾 = 三个引号 + 一个右括号）。
        # 🔴 只砍掉**最后一个右括号**（[:-1]），保留三个引号闭合字符串，再补 ', dp)'。
        #    （上一版写成 [:-3] 吃掉了一个引号 ⇒ 字符串配对被破坏、整个文件 SyntaxError。）
        body = body.replace(order_clause, '""" + dc + """ ' + order_clause[:-1] + ', dp)', 1)
    elif mode == 'groupby':
        old = f'FROM {table} GROUP BY'
        assert old in body, f'NO_FROM_GROUP: {name}'
        body = body.replace(old, f'FROM {table} WHERE 1=1""" + dc + """ GROUP BY', 1)
        assert 'DESC""")' in body, f'NO_CLOSE: {name}'
        body = body.replace('DESC""")', 'DESC""", dp)', 1)

    # _scalar 合计（这些 SQL 均无 WHERE，直接追加 WHERE 1=1 + dc）
    if re.search(r'_scalar\("([^"]+?) FROM ' + table + r'"\)', body):
        body = re.sub(r'_scalar\("([^"]+?) FROM ' + table + r'"\)',
                      rf'_scalar("\1 FROM {table} WHERE 1=1" + dc, dp)', body)

    assert body != orig, f'NO_CHANGE: {name}'
    patches.append((s, e, body))

for sp in SPECIAL:
    s, e = span(sp['name'])
    body = src[s:e]
    orig = body
    sig = f'def {sp["name"]}(request: Request):'
    assert sig in body, f"SPECIAL_SIG: {sp['name']}"
    body = body.replace(sig, sig.replace('(request: Request):',
                        '(request: Request, date_from: str = "", date_to: str = ""):'), 1)
    assert '\n    u = _auth(request)' in body, f"SPECIAL_AUTH: {sp['name']}"
    body = body.replace('\n    u = _auth(request)', '\n    u = _auth(request)\n    ' + sp['cond'], 1)
    for old, new in sp['reps']:
        assert old in body, f"SPECIAL_REP: {sp['name']} :: {old[:50]}"
        body = body.replace(old, new, 1)
    assert body != orig, f"SPECIAL_NO_CHANGE: {sp['name']}"
    patches.append((s, e, body))

# 🔴 必须按 **起始位置倒序** 应用：目标列表并非按文件顺序排列（如 fee_usage 在文件中
#    位于 other_inout 之后，但在 TARGETS 里排在前面）。若按列表顺序/任意顺序应用，
#    先应用的补丁会改变长度 ⇒ 后续补丁的 s/e 偏移全部失效 ⇒ 撕裂文件（实测把
#    other_inout 的 SQL 尾部和 fee-usage 的 @router 装饰器一起吞掉了）。
patches.sort(key=lambda x: x[0], reverse=True)
# 防御：任两段区间重叠即中止（重叠说明 span() 边界算错，宁可不动文件）
# 倒序后：patches[i] 在文件中更靠后 ⇒ 约束是「靠前那段的结尾 ≤ 靠后那段的开头」
for i in range(len(patches) - 1):
    assert patches[i + 1][1] <= patches[i][0], f'OVERLAP at {i}'

for s, e, new in patches:
    src = src[:s] + new + src[e:]

src += '\n\n# v645_DATE_ALL：以上端点 date_from/date_to 过滤已由本脚本注入（只读、参数绑定）。\n'

with open(P, 'w', encoding='utf-8') as f:
    f.write(src)
print('PATCHED_OK', len(T), '+', len(SPECIAL), 'special')
