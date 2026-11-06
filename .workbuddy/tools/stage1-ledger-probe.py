#!/usr/bin/env python3
"""阶段 1 · 真实交易链路「是否点亮」只读探针

背景（阶段 0 线上核实 2026-11-06）：
  生产 tenant_1.db 里 inventory_logs 281 行**全部是 2026-10-29 09:28:47 的一次性
  opening 快照**，台账数量/金额与流水「三项完全相等」只是快照的镜像 ⇒ 典型假绿。
  同期新销售单 0 张、新采购单 0 张 ⇒ 不是链路坏了，是**从没跑过一笔真实交易**。
  所以阶段 1 的第一个动作不是写对账卡，而是真实开一笔单，看流水会不会长。

用法（在 laozhangai-product 根目录）：
  # 第 1 次：开单前记基线
  python3 .workbuddy/tools/stage1-ledger-probe.py --reset
  # 老张在网页端真实开一笔带批次/效期的采购入库 + 一笔销售出库后：
  python3 .workbuddy/tools/stage1-ledger-probe.py
  # 只想看当前状态、不动基线：
  python3 .workbuddy/tools/stage1-ledger-probe.py --no-save

🔴 只读保证：远端用 sqlite `mode=ro` 打开，脚本只 SELECT，绝不写生产库；
   也绝不代开单据。真实业务动作必须由老张本人在 boss 账号下完成。

判定：
  ✅ 链路已点亮        —— 流水新增且含非 opening 类型
  🔴 开单但没写流水    —— 单据数增了、流水没动 ⇒ 链路断了，阶段 1 先修这个
  ⏸ 无新交易           —— 两边都没变，无法判定（先去开单）
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / '.workbuddy/stage1/ledger-baseline.json'
HOST = 'root@47.113.224.140'
DB = '/opt/hergent-erp/tenant_1.db'

REMOTE_SQL = r'''
import sqlite3, json
c = sqlite3.connect("file:%s?mode=ro", uri=True)
c.row_factory = sqlite3.Row
out = {}
def one(sql):
    try:
        r = c.execute(sql).fetchone()
        return dict(r) if r else {}
    except Exception as e:
        return {"ERR": str(e)[:120]}
def rows(sql, n=5):
    try:
        return [dict(r) for r in c.execute(sql).fetchall()][:n]
    except Exception as e:
        return [{"ERR": str(e)[:120]}]
out["logs"] = one("SELECT COUNT(*) AS n, MAX(id) AS max_id, MAX(created_at) AS last_at FROM inventory_logs")
out["logs_after_opening"] = one("SELECT COUNT(*) AS n FROM inventory_logs WHERE created_at > '2026-10-29 09:28:47'")
out["log_types"] = rows("SELECT change_type AS k, COUNT(*) AS n FROM inventory_logs GROUP BY change_type ORDER BY n DESC", 30)
out["recent_logs"] = rows("SELECT id,product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,ref_type,ref_id,created_at FROM inventory_logs ORDER BY id DESC LIMIT 5")
out["inventory"] = one("SELECT COUNT(*) AS n, SUM(CASE WHEN COALESCE(batch_no,'')<>'' THEN 1 ELSE 0 END) AS with_batch, SUM(CASE WHEN COALESCE(expiry_date,'')<>'' THEN 1 ELSE 0 END) AS with_expiry, MAX(updated_at) AS last_update, ROUND(SUM(quantity),3) AS qty_sum, ROUND(SUM(stock_value),2) AS value_sum FROM inventory")
out["purchase_orders"] = one("SELECT COUNT(*) AS n, MAX(id) AS max_id, MAX(created_at) AS last_at FROM purchase_orders")
out["sale_orders"] = one("SELECT COUNT(*) AS n, MAX(id) AS max_id, MAX(created_at) AS last_at FROM sale_orders")
out["party_ledger"] = one("SELECT COUNT(*) AS n FROM party_ledger")
print(json.dumps(out, ensure_ascii=False, default=str))
''' % DB


def collect():
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', HOST, 'python3 -'],
                       input=REMOTE_SQL, text=True, capture_output=True)
    if r.returncode != 0:
        print('❌ 远端只读采集失败 rc=%d' % r.returncode, file=sys.stderr)
        print(r.stderr[-800:], file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        print('❌ 远端输出不是合法 JSON：' + str(e), file=sys.stderr)
        print(r.stdout[-800:], file=sys.stderr)
        sys.exit(1)


def n(d, key, field='n'):
    try:
        return int((d.get(key) or {}).get(field) or 0)
    except (TypeError, ValueError):
        return 0


def show(title, cur):
    print('\n=== %s（采集时间 %s）===' % (title, dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
    print('  流水 inventory_logs      : %d 行，最大编号 %d，最后写入 %s'
          % (n(cur, 'logs'), n(cur, 'logs', 'max_id'), (cur.get('logs') or {}).get('last_at', '-')))
    print('  10-29 快照之后的流水      : %d 行' % n(cur, 'logs_after_opening'))
    print('  流水类型分布              : ' + ', '.join(
        '%s %s行' % (x.get('k'), x.get('n')) for x in (cur.get('log_types') or []) if 'ERR' not in x))
    inv = cur.get('inventory') or {}
    print('  台账 inventory           : %s 行，有批次 %s 行，有效日期 %s 行，数量合计 %s 件，金额合计 %s 元'
          % (inv.get('n'), inv.get('with_batch'), inv.get('with_expiry'), inv.get('qty_sum'), inv.get('value_sum')))
    print('  台账最后更新              : %s' % inv.get('last_update', '-'))
    print('  采购单 / 销售单          : %d / %d 张' % (n(cur, 'purchase_orders'), n(cur, 'sale_orders')))
    print('  逐笔往来账 party_ledger  : %d 行' % n(cur, 'party_ledger'))
    print('  最近 5 条流水：')
    for x in (cur.get('recent_logs') or []):
        if 'ERR' in x:
            print('    ⚠️ ' + x['ERR'])
        else:
            print('    #%s %s 变动%s 前%s→后%s 来源=%s/%s %s'
                  % (x.get('id'), x.get('change_type'), x.get('change_qty'),
                     x.get('before_qty'), x.get('after_qty'),
                     x.get('ref_type'), x.get('ref_id'), x.get('created_at')))


def compare(base, cur):
    print('\n=== 与基线对比 ===')
    d_logs = n(cur, 'logs') - n(base, 'logs')
    d_after = n(cur, 'logs_after_opening') - n(base, 'logs_after_opening')
    d_po = n(cur, 'purchase_orders') - n(base, 'purchase_orders')
    d_so = n(cur, 'sale_orders') - n(base, 'sale_orders')
    inv_b, inv_c = base.get('inventory') or {}, cur.get('inventory') or {}
    d_batch = int(inv_c.get('with_batch') or 0) - int(inv_b.get('with_batch') or 0)
    d_exp = int(inv_c.get('with_expiry') or 0) - int(inv_b.get('with_expiry') or 0)
    print('  流水 %+d 行（其中 10-29 快照之后 %+d 行）｜采购单 %+d 张｜销售单 %+d 张'
          % (d_logs, d_after, d_po, d_so))
    print('  台账有批次 %+d 行｜有效日期 %+d 行' % (d_batch, d_exp))
    new_types = [(x.get('k'), int(x.get('n') or 0)) for x in (cur.get('log_types') or []) if 'ERR' not in x]
    non_opening = sum(v for k, v in new_types if k != 'opening')

    print('\n=== 判定 ===')
    if d_logs > 0 and non_opening > 0:
        print('  ✅ 链路已点亮：真实交易产生了新流水，且不是 opening 快照。')
        print('     阶段 1 可以进入「对账卡 / 状态白名单 / 留痕接线」的编码。')
    elif (d_po > 0 or d_so > 0) and d_logs == 0:
        print('  🔴 单据数增加了但流水没动。**先别下「链路断了」的结论**，按顺序排查：')
        print('     ① 最常见：只保存了草稿。采购必须点「入库确认」(purchase_order_confirm)、')
        print('        销售必须点「发货」(sale_order_deliver) —— 只建单不写库存，这是设计如此。')
        print('     ② 确认过了仍无流水 ⇒ 链路确实断了，阶段 1 第一件事改为修写入链路，')
        print('        先查保存端点有没有调 inventory_adjust()/batch_in()，不要再写对账卡。')
    elif d_logs == 0 and d_po == 0 and d_so == 0:
        print('  ⏸ 两边都没变化：还没有新交易，无法判定。请先在 boss 账号下开单，再跑一次本探针。')
    else:
        print('  🟠 有变化但不符合上述任一模式，请把上面「最近 5 条流水」贴给我人工判读。')

    if d_po > 0 and (d_batch == 0 and d_exp == 0):
        print('  ⚠️ 采购单增加了，但台账里批次/效期仍是 0 行 —— batch_in() 可能没被调用，')
        print('     低温奶先到期先出库会没有数据可用（阶段 0 已实测效期全空）。')


def main():
    ap = argparse.ArgumentParser(description='真实交易链路点亮探针（只读生产库）')
    ap.add_argument('--reset', action='store_true', help='只记基线，不做对比（开单前跑）')
    ap.add_argument('--no-save', action='store_true', help='只看当前状态，不更新基线')
    args = ap.parse_args()

    cur = collect()
    show('线上当前状态', cur)
    if args.no_save:
        return 0

    if args.reset or not BASELINE.exists():
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(json.dumps({
            '_at': dt.datetime.now().isoformat(timespec='seconds'),
            '_note': '开单前基线；采集方式 ssh + sqlite mode=ro，全程只读',
            'data': cur
        }, ensure_ascii=False, indent=1), encoding='utf-8')
        print('\n✅ 基线已记录 → %s' % BASELINE)
        print('   现在去网页端用 boss 账号真实开一笔采购入库（填批次号＋效期）＋一笔销售出库，')
        print('   然后重跑：python3 .workbuddy/tools/stage1-ledger-probe.py')
        return 0

    try:
        base = json.loads(BASELINE.read_text(encoding='utf-8')).get('data') or {}
    except Exception as e:
        print('⚠️ 基线文件损坏（%s），请用 --reset 重建' % e, file=sys.stderr)
        return 1
    print('\n（基线采集于 %s）' % json.loads(BASELINE.read_text(encoding='utf-8')).get('_at', '?'))
    compare(base, cur)
    return 0


if __name__ == '__main__':
    sys.exit(main())
