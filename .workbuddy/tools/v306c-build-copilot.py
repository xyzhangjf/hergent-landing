#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v306c 受控提交：从 HEAD 版重建 CopilotDrawer.vue，只落本轮（v306/v306c）的块。

为什么不 git add 整文件：该文件在工作区里有 62 个 hunk（并行会话的 v309 停止生成 /
H2 多模态 / M1 斜杠命令 / ThinkingDots 等），只有 6 个是本轮的。

为什么不用内置切分键：其中 3 个是**混合 hunk**（我的行与别人的行粘在同一个 @@ 里），
  · hunk os=90  : `-` 侧 2 行 = 我的行 + 别人的下一行；`+` 侧第 1 行 my、其余 4 行 别人的
  · hunk os=92  : `+` 侧前 6 行别人的（v309 停止标记），之后全是我的文件卡
  · hunk os=453 : `+` 侧第 1 行我的（splitMedia），后 3 行别人的（useRouter）
  · hunk os=459 : `+` 侧头 2 行别人的（openThink），中间我的（mediaView/downloadAuthed），尾部别人的（openTools）
⇒ 逐 hunk 显式指定「哪一段是我的」比拼切分键更可读、更可控。

§5.6 铁律：纯插入 hunk（old_count==0）写 lines[a:a] = block（不是 a-1）。
"""
import subprocess, sys

REPO = '/Users/zhangjunfeng/Documents/laozhangai-product'
FP = 'hergent-cn-v2/src/components/CopilotDrawer.vue'
OUT = '/tmp/v306c-CopilotDrawer.vue'

d = subprocess.run(['git', '-C', REPO, 'diff', '-U0', '--', FP],
                   capture_output=True, text=True).stdout

hunks, cur = [], None
for ln in d.split('\n'):
    if ln.startswith('@@'):
        h = ln.split('@@')[1].strip()
        old = h.split()[0][1:]
        a = int(old.split(',')[0])
        n = int(old.split(',')[1]) if ',' in old else 1
        cur = {'os': a, 'nold': n, 'plus': [], 'minus': []}
        hunks.append(cur)
    elif cur is not None:
        if ln.startswith('+') and not ln.startswith('+++'):
            cur['plus'].append(ln[1:])
        elif ln.startswith('-') and not ln.startswith('---'):
            cur['minus'].append(ln[1:])

H = {h['os']: h for h in hunks}


def slice_between(h, start_kw, end_kw):
    """取 h['plus'] 中 [含 start_kw 的行, 含 end_kw 的行) 这一段。"""
    plus = h['plus']
    si = next(i for i, l in enumerate(plus) if start_kw in l)
    ei = next((i for i, l in enumerate(plus) if end_kw in l and i > si), len(plus))
    return plus[si:ei]


# ==== 本轮要落的块（每处都有显式的「起点关键词」，落空会当场 KeyError/StopIteration）====
# 每处返回 (plus, n_replace)：n_replace = 要被覆盖的**旧侧行数**（从 hunk 起点数起）。
# 🔴 混合 hunk 的关键就在这里：os=90 的 `-` 侧有 2 行（我的第 1 行 + 别人的第 2 行），
#    只覆盖 1 行 ⇒ 别人的那行原样留在 HEAD 位置上，留给它的主人。
BLOCKS = {
    # os=90  混合：只替换旧侧第 1 行 → 我的那一行（别人的 ThinkingDots 留给别人）
    90: lambda h: (h['plus'][:1], 1),
    # os=92  混合插入：跳过后出现的 v309「已停止生成」6 行，取我的文件卡那一段
    92: lambda h: (h['plus'][next(i for i, l in enumerate(h['plus'])
                                  if '副驾产出的文件（Hermes' in l):], 0),
    # os=404 产物栏附件卡：整块（注释 2 行 + 替换行）都是我的
    404: lambda h: (h['plus'], h['nold']),
    # os=446 import 补 auth：整块是我的
    446: lambda h: (h['plus'], h['nold']),
    # os=453 混合：只取第 1 行（splitMedia），别人的 useRouter 不进
    453: lambda h: (h['plus'][:1], h['nold']),
    # os=459 混合插入：跳过后出现的头 2 行 openThink，在别人的 openTools 前截断
    459: lambda h: (h['plus'][next(i for i, l in enumerate(h['plus'])
                                  if '副驾产出的文件（Hermes 的' in l):
                             next(i for i, l in enumerate(h['plus'])
                                  if '工具执行情况的展开节奏' in l)], 0),
    # os=1402 CSS .msg-file：整块是我的
    1402: lambda h: (h['plus'], h['nold']),
}

lines = subprocess.run(['git', '-C', REPO, 'show', 'HEAD:' + FP],
                       capture_output=True, text=True).stdout.split('\n')
head_lines = list(lines)

# §5.6：按 os 降序应用，避免位移
for os_ in sorted(BLOCKS, reverse=True):
    h = H[os_]
    plus, nrep = BLOCKS[os_](h)
    a = os_
    assert len(plus) > 0, '空块 os=%d' % a
    if nrep == 0:                       # 纯插入 ⇒ 插在第 a 行**之后**（§5.6：不是 a-1）
        lines[a:a] = plus
    else:                               # 覆盖旧侧连续 nrep 行
        seg = lines[a - 1:a - 1 + nrep]
        assert seg == h['minus'][:nrep], '旧侧不匹配 os=%d\n  expect=%r\n  got   =%r' % (
            a, h['minus'][:nrep], seg)
        lines[a - 1:a - 1 + nrep] = plus

out = '\n'.join(lines)
open(OUT, 'w', encoding='utf-8').write(out)

# ============ 自证 1：本轮判别串必须进来了 ============
MINE = ['v306', 'msg-file', 'downloadAuthed', 'mediaView', 'mediaFiles',
        'mediaHref', 'splitMedia', 'renderMd, splitMedia', 'auth, CHAT_TIMEOUT_NORMAL',
        '副驾产出 · 点击下载', 'cp-art-file msg-file', '.msg-file{']
print('=== ① 本轮改动是否都进了（产物计数 vs HEAD 计数）===')
ok = True
for k in MINE:
    c_new = out.count(k)
    c_head = '\n'.join(head_lines).count(k)
    flag = '✅' if c_new > c_head else '❌'
    if c_new <= c_head:
        ok = False
    print('  %s %-28s 产物=%d HEAD=%d' % (flag, k, c_new, c_head))

# ============ 自证 2：别人的改动必须一笔没进（计数与 HEAD 完全一致）============
OTHERS = ['v309', 'ThinkingDots', 'useRouter', 'openThink', 'toggleThink',
          'cp-stopped', '已停止生成', 'M1：斜杠命令', 'openTools', 'toggleTools',
          'toolsElapsed', 'H2', 'visionBlocks', 'cp-mode-banner', 'SRC-EP-SRC']
print('\n=== ② 并行会话的改动是否一笔未进（产物计数必须 == HEAD 计数）===')
for k in OTHERS:
    c_new = out.count(k)
    c_head = '\n'.join(head_lines).count(k)
    c_ws = open(REPO + '/' + FP, encoding='utf-8').read().count(k)
    flag = '✅' if c_new == c_head else '❌'
    if c_new != c_head:
        ok = False
    print('  %s %-22s 产物=%d HEAD=%d 工作区=%d' % (flag, k, c_new, c_head, c_ws))

print('\n产物行数: HEAD %d → 产物 %d（工作区 %d）' %
      (len(head_lines), len(lines),
       len(open(REPO + '/' + FP, encoding='utf-8').read().split('\n'))))
print('输出: ' + OUT)
print('\n' + ('✅ 两侧自证通过' if ok else '❌ 有断言失败，禁止提交'))
sys.exit(0 if ok else 1)
