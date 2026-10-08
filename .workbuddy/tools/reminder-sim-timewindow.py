#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模拟自证：复刻 scheduler._should_run 的真实语义，证明「带时间窗的任务」的触发概率。

复刻依据（server/scheduler.py:174-179 原文）：
    def _should_run(name, interval_sec, now):
        last = _monitors_run.get(name)
        if last is None or (now - last).total_seconds() >= interval_sec:
            _monitors_run[name] = now     # ← 返回 True 时无条件记账
            return True
        return False

调用处（:128）：
    if _should_run("forecast_reminder", 3600, now) and now.hour in (9, 16) and now.minute < 5:

⇒ 时间窗只在「_should_run 恰好返回 True 的那一分钟」被检查。
"""
from datetime import datetime, timedelta

LOOP_SEC = 60


def simulate(start_hhmm, interval_sec, win_hours, win_minutes, hours=24, phase=None):
    """start_hhmm: 进程启动时刻 'HH:MM'；返回该窗口在 24h 内被触发的次数。
    phase: 若给出，则把启动时刻的秒数当作相位（模拟 'HH:MM:SS'）。"""
    h, m = [int(x) for x in start_hhmm.split(':')]
    t = datetime(2026, 9, 28, h, m, phase or 0)
    end = t + timedelta(hours=hours)
    monitors = {}
    fired = 0
    checks = 0
    while t < end:
        last = monitors.get('forecast_reminder')
        if last is None or (t - last).total_seconds() >= interval_sec:
            monitors['forecast_reminder'] = t
            # 这一轮 _should_run 返回 True → 才轮到时间窗被判
            if t.hour in win_hours and t.minute < win_minutes:
                fired += 1
            checks += 1
        t += timedelta(seconds=LOOP_SEC)
    return fired, checks


print('=' * 70)
print('A. 报单催单（窗口 9:00-9:05 与 16:00-16:05，间隔 3600s）')
print('   ——对 24 小时里每一分钟都当一次「进程启动时刻」，看能不能命中')
print('=' * 70)

hit_starts = []
for total_min in range(24 * 60):
    hh, mm = divmod(total_min, 60)
    f, _ = simulate('%02d:%02d' % (hh, mm), 3600, (9, 16), 5, hours=24)
    if f:
        hit_starts.append('%02d:%02d' % (hh, mm))

print('   能命中的启动时刻共 %d / 1440 分钟 = %.2f%%' % (
    len(hit_starts), 100.0 * len(hit_starts) / 1440))
print('   它们是: %s' % (', '.join(hit_starts[:40]) + (' …' if len(hit_starts) > 40 else '')))

print()
print('=' * 70)
print('B. 今天（9/28）的真实相位：服务 07:32 启动')
print('=' * 70)
f, c = simulate('07:32', 3600, (9, 16), 5, hours=20)
print('   到 24 小时内命中次数 = %d  （_should_run 返回 True 的次数 = %d）' % (f, c))
print('   _should_run 返回 True 的时刻应为: 07:32, 08:32, 09:32, 10:32 …')
print('   其中 hour∈{9,16} 的只有 09:32 / 16:32，而 minute=32 不满足 <5 ⇒ 全天 0 次')

print()
print('=' * 70)
print('C. 对照组：不带时间窗的任务（库存预警 1800s / 应收逾期 3600s）')
print('=' * 70)
f2, c2 = simulate('07:32', 1800, (9, 16), 5, hours=24)
print('   同一启动时刻下，仅靠间隔（1800s）触发的次数 = %d 次/24h' % c2)
print('   ⇒ 不带时间窗者照跑，带时间窗者归零。这就是 722/417 条 vs 0 条的机制来源。')

print()
print('=' * 70)
print('D. 同病相怜：其他「带时间窗」任务的同款命中率')
print('=' * 70)
for name, hr, mn_from, mn_to, wsec in [
    ('morning_report 早报 8:00-8:05', 8, 0, 5, 86400),
    ('ai_daily_insight 洞察 7:30-7:35', 7, 30, 35, 86400),
    ('llm_insight 洞察 7:35-7:40', 7, 35, 40, 86400),
    ('copilot_cards_brief 8:05-8:10', 8, 5, 10, 86400),
]:
    cnt = 0
    for total_min in range(24 * 60):
        hh, mm = divmod(total_min, 60)
        t = datetime(2026, 9, 28, hh, mm)
        end = t + timedelta(hours=24)
        monitors = {}
        while t < end:
            last = monitors.get('x')
            if last is None or (t - last).total_seconds() >= wsec:
                monitors['x'] = t
                if t.hour == hr and mn_from <= t.minute < mn_to:
                    cnt += 1
                    break
            t += timedelta(seconds=LOOP_SEC)
    print('   %-34s 能命中的启动时刻 = %d / 1440 (%.2f%%)' % (
        name, cnt, 100.0 * cnt / 1440))
