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
                   `.col-menu-list` / `.cross-tbl` 必须在 `Forecast.vue ∪ variables.css`
                   里有定义。
  B. 数值一致性 —— §2.6.1 写下的关键数值（序号列宽 46px / 齿轮内距 / 圆角 /
                   `sticky left:0` / z 6 与 9 / 字号 14px …）必须与 CSS 逐字相同。
                   ⚠️ **v408 起「代码侧」= `Forecast.vue ∪ variables.css`**：列设置件
                      （`.col-cfg` / `.gear` / `.th-in` / `.col-menu*` / `.btn-xs`）已**上提全局**，
                      只看 Forecast 会**假红**（这正是本条最容易失守的方式）。
  C. 关键机制   —— §2.6.1 点了名的机制（`Icon` 的 `settings` 键 / `colOrderList` 注入 seq /
                   `defaultColOrder` **不含** seq / 改单态 `seq-th` + `ri + 1` /
                   查看态 `it.seq` + `seq++` / 两个齿轮共用 `showColMenu`）必须存在。
  D. 反例禁令   —— ① 全站**零** emoji 齿轮（码位 U+2699）—— 规范声称「是
                   `<Icon name="settings"/>` 线性图标，**不是** emoji 齿轮」；
                   ② `class="col-cfg gear"` **逐宿主页计数**（Forecast 恰好 2 = 查看态/改单态各一；
                   InvPurchaseList 恰好 1）—— 防「只改一处」漂移；
                   ③ `defaultColOrder` 行**不许**出现 `seq`（序号列不在列设置清单里）；
                   ④ 「适用范围」分两族验：`.seq-th` / `.seq-cell` / `.seq-num` 已上提为
                   **全局唯一源**（`variables.css`），除 Forecast 与该文件外**不许有第三者**，
                   且三个试点页必须按宿主写法接入；
                   ⑤ **菜单定位契约**（v401）：`.col-menu` / `.edit-col-menu` 必须
                   `position:fixed`，**不许**再写死 `top:38px` / `left:0`
                   （**在剥掉注释的源码上判** —— 否则注释里的说明会把它假绿）；
                   ⑥ **齿轮宿主页白名单**（v408）：`.col-cfg` **只许出现在白名单页**
                   （`Forecast.vue` / `InvPurchaseList.vue`）与全局层 `variables.css`。
                   白名单外出现即 FAIL —— 给「随手给固定列页面硬套一个齿轮」上锁，
                   含 ★反例自证（证明白名单真的会拦）；
                   ⑦ **定位与开合的唯一实现**（v408）= `useColMenu.js`：两个宿主页都**不许**
                   再出现 `getBoundingClientRect`（否则就是第二份实现，契约必然漂移）。

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
# v408（P1-9）采购结算页 —— 第三个齿轮宿主。
#   🔴 为什么必须同批登记：下面的 D4a 白名单是「`.col-cfg` **只许**出现在白名单页」。
#      新页落地了列设置却没登记 ⇒ 自检会把它判成**违规使用者**（FAIL）；
#      而若为了不 FAIL 去放宽那条判据，白名单就形同虚设。
#      ⇒ 唯一正解：**落地即登记**（这里 + UI-SPEC §2.6.1「五、D」+ 实现三处同批）。
PS_SETTLE = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'pages', 'inventory', 'InvPurchaseSettle.vue')
COLMENU = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'composables', 'useColMenu.js')
SRC = os.path.join(ROOT, 'hergent-cn-v2', 'src')

# 🔴 齿轮宿主页**白名单**（§2.6.1「五、D」）—— 新增宿主页必须**同批**改这里 + 本文档 + 实现。
GEAR_HOSTS = {FORECAST, PO_LIST, PS_SETTLE}
# 允许出现列设置类名的「全局层」文件（件上提全局的唯一源）
GLOBAL_OWNERS = {VARS}

spec = io.open(SPEC, encoding='utf-8').read()
fc = io.open(FORECAST, encoding='utf-8').read()
icon = io.open(ICON, encoding='utf-8').read()
vars_css = io.open(VARS, encoding='utf-8').read()
po = io.open(PO_LIST, encoding='utf-8').read()
so = io.open(SO_LIST, encoding='utf-8').read()
ps = io.open(PS_SETTLE, encoding='utf-8').read()
colmenu = io.open(COLMENU, encoding='utf-8').read()

# 剥掉注释与 <template> 里的 HTML 注释，供"反例禁令"使用
def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'//[^\n]*', '', s)
    return s

fc_nc = strip_comments(fc)
po_nc = strip_comments(po)
ps_nc = strip_comments(ps)
vars_nc = strip_comments(vars_css)
# v408：「代码侧」= 页面 ∪ 全局层（件已上提）
code_all = fc + vars_css
code_all_nc = fc_nc + vars_nc

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
print('\n[A] 类名存在性（§2.6.1 ↔ Forecast.vue ∪ variables.css）')
CLASSES = ['.col-cfg', '.gear', '.th-in', '.seq-th', '.seq-cell', '.seq-num',
           '.col-config-bar', '.col-menu', '.col-menu-list', '.cross-tbl']
for c in CLASSES:
    in_spec = c in sec
    in_code = c in code_all
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
    ck((s_need in sec) and (c_need in code_all), '%-22s 规范 %r ∧ 代码 %r' % (name, s_need, c_need),
       'spec=%s code=%s' % (s_need in sec, c_need in code_all))

# v401：序号列的基础样式已**上提全局**（唯一源 = variables.css），不再是 Forecast.vue 私有，
#   ⇒ 单独判（代码侧要落在 variables.css 上，而不是靠 Forecast 里的 COL_DEFAULTS）。
#
# 🔴 2026-10-08 回查时修一处**护栏自身烂掉**：本断言原先写死字面量
#   `'table.tbl .seq-th{width:46px;min-width:46px' in vars_css`，
#   而 **v402 已把选择器改成 `table.tbl th.seq-th, table.seq-host th.seq-th`**
#   （为压过 Vue scoped 补 `[data-v-xxx]` 后的 (0,2,1) 同分覆盖；详见 UI-SPEC §2.6.1 与 v402 行）
#   ⇒ 该断言**自 v402 起恒 FAIL**，只因 v402 之后没人再跑这个脚本而没被看见。
#   ⇒ 改为「**剥注释 + 剥空白后按选择器片段**判」：v401 单臂（`.seq-th`）与 v402 双臂
#   （`th.seq-th` + `table.seq-host`）两种形态都认，且要求 46px 落在**真规则**上、不在注释里。
#   ⚠️ 别退回写死字面量 —— 这正是本条失守的成因。
_vars_css_nc = re.sub(r'\s+', '', strip_comments(vars_css))
_SEQ46_RE = r'table\.tbl(?:th\.seq-th|\.seq-th)[^{]*\{width:46px;min-width:46px'
_seq46 = bool(re.search(_SEQ46_RE, _vars_css_nc))
# 反例自证：把 46px 换成别的值 ⇒ 上式必须转 False（证明判据不是恒真）
_seq46_probe = bool(re.search(_SEQ46_RE, _vars_css_nc.replace('width:46px;min-width:46px',
                                                              'width:99px;min-width:99px')))
ck(('46px' in sec) and _seq46,
   '%-22s 规范 ∧ variables.css 唯一源（46px，剥注释/空白后按选择器片段判）' % '序号列宽上提全局',
   'spec=%s vars=%s' % ('46px' in sec, _seq46))
ck((not _seq46_probe) and _seq46,
   '%-22s ★反例自证：把 46px 改成 99px 后上式确实转 False' % '序号列宽上提全局',
   'probe=%s（应为 False）' % _seq46_probe)

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

# v408：定位与开合上提为唯一实现（composable）
print('\n[C2] 菜单定位/开合的唯一实现（v408 上提 = useColMenu.js）')
ck('getBoundingClientRect' in colmenu and 'showColMenu' in colmenu
   and 'toggleColMenu' in colmenu and 'placeColMenu' in colmenu,
   'useColMenu.js 含 getBoundingClientRect / showColMenu / toggleColMenu / placeColMenu')
ck("window.addEventListener('scroll', closeColMenuOnViewportChange, true)" in colmenu,
   'useColMenu.js 的滚动监听走**捕获阶段**（一处覆盖页面滚动与表内滚动）')
for label, blob in [('Forecast', fc_nc), ('InvPurchaseList', po_nc)]:
    ck('useColMenu' in blob, '%-16s 引入了 useColMenu' % label, 'import 命中')

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

# D2. class="col-cfg gear" **逐宿主页**计数（v408 起）
#     · Forecast 恰好 2（查看态 / 改单态各一）—— 防「只改一处」；
#     · InvPurchaseList 恰好 1（只有查看态）。
n_gear_fc = fc_nc.count('class="col-cfg gear"')
n_gear_po = po_nc.count('class="col-cfg gear"')
n_gear_ps = ps_nc.count('class="col-cfg gear"')
ck(n_gear_fc == 2, 'D2a Forecast 齿轮源码恰好 2 处（查看态/改单态各一）', 'count=%d' % n_gear_fc)
ck(n_gear_po == 1, 'D2b InvPurchaseList 齿轮源码恰好 1 处', 'count=%d' % n_gear_po)
# v408（P1-9）第三个宿主页：采购结算页同样**只有一处**齿轮（在序号列表头格内）。
ck(n_gear_ps == 1, 'D2b2 InvPurchaseSettle 齿轮源码恰好 1 处', 'count=%d' % n_gear_ps)

# D2c ★反例自证：把宿主页计数改成错的期望值必须转 FAIL（证明判据不是恒真）
ck(not (n_gear_po == 2), 'D2c ★反例自证：把 InvPurchaseList 期望改成 2 会转 FAIL',
   '实际=%d（应为 1）' % n_gear_po)

# D3. defaultColOrder 行不许出现 seq（序号列不在列设置清单里）
line = ''
for ln in fc_nc.split('\n'):
    if 'defaultColOrder =' in ln or ln.strip().startswith('const defaultColOrder'):
        line = ln
        break
ck(line != '' and 'seq' not in line, 'D3 defaultColOrder 不含 seq（不可被隐藏/拖序）',
   (line.strip()[:80] if line else '未找到 defaultColOrder 定义行'))
# 采购单列表同理：列清单必须**不含**序号列 key（否则它就能被隐藏 ⇒ 齿轮的宿主消失）
_po_seq_in_reg = bool(re.search(r"key:\s*'seq'", po_nc))
ck(not _po_seq_in_reg, 'D3b InvPurchaseList 的列清单不含 seq', 'seq 注册项=%s' % _po_seq_in_reg)


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


def _owners_def(pattern, exclude_paths):
    """🔴 判「**有没有另抄一份 CSS**」必须认**规则定义**，不能认「提到过这个类名」。
    v408 踩到的假红：页面注释里写了「序号列 = `.seq-th` / …（唯一源在 variables.css）」，
    纯字符串判据把它当成第三份实现。⇒ 判据 = 选择器后紧跟 `{` 或 `,`（真规则），
    注释里的「`.seq-th`（」天然不匹配。"""
    rx = re.compile(pattern)
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
            if rx.search(t):
                hits.append(os.path.relpath(p, ROOT))
    return sorted(hits)


# D4a. 齿轮宿主页**白名单**（v408：原为「除 Forecast 外零使用者」）
print('\n[D4a] 齿轮宿主 .col-cfg：只许出现在白名单页（v408 起 2 页）')
_o = _owners('.col-cfg', GEAR_HOSTS | GLOBAL_OWNERS)
ck(len(_o) == 0, '%-12s 白名单外无使用者' % '.col-cfg',
   (', '.join(_o[:4])) if _o else '0 处')
# ★反例自证：白名单外**真有**文件（`InvSaleList.vue` 等 20+ 页）都在扫描面内 ⇒ 判据有判别力；
#   用「把一个白名单页移出白名单」模拟「白名单外出现」⇒ 差集必须非空。
_probe_out = _owners('.col-cfg', (GEAR_HOSTS - {FORECAST}) | GLOBAL_OWNERS)
ck(len(_probe_out) >= 1,
   'D4a2 ★反例自证：把 Forecast 移出白名单后差集非空（白名单真的会拦）',
   'probe 差集=%s' % (', '.join(_probe_out[:3]) or '空'))

print('\n[D4b] 序号列件：唯一源 = variables.css（除 Forecast 外不许有第三者）')
for c in ['.seq-th', '.seq-cell', '.seq-num']:
    ck(c in vars_css, '%-12s 定义在 variables.css（唯一源）' % c)
    # ⚠️ 认「规则定义」（选择器后紧跟 { 或 ,），不认「注释里提到类名」—— v408 假红成因
    _o = _owners_def(re.escape(c) + r'\s*[,{]', {FORECAST, VARS})
    ck(len(_o) == 0, '%-12s 除 Forecast / variables.css 外无第三者（按规则定义判）' % c,
       (', '.join(_o[:4])) if _o else '0 处')

print('\n[D4c] 试点两页按宿主写法接入（class ＋ offset + i + 1 跨页连续编号）')
for label, blob in [('InvPurchaseList', po), ('InvSaleList', so)]:
    # ⚠️ 类名**可以带附加修饰类**（如冻结区 `class="seq-th ipl-frz-seq"`）⇒ 判「class 属性里
    #    含该 token」，不判逐字等于 `class="seq-th"`（v408 假红成因）。
    _t = bool(re.search(r'class="[^"]*\bseq-th\b[^"]*"', blob))
    _c = bool(re.search(r'class="[^"]*\bseq-cell\b[^"]*"', blob))
    _n = bool(re.search(r'class="[^"]*\bseq-num\b[^"]*"', blob))
    _i = 'offset + i + 1' in blob
    ck(_t and _c and _n and _i, '%-16s 序号列宿主写法齐全' % label,
       'seq-th=%s seq-cell=%s seq-num=%s offset+i+1=%s' % (_t, _c, _n, _i))
# ★反例自证：把 token 拼成别的名字（seq-thx）必须不成立
ck(not bool(re.search(r'class="[^"]*\bseq-th\b[^"]*"', 'class="seq-thx"')),
   'D4c2 ★反例自证：class="seq-thx" 不满足（\\b 边界真的生效）')

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
#     ⚠️ v408：菜单 CSS 已上提全局 ⇒ 在 **vars_nc（剥注释的 variables.css）** 上判。
#        一律剥注释 —— 否则写在注释里的历史说明（原先是 top:38px;left:0）会把「不写死」这条
#        **假绿**（这正是 v400 那三条判据失效的同一机制）。
print('\n[D6] 菜单定位契约（v401）：fixed ＋ 不写死 top/left（variables.css，剥注释后判）')
menu_defs = [ln for ln in vars_nc.split('\n') if re.match(r'\s*\.(edit-)?col-menu\{', ln)]
ck(len(menu_defs) == 2, 'D6a 找到两条菜单定义行（.col-menu / .edit-col-menu）',
   'count=%d' % len(menu_defs))
ck(len(menu_defs) == 2 and all('position:fixed' in ln for ln in menu_defs),
   'D6b 两条菜单都 position:fixed',
   ' | '.join(ln.strip()[:44] for ln in menu_defs))
ck(not any(re.search(r'top:\s*38px', ln) for ln in menu_defs),
   'D6c 两条菜单都无写死 top:38px')
ck(not any(re.search(r'(?<![-\w])left:\s*0(?![.\d])', ln) for ln in menu_defs),
   'D6d 两条菜单都无写死 left:0')
# v408：位置由 composable 现算（不再在页面里）
ck(('getBoundingClientRect' in colmenu) and ('toggleColMenu' in colmenu),
   'D6e 位置由 useColMenu.toggleColMenu + getBoundingClientRect 现算')
# 🔴 v408：判「宿主页有没有自带第二份定位实现」**不能拿 `getBoundingClientRect` 当判据** ——
#    `Forecast.vue` 另有 7 处合法用法（提示框 / 单元格测量 / 底部动作条定位）。判据必须
#    **窄到那份被上提的实现本身**：它的私有状态与函数名（`colMenuGear` / `placeColMenu` /
#    `toggleColMenu`）。页面里这些名字一出现，就说明有人又抄了一份。
_LIFT_SIG = [r'\bconst\s+colMenuGear\b', r'\bfunction\s+placeColMenu\b', r'\bfunction\s+toggleColMenu\b']
for label, blob in [('Forecast', fc_nc), ('InvPurchaseList', po_nc), ('InvPurchaseSettle', ps_nc)]:
    _hits = [s for s in _LIFT_SIG if re.search(s, blob)]
    ck(not _hits, 'D6e2 %-16s 不自带定位实现（防第二份漂移）' % label,
       '命中=%s' % (_hits or '0'))
ck(bool(re.search(r'\bconst\s+colMenuGear\b', colmenu))
   and bool(re.search(r'\bfunction\s+placeColMenu\b', colmenu)),
   'D6e2b 定位实现确实在 useColMenu.js（colMenuGear ＋ placeColMenu）')
# ★反例自证：把那份被上提的实现塞回页面 ⇒ D6e2 必须转 FAIL
_probe_sig = po_nc + "\nconst colMenuGear = ref(null)\n"
ck(any(re.search(s, _probe_sig) for s in _LIFT_SIG),
   'D6e2c ★反例自证：把 colMenuGear 塞回页面后 D6e2 确实会转 FAIL')

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
    print('ALL PASS（§2.6.1 ↔ Forecast.vue / InvPurchaseList.vue / Icon.vue / variables.css '
          '/ useColMenu.js / 三个试点页 一致）')
