# -*- coding: utf-8 -*-
"""v773 自检：导购（guide）补进报单线通知受众，且**不许顺手放开经营/账务类**。

被测代码 = 磁盘真源码（AST 抠出受众常量与判定函数 → exec，不 import 后端包）。
默认读本地回拉镜像；生产复跑时传 V773_FINANCE=/opt/hergent-erp/db/queries/finance.py。

🔴 为什么必须「被真正执行」：只把 guide 写进 8 条规则不算修好 —— 判据要能用
   `message_visible()` 真跑出「导购可见报单线、不可见客户欠款」，并有坏样本自证。
"""
import ast
import os
import sys

try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
    _DEFAULT = os.path.join(_HERE, '..', 'remote-erp', 'db', 'queries', 'finance.py')
except NameError:                       # 通过 stdin 喂给生产 python3 - 时没有 __file__
    _DEFAULT = '/opt/hergent-erp/db/queries/finance.py'

FINANCE = os.environ.get('V773_FINANCE') or _DEFAULT
WANT = {'AUDIENCE_ALL', 'DEFAULT_AUDIENCE', '_AUDIENCE_EXACT', '_AUDIENCE_PREFIX_RAW',
        '_AUDIENCE_PREFIX', 'audience_for_event', 'roles_in_audience', 'message_visible',
        'norm_event_key', '_EVENT_KEY_DATE_RES'}

FORECAST_KEYS = [
    '本期报单已开放', '预报催单', '预报·新期次',
    'forecast_period_open_43', 'forecast_remind_emp_23', 'forecast_extra_alloc|43|1',
]
SENSITIVE_KEYS = [
    '盈亏快报', '经营日报', '经营卡简报', '应收逾期提醒', '异常支出预警', '合同到期提醒',
    'AI 经营洞察', '今日经营洞察', '档案健康检查', '客户流失预警',
    '库存预警', '效期预警·紧急', '效期预警·提醒', '定时任务·x',
]


def load(src):
    """抠出受众规则与判定函数，exec 到只给假依赖的命名空间。"""
    tree = ast.parse(src)
    ns = {'__builtins__': __builtins__, 're': __import__('re')}
    for node in tree.body:
        take = False
        if isinstance(node, ast.Assign):
            take = any(isinstance(x, ast.Name) and x.id in WANT for x in node.targets)
        elif isinstance(node, ast.FunctionDef):
            take = node.name in WANT
        if take:
            exec(compile(ast.Module(body=[node], type_ignores=[]), '<finance>', 'exec'), ns)
    return ns


def checks(src):
    """同一套判据，好样本应返回空列表；坏样本必须返回非空（这就是判别力自证）。"""
    ns = load(src)
    afe, mv = ns['audience_for_event'], ns['message_visible']
    exact, pref = ns['_AUDIENCE_EXACT'], ns['_AUDIENCE_PREFIX_RAW']
    bad = []

    def ok(cond, label):
        if not cond:
            bad.append(label)

    all_rules = list(exact.items()) + list(pref.items())
    ok(sum(1 for _, v in all_rules if 'guide' in v) == 8, '恰好 8 条报单线规则含 guide')
    for k in FORECAST_KEYS:
        ok('guide' in afe(k), '受众表：%s 含 guide' % k)
        ok(mv('x', k, '', ['guide'], set()) is True, '真判据：guide 可见 %s' % k)
    for k in SENSITIVE_KEYS:
        ok('guide' not in afe(k), '受众表：%s 不含 guide' % k)
        ok(mv('x', k, '', ['guide'], set()) is False, '真判据：guide 不可见 %s' % k)
    ok('guide' not in ns['DEFAULT_AUDIENCE'], 'DEFAULT_AUDIENCE 不含 guide')
    # 定向优先：被点名才可见；角色在受众里也不能把别人的催单广播过来
    ok(mv('预报催单', 'forecast_remind_emp_23', '999943', ['guide'], {'999943'}) is True,
       '定向命中可见')
    ok(mv('预报催单', 'forecast_remind_emp_23', '999943', ['guide'], {'999900'}) is False,
       '定向未命中不可见')
    # 对照组：原六个角色一字不放；会计本来就能看应收逾期（别把它写成反例）
    for r in ['admin', 'boss', 'sales', 'supervisor', 'distributor', 'staff']:
        ok(mv('x', 'forecast_period_open_43', '', [r], set()) is True, '%s 仍可见开放通知' % r)
    ok(mv('x', '应收逾期提醒', '', ['accountant'], set()) is True, 'accountant 仍可见应收逾期')
    ok(mv('x', '应收逾期提醒', '', ['driver'], set()) is False, 'driver 仍不可见应收逾期')
    return bad


def main():
    src = open(FINANCE, encoding='utf-8').read()
    print('[v773] 被测源码 =', os.path.abspath(FINANCE))
    bad = checks(src)
    for b in bad:
        print('  ❌', b)
    print('[v773] 主检查：%s（%d 条判据）' % ('ALL PASS' if not bad else 'FAILED', 40))
    if bad:
        return 1

    # ── 坏样本自证：每条都要被上面那套判据抓出来 ──
    mutants = [
        ('退回 v330 旧口径（8 条规则全撤 guide）',
         src.replace(',staff,guide"', ',staff"')),
        ('把 guide 也塞进「应收逾期提醒」（客户名＋欠款金额泄密）',
         src.replace('"应收逾期提醒": "admin,boss,accountant"',
                     '"应收逾期提醒": "admin,boss,accountant,guide"')),
        ('把 DEFAULT_AUDIENCE 改成含 guide（未登记事件全放行）',
         src.replace('DEFAULT_AUDIENCE = "admin,boss"',
                     'DEFAULT_AUDIENCE = "admin,boss,guide"')),
        ('拆掉定向优先（别人的催单会广播给所有导购）',
         src.replace('    if rc:\n        return rc in user_ids',
                     '    if rc and False:\n        return rc in user_ids')),
    ]
    print('[v773] 坏样本自证（每条都必须被检出）')
    failed = 0
    for label, mutant in mutants:
        assert mutant != src, '坏样本没改动源码：' + label
        hit = checks(mutant)
        print('  %s %s → 检出 %d 条' % ('✅' if hit else '❌', label, len(hit)))
        if not hit:
            print('      🔴 判据没有牙齿，护栏是空白支票')
            failed += 1
    print('[v773] 判定：%s' % ('ALL PASS' if not failed else 'FAILED %d' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
