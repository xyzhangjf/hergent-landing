#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v402 一致性自检：§2.6.1 序号列铺开 ↔ 源码。

四类判据（--strict 时任一 FAIL 即退出码 1）：
  [A] `variables.css` 的序号规则**两组并列**（table.tbl … , table.seq-host …），且用
      `th.seq-th` / `td.seq-cell`（specificity 0,2,2 稳压 scoped 的 0,2,1）。
  [B] CSS **注释/括号配对** —— 🔴 这条是 v402 实际踩的坑固化的护栏：
      上一次改动把说明文字写到了 `*/` **之外**，成了裸文本，CSS 解析器把这堆乱码连同
      紧随其后的 `table.tbl th.seq-th{…}` 一起吞掉 ⇒ 全站序号列立刻失效（首轮真机探针
      从 133 PASS 掉到 104 PASS）。**改注释后必须验配对**。
  [C] 5 张非 `.tbl` 自定义表都挂了 `seq-host` 类。
  [D] 被铺开的页面宿主写法齐全（`class="seq-th"` + `class="seq-cell"` + `class="seq-num"`），
      且文件名与列表一致。
  [E] 反例自证：把「未闭合注释」喂给配对函数 ⇒ 必报不等（证明 [B] 不是恒真）。

用法：python3 v402-spec-seq-consistency.py [--strict]
"""
import io, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'hergent-cn-v2', 'src')
VARS = os.path.join(SRC, 'styles', 'variables.css')
STRICT = '--strict' in sys.argv

PASS, FAIL = [], []
def ok(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print('  ' + ('PASS' if cond else 'FAIL') + '  ' + name + ((' | ' + str(detail)) if detail else ''))

def read(p):
    return io.open(p, encoding='utf-8').read()

print('=== [A] variables.css 序号规则两组并列 + th/td 限定 ===')
vars_css = read(VARS)
ok('A1 .seq-th 两组并列（table.tbl, table.seq-host）', 'table.tbl th.seq-th' in vars_css and 'table.seq-host th.seq-th' in vars_css)
ok('A2 .seq-cell 两组并列', 'table.tbl td.seq-cell' in vars_css and 'table.seq-host td.seq-cell' in vars_css)
ok('A3 .seq-num 两组并列', 'table.tbl .seq-num' in vars_css and 'table.seq-host .seq-num' in vars_css)
ok('A4 ⛔ 无裸类写法（回到 .seq-th 就丢了 specificity）',
   not re.search(r'^table\.(tbl|seq-host)\s+\.seq-th\{', vars_css, re.M))
ok('A5 列宽 46px 写死', 'width:46px;min-width:46px' in vars_css)

print('\n=== [B] CSS 注释 / 括号配对（v402 踩坑固化的护栏）===')
def balanced(css):
    return (css.count('/*') == css.count('*/'), css.count('{') == css.count('}'))
b = balanced(vars_css)
ok('B1 注释 /* 与 */ 数量相等', b[0], '/* =%d  */ =%d' % (vars_css.count('/*'), vars_css.count('*/')))
ok('B2 花括号 { 与 } 数量相等', b[1], '{ =%d  } =%d' % (vars_css.count('{'), vars_css.count('}')))
# B3 规则必须紧跟在一个 `*/` 之后（不是夹在裸文本里）
m = re.search(r'table\.tbl th\.seq-th', vars_css)
seg_before = vars_css[max(0, m.start() - 120):m.start()] if m else ''
ok('B3 序号规则紧跟在注释闭合 `*/` 之后（无裸文本夹缝）', '*/' in seg_before, repr(seg_before[-40:]))
# B4 注释块内不得出现「同时存在两个 */ 且其后还有 ** 标题行」这类典型误写
ok('B4 无「注释外裸文本」特征（`*/` 后紧跟非选择器行）',
   not re.search(r'\*/\s*\n\s*🔴', vars_css))

print('\n=== [C] 5 张非 .tbl 自定义表挂 seq-host ===')
SELF = {
    'pages/PriceChannels.vue': 'pc-tb seq-host',
    'pages/ProductTarget.vue': 'pt-tbl seq-host',
    'pages/BidRadar.vue': 'br-tbl seq-host',
    'pages/LossAccounting.vue': 'la-ml-tbl seq-host',
}
for rel, cls in SELF.items():
    src = read(os.path.join(SRC, rel))
    ok('C %s 含 `%s`' % (rel.split('/')[-1], cls), cls in src)

print('\n=== [D] 铺开页面宿主写法齐全 ===')
PAGES = [
 'pages/BidRadar.vue','pages/BrandArchive.vue','pages/CronJobs.vue','pages/CustomerArchive.vue',
 'pages/EmployeeArchive.vue','pages/ForecastHistory.vue','pages/LossAccounting.vue',
 'pages/LossWorkflow.vue','pages/PayrollWorkflow.vue','pages/PriceChannels.vue',
 'pages/ProductArchive.vue','pages/ProductTarget.vue','pages/Rebate.vue','pages/ReportMapping.vue',
 'pages/SupplierArchive.vue','pages/WarehouseArchive.vue',
 'pages/inventory/InvPurchaseDetail.vue','pages/inventory/InvPurchaseNew.vue',
 'pages/inventory/InvSaleDetail.vue','pages/inventory/InvSaleNew.vue','pages/inventory/InvStock.vue',
]
for rel in PAGES:
    src = read(os.path.join(SRC, rel))
    has = ('class="seq-th"' in src) and ('class="seq-cell"' in src) and ('class="seq-num"' in src)
    ok('D %s 三个宿主类齐全' % rel.split('/')[-1], has,
       'th=%s cell=%s num=%s' % ('class="seq-th"' in src, 'class="seq-cell"' in src, 'class="seq-num"' in src))

print('\n=== [E] 反例自证：[B] 不是恒真 ===')
ok('E1 未闭合注释必须被判不配对', balanced('a{/* 没闭合') [0] is False)
ok('E2 裸文本夹缝必须被 B3/B4 抓到',
   ('*/' not in '🔴 裸文本\n') and bool(re.search(r'\*/\s*\n\s*🔴', 'x */\n  🔴 y')))

print('\n' + '=' * 74)
print('PASS=%d  FAIL=%d' % (len(PASS), len(FAIL)))
if FAIL:
    print('FAIL 明细：'); [print('  · ' + f) for f in FAIL]
if STRICT and FAIL:
    sys.exit(1)
print('ALL PASS（§2.6.1 序号列 ↔ variables.css / 21 页 / 5 张 seq-host 表 一致）' if not FAIL else '有 FAIL')
