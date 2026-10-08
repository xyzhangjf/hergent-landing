#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v304 判据台：证明「带时间窗的调度任务」从 8% 命中率修到 100%。

核心手法：**从真实源码 `ast.get_source_segment` 提取 `_should_run` / `_should_run_at`
再 exec** —— 不复制实现。复制就会出现两份实现，改一处漏一处（本项目反复栽的同一类坑）。

判别力自证：同一场景同时跑「旧组合」（`_should_run(...) and now.hour==X`）与
「新函数」（`_should_run_at(...)`），证明**不是"本来就不显示"**。

跑法：python3 v304-scheduler-timewindow-verify.py
"""
import ast
import re
import sys
from datetime import datetime, timedelta

SRC = '/Users/zhangjunfeng/Documents/hergent-erp/server/scheduler.py'
LOOP_SEC = 60

PASS = 0
FAIL = 0


def ok(cond, msg, extra=''):
    global PASS, FAIL
    tail = ('  -> ' + str(extra)) if extra != '' else ''
    if cond:
        PASS += 1
        print('  [OK] ' + msg + tail)
    else:
        FAIL += 1
        print('  [XX] ' + msg + tail)


# ============================================================
# §0 装载真实代码
# ============================================================
print('=== §0 从真实源码提取函数（不复制实现）===')
with open(SRC, encoding='utf-8') as f:
    SRC_TEXT = f.read()
TREE = ast.parse(SRC_TEXT)

SEGS = {}
for node in TREE.body:
    if isinstance(node, ast.FunctionDef) and node.name in ('_should_run', '_should_run_at'):
        SEGS[node.name] = ast.get_source_segment(SRC_TEXT, node)

ok('_should_run' in SEGS, '提取到 _should_run（旧，给纯间隔任务用）')
ok('_should_run_at' in SEGS, '提取到 _should_run_at（v304 新增）',
   '%d 字节' % len(SEGS.get('_should_run_at', '')))

LOGS = []


def _cap_print(*a, **k):
    LOGS.append(' '.join(str(x) for x in a))


NS = {'_monitors_run': {}, 'print': _cap_print}
for _name, _code in SEGS.items():
    exec(_code, NS)


# ============================================================
# §1 任务清单（与源码一一对应）
# ============================================================
# (name, interval_sec, 旧实现的时间窗判定, 新实现的 kwargs, 24h 内期望次数, 「能否触发」扫描跨度/小时)
# ⚠️ 第 6 项是**判据台自己的参数**，与被测代码无关：跨度的选取必须 >= 该任务的周期，
#    否则「必然触发」会被误判成「命中率不足」。catalog_health 是**每周**一次（7 天），
#    用 24 小时衡量它只会得到 33.68%（= 24h 里窗口落进区间的比例），那不是缺陷。
def _first5(n):
    return n.minute < 5


TASKS = [
    ('auto_backup',          86400,  lambda n: n.hour == 2 and _first5(n),        dict(hours=(2,)),                            1, 24),
    ('procurement_plan',     86400,  lambda n: n.hour == 6 and _first5(n),        dict(hours=(6,)),                            1, 24),
    ('ai_daily_insight',     86400,  lambda n: n.hour == 7 and 30 <= n.minute < 35, dict(hours=(7,), minute_from=30, minute_to=35), 1, 24),
    ('llm_insight',          86400,  lambda n: n.hour == 7 and 35 <= n.minute < 40, dict(hours=(7,), minute_from=35, minute_to=40), 1, 24),
    ('morning_report',       86400,  lambda n: n.hour == 8 and _first5(n),        dict(hours=(8,)),                            1, 24),
    ('dunning_eval',         86400,  lambda n: n.hour == 8 and _first5(n),        dict(hours=(8,)),                            1, 24),
    ('timeline_generate',    86400,  lambda n: n.hour == 8 and _first5(n),        dict(hours=(8,)),                            1, 24),
    ('commitment_due',       86400,  lambda n: n.hour == 8 and _first5(n),        dict(hours=(8,)),                            1, 24),
    ('copilot_cards_brief',  86400,  lambda n: n.hour == 8 and 5 <= n.minute < 10, dict(hours=(8,), minute_from=5, minute_to=10),   1, 24),
    ('forecast_reminder',     3600,  lambda n: n.hour in (9, 16) and _first5(n),  dict(hours=(9, 16)),                         2, 24),
    ('catalog_health',      604800,  lambda n: n.hour == 8 and _first5(n),        dict(hours=(8,), weekday=0),                 1, 168),
]

# 今天的真实起点：2026-09-28（周一）00:00 —— 覆盖全部窗口一次
BASE = datetime(2026, 9, 28, 0, 0)


def sim_old(name, interval, win, start, horizon_h=24):
    """旧组合：_should_run 返回 True 的那一分钟才轮到时间窗被判。"""
    NS['_monitors_run'].clear()
    t, end, fired = start, start + timedelta(hours=horizon_h), 0
    while t < end:
        if NS['_should_run'](name, interval, t) and win(t):
            fired += 1
        t += timedelta(seconds=LOOP_SEC)
    return fired


def sim_new(name, interval, kwargs, start, horizon_h=24):
    NS['_monitors_run'].clear()
    t, end, fired = start, start + timedelta(hours=horizon_h), 0
    while t < end:
        if NS['_should_run_at'](name, t, interval_sec=interval, **kwargs):
            fired += 1
        t += timedelta(seconds=LOOP_SEC)
    return fired


# ============================================================
# §2 判别力自证：1440 个启动时刻全遍历（星标任务 = 报单催单）
# ============================================================
print()
print('=== §2 判别力自证：24 小时内能否触发（遍历 1440 个启动时刻）===')
print('    星标任务 = forecast_reminder（报单催单，窗口 9:00-9:05 / 16:00-16:05）')

for name, interval, win, kwargs, _exp, sw_h in TASKS:
    old_hit = new_hit = 0
    for m in range(1440):
        s = BASE + timedelta(minutes=m)
        if sim_old(name, interval, win, s, horizon_h=sw_h) > 0:
            old_hit += 1
        if sim_new(name, interval, kwargs, s, horizon_h=sw_h) > 0:
            new_hit += 1
    old_pct = 100.0 * old_hit / 1440
    new_pct = 100.0 * new_hit / 1440
    mark = '★' if name == 'forecast_reminder' else ' '
    ok(new_pct == 100.0, '%s %-20s 新实现命中率 %.2f%%（旧 %.2f%%，跨度 %dh）'
       % (mark, name, new_pct, old_pct, sw_h))
    if name == 'forecast_reminder':
        ok(old_pct < 10.0, '★ 旧实现命中率确实极低（%.2f%%）⇒ 不是"本来就不显示"' % old_pct)

# ============================================================
# §3 今天真实起点下的表现
# ============================================================
print()
print('=== §3 今天（9/28 周一）从 00:00 起 24 小时的真实触发次数 ===')
for name, interval, win, kwargs, exp, _sw in TASKS:
    o = sim_old(name, interval, win, BASE)
    n = sim_new(name, interval, kwargs, BASE)
    ok(n == exp, '%-20s 新实现 %d 次（期望 %d），旧实现 %d 次' % (name, n, exp, o), '')

# 今天的真实启动相位（服务 07:32 起）
print()
print('--- 复现"今天为什么漏"：服务 07:32 启动 ---')
PHASE = datetime(2026, 9, 28, 7, 32)
o = sim_old('forecast_reminder', 3600, TASKS[9][2], PHASE)
n = sim_new('forecast_reminder', 3600, TASKS[9][3], PHASE)
ok(o == 0, '旧实现：07:32 启动时 24h 内触发 %d 次（= 漏掉）' % o)
ok(n == 2, '新实现：07:32 启动时 24h 内触发 %d 次（9:00 + 16:00）' % n)

# ============================================================
# §4 边界
# ============================================================
print()
print('=== §4 边界 ===')
NS['_monitors_run'].clear()
t = datetime(2026, 9, 28, 9, 0)
fired = []
while t < datetime(2026, 9, 28, 9, 10):
    if NS['_should_run_at']('forecast_reminder', t, interval_sec=3600, hours=(9, 16)):
        fired.append(t.strftime('%H:%M'))
    t += timedelta(seconds=LOOP_SEC)
ok(fired == ['09:00'], '窗口内只触发 1 次（间隔节流生效，不重复）', fired)

NS['_monitors_run'].clear()
t = datetime(2026, 9, 28, 8, 59)
fired = []
while t < datetime(2026, 9, 28, 17, 0):
    if NS['_should_run_at']('forecast_reminder', t, interval_sec=3600, hours=(9, 16)):
        fired.append(t.strftime('%H:%M'))
    t += timedelta(seconds=LOOP_SEC)
ok(fired == ['09:00', '16:00'], '跨两个窗口都能触发', fired)

NS['_monitors_run'].clear()
ok(NS['_should_run_at']('morning_report', datetime(2026, 9, 28, 7, 59),
                        interval_sec=86400, hours=(8,)) is False,
   '窗口外返回 False')
ok(NS['_monitors_run'] == {}, '★ 窗口外**不记账**（相位不被污染，这是修复的实质）',
   NS['_monitors_run'])

NS['_monitors_run'].clear()
a = NS['_should_run_at']('morning_report', datetime(2026, 9, 28, 8, 0),
                         interval_sec=86400, hours=(8,))
b = NS['_should_run_at']('morning_report', datetime(2026, 9, 29, 8, 0),
                         interval_sec=86400, hours=(8,))
c = NS['_should_run_at']('morning_report', datetime(2026, 9, 29, 8, 30),
                         interval_sec=86400, hours=(8,))
ok((a, b, c) == (True, True, False), '跨天可再次触发，当天窗口外不触发', (a, b, c))

NS['_monitors_run'].clear()
w = NS['_should_run_at']('catalog_health', datetime(2026, 9, 28, 8, 0),
                         interval_sec=604800, hours=(8,), weekday=0)
ok(w is True, 'weekday 限定生效（周一）')
NS['_monitors_run'].clear()
w2 = NS['_should_run_at']('catalog_health', datetime(2026, 9, 29, 8, 0),
                          interval_sec=604800, hours=(8,), weekday=0)
ok(w2 is False, '周二不触发')

# ============================================================
# §5 可观测性：命中必须留痕
# ============================================================
print()
print('=== §5 可观测性（R8：静默失效必须显式化）===')
LOGS.clear()
NS['_monitors_run'].clear()
NS['_should_run_at']('forecast_reminder', datetime(2026, 9, 28, 9, 0),
                     interval_sec=3600, hours=(9, 16))
ok(len(LOGS) == 1 and 'forecast_reminder' in LOGS[0] and '到点触发' in LOGS[0],
   '命中时打印可 grep 的触发日志（验收抓手）', LOGS[0] if LOGS else '(无)')

LOGS.clear()
NS['_monitors_run'].clear()
NS['_should_run_at']('forecast_reminder', datetime(2026, 9, 28, 3, 0),
                     interval_sec=3600, hours=(9, 16))
ok(len(LOGS) == 0, '窗口外不打印（不刷屏）')

ok('无事可推' in SRC_TEXT,
   '报单催单「跑了但没事可做」也留痕（否则"跑了"与"没跑"日志一模一样）')

# ============================================================
# §6 静态自检：防再犯
# ============================================================
print()
print('=== §6 静态自检（防止未来再写出旧组合）===')
bad = re.findall(r'_should_run\("[a-z_]+",\s*[\w\d]+,\s*now\)\s*and\s+now\.', SRC_TEXT)
ok(len(bad) == 0, '全文件无「_should_run(...) and now.<时间窗>」残留', '%d 处' % len(bad))

n_at = len(re.findall(r'_should_run_at\("', SRC_TEXT))
ok(n_at == 11, '11 个时间窗任务全部改用 _should_run_at', '%d 处' % n_at)

plain = [l for l in SRC_TEXT.split('\n') if '_should_run("' in l]
ok(len(plain) == 18, '18 个纯间隔任务仍用 _should_run（未被误改）', '%d 处' % len(plain))

ok('绝不要' in SRC_TEXT and 'v304' in SRC_TEXT,
   '_should_run 的 docstring 已写入禁止条款（防再犯）')

ok(SRC_TEXT.count('def _should_run_at(') == 1, '_should_run_at 只有一份实现（无第二份）')

# 逐条核对：每个时间窗任务的新 kwargs 与源码一致
print()
for name, interval, win, kwargs, exp, _sw in TASKS:
    pat = '_should_run_at("%s", now, interval_sec=%d' % (name, interval)
    ok(pat in SRC_TEXT, '源码中 %s 的调用签名正确' % name)

print()
print('=== 结果 PASS=%d FAIL=%d ===' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
