#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`drop_plus_lines` + `dropped` 的反证自测（2026-09-21 恢复后补）。

背景：这两个能力原本在 v224（2026-09-21）加进 scoped_stage_by_marker.py，但**从未入库**；
本轮因一次误操作（`git checkout -- .workbuddy`）把它连同工具的 619 行未提交改动一起抹掉，
只留下 `__pycache__/*.pyc` 与技能 §5.29 作为依据 ⇒ 按语义重建后，必须**证明它是活的**。

判据（每条都要「正例过、反例被抓」）：
  ① 正常中间段：保留/挖掉逐行正确
  ② 贴头（idx[0]==1）必须炸
  ③ 贴尾（idx[-1]==len(plus)）必须炸
  ④ 不连续必须炸
  ⑤ 越界必须炸
  ⑥ 端到端：残留 hunk 数 == 公式期望（每处 +1）—— 用真 git diff -U0 数，不靠推理
"""
import os
import subprocess
import sys
import tempfile
import types

ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'
TOOL = os.path.join(ROOT, '.workbuddy/tools/scoped_stage_by_marker.py')

src = open(TOOL, encoding='utf-8').read()
tail = src.rstrip()
assert tail.endswith('main()'), '尾部不是裸 main() 调用，本测试的剥离手法要跟着改'
mod = types.ModuleType('tool_under_test')
exec(compile(tail[:-len('main()')], TOOL, 'exec'), mod.__dict__)
apply = mod.apply_drop_plus_lines

bad = 0


def expect_boom(name, fn, *a):
    global bad
    try:
        fn(*a)
    except AssertionError as e:
        print('  ok   反证被抓住  %-22s %s' % (name, str(e)[:64]))
        return
    except Exception as e:
        print('  BAD  抛的不是 AssertionError %s: %r' % (name, e)); bad += 1; return
    print('  BAD  本该炸却没炸：%s' % name); bad += 1


PLUS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7']

print('① 正常中间段（0-based 挖 [1,2] → 留 [0,3,4,5,6]）')
keep, gone = apply(list(PLUS), [1, 2], 331)
ok = keep == [PLUS[0]] + PLUS[3:] and gone == PLUS[1:3]
print('  %s  留=%r 挖=%r' % ('ok ' if ok else 'BAD', keep, gone))
bad += 0 if ok else 1

print('②..⑤ 反证')
expect_boom('贴头 idx=[0,1]', apply, list(PLUS), [0, 1], 1)
expect_boom('贴尾 idx=[5,6]', apply, list(PLUS), [5, 6], 1)
expect_boom('不连续 [2,4]', apply, list(PLUS), [2, 4], 1)
expect_boom('越界 [2,99]', apply, list(PLUS), [2, 99], 1)
expect_boom('空表', apply, list(PLUS), [], 1)

print('⑥ 端到端：残留 hunk 数 == 每处 +1')
d = tempfile.mkdtemp()
repo = os.path.join(d, 'r')
os.makedirs(repo)


def g(*a, **kw):
    return subprocess.run(['git', '-C', repo] + list(a), capture_output=True, text=True, **kw)


g('init', '-q')
g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
head = 'A\nB\nC\n'
open(os.path.join(repo, 'f.txt'), 'w').write(head)
g('add', 'f.txt'); g('commit', '-qm', 'base')
# 我的块 0,3,4,5,6；v215 的夹在中间 1,2
mine_plus = ['my0', 'v215a', 'v215b', 'my3', 'my4', 'my5', 'my6']
wt = 'A\n' + '\n'.join(mine_plus) + '\nB\nC\n'
open(os.path.join(repo, 'f.txt'), 'w').write(wt)
# 工具会这样构造暂存版：纯插入 hunk os=2，挖掉 1,2
keep, gone = apply(list(mine_plus), [1, 2], 2)
staged = 'A\n' + '\n'.join(keep) + '\nB\nC\n'
open(os.path.join(d, 'staged.txt'), 'w').write(staged)
resid = subprocess.run(['git', '-C', repo, 'diff', '-U0', '--no-index',
                        '--', os.path.join(d, 'staged.txt'), os.path.join(repo, 'f.txt')],
                       capture_output=True, text=True).stdout
n_resid = len([1 for l in resid.splitlines() if l.startswith('@@')])
ok = n_resid == 1
print('  %s  残留 hunk=%d（期望 1 = n_extra_resid 每处 +1）' % ('ok ' if ok else 'BAD', n_resid))
bad += 0 if ok else 1
print('  残留 diff 片段：')
for l in resid.splitlines():
    if l.startswith('@@') or l.startswith('+') or l.startswith('-'):
        print('     ' + l[:70])
print('  挖掉的行 =', gone)

print('⑦ dropped 判据：暂存 0 且 工作区 >0（含三条反面）')
dok = mod.dropped_ok
for (a, b), exp, why in [((0, 1), True, '正例：我故意没交、别人还在'),
                         ((0, 3), True, '正例：同上（多份）'),
                         ((0, 0), False, '反面：HEAD 里本来就没有 ⇒ dropped 不适用'),
                         ((1, 1), False, '反面：HEAD 里本就有 ⇒ 不适用（v226 踩过）'),
                         ((1, 0), False, '反面：这是 gone 的活，不是 dropped 的'),
                         ((2, 5), False, '反面：没挖干净（还有我的行落下了）')]:
    got = dok(a, b)
    ok = got == exp
    print('  %s  dropped_ok(暂存=%d, 工作区=%d) = %-5s  期望 %-5s  %s'
          % ('ok ' if ok else 'BAD', a, b, got, exp, why))
    bad += 0 if ok else 1

print('=' * 62)
print('结论：%s（%d 项不合格）' % ('PASS' if bad == 0 else 'FAIL', bad))
sys.exit(1 if bad else 0)