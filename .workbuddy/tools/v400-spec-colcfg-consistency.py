#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v400 · UI-SPEC §2.6.1（列设置入口与序号列）与实现的**一致性自检**。

为什么需要它：规范最典型的失效方式是「写完就与实现脱节」。
本脚本把 §2.6.1 里写下的**每一条可验证断言**拿去代码里比对，任一不符即 FAIL。
（与 `v395-spec-shell-consistency.py` / `v396-spec-tabbar-consistency.py` 同族。）

四类判据：
  A. 类名存在性 —— §2.6.1 表格里的 `.col-cfg` / `.gear` / `.th-in` / `.seq-th` /
                   `.seq-cell` / `.seq-num` / `.col-config-bar` / `.col-menu` /
                   `.col-menu-list` 必须在 Forecast.vue 里有定义。
  B. 数值一致性 —— §2.6.1 写下的关键数值（序号列宽 46px / 齿轮内距 / 圆角 /
                   `top:38px` / `sticky left:0` / z 6 与 9 / 字号 14px …）必须与 CSS 逐字相同。
  C. 关键机制   —— §2.6.1 点了名的机制（`Icon` 的 `settings` 键 / `colOrderList` 注入 seq /
                   `defaultColOrder` **不含** seq / 改单态 `seq-th` + `ri + 1` /
                   查看态 `it.seq` + `seq++` / 两个齿轮共用 `showColMenu`）必须存在。
  D. 反例禁令   —— ① 全站**零** emoji 齿轮（码位 U+2699 / U+FE0F）—— 规范声称「是
                   `<Icon name="settings"/>` 线性图标，**不是** emoji 齿轮」；
                   ② `class="col-cfg gear"` 源码**恰好 2 处**（查看态 / 改单态各一）
                   —— 防「只改一处」漂移；③ `defaultColOrder` 行**不许**出现 `seq`
                   （序号列不在列设置清单里）；④ 「适用范围」分两族验（v401 起）：
                   `.col-cfg` 仍**只**在 Forecast.vue；`.seq-th` / `.seq-cell` /
                   `.seq-num` 已上提为**全局唯一源**（`variables.css`），除 Forecast 与该
                   文件外**不许有第三者**，且两个试点页必须按宿主写法接入；
                   ⑤ **菜单定位契约**（v401）：`.col-menu` / `.edit-col-menu` 必须
                   `position:fixed`，**不许**再写死 `top:38px` / `left:0`
                   （**在剥掉注释的源码上判** —— 否则注释里的说明会把它假绿）。

用法：
  python3 v400-spec-colcfg-consistency.py            # 只报告
  python3 v400-spec-colcfg-consistency.py --strict    # 有 FAIL 则 exit 1
"""
import os
import re
import sys
import io

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPEC = os.path.join(ROOT, 'hergent-cn-v2', 'docs', 'UI-SPEC.md')
FORECAST = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'pages', 'Forecast.vue')
ICON = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'components', 'Icon.vue')
VARS = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'styles', 'variables.css')
PO_LIST = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'pages', 'inventory', 'InvPurchaseList.vue')
SO_LIST = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'pages', 'inventory', 'InvSaleList.vue')
SRC = os.path.join(ROOT, 'hergent-cn-v2', 'src')

spec = io.open(SPEC, encoding='utf-8').read()
fc = io.open(FORECAST, encoding='utf-8').read()
icon = io.open(ICON, encoding='utf-8').read()
vars_css = io.open(VARS, encoding='utf-8').read()
po = io.open(PO_LIST, encoding='utf-8').read()
so = io.open(SO_LIST, encoding='utf-8').read()

# 剥掉注释与 <template> 里的 HTML 注释，供"反例禁令"使用
def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'//[^\n]*', '', s)
    return s

fc_nc = strip_comments(fc)

m = re.search(r'#### 2\.6\.1 .*?(?=\n###|\n## )', spec, re.S)
if not m:
    print('FAIL  规范里找不到 §2.6.1')
    sys.exit(1)
sec = m.group(0)
print('§2.6.1 段落长度：%d 字符' % len(sec))

fails = []


def ck(cond, name, detail=''):
    print(('  OK   ' if cond else '  FAIL ') + name + (('  | ' + detail) if detail else ''))
    if not cond:
        fails.append(name)


# ---------- A. 类名存在性 ----------
print('\n[A] 类名存在性（§2.6.1 ↔ Forecast.vue 定义）')
CLASSES = ['.col-cfg', '.gear', '.th-in', '.seq-th', '.seq-cell', '.seq-num',
           '.col-config-bar', '.col-menu', '.col-menu-list', '.cross-tbl']
for c in CLASSES:
    in_spec = c in sec
    in_code = c in fc
    ck(in_spec and in_code, '%-16s 规范有 ∧ 代码有' % c,
       'spec=%s code=%s' % (in_spec, in_code))

# ---------- B. 数值一致性 ----------
print('\n[B] 数值一致性（规范写的 = 代码里的）')
# ⚠️ 规范侧的串**不带反引号对**：文档里多个值常合写在一个反引号对内 ⇒ 要求独立反引号对会假红。
#    （v396 首版 10 项假红即此因）
PAIRS = [
    # (说明, 规范里应出现的串, 代码里应出现的串)
    ('齿轮无边框',            'border:none',                'border:none'),
    ('齿轮透明底',            'background:transparent',     'background:transparent'),
    ('齿轮内距 0 2px',        'padding:0 2px',              'padding:0 2px'),
    ('齿轮 flex-shrink 0',    'flex-shrink:0',              'flex-shrink:0'),
    ('齿轮 inline-flex',      'display:inline-flex',        'display:inline-flex'),
    ('齿轮字号 14px',         'font-size:14px',             'font-size:14px'),
    ('齿轮圆角 radius-sm',    'border-radius:var(--radius-sm)', 'border-radius:var(--radius-sm)'),
    ('齿轮默认色 t3',         'var(--t3)',                  'color:var(--t3)'),
    ('齿轮 hover 底 bg3',     'var(--bg3)',                 'background:var(--bg3)'),
    ('齿轮 hover 色 p-dark',  'var(--p-dark)',              'color:var(--p-dark)'),
    ('th-in 两端对齐',        'justify-content:space-between', 'justify-content:space-between'),
    ('th-in gap 5px',         'gap:5px',                    'gap:5px'),
    ('序号列默认宽 46px',     '46px',                       'seq: 46'),
    ('序号列冻结 sticky',     'position:sticky',            'position:sticky;left:0'),
    ('表体冻结 z 6',          'z-index:6',                  'background:var(--bg);z-index:6'),
    ('表头冻结 z 9',          'z-index:9',                  'background:var(--bg3);z-index:9'),
    ('序号等宽数字',          'tabular-nums',               'font-variant-numeric:tabular-nums'),
    ('序号最小宽 18px',       'min-width:18px',             'min-width:18px'),
    ('序号居中',              'text-align:center',          'text-align:center'),
    ('菜单最大高 70vh',       'max-height:70vh',            'max-height:70vh'),
    ('菜单视口定位 fixed',    'position:fixed',             'position:fixed'),
]
# ⚠️ v401 起删掉三条旧判据（top:38px ／ left:0 ／ position:absolute）—— 它们已被**别的规则或
#    注释**满足（.col-resizer 的 absolute、sticky 的 left:0、写进注释的历史说明）⇒ 属**假绿**，
#    根本证明不了菜单契约。菜单定位改由 [D6] 用「剥注释后的 .col-menu 定义行」精确验。
for name, s_need, c_need in PAIRS:
    ck((s_need in sec) and (c_need in fc), '%-22s 规范 %r ∧ 代码 %r' % (name, s_need, c_need),
       'spec=%s code=%s' % (s_need in sec, c_need in fc))

# v401：序号列的基础样式已**上提全局**（唯一源 = variables.css），不再是 Forecast.vue 私有，
#   ⇒ 单独判（代码侧要落在 variables.css 上，而不是靠 Forecast 里的 COL_DEFAULTS）。
ck(('46px' in sec) and ('table.tbl .seq-th{width:46px;min-width:46px' in vars_css),
   '%-22s 规范 ∧ variables.css 唯一源（46px）' % '序号列宽上提全局',
   'spec=%s vars=%s' % ('46px' in sec, 'table.tbl .seq-th{width:46px;min-width:46px' in vars_css))

# ---------- C. 关键机制 ----------
print('\n[C] 关键机制（§2.6.1 点了名，代码必须有）')
MECH = [
    ('Icon 有 settings 键',      "settings: [",                             icon, 'Icon.vue'),
    ('齿轮用 Icon settings',     '<Icon name="settings"/>',                 fc_nc, 'Forecast'),
    ('按钮 title=列设置',        'title="列设置"',                          fc_nc, 'Forecast'),
    ('渲染序注入 seq 列',        "{ type: 'seq', key: 'seq', label: '列设置' }", fc_nc, 'Forecast'),
    ('查看态序号渲染',           '{{ it.seq }}',                            fc_nc, 'Forecast'),
    ('序号 1 基（seq++）',       'seq++',                                   fc_nc, 'Forecast'),
    ('改单态表头 seq-th',        'class="th seq-th"',                       fc_nc, 'Forecast'),
    ('改单态序号 ri + 1',        '{{ ri + 1 }}',                            fc_nc, 'Forecast'),
    ('权威列宽走 colgroup',      "colW('seq')",                             fc_nc, 'Forecast'),
]
for name, needle, blob, where in MECH:
    ck(needle in blob, '%-22s 在 %s' % (name, where))

# ---------- D. 反例禁令 ----------
print('\n[D] 反例禁令')

# D1. 全站零 emoji 齿轮（U+2699）—— 规范声称「是 <Icon name="settings"/> 线性图标，不是 emoji 齿轮」
#     ⚠️ **不要**顺手把 U+FE0F（变体选择符）也算进来：全站 59 个文件合法地用它（⚠️ / ✅ / ℹ️ 等
#        通用 emoji 都带它），把它当判据会**假红 59 个文件** —— 「判据取值域必须与结论同宽」。
#        真正要证的是**齿轮字符**（U+2699）为 0，以及**齿轮按钮那一行**两种码位都没有。
n2699 = []
for dirpath, _dirnames, filenames in os.walk(SRC):
    for fn in filenames:
        if not fn.endswith(('.vue', '.js', '.css')):
            continue
        p = os.path.join(dirpath, fn)
        try:
            t = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        if '\u2699' in t:
            n2699.append(os.path.relpath(p, ROOT))
ck(len(n2699) == 0, 'D1 全站零 emoji 齿轮字符 U+2699',
   ('命中 %d 个文件: %s' % (len(n2699), ', '.join(n2699[:3]))) if n2699 else '0 命中')

gear_lines = [ln for ln in fc.split('\n') if 'class="col-cfg gear"' in ln]
ck(len(gear_lines) == 2
   and all(('\u2699' not in ln) and ('\ufe0f' not in ln) for ln in gear_lines),
   'D1b 齿轮按钮行内两种码位都没有（U+2699 / U+FE0F）',
   '行数=%d' % len(gear_lines))

# D2. class="col-cfg gear" 源码恰好 2 处（查看态 + 改单态）
n_gear = fc_nc.count('class="col-cfg gear"')
ck(n_gear == 2, 'D2 齿轮源码恰好 2 处（查看态/改单态各一）', 'count=%d' % n_gear)

# D3. defaultColOrder 行不许出现 seq（序号列不在列设置清单里）
line = ''
for ln in fc_nc.split('\n'):
    if 'defaultColOrder =' in ln or ln.strip().startswith('const defaultColOrder'):
        line = ln
        break
ck(line != '' and 'seq' not in line, 'D3 defaultColOrder 不含 seq（不可被隐藏/拖序）',
   (line.strip()[:80] if line else '未找到 defaultColOrder 定义行'))

# D4. 适用范围证据（v401 起分两族）
#   · `.col-cfg`（齿轮）**仍只**出现在 Forecast.vue —— 其余页面还没接齿轮；
#   · `.seq-th` / `.seq-cell` / `.seq-num` 已**上提为全局唯一源**（variables.css），并被两个
#     试点页复用 ⇒ 判据从「零使用者」改成「唯一源 + 恰好两个试点页」，**多一处即 FAIL**
#     （防有人又在某页抄一份）。
def _owners(cls, exclude_paths):
    hits = []
    for dirpath, _d, filenames in os.walk(SRC):
        for fn in filenames:
            if not fn.endswith(('.vue', '.js', '.css')):
                continue
            p = os.path.join(dirpath, fn)
            if p in exclude_paths:
                continue
            try:
                t = io.open(p, encoding='utf-8').read()
            except Exception:
                continue
            if cls in t:
                hits.append(os.path.relpath(p, ROOT))
    return sorted(hits)


print('\n[D4a] 齿轮宿主 .col-cfg：全站仍只在 Forecast.vue')
_o = _owners('.col-cfg', {FORECAST})
ck(len(_o) == 0, '%-12s 除 Forecast.vue 外无使用者' % '.col-cfg',
   (', '.join(_o[:4])) if _o else '0 处')

print('\n[D4b] 序号列件：唯一源 = variables.css（除 Forecast 外不许有第三者）')
for c in ['.seq-th', '.seq-cell', '.seq-num']:
    ck(c in vars_css, '%-12s 定义在 variables.css（唯一源）' % c)
    _o = _owners(c, {FORECAST, VARS})
    ck(len(_o) == 0, '%-12s 除 Forecast / variables.css 外无第三者' % c,
       (', '.join(_o[:4])) if _o else '0 处')

print('\n[D4c] 试点两页按宿主写法接入（class ＋ offset + i + 1 跨页连续编号）')
for label, blob in [('InvPurchaseList', po), ('InvSaleList', so)]:
    _t = 'class="seq-th"' in blob
    _c = 'class="seq-cell"' in blob
    _n = 'class="seq-num"' in blob
    _i = 'offset + i + 1' in blob
    ck(_t and _c and _n and _i, '%-16s 序号列宿主写法齐全' % label,
       'seq-th=%s seq-cell=%s seq-num=%s offset+i+1=%s' % (_t, _c, _n, _i))

# D5. 反例自证：把「不存在的类名」混进待查清单 ⇒ 差集必须**恰好等于那一个**
#     （证明 A 类判据**真的能发现缺失**，而不是无论查什么都说 OK）
FAKE = '.zz-not-exist-class'
all_src = ''
for dirpath, _d, filenames in os.walk(SRC):
    for fn in filenames:
        if fn.endswith(('.vue', '.js', '.css')):
            try:
                all_src += io.open(os.path.join(dirpath, fn), encoding='utf-8').read()
            except Exception:
                pass
missing_probe = [c for c in (CLASSES + [FAKE]) if c not in all_src]
ck(missing_probe == [FAKE],
   'D5 ★反例自证：混入 %s 后差集恰好 = [它]（判据有判别力）' % FAKE,
   '差集=' + repr(missing_probe))

# D6. 菜单定位契约（v401）：两条菜单必须 position:fixed 且**不写死** top / left。
#     ⚠️ 一律在 **fc_nc（剥注释）** 上判 —— 否则写在注释里的历史说明（原先是 top:38px;left:0）
#        会把「不写死」这条**假绿**（这正是 v400 那三条判据失效的同一机制）。
print('\n[D6] 菜单定位契约（v401）：fixed ＋ 不写死 top/left（剥注释后判）')
menu_defs = [ln for ln in fc_nc.split('\n') if re.match(r'\s*\.(edit-)?col-menu\{', ln)]
ck(len(menu_defs) == 2, 'D6a 找到两条菜单定义行（.col-menu / .edit-col-menu）',
   'count=%d' % len(menu_defs))
ck(len(menu_defs) == 2 and all('position:fixed' in ln for ln in menu_defs),
   'D6b 两条菜单都 position:fixed',
   ' | '.join(ln.strip()[:44] for ln in menu_defs))
ck(not any(re.search(r'top:\s*38px', ln) for ln in menu_defs),
   'D6c 两条菜单都无写死 top:38px')
ck(not any(re.search(r'(?<![-\w])left:\s*0(?![.\d])', ln) for ln in menu_defs),
   'D6d 两条菜单都无写死 left:0')
ck(('getBoundingClientRect' in fc_nc) and ('toggleColMenu' in fc_nc),
   'D6e 位置由 toggleColMenu + getBoundingClientRect 现算')

# D6f ★反例自证：混入一条「写死 top:38px 且非 fixed」的假菜单定义 ⇒ D6b / D6c 必须转 FAIL
FAKE_MENU = '.col-menu{position:absolute;top:38px;left:0}'
_probe = menu_defs + [FAKE_MENU]
ck((not all('position:fixed' in ln for ln in _probe))
   and any(re.search(r'top:\s*38px', ln) for ln in _probe),
   'D6f ★反例自证：混入假菜单定义后 D6b / D6c 确实会转 FAIL',
   '假定义=%s' % FAKE_MENU)

print('\n' + '=' * 60)
if fails:
    print('FAIL %d 项：' % len(fails))
    for f in fails:
        print('  -', f)
    if '--strict' in sys.argv:
        sys.exit(1)
else:
    print('ALL PASS（§2.6.1 ↔ Forecast.vue / Icon.vue / variables.css / 两个试点页 一致）')
