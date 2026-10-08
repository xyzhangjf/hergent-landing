#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v396 · UI-SPEC §3.5（全局标签栏）与实现的**一致性自检**。

为什么需要它：规范最典型的失效方式是「写完就与实现脱节」。
本脚本把 §3.5 里写下的**每一条可验证断言**拿去代码里比对，任一不符即 FAIL。
（与 `v395-spec-shell-consistency.py` 同族；那条管 §3.4，这条管 §3.5。）

四类判据：
  A. 类名存在性 —— §3.5 表格里的 `.tab-*` / `.tb-strip` / `.tabbar` 必须在 TabBar.vue 里有定义。
  B. 数值一致性 —— §3.5 写下的关键数值（高度/内距/圆角/字号/z-index/断点）必须与 CSS 逐字相同。
  C. 关键机制   —— §3.5 点了名的机制（上限 18 / EPHEMERAL / 淘汰保护当前 / URL 归一 /
                   标题四层回落 / viewKey 不含 fullPath / 抽屉摊平 …）必须在对应文件里存在。
  D. 反例禁令   —— ① `tabTitle` 里 `PAGE_RULES` 精确命中必须**先于** `pageTitle`（否则子页同名）；
                   ② `viewKey` 定义行**不许**出现 `fullPath`；③ TabBar 模板不许出现 `.main-tabs`。

用法：
  python3 v396-spec-tabbar-consistency.py            # 只报告
  python3 v396-spec-tabbar-consistency.py --strict    # 有 FAIL 则 exit 1
"""
import re
import sys
import os
import io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPEC = os.path.join(ROOT, 'hergent-cn-v2', 'docs', 'UI-SPEC.md')
TABBAR = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'components', 'TabBar.vue')
SHELL = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'components', 'Shell.vue')
USE = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'composables', 'useTabs.js')
TITLES = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'constants', 'tabTitles.js')

spec = io.open(SPEC, encoding='utf-8').read()
bar = io.open(TABBAR, encoding='utf-8').read()
shell = io.open(SHELL, encoding='utf-8').read()
use = io.open(USE, encoding='utf-8').read()
titles = io.open(TITLES, encoding='utf-8').read()

m = re.search(r'### 3\.5 .*?(?=\n## 4\. )', spec, re.S)
if not m:
    print('FAIL  规范里找不到 §3.5')
    sys.exit(1)
sec = m.group(0)
print('§3.5 段落长度：%d 字符' % len(sec))

fails = []


def ck(cond, name, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (('  | ' + detail) if detail else ''))
    if not cond:
        fails.append(name)


# ---------- A. 类名存在性 ----------
print('\n[A] 类名存在性（§3.5 表格 ↔ TabBar.vue 定义）')
CLASSES = ['.tabbar', '.tb-strip', '.tab-item', '.tab-ic', '.tab-title',
           '.tab-refresh', '.tab-close',
           '.tab-more', '.tab-more-btn', '.tab-more-n', '.tab-more-menu', '.tab-more-mask']
for c in CLASSES:
    in_spec = c in sec
    in_code = c in bar
    ck(in_spec and in_code, '%-16s 规范有 ∧ 代码有' % c,
       'spec=%s code=%s' % (in_spec, in_code))

# ---------- B. 数值一致性 ----------
print('\n[B] 数值一致性（规范写的 = 代码里的）')
# ⚠️ 规范侧的串**不带反引号**：文档里多个值常合写在一个反引号对内
#    （如 `` `display:flex;align-items:center;gap:6px;padding:6px 20px` ``），
#    判据若要求「独立反引号对」会**假红**（首版 10 项假红就是这么来的）。
PAIRS = [
    # (说明, 规范里应出现的串, 代码里应出现的串)
    ('条体间距 6px',         'gap:6px',             'gap:6px'),
    ('条体内距 6px 20px',    'padding:6px 20px',    'padding:6px 20px'),
    ('条体 z-index 6',       'z-index:6',           'z-index:6'),
    ('条体 flex-shrink 0',   'flex-shrink:0',       'flex-shrink:0'),
    ('strip gap 4px',        'gap:4px',             'gap:4px'),
    ('strip 裁剪溢出',       'overflow:hidden',     'overflow:hidden'),
    ('标签高 28px',          'height:28px',         'height:28px'),
    ('标签内距 0 7px 0 5px', 'padding:0 7px 0 5px', 'padding:0 7px 0 5px'),
    ('标签 max-width 200px', 'max-width:200px',     'max-width:200px'),
    ('标签字号 12.5px',      '12.5px',              'font-size:12.5px'),
    ('小钮 16×16',           '16×16',               'width:16px;height:16px'),
    ('小钮圆角 5px',         'border-radius:5px',   'border-radius:5px'),
    ('下拉 top 34px',        'top:34px',            'top:34px'),
    ('下拉 min-width 180px', 'min-width:180px',     'min-width:180px'),
    ('下拉 max-height 320px', 'max-height:320px',   'max-height:320px'),
    ('下拉 z-index 40',      'z-index:40',          'z-index:40'),
    ('遮罩 inset:0',         'inset:0',             'inset:0'),
    ('遮罩 z-index 30',      'z-index:30',          'z-index:30'),
    ('角标 11px/600',        '11px/600',            'font-size:11px;font-weight:600'),
    ('溢出入口 gap 5px',     'gap:5px',             'gap:5px'),
    ('窄屏 768px 隐藏',      '≤768px',              '@media(max-width:768px)'),
]
for name, s_need, c_need in PAIRS:
    ck(s_need in sec, '%-22s 规范串 %r' % (name, s_need))
    ck(c_need in bar, '%-22s 代码串 %r' % (name, c_need))

print('\n[B2] 内容区两层（规范 §3.5 ↔ Shell.vue）')
ck('overflow:visible' in shell, 'Shell 有 .content overflow:visible')
ck('overflow-y:auto' in shell, 'Shell 有 .view-wrap overflow-y:auto')

# ---------- C. 关键机制 ----------
print('\n[C] 关键机制（规范点了名，代码必须有）')
MECH = [
    ('上限 18',            'MAX_TABS = 18',               use, 'useTabs'),
    ('EPHEMERAL 三项',     "['__r', 'denied', 'edit_rule']", use, 'useTabs'),
    ('淘汰跳过当前标签',   't.key === activeKey.value) return', use, 'useTabs'),
    ('先激活再淘汰',       'activeKey.value = key',       use, 'useTabs'),
    ('URL 归一注入默认',   'query.tab = def',             use, 'useTabs'),
    ('净化 query',         'EPHEMERAL.indexOf(k) >= 0',   use, 'useTabs'),
    ('effTab 导出',        'export function effTab',      titles, 'tabTitles'),
    ('DEFAULT_SUB_KEY',    'export const DEFAULT_SUB_KEY', titles, 'tabTitles'),
    ('viewKey 只含计数',   "'v' + viewTick.value",        shell, 'Shell'),
    ('刷新=非当前先切过去', 'router.push(tabLink(t))',     shell, 'Shell'),
    ('关尽回首页',         "router.push('/workbench')",    shell, 'Shell'),
    ('抽屉摊平名单',       'EXPLODED_PATHS',              shell, 'Shell'),
    ('抽屉唯一实现',       'function showInDrawer',       shell, 'Shell'),
    ('路由驱动打标签',     'openTab(route)',              shell, 'Shell'),
    ('打印时隐藏标签栏',   '@media print',                bar, 'TabBar'),
]
for name, needle, blob, where in MECH:
    ck(needle in blob, '%-20s 在 %s' % (name, where))

# ---------- D. 反例禁令 ----------
print('\n[D] 反例禁令')
# ⚠️ 反例断言必须跑在**剥掉注释**的源码上：`pageTitle(path)` / `main-tabs` 都出现在注释里，
#    裸 grep 会被注释满足 ⇒ 判据恒真（或恒假）。首版就是这么假红的。


def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'//[^\n]*', '', s)
    return s


use_nc = strip_comments(use)
bar_nc = strip_comments(bar)

# D1. tabTitle 里「PAGE_RULES 精确命中」必须早于「pageTitle 回落」
i_fn = use_nc.find('export function tabTitle')
i_exact = use_nc.find('const exact = PAGE_RULES[path]', i_fn)
i_paget = use_nc.find('pageTitle(path)', i_exact)
ck(i_fn >= 0 and i_exact > i_fn and i_paget > i_exact,
   'tabTitle 层序 = SUB_TITLES → PAGE_RULES 精确 → pageTitle',
   'fn=%d exact=%d pageTitle=%d' % (i_fn, i_exact, i_paget))

# D2. viewKey 定义行不许含 fullPath（否则页内切 tab 会整页重拉）
vk = re.search(r'const viewKey = computed\(\(\) => (.+)\)', shell)
ck(vk is not None, '找到 viewKey 定义行')
if vk:
    ck('fullPath' not in vk.group(1), 'viewKey 不含 fullPath', vk.group(1)[:60])

# D3. TabBar 的模板 / 样式里不许出现模块内页签（已退役）——判真实使用，不判注释提及
ck('class="main-tabs"' not in bar_nc and '.main-tabs{' not in bar_nc,
   'TabBar 模板/样式里无 .main-tabs（模块内页签已退役）')

# D4. 抽屉规则必须「带 tab/q 的才放」（纯直达仍归底部栏，避免双入口）
ck('x.tab || (x.q && Object.keys(x.q).length)' in shell,
   'showInDrawer 只放带 tab/q 的条目')

print('\n' + '=' * 60)
if fails:
    print('FAIL %d 项：' % len(fails))
    for f in fails:
        print('  -', f)
    if '--strict' in sys.argv:
        sys.exit(1)
else:
    print('ALL PASS（§3.5 ↔ TabBar/Shell/useTabs/tabTitles 一致）')
