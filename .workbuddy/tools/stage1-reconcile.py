#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 · 自动对账卡（判定内核，最小可用版）

对应 `outputs/进销存对标ERPNext-优化清单与分阶段开发计划-2026-11-06.md`
阶段 1 第②项：「补自动对账卡（余额对台账、流水链自洽、金额对得上），
异常在页面显式告警，**禁止静默**」。

本轮交付的是**只读判定内核**（可复跑、带坏样本自证），页面接入是阶段 1 后续项。
判定四项，缺一不可：

  ① 台账数量 == 流水累加      —— 防「只改台账不写流水」
  ② 流水链自洽                —— before_qty + change_qty == after_qty
  ③ 台账金额 == 数量 × 成本   —— 防「库存看着对、成本全错」
  ④ 有非 opening 的真实交易   —— 🔴 防阶段 0 那个「镜像快照假绿」：
                                281 条流水全是 opening 快照、三项完美相等，
                                看着对账全绿，实则一笔交易都没跑过。

🔴 只读保证：默认对**沙箱副本库**只读。--self-test 会先把库复制到临时文件，
   4 种脏数据都造在临时副本上，绝不污染沙箱、绝不碰生产。

用法：
  /usr/bin/python3 .workbuddy/tools/stage1-reconcile.py
  /usr/bin/python3 .workbuddy/tools/stage1-reconcile.py --all        # 全库口径（含历史快照）
  /usr/bin/python3 .workbuddy/tools/stage1-reconcile.py --self-test   # 坏样本自证
  /usr/bin/python3 .workbuddy/tools/stage1-reconcile.py --json out.json

退出码：0 = 对账全绿；2 = 有异常（显式告警）；1 = 环境错误。
"""
import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / '.workbuddy/stage1/demo-sandbox/erp.db'
DEMO_PREFIX = '演示-%'
EPS = 0.01


def dbg(tag, msg):
    print('[%s] %s' % (tag, msg), flush=True)


def demo_scope(c):
    """取演示数据的 (product_id, warehouse_id) 范围。历史开发数据不进对账范围。"""
    pids = [r[0] for r in c.execute("SELECT id FROM products WHERE name LIKE ?", (DEMO_PREFIX,))]
    return pids


def reconcile(db_path, scope_all=False):
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    try:
        pids = demo_scope(c)
        where_p = '' if scope_all else ' AND product_id IN (%s)' % ','.join('?' * len(pids))
        args = [] if scope_all else pids
        if not scope_all and not pids:
            return {'error': '库里没有演示数据（先跑 stage1-demo-e2e.py）'}, None

        checks = []

        # ① 台账数量 vs 流水累加（按商品 + 仓库）
        led = {}
        for r in c.execute("SELECT product_id, warehouse_id, COALESCE(SUM(quantity),0) q, "
                           "COALESCE(SUM(stock_value),0) v FROM inventory WHERE 1=1" + where_p +
                           " GROUP BY product_id, warehouse_id", args):
            led[(r['product_id'], r['warehouse_id'])] = (float(r['q']), float(r['v']))
        logs = {}
        for r in c.execute("SELECT product_id, warehouse_id, COALESCE(SUM(change_qty),0) q "
                           "FROM inventory_logs WHERE 1=1" + where_p +
                           " GROUP BY product_id, warehouse_id", args):
            logs[(r['product_id'], r['warehouse_id'])] = float(r['q'])
        qty_bad = []
        for k in sorted(set(led) | set(logs)):
            lq = led.get(k, (0, 0))[0]
            gq = logs.get(k, 0)
            if abs(lq - gq) > EPS:
                qty_bad.append('商品%s/仓%s：台账 %.2f vs 流水累计 %.2f（差 %+.2f）'
                               % (k[0], k[1], lq, gq, lq - gq))
        checks.append(('台账数量 vs 流水累加', not qty_bad, qty_bad))

        # ② 流水链自洽
        chain_bad = []
        for r in c.execute("SELECT id, product_id, before_qty, change_qty, after_qty "
                           "FROM inventory_logs WHERE 1=1" + where_p + " ORDER BY id", args):
            b, ch, a = float(r['before_qty'] or 0), float(r['change_qty'] or 0), float(r['after_qty'] or 0)
            if abs(b + ch - a) > EPS:
                chain_bad.append('流水#%d：%.2f %+.2f ≠ %.2f' % (r['id'], b, ch, a))
        checks.append(('流水链自洽（前值+变动=后值）', not chain_bad, chain_bad[:8]))

        # ③ 台账金额 vs 数量 × 成本
        amt_bad = []
        for r in c.execute("SELECT id, product_id, quantity, cost_price, stock_value "
                           "FROM inventory WHERE 1=1" + where_p, args):
            expect = float(r['quantity'] or 0) * float(r['cost_price'] or 0)
            got = float(r['stock_value'] or 0)
            if abs(expect - got) > EPS:
                amt_bad.append('台账#%d：金额 %.2f vs 数量×成本 %.2f' % (r['id'], got, expect))
        checks.append(('台账金额 vs 数量×成本', not amt_bad, amt_bad[:8]))

        # ④ 真实交易存在（防「全是 opening 快照」的镜像假绿）
        types = [r[0] for r in c.execute(
            "SELECT DISTINCT change_type FROM inventory_logs WHERE 1=1" + where_p, args)]
        non_opening = [t for t in types if t and t != 'opening']
        n_non = c.execute("SELECT count(*) FROM inventory_logs WHERE change_type!='opening'"
                          + ('' if scope_all else ' AND product_id IN (%s)' % ','.join('?' * len(pids))),
                          args).fetchone()[0]
        checks.append(('存在非 opening 的真实交易流水', bool(non_opening) and n_non > 0,
                       [] if non_opening else ['流水类型只有 %s ⇒ 疑似一次性快照镜像，不是真实交易'
                                               % (types or '（无流水）')]))

        meta = {
            'scope': '全库' if scope_all else '演示数据',
            'products': pids if not scope_all else '全部',
            'ledger_rows': len(led),
            'log_types': types,
            'non_opening_logs': n_non,
        }
        out = {
            'checks': [{'name': n, 'ok': bool(o), 'problems': p} for n, o, p in checks],
            'all_ok': all(o for _, o, _ in checks),
            'meta': meta,
        }
        return out, meta
    finally:
        c.close()


def print_report(title, out):
    print('\n' + '=' * 72)
    print('阶段 1 · 自动对账卡：' + title)
    print('=' * 72)
    if out.get('error'):
        print('  ❌ ' + out['error'])
        return
    for ch in out['checks']:
        print('  %s %s' % ('✅' if ch['ok'] else '🔴', ch['name']))
        for p in ch['problems']:
            print('       · ' + p)
    m = out['meta']
    print('\n  口径=%s / 台账分组=%d / 流水类型=%s / 非快照流水=%d 条'
          % (m['scope'], m['ledger_rows'], m['log_types'], m['non_opening_logs']))
    print('  ' + ('✅ 对账全绿' if out['all_ok'] else '🔴 异常已显式告警（禁止静默）'))


CORRUPTIONS = {
    '只改台账不写流水': ("UPDATE inventory SET quantity=quantity+3 WHERE product_id IN "
                     "(SELECT id FROM products WHERE name LIKE ?)", (DEMO_PREFIX,)),
    '流水链断裂': ("UPDATE inventory_logs SET after_qty=after_qty+1 WHERE product_id IN "
                "(SELECT id FROM products WHERE name LIKE ?)", (DEMO_PREFIX,)),
    '台账金额被改': ("UPDATE inventory SET stock_value=stock_value+100 WHERE product_id IN "
                 "(SELECT id FROM products WHERE name LIKE ?)", (DEMO_PREFIX,)),
    '全是快照假绿': ("UPDATE inventory_logs SET change_type='opening' WHERE product_id IN "
                 "(SELECT id FROM products WHERE name LIKE ?)", (DEMO_PREFIX,)),
}


def self_test(db_path):
    """4 种脏数据各造在独立临时副本上，每种都必须让对账判红（坏样本自证）。"""
    expected_index = {'只改台账不写流水': 0, '流水链断裂': 1, '台账金额被改': 2, '全是快照假绿': 3}
    bad = 0
    for name, (sql, params) in CORRUPTIONS.items():
        tmp = Path(tempfile.mkstemp(prefix='stage1-recon-', suffix='.db')[1])
        shutil.copy2(db_path, tmp)
        c = sqlite3.connect(tmp)
        c.execute(sql, params)
        c.commit()
        c.close()
        out, _ = reconcile(tmp)
        idx = expected_index[name]
        hit = out.get('checks') and not out['checks'][idx]['ok']
        print('  %s %-16s → 第 %d 项判红=%s（%s）'
              % ('✅' if hit else '❌', name, idx + 1, hit,
                 out['checks'][idx]['problems'][0][:56] if hit and out['checks'][idx]['problems'] else '—'))
        if not hit:
            bad += 1
        tmp.unlink()
    return bad


def main():
    ap = argparse.ArgumentParser(description='阶段 1 自动对账卡（只读判定内核）')
    ap.add_argument('--db', default=str(DEFAULT_DB))
    ap.add_argument('--all', action='store_true', help='全库口径（默认只算演示数据）')
    ap.add_argument('--self-test', action='store_true', help='跑坏样本自证')
    ap.add_argument('--json', default=None, help='把判定结果写成 JSON')
    args = ap.parse_args()

    db = Path(args.db)
    if not db.is_file():
        print('❌ 库不存在：%s' % db, file=sys.stderr)
        return 1
    if '/opt/hergent-erp' in str(db):
        print('❌ 拒绝：本脚本不得直接指向生产库，请先做只读副本', file=sys.stderr)
        return 1

    out, meta = reconcile(db, scope_all=args.all)
    print_report('演示数据' if not args.all else '全库', out)
    if args.self_test:
        print('\n坏样本自证（4 种脏数据各造在临时副本，绝不污染沙箱）：')
        bad = self_test(db)
        if bad:
            print('  ❌ %d 种坏样本没判红 ⇒ 对账卡无效（空白支票）' % bad)
            return 2
        print('  ✅ 4/4 坏样本全部判红，对账卡有判别力')
    if args.json:
        Path(args.json).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
        print('\n[out] %s' % args.json)
    return 0 if out.get('all_ok') else 2


if __name__ == '__main__':
    sys.exit(main())
