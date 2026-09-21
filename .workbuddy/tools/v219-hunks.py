#!/usr/bin/env python3
"""定位本轮（v219 定稿 + 6 项打磨 + ⑤⑥）在 Forecast.vue 里落在哪些 hunk。

用途：给 `scoped_stage_by_marker.py` 的 `own_hunks` 提供**精确**清单 —— 该文件里有
几百个在途 hunk（并发会话 + 历史未提交），`keep_all` 会把别人的半成品一起提交。

判据：一个 hunk 只要**新增行**里出现任一本轮特征串，就算本轮。
反向防漏：跑完后把「未命中但含疑似特征」的 hunk 也列出来（防止特征串写漏）。

跑法：python3 .workbuddy/tools/v219-hunks.py
"""
import re
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
FILE = "hergent-cn-v2/src/pages/Forecast.vue"

# 本轮特征串 —— 全部是**本轮新增**的标识符/类名/文案。
# ⚠️ 不要放过于通用的串（如 'undo'）：那会把别人的在途 hunk 一起圈进来。
OWN = [
    # v219 定稿（期次关闭 = 定稿）
    'periodClosed', 'reopenPeriod', 'onHistoryReopen', '重开',
    # 打磨① 跳最后一处有数据 / ③ Ctrl+Shift 方向键
    'lastDataPos',
    # 打磨② 撤销栈可见
    'undoPanelOpen', 'undoShown', 'undoUpto', 'undoLabel', 'pushBatchSnap',
    # 打磨④ 错误跳转后闪烁
    'flashCell', 'flashAt', 'isFlash', 'cellFlash', 'td.flash',
    # 打磨⑤ 预检一键修复
    'fixCandidate', 'cellNumericMeta', 'fixables', 'manualErrs',
    'openFixPreview', 'applyFixes', 'fixPreviewOpen', 'fix-mask', 'fix-dlg',
    'fix-list', 'fix-old', 'fix-new', 'fix-how', 'err-fixbar', 'err-fixhint',
    # 打磨⑥ 列上限可配
    'canEditRules', 'openRuleEdit', 'saveRuleEdit', 'ruleEditOpen', 'ruleQtyMax',
    'ruleSaving', 'err-rulebtn', 'rule-dlg', 'rule-body', 'rule-input',
    'rule-hint', 'setValidationRules',
]
# 疑似（用于防漏自检）：命中这些但没被 OWN 圈到的 hunk 会单独列出来人工看
SUSPECT = ['打磨', 'v219', 'fix', 'Flash', 'batch']


def hunks(path):
    out = subprocess.run(['git', 'diff', '-U0', '--', path],
                         cwd=REPO, capture_output=True, text=True).stdout
    hs = []
    cur = None
    n = 0
    for line in out.split('\n'):
        m = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', line)
        if m:
            n += 1
            cur = {'no': n, 'start': int(m.group(1)), 'lines': []}
            hs.append(cur)
            continue
        if cur is not None and line:
            cur['lines'].append(line)
    return hs


def main():
    hs = hunks(FILE)
    print('git diff -U0 总 hunk 数: %d' % len(hs))
    own, miss, suspect = [], [], []
    for h in hs:
        added = [l for l in h['lines'] if l.startswith('+')]
        txt = '\n'.join(added)
        hit = [k for k in OWN if k in txt]
        if hit:
            own.append(h['no'])
        else:
            sus = [k for k in SUSPECT if k in txt]
            if sus and len(txt) < 4000:
                suspect.append((h['no'], h['start'], sus, txt[:160].replace('\n', ' | ')))
    print()
    print('== 本轮 hunk（%d 个）==' % len(own))
    print(own)
    print()
    print('== 未命中但含疑似串（%d 个，需人工确认）==' % len(suspect))
    for s in suspect[:25]:
        print('  hunk#%d @line %d  %s\n      %s' % (s[0], s[1], s[2], s[3]))
    if not suspect:
        print('  （无）')
    print()
    print('own_hunks = %s' % own)
    return 0


if __name__ == '__main__':
    sys.exit(main())
