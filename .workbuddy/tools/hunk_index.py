#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""列出某文件每个 hunk 的「旧侧起始行 + 首条新增行」，用于人工分类归属。

为什么需要它：scoped 提交时同一文件里常同时含「本轮改动」与「上一轮/并发会话的在途改动」，
Hergent 的 Forecast.vue 实测有 59 个 hunk。逐个人眼看 diff 太慢，先出一张索引表，
再用内容标记（markers）精确认领 —— 标记必须命中恰好 1 个 hunk。

用法: python3 hunk_index.py <仓库路径> <文件相对路径> [最多显示多少条新增行]
"""
import re
import subprocess
import sys

repo, path = sys.argv[1], sys.argv[2]
lim = int(sys.argv[3]) if len(sys.argv) > 3 else 1

out = subprocess.run(['git', '-C', repo, 'diff', '-U0', '--', path],
                     capture_output=True, text=True).stdout
hunks, cur = [], None
for ln in out.splitlines():
    if ln.startswith('@@'):
        m = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', ln)
        cur = {'os': int(m.group(1)), 'oc': int(m.group(2) or 1),
               'ns': int(m.group(3)), 'nc': int(m.group(4) or 1), 'plus': [], 'minus': []}
        hunks.append(cur)
    elif cur is not None:
        if ln.startswith('+'):
            cur['plus'].append(ln[1:].strip())
        elif ln.startswith('-'):
            cur['minus'].append(ln[1:].strip())

print('%s：%d 个 hunk' % (path, len(hunks)))
print('%-8s %-6s %-6s %-6s %s' % ('旧起', '旧数', '新起', '新数', '首条新增 / 首条删除'))
print('-' * 110)
for h in hunks:
    head = ' / '.join((h['plus'][:lim] or h['minus'][:lim])[:lim])[:96]
    print('%-8d %-6d %-6d %-6d %s' % (h['os'], h['oc'], h['ns'], h['nc'], head))
