# -*- coding: utf-8 -*-
"""v773 建立 / v774 修订 / v775（B 方案）拆分：导购只进「面向全体报单人的广播」。

被测代码 = 磁盘真源码（AST 抠出受众常量与判定函数 → exec，不 import 后端包）。
默认读本地回拉镜像；生产复跑时传 V773_FINANCE=/opt/hergent-erp/db/queries/finance.py，
或 `ssh ... 'cd /opt/hergent-erp && python3 -' < 本脚本`（stdin 路径兜底见 _CANDIDATES）。

🔴 为什么必须「被真正执行」：只把名字写进/撤出规则表不算修好 —— 判据要用
   `message_visible()` 真跑出「导购可见期次开放、不可见管理兜底、不可见客户欠款」，
   「管理链可见兜底、一线角色不可见兜底」，并有坏样本自证。

版本线：
  v773 8 条报单线规则一锅端补 guide ⇒ 导购 0→31，其中 11 条是 `预报催单 · 报单期次`
        兜底广播（无 recipients，正文含别人的单元名「唐成」＋金额）。
  v774 只撤 3 条催单规则 ⇒ 31→20；定向催单靠 `recipients` 定向优先，不受受众表影响。
  v775 写端把管理兜底广播拆成独立 event_key `forecast_reminder_unbound`，受众登记
        管理链 `admin,boss,supervisor`；旧 `预报催单` 精确/前缀键只为存量 11 行保留、
        受众必须一模一样。写端结构判据在 hergent-cn-v2/tests 的 ㊾ 契约里（本脚本
        只管 finance.py 的判定内核，分工不重叠）。
"""
import ast
import os
import sys

# 🔴 不能只靠「__file__ 是否抛 NameError」判断本地/生产：实测 `python3 -` 喂 stdin 时
#    `__file__` **有定义**（值是 `-`）⇒ os.path.abspath 拼出
#    `/opt/hergent-erp/../remote-erp/...`，脚本直接 FileNotFoundError 跑不起来。
#    判据改成「候选路径是否真的存在」，本地镜像 / 生产路径 / 环境变量三种入口都吃下。
_CANDIDATES = [
    os.environ.get('V773_FINANCE'),
    (os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'remote-erp',
                  'db', 'queries', 'finance.py') if '__file__' in globals() else None),
    '/opt/hergent-erp/db/queries/finance.py',
]
FINANCE = next((p for p in _CANDIDATES if p and os.path.exists(p)), _CANDIDATES[-1])
WANT = {'AUDIENCE_ALL', 'DEFAULT_AUDIENCE', '_AUDIENCE_EXACT', '_AUDIENCE_PREFIX_RAW',
        '_AUDIENCE_PREFIX', 'audience_for_event', 'roles_in_audience', 'message_visible',
        'norm_event_key', '_EVENT_KEY_DATE_RES'}

SEVEN = 'admin,boss,sales,supervisor,distributor,staff,guide'
SIX = 'admin,boss,sales,supervisor,distributor,staff'
MGMT = 'admin,boss,supervisor'
UNBOUND = 'forecast_reminder_unbound'
# 导购该看的（期次开放类广播）
GUIDE_VISIBLE_KEYS = [
    '本期报单已开放', '预报·新期次', 'forecast_period_open_43', 'forecast_extra_alloc|43|1',
]
# 🔴 必须含生产真实落库的存量兜底 event_key **和 v775 新键**
UNBOUND_KEYS = ['预报催单', '预报催单 · 报单期次', UNBOUND]
GUIDE_HIDDEN_KEYS = UNBOUND_KEYS + ['forecast_remind_emp_23']
SENSITIVE_KEYS = [
    '盈亏快报', '经营日报', '经营卡简报', '应收逾期提醒', '异常支出预警', '合同到期提醒',
    'AI 经营洞察', '今日经营洞察', '档案健康检查', '客户流失预警',
    '库存预警', '效期预警·紧急', '效期预警·提醒', '定时任务·x',
]
MGMT_ROLES = ['admin', 'boss', 'supervisor']
FRONT_ROLES = ['sales', 'staff', 'distributor', 'guide']
ALL_ROLES = MGMT_ROLES + ['sales', 'staff', 'distributor', 'guide']
# 写端若不显式传 event_key，标题会被归一化成这个存量键 ⇒ v773 的共用前缀病根
UNBOUND_TITLE = '11月05日 预报催单 · 2026-11-05 报单期次'


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
    ok(sum(1 for _, v in all_rules if 'guide' in v) == 5, '恰好 5 条报单线规则含 guide')
    ok(sum(1 for _, v in all_rules if v == MGMT) == 3, '恰好 3 条管理兜底规则是管理链名单')
    ok(sum(1 for _, v in all_rules if v == SIX) == 1, '恰好 1 条定向催单规则是原六角色名单')
    # 存在性：只查上限不查存在 = 空白支票（删键也能凑出「恰好 N 条」）
    ok(len(exact) >= 4 and len(pref) >= 5, '两张受众表结构完整（不许删键凑数）')
    ok(exact.get(UNBOUND) == MGMT, '新键已登记且受众恰为管理链')
    ok(pref.get('预报催单') == exact.get(UNBOUND), '存量前缀与新键受众同口径（不许漂移）')
    ok(UNBOUND not in pref, '前缀表没有冗余的新键副本')
    # 🔴 真跑归一化：证明「写端漏传 event_key ⇒ 退回存量键」这条结构病根不是猜的
    ok(ns['norm_event_key'](UNBOUND_TITLE) == '预报催单 · 报单期次',
       '归一标题确实落回存量兜底键（写端必须显式传新键）')

    for k in GUIDE_VISIBLE_KEYS:
        ok('guide' in afe(k), '受众表：%s 含 guide' % k)
        ok(mv('x', k, '', ['guide'], set()) is True, '真判据：guide 可见 %s' % k)
    for k in GUIDE_HIDDEN_KEYS:
        ok('guide' not in afe(k), '受众表：%s 不含 guide' % k)
        ok(mv('x', k, '', ['guide'], set()) is False, '真判据：guide 不可见 %s' % k)
    for k in SENSITIVE_KEYS:
        ok('guide' not in afe(k), '受众表：%s 不含 guide' % k)
        ok(mv('x', k, '', ['guide'], set()) is False, '真判据：guide 不可见 %s' % k)
    ok('guide' not in ns['DEFAULT_AUDIENCE'], 'DEFAULT_AUDIENCE 不含 guide')

    # v775 核心：兜底广播只给管理链，一线/外部角色（含导购）一条都看不到
    for r in MGMT_ROLES:
        for k in UNBOUND_KEYS:
            ok(mv('x', k, '', [r], set()) is True, '%s 可见兜底 %s' % (r, k))
    for r in FRONT_ROLES:
        for k in UNBOUND_KEYS:
            ok(mv('x', k, '', [r], set()) is False, '%s 不可见兜底 %s' % (r, k))
    # 开放类不许误伤：全员（含导购）仍可见
    for r in ALL_ROLES:
        for k in GUIDE_VISIBLE_KEYS:
            ok(mv('x', k, '', [r], set()) is True, '%s 仍可见开放类 %s' % (r, k))
    # 定向优先：点名给本人的催单照收，不依赖受众表
    ok(mv('预报催单', 'forecast_remind_emp_23', '999943', ['guide'], {'999943'}) is True,
       '定向命中可见（不依赖受众表）')
    ok(mv('预报催单', 'forecast_remind_emp_23', '999943', ['guide'], {'999900'}) is False,
       '定向未命中不可见')
    ok(mv('x', UNBOUND, '999918', ['guide'], {'999943'}) is False,
       '兜底行若被人级定向，也不因受众表外泄')
    ok(mv('x', '应收逾期提醒', '', ['accountant'], set()) is True, 'accountant 仍可见应收逾期')
    ok(mv('x', '应收逾期提醒', '', ['driver'], set()) is False, 'driver 仍不可见应收逾期')
    return bad


def set_rule_value(src, key, old, new):
    """把某条规则的名单换成另一个值（用真实当前值做 needle，防坏样本静默不改动）。"""
    needle = '"%s": "%s"' % (key, old)
    i = src.rfind(needle)
    assert i >= 0, '找不到规则：%s = %s' % (key, old)
    return src[:i] + src[i:].replace(needle, '"%s": "%s"' % (key, new), 1)


def main():
    src = open(FINANCE, encoding='utf-8').read()
    print('[v775] 被测源码 =', os.path.abspath(FINANCE))
    bad = checks(src)
    for b in bad:
        print('  ❌', b)
    print('[v775] 主检查：%s' % ('ALL PASS' if not bad else 'FAILED %d 条' % len(bad)))
    if bad:
        return 1

    # ── 坏样本自证：每条都要被上面那套判据抓出来 ──
    mutants = [
        ('退回 v330 旧口径（5 条规则全撤 guide）',
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
        ('前缀「预报催单」加回 guide（v773 误伤复发）',
         set_rule_value(src, '预报催单', MGMT, SEVEN)),
        ('`forecast_remind_emp_` 加回 guide（冗余规则复发）',
         set_rule_value(src, 'forecast_remind_emp_', SIX, SEVEN)),
        # ── v775 新增 ──
        ('新键受众改回原六角色（一线又看到金额）',
         set_rule_value(src, UNBOUND, MGMT, SIX)),
        ('新键受众含 guide（v773 误伤换个键复发）',
         set_rule_value(src, UNBOUND, MGMT, SEVEN)),
        ('存量前缀与新键受众漂移（两套口径）',
         set_rule_value(src, '预报催单', MGMT, SIX)),
        ('删掉新键（落 DEFAULT，主管少看兜底）',
         src.replace('    "%s": "%s",  # v775 管理兜底（新行）\n' % (UNBOUND, MGMT), '')),
    ]
    print('[v775] 坏样本自证（每条都必须被检出）')
    failed = 0
    for label, mutant in mutants:
        assert mutant != src, '坏样本没改动源码：' + label
        hit = checks(mutant)
        print('  %s %s → 检出 %d 条' % ('✅' if hit else '❌', label, len(hit)))
        if not hit:
            print('      🔴 判据没有牙齿，护栏是空白支票')
            failed += 1
    print('[v775] 判定：%s' % ('ALL PASS' if not failed else 'FAILED %d' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
