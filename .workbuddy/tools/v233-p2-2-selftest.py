# -*- coding: utf-8 -*-
"""v233 P2-2 自测：模板侧「*单位」的**优先级**与「*数量」的**换算/降级**。

做法：从 `routers/forecast.py` **原样抽出** `_resolve_template_unit` / `_align_row_unit`
两段源码（抽出来的就是线上跑的那段），exec 进一个命名空间（只注入 `_guess_unit` 桩与
真身 `convert_qty`）——这样不必 import 整个 forecast（它需要 erp_db / ERP_SECRET）。

🔴 三条必须锁死的**反证**（本批次的立命之本）：
  1. 「单位与明细不同、换算比可求」⇒ **数量必须跟着变**（只改标签不改数 = v217 的错误）；
  2. 「换算不出来」⇒ **必须退回明细单位**，不许输出一个数量对不上的新单位；
  3. `order_unit` 为空 ⇒ **逐字回到 v233 之前的行为**（保「存量零变化」）。

用法：python3 v233-p2-2-selftest.py
"""
import os
import sys

SRV = os.environ.get('HERGENT_SRV') or (
    '/Users/zhangjunfeng/Documents/hergent-erp/server'
    if os.path.isdir('/Users/zhangjunfeng/Documents/hergent-erp/server')
    else '/opt/hergent-erp')
sys.path.insert(0, SRV)

FORECAST = os.path.join(SRV, 'routers', 'forecast.py')

fail = []


def expect(name, got, want):
    ok = got == want
    print('  %s %-62s got=%r want=%r' % ('ok ' if ok else 'BAD', name, got, want))
    if not ok:
        fail.append(name)


def truthy(name, got):
    ok = bool(got)
    print('  %s %-62s got=%r' % ('ok ' if ok else 'BAD', name, got))
    if not ok:
        fail.append(name)


def extract(path, fname, nxt):
    """抽 `def <fname>(...)` 到下一个 `def <nxt>(` 之前的源码（顶格 def 为界）。"""
    src = open(path, encoding='utf-8').read()
    i = src.index('def ' + fname + '(')
    j = src.index('\ndef ' + nxt + '(', i)
    return src[i:j]


ns = {}
_guess_calls = []


def _guess_unit(name):
    _guess_calls.append(name)
    return '件'


from domain.unit_convert import convert_qty  # noqa: E402

ns['_guess_unit'] = _guess_unit
ns['convert_qty'] = convert_qty
for _fn, _nxt in (('_resolve_template_unit', '_align_row_unit'),
                  ('_align_row_unit', '_price_stat_warnings')):
    exec(compile(extract(FORECAST, _fn, _nxt), _fn, 'exec'), ns)
    truthy('抽出 %s 源码' % _fn, _fn in ns)

R = ns['_resolve_template_unit']
ALIGN = ns['_align_row_unit']

# arc 形状与 `products_grid` / `_fetch_product_units` 一致
ARC_3 = {'name': '每日鲜酪', 'spec': '16', 'unit': '件', 'order_unit': '',
         'medium_unit': '', 'medium_ratio': 0, 'large_unit': '', 'large_ratio': 0}
# 🔴 `large_ratio` / `medium_ratio` 的语义已由消费方**正面确认**，不是猜的：
#   `domain/pricing_engine.py::_get_standard_price` —— 「中单位价 = 小单位价 × medium_ratio」、
#   「大单位价 = 小单位价 × large_ratio」⇒ **两者都是「1 个该档单位 = 多少个小单位」**。
#   ⇒ 本组数据自洽：1 件 = 24 杯、1 组 = 2 杯 ⇒ 1 件 = 12 组（与规格串 `125g*2杯*12组` 一致）。
ARC_216 = {'name': '每日鲜酪青青柚子125g*2杯*12组', 'spec': '125g*2杯*12组', 'unit': '杯',
           'order_unit': '', 'medium_unit': '组', 'medium_ratio': 2,
           'large_unit': '件', 'large_ratio': 24}
ARC_217 = {'name': '160红枣5连杯', 'spec': '8', 'unit': '件', 'order_unit': '',
           'medium_unit': '', 'medium_ratio': 0, 'large_unit': '', 'large_ratio': 0}
# 同一商品但**档案没有换算**（只留规格串）—— 用于验证「规格定位」闸门
ARC_216_NOR = dict(ARC_216, large_ratio=0, medium_ratio=0, medium_unit='', large_unit='')

print('=' * 92)
print('一、`_resolve_template_unit` 的**优先级**')
print('=' * 92)
expect('① order_unit 非空 ⇒ 取它（最高优先，压过条码层）',
       R('B1', '条', '某商品', dict(ARC_3, order_unit='件'), {'B1': '包'}), ('件', 'product'))
expect('② order_unit 空 + 条码层有 ⇒ 取条码层',
       R('B1', '条', '某商品', ARC_3, {'B1': '包'}), ('包', 'barcode'))
expect('③ 都无 + 明细有 ⇒ 取明细',
       R('B1', '条', '某商品', ARC_3, {}), ('条', 'detail'))
expect('④ 全无 ⇒ 名称推断',
       R('B1', '', '某商品', ARC_3, {}), ('件', 'guess'))
expect('★ order_unit 只有空白 ⇒ 视为未指定（不许当成有效值）',
       R('B1', '条', '某商品', dict(ARC_3, order_unit='   '), {}), ('条', 'detail'))
expect('★ order_unit 为 None ⇒ 视为未指定',
       R('B1', '条', '某商品', dict(ARC_3, order_unit=None), {}), ('条', 'detail'))
expect('★ 单位不该被 trim 成空（明细单位带空格）',
       R('B1', ' 条 ', '某商品', ARC_3, {}), ('条', 'detail'))
expect('★ 无商品档案（arc=None）⇒ 不炸，走条码/明细',
       R('B1', '条', '某商品', None, {'B1': '包'}), ('包', 'barcode'))

print()
print('=' * 92)
print('二、`_align_row_unit` 的换算与**降级**')
print('=' * 92)
ust = lambda: {'manual': 0, 'conv': 0, 'fail': 0, 'sample': []}

# 反证 1：单位变了 ⇒ 数量必须跟着变
u1 = ust()
expect('★反证1a 无档案换算 + 纯数字规格 ⇒ 折不出来（比值会恒等 1，必须拦住）',
       ALIGN('件', 86, '组', ARC_3, u1), ('组', 86))
expect('    → 计入 fail（降级可见）', u1['fail'], 1)

u2 = ust()
# ARC_216：1 件 = 24 杯、1 组 = 2 杯 ⇒ 24 杯 = 12 组
expect('★反证1b 单位 杯→组（有换算）⇒ 数量折算 24 杯 = 12 组',
       ALIGN('组', 24, '杯', ARC_216, u2), ('组', 12))
expect('    → 计入 conv', u2['conv'], 1)
expect('    → 未计入 fail', u2['fail'], 0)

u3 = ust()
expect('★ 单位 杯→件 ⇒ 24 杯 = 1 件',
       ALIGN('件', 24, '杯', ARC_216, u3), ('件', 1))

u4 = ust()
expect('   单位 件→杯 ⇒ 2 件 = 48 杯（反向）',
       ALIGN('杯', 2, '件', ARC_216, u4), ('杯', 48))

u5 = ust()
expect('★ 单位相同 ⇒ 原样，不动数量、不计 conv/fail',
       ALIGN('组', 86, '组', ARC_216, u5), ('组', 86))
expect('    → conv/fail 均 0', (u5['conv'], u5['fail']), (0, 0))

u6 = ust()
expect('★ 明细单位为空白 ⇒ 原样（不猜）',
       ALIGN('组', 86, '', ARC_216, u6), ('组', 86))
expect('    → 不计 conv/fail', (u6['conv'], u6['fail']), (0, 0))

u7 = ust()
expect('★ 目标单位为空 ⇒ 原样',
       ALIGN('', 86, '组', ARC_216, u7), ('', 86))

# 反证 2：换算不出来 ⇒ 必须退回明细单位
u8 = ust()
expect('★ 档案有换算 ⇒ 即便 spec 为空也能换算（10 杯 = 5 组）',
       ALIGN('组', 10, '杯', dict(ARC_216, spec=''), u8), ('组', 5))
expect('    → conv 计 1', u8['conv'], 1)

u8b = ust()
expect('★反证2 无档案换算 + spec 空 ⇒ **退回明细单位**',
       ALIGN('组', 10, '杯', dict(ARC_3, spec=''), u8b), ('杯', 10))
expect('    → fail 计 1（用户能看到）', u8b['fail'], 1)
expect('    → fail 样本已记录', len(u8b['sample']), 1)

u8c = ust()
expect('★反证2b 无档案换算但**两个单位都在规格串里** ⇒ 允许按规格折算（24 杯 = 12 组）',
       ALIGN('组', 24, '杯', ARC_216_NOR, u8c), ('组', 12))
expect('    → 与档案口径**同值**（12），说明两条路自洽', u8c['conv'], 1)

u8d = ust()
expect('★ 无档案换算 + 目标单位不在规格串里（件）⇒ 折不出来',
       ALIGN('件', 24, '杯', ARC_216_NOR, u8d), ('杯', 24))
expect('    → fail 计 1', u8d['fail'], 1)

u9 = ust()
expect('★ 非整数换算 ⇒ 不取整（5 杯 = 2.5 组）',
       ALIGN('组', 5, '杯', ARC_216, u9), ('组', 2.5))

u10 = ust()
expect('★ 整数换算 ⇒ 返回 int（舟谱数量列是整数）',
       type(ALIGN('件', 24, '杯', ARC_216, u10)[1]).__name__, 'int')

u11 = ust()
expect('★ arc=None ⇒ 换算不出来 ⇒ 退回明细单位（不炸）',
       ALIGN('组', 5, '杯', None, u11), ('杯', 5))

print()
print('=' * 92)
print('三、v217 真实商品（`160红枣5连杯`，spec=8、档案无换算）')
print('=' * 92)
u12 = ust()
expect('回填前（order_unit 空、无条码层）⇒ 走明细，单位「件」数量 8（**零变化**）',
       (R('B9', '件', '160红枣5连杯', ARC_217, {}), ALIGN('件', 8, '件', ARC_217, u12)),
       (('件', 'detail'), ('件', 8)))
u13 = ust()
u, src = R('B9', '件', '160红枣5连杯', ARC_217, {'B9': '条'})
expect('① 单位判决：条码层「条」胜出（明细「件」被覆盖）', (u, src), ('条', 'barcode'))
u, q = ALIGN(u, 8, '件', ARC_217, u13)
expect('② 但规格「8」定位不到任何单位 ⇒ 折不出来 ⇒ **退回明细单位**（宁可不改）',
       (u, q), ('件', 8))
expect('③ fail 已计入（用户会在下载告警里看到）', u13['fail'], 1)

u14 = ust()
_arc217b = dict(ARC_217, order_unit='条')
u, src = R('B9', '条', '160红枣5连杯', _arc217b, {})
expect('④ **回填后的真实形状**（order_unit=条、明细也是条）⇒ 取档案值、单位相同 ⇒ 不换算',
       (u, src, ALIGN(u, 8, '条', _arc217b, u14)), ('条', 'product', ('条', 8)))
expect('    → conv/fail 均 0（**零变化**的落点）', (u14['conv'], u14['fail']), (0, 0))

print()
if fail:
    print('SELFTEST FAIL：%d 项' % len(fail))
    for f in fail:
        print('   -', f)
    sys.exit(1)
print('SELFTEST OK')
