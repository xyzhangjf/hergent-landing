#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v232 P2-1 影响面试算（**只读**）：舟谱模板单价「渠道价」vs「明细价」逐行对比。

为什么要有这个工具：
  · P2-1 把模板「*单价(折后价)」从**明细价**改成**该报单对象的渠道价**。
    明细价在生产上 97% 等于 `products.factory_price`（**元/箱**），而舟谱那一列
    与「*单位」同量纲（元/单位）⇒ 会变很多行，且量级差「规格 × 0.9」倍。
  · 「变了多少行、变成什么」必须在**动生产之前**说清楚，不能部署完再看。
  · 本工具走**真身代码**（`db/queries/prices.py` 的取价 + `routers/forecast.py`
    的 `_reject_reason` 闸门），不另写一份口径 —— 否则试算与线上会分家。

用法：
    python3 v232-zhoupu-price-impact.py --db ./tenant_1.db
    python3 v232-zhoupu-price-impact.py --db /opt/hergent-erp/tenant_1.db \
            --server /opt/hergent-erp        # 生产机上（扁平布局，无 server/ 子目录）

只读保证：以 `file:...?mode=ro` 打开 ⇒ 任何写操作都会抛错，
连 `ensure_default_channels()` 的惰性补种也写不进去（会被它自己的 except 吞掉）。
"""
import argparse
import contextlib
import importlib.util
import sqlite3
import sys
import types

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'


def _load(mod_name, rel_path):
    spec = importlib.util.spec_from_file_location(mod_name, SRV + '/' + rel_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


_ctx = None


@contextlib.contextmanager
def _get_db():
    yield _ctx


def _install_stubs(db_path):
    """把 `db.connection.get_db` 换成「只读打开指定租户库」的连接。

    `prices.py` 只通过 `get_db()` 取数 ⇒ 这样就能让**真身取价代码**跑在任一库上。
    """
    global _ctx
    raw = sqlite3.connect('file:' + db_path + '?mode=ro', uri=True)
    raw.row_factory = sqlite3.Row

    class _Ctx:
        def commit(self):
            pass

        def execute(self, sql, args=()):
            return raw.execute(sql, args)

    _ctx = _Ctx()

    m = types.ModuleType('db')
    m.__path__ = [SRV + '/db']
    sys.modules['db'] = m
    m_q = types.ModuleType('db.queries')
    m_q.__path__ = [SRV + '/db/queries']
    sys.modules['db.queries'] = m_q
    m_c = types.ModuleType('db.connection')
    m_c.get_db = _get_db
    sys.modules['db.connection'] = m_c
    # 只替一个纯 SQL 片段（`products_factory` 分支用）；它本身不是业务口径
    m_p = types.ModuleType('db.queries.products')
    m_p.factory_price_sql = lambda alias='products': 'COALESCE(%s.factory_price,0)' % alias
    sys.modules['db.queries.products'] = m_p
    m_core = types.ModuleType('core')
    m_core._auth = lambda request: {'id': 1}
    m_core.pydantic_error_detail = lambda e: str(e)
    sys.modules['core'] = m_core
    m_erp = types.ModuleType('erp_db')
    m_erp.get_db = _get_db
    m_erp.report_mapping_list = lambda **k: []
    sys.modules['erp_db'] = m_erp


def main():
    global SRV
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='租户库文件路径（只读打开）')
    ap.add_argument('--server', default=SRV, help='后端代码根目录（生产机为 /opt/hergent-erp）')
    args = ap.parse_args()
    SRV = args.server
    sys.path.insert(0, SRV)

    _install_stubs(args.db)
    P = _load('prices_real', 'db/queries/prices.py')
    FC = _load('forecast_real', 'routers/forecast.py')

    raw = sqlite3.connect('file:' + args.db + '?mode=ro', uri=True)
    raw.row_factory = sqlite3.Row

    def q(sql, *a):
        try:
            return raw.execute(sql, a).fetchall()
        except sqlite3.Error as e:
            print('  (读表失败 %s) %s' % (e, sql.split()[2] if len(sql.split()) > 2 else sql))
            return []

    maps = {}
    for r in q('SELECT * FROM report_mapping'):
        d = dict(r)
        maps[str(d.get('report_alias') or '').strip()] = d
    try:
        channels = {int(r['id']): str(r['name']) for r in q('SELECT id,name,is_default FROM price_channels')}
        dflt = [str(r['name']) for r in q('SELECT id,name,is_default FROM price_channels')
                if int(r['is_default'] or 0)]
    except sqlite3.Error:
        channels, dflt = {}, []

    print('=' * 74)
    print('库：%s' % args.db)
    print('渠道：%s' % (channels or '（无 —— 取价会退回明细价）'))
    print('默认渠道（兜底）：%s' % (dflt or '（无）'))
    print('报单对象：%d 条，其中显式挂渠道 %d 条'
          % (len(maps), sum(1 for v in maps.values() if int(v.get('channel_id') or 0) > 0)))
    print('=' * 74)

    rows = q("""
SELECT s.store_name AS store, i.product_id AS pid, COALESCE(i.product_name,'') AS pname,
       COALESCE(i.unit,'') AS u, COALESCE(i.quantity,0) AS q,
       COALESCE(i.price,0) AS ip, COALESCE(i.amount,0) AS amt
FROM forecast_submission_items i JOIN forecast_submissions s ON s.id = i.submission_id
WHERE COALESCE(i.quantity,0) > 0
ORDER BY s.store_name, i.id """)
    print('参与行数（正数量）：%d\n' % len(rows))

    cat, samples = {}, {}
    n_changed, delta = 0, 0.0
    for r in rows:
        pid = int(r['pid'] or 0)
        store = str(r['store'] or '')
        u = str(r['u'] or '')
        old = round(float(r['ip'] or 0), 2)
        new = old
        if pid <= 0:
            k = '① 无档案号 ⇒ 必回退（不变）'
        else:
            d = P.resolve_for_report(pid, maps.get(store), u)
            if d.get('missing'):
                k = '② 该渠道没录价 ⇒ 回退（不变）'
            else:
                why = FC._reject_reason(d)
                if why:
                    k = '③ 量纲不可用 ⇒ 回退（不变）'
                else:
                    new = round(float(d['price']), 2)
                    if abs(new - old) < 0.005:
                        k = '④ 渠道价 == 明细价（不变）'
                    elif old <= 0:
                        k = '⑤ 明细价为空 ⇒ 新增单价（正向）'
                    else:
                        k = '⑥ 会变：明细价(进价,元/箱) → 渠道价(元/单位)'
                        n_changed += 1
                        delta += new - old
        cat[k] = cat.get(k, 0) + 1
        if k.startswith(('③', '⑤', '⑥')):
            samples.setdefault(k, [])
            if len(samples[k]) < 6:
                samples[k].append((store[:10], r['pname'][:22], u, old, new))

    print('--- 逐行影响分类 ---')
    for k in sorted(cat):
        print('  %-42s %5d 行' % (k, cat[k]))
    if n_changed:
        print('  ⇒ 会变 %d 行；逐行单价之和 %+.2f（单位：元/单位）' % (n_changed, delta))
    print()
    for k in sorted(samples):
        print('  样本 %s' % k)
        for s in samples[k]:
            print('     %-10s %-24s 单位=%-3s 旧=%-9s 新=%s' % s)
    print()
    print('只读试算结束（未写任何库）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
