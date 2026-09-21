#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v232 P2-1 内存库功能反证：舟谱模板单价 = 渠道价（与「*单位」同量纲）。

为什么必须反证而不是「读代码心算」：
  · 这件事的**错法与对法在代码上长得几乎一样** ——
    旧：`price = _round_price(it["price"])`
    新：`price = _round_price(db.resolve_for_report(pid, mapping, unit)["price"])`
    而 `it["price"]` 在生产上 **97% 等于 `products.factory_price`（元/箱）**，
    舟谱的「*单价(折后价)」配「*单位」（小/中单位）⇒ 差 10~24 倍（= 规格 × 0.9）。
  · 所以本测试的重点不是「新代码跑得通」，而是**三条不得退让的边界**：
      ① 取不到/单位不明 ⇒ **回退**，绝不写一个不知道量纲的数（防 v217「99→990」）；
      ② `products_factory`（元/大单位）**永不**可直接用在模板行上；
      ③ 回退必须**显式回报**（否则「取到渠道价」与「取到进价」在文件里一模一样）。

手法：桩掉 `db` / `core` / `erp_db` 三个模块，再**按源文件路径**加载真身
`db/queries/prices.py` 与 `routers/forecast.py`（不连库、不迁移、不碰生产）。
"""
import contextlib
import importlib.util
import sys
import types

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
sys.path.insert(0, SRV)

fail = []


def expect(name, got, want):
    ok = got == want
    print('  %s %-58s got=%r want=%r' % ('ok ' if ok else 'BAD', name, got, want))
    if not ok:
        fail.append(name)


def truthy(name, got):
    ok = bool(got)
    print('  %s %-58s got=%r' % ('ok ' if ok else 'BAD', name, got))
    if not ok:
        fail.append(name)


def _load(mod_name, rel_path):
    spec = importlib.util.spec_from_file_location(mod_name, SRV + '/' + rel_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------- 桩
# prices.py 只依赖 db.connection.get_db + db.queries.products.factory_price_sql
PROD = {}          # pid -> dict(unit, medium_unit, large_unit, factory, dist)
PCPS = {}          # (pid, cid) -> dict(price, small, medium, large)


class _Cur:
    """`prices.py` 只按**下标**取这几条 SELECT 的列 ⇒ 元组即可（无键名需求）。"""

    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    """极简 SQL 路由：只认 prices.py 真正会发的那几条 SELECT。"""

    def execute(self, sql, args=()):
        s = ' '.join(sql.split())
        if 'FROM products WHERE id=?' in s:
            p = PROD.get(args[0])
            if not p:
                return _Cur(None)
            if 'factory_price' in s:
                return _Cur((p['factory'], p['large_unit'], p['unit']))
            if 'dist_price' in s:
                return _Cur((p['dist'], p['unit']))
            return _Cur((p['unit'],))
        if 'FROM product_channel_prices m' in s:
            pid, cid = args
            m = PCPS.get((pid, cid))
            if not m:
                return _Cur(None)
            p = PROD.get(pid) or {'unit': '', 'medium_unit': '', 'large_unit': ''}
            # 列序：price, small, medium, large, p.unit, p.medium_unit, p.large_unit
            return _Cur((m['price'], m['small'], m['medium'], m['large'],
                         p['unit'], p['medium_unit'], p['large_unit']))
        return _Cur(None)


class _ConnDb(_Conn):
    """prices.py 用 `db.execute(...).fetchone()`；`get_db()` 的 ctx 要能 yield 它。"""

    def commit(self):
        pass


_conn_db = _ConnDb()


@contextlib.contextmanager
def _get_db():
    yield _conn_db


m = types.ModuleType('db')
m.__path__ = [SRV + '/db']
sys.modules['db'] = m
m_q = types.ModuleType('db.queries')
m_q.__path__ = [SRV + '/db/queries']
sys.modules['db.queries'] = m_q
m_c = types.ModuleType('db.connection')
m_c.get_db = _get_db
sys.modules['db.connection'] = m_c
m_p = types.ModuleType('db.queries.products')
m_p.factory_price_sql = lambda alias='products': 'COALESCE(%s.factory_price,0)' % alias
sys.modules['db.queries.products'] = m_p

# core / erp_db：forecast.py 的 import 面（桩掉即可，重点是纯函数）
m_core = types.ModuleType('core')
m_core._auth = lambda request: {'id': 1}
m_core.pydantic_error_detail = lambda e: str(e)
sys.modules['core'] = m_core

CALLS = []          # 记录桩收到的 (pid, mapping, unit)


def _fake_resolve_for_report(pid, mapping, unit=''):
    CALLS.append((pid, mapping, unit))
    r = (mapping or {}).get('__stub__')
    if isinstance(r, Exception):
        raise r
    return dict(r or {'price': 0.0, 'missing': True, 'price_unit': ''})


m_erp = types.ModuleType('erp_db')
m_erp.resolve_for_report = _fake_resolve_for_report
m_erp.get_business_profile = lambda: {}
m_erp.report_mapping_list = lambda **k: []
sys.modules['erp_db'] = m_erp

P = _load('prices_real', 'db/queries/prices.py')
FC = _load('forecast_real', 'routers/forecast.py')

PROD[1] = {'unit': '瓶', 'medium_unit': '桶', 'large_unit': '箱',
           'factory': 75.0, 'dist': 5.56}
PROD[2] = {'unit': '袋', 'medium_unit': '', 'large_unit': '', 'factory': 82.8, 'dist': 7.67}
PROD[3] = {'unit': '组', 'medium_unit': '', 'large_unit': '', 'factory': 82.8, 'dist': 0.0}
PCPS[(1, 9)] = {'price': 9.9, 'small': 2.0, 'medium': 40.0, 'large': 80.0}

print('① @prices 渠道价**带单位**返回（v232 新增：价的单位由取价分支自己声明）')
d = P.channel_price_detail(1, {'id': 9, 'price_source': 'matrix'}, '桶')
expect('matrix 命中中档 → 价 40.0', d['price'], 40.0)
expect('  ⇒ 单位 = 中单位名「桶」', d['unit'], '桶')
d = P.channel_price_detail(1, {'id': 9, 'price_source': 'matrix'}, '瓶')
expect('matrix 命中低档 → 单位 = 「瓶」', (d['price'], d['unit']), (2.0, '瓶'))
d = P.channel_price_detail(1, {'id': 9, 'price_source': 'matrix'}, '提')
expect('认不出的单位 ⇒ 退回主列', d['price'], 9.9)
expect('  🔴 退回主列时单位必须为「未知」空串（不得冒充小单位）', d['unit'], '')

d = P.channel_price_detail(1, {'id': 9, 'price_source': 'products_dist'})
expect('products_dist → 元/小单位', d['price'], 5.56)
expect('  ⇒ 单位 = 小单位名「瓶」', d['unit'], '瓶')
d = P.channel_price_detail(1, {'id': 9, 'price_source': 'products_factory'})
expect('products_factory → 元/大单位', d['price'], 75.0)
expect('  ⇒ 单位 = **大**单位名「箱」', d['unit'], '箱')
d = P.channel_price_detail(1, None)
expect('无渠道 → (0, none, True, \'\')',
       (d['price'], d['source'], d['missing'], d['unit']), (0.0, 'none', True, ''))
expect('档案不存在 → missing', P.channel_price_detail(999, {'id': 9, 'price_source': 'products_dist'})['missing'], True)

print('② 旧 3 元组接口**逐字节不变**（既有调用方零影响）')
old = P.resolve_channel_price(1, {'id': 9, 'price_source': 'matrix'}, '桶')
expect('resolve_channel_price 仍是 3 元组', (len(old), old[0], old[1], old[2]),
       (3, 40.0, 'matrix', False))
expect('不传 unit ⇒ 主列 9.9（旧行为）', P.resolve_channel_price(1, {'id': 9, 'price_source': 'matrix'})[0], 9.9)

print('③ @forecast 量纲闸门：哪些价**不允许**写进「*单价(折后价)」')
expect('products_dist（元/小单位）⇒ 放行', FC._reject_reason({'price_source': 'products_dist', 'price_unit': '瓶'}), '')
expect('matrix 命中档（元/该档单位）⇒ 放行',
       FC._reject_reason({'price_source': 'matrix', 'price_unit': '桶'}), '')
truthy('🔴 products_factory（元/大单位）⇒ **拒绝**（这就是防 v217 990 的那一击）',
       FC._reject_reason({'price_source': 'products_factory', 'price_unit': '箱'}))
truthy('🔴 matrix 退回主列（单位未知）⇒ 拒绝',
       FC._reject_reason({'price_source': 'matrix', 'price_unit': ''}))

DETAIL = {'product_id': 1, 'product_name': '蒙牛纯甄', 'price': 75.0}   # 明细价 = 进价（元/箱）


def _price(stub, unit='瓶', it=None):
    st = FC._new_price_stat()
    if stub is not None:
        MAP = {'__stub__': stub}
    else:
        MAP = {}
    v, src = FC._template_price(it or dict(DETAIL), MAP, unit, st)
    return v, src, st


print('④ @forecast 取值：渠道价优先，取不到才回退明细价')
v, src, st = _price({'price': 5.56, 'missing': False, 'price_source': 'products_dist', 'price_unit': '瓶'})
expect('取到渠道价 ⇒ 用 5.56（**不再是 75.0**）', (v, src), (5.56, 'channel'))
expect('  统计 ch=1', st['ch'], 1)
v, src, st = _price({'price': 0.0, 'missing': True, 'price_source': 'products_dist', 'price_unit': '瓶'})
expect('该渠道没录价 ⇒ 回退明细价 75.0', (v, src), (75.0, 'detail'))
expect('  missing 计数 1', st['missing'], 1)
v, src, st = _price({'price': 75.0, 'missing': False, 'price_source': 'products_factory', 'price_unit': '箱'})
expect('🔴 只取到进价（元/箱）⇒ 回退明细价，**不得**写 75.0 冒充渠道价', (v, src), (75.0, 'detail'))
expect('  arity 计数 1（= 量纲不符）', st['arity'], 1)
expect('  arity 样本已记录（供回报）', len(st['arity_sample']), 1)
v, src, st = _price({'price': 9.9, 'missing': False, 'price_source': 'matrix', 'price_unit': ''})
expect('matrix 单位未知 ⇒ 回退', (v, src), (75.0, 'detail'))
v, src, st = _price(RuntimeError('boom'))
expect('取价抛异常 ⇒ 回退（不得让模板整份生成失败）', (v, src), (75.0, 'detail'))
expect('  err 计数 1', st['err'], 1)
_n_before = len(CALLS)
v, src, st = _price(None, it={'product_id': 0, 'product_name': '无档案行', 'price': 12.0})
expect('无档案号 ⇒ 直接用明细价且**不调用取价**', (v, src), (12.0, 'detail'))
expect('  nopid 计数 1', st['nopid'], 1)
expect('  确实没有发出取价调用', len(CALLS), _n_before)
v, src, st = _price({'price': 7.0, 'missing': False, 'price_source': 'products_dist', 'price_unit': '瓶'},
                    unit='桶')
expect('报单单位以行内 unit 为准（透传下去）', (v, src), (7.0, 'channel'))
expect('  透传给取价的 unit = 桶', CALLS[-1][2], '桶')

print('⑤ 🔴 回退必须**显式回报**（否则「渠道价」与「进价」在文件里长得一样）')
w = []
FC._price_stat_warnings(FC._new_price_stat(), w)
expect('全 0（一行都没取到渠道价）⇒ 必须出告警', len(w), 1)
truthy('  且告警里点明「进价，元/箱」', '元/箱' in w[0])
w = []
st = FC._new_price_stat()
st['ch'] = 10
st['missing'] = 2
st['arity'] = 1
st['arity_sample'] = ['「某商品」单位不同量纲']
FC._price_stat_warnings(st, w)
expect('有取到也有回退 ⇒ 两条告警（分别说清各多少行）', len(w), 2)
truthy('  第 1 条点名渠道价行数', '10' in w[0])
truthy('  第 2 条点名回退行数 + 原因 + 样本', ('3' in w[1]) and ('量纲' in w[1]) and ('某商品' in w[1]))
w = []
st = FC._new_price_stat()
st['ch'] = 5
FC._price_stat_warnings(st, w)
expect('全部取到渠道价 ⇒ 只报 1 条（只说来源）', len(w), 1)

print()
print('自证通过 ✓' if not fail else '自证未通过 ✗ %d 项：%s' % (len(fail), fail))
sys.exit(1 if fail else 0)
