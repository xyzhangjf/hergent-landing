#!/usr/bin/env python3
"""v771：小程序「我的预报提交」到货日期 —— **生产机只读自检**。

在生产机跑（脚本自己把生产库复制到临时副本，绝不改生产数据）：
    cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 /tmp/arrival-date-check.py

🔴 为什么必须有这个脚本：护栏契约（hergent-cn-v2/tests/miniprogram-arrival-date.contract.mjs）
   只能证明「源码写对了」，证明不了**真跑**时四种数据形态都对。这里在**完整真实 schema
   的生产库副本**上直接调 `forecast_submission_list`，逐条核对：
     A 有值   —— 值与 `forecast_periods.arrival_date` 同列一致、格式与 order_date 同为 YYYY-MM-DD
     B 空值   —— 期次到货日期为空 ⇒ 该条返回 ''，其余条不受影响
     C 期次删 —— 期次行不存在 ⇒ 该条返回 ''，且不抛错
     D 缺列   —— 期次表没有 `arrival_date` 列（老租户）⇒ 全部返回 ''，**列表接口不 500**
     E 回归   —— can_delete / can_recall / period_writable / status / order_date / items 一字不变

   C/D 是最容易伪造「全绿」的两态：前端能做的只有 `wx:if="{{item.arrivalDate}}"`，
   真正决定「空值会不会变成报错」的是服务端这段批量查询（v765c 缺列教训）。
"""
import sys, os, re, shutil, sqlite3, tempfile, contextlib

sys.path.insert(0, '/opt/hergent-erp')
import erp_db  # noqa: E402

SRC = '/opt/hergent-erp/tenant_1.db'
TMP = tempfile.mkdtemp(prefix='v771-arrival-')
DB = os.path.join(TMP, 'tenant_1.db')
shutil.copy2(SRC, DB)

_failed = 0
_n = 0


def ok(cond, label, extra=''):
    global _failed, _n
    _n += 1
    if cond:
        print('  ✅ ' + label + (' ' + extra if extra else ''))
    else:
        print('  ❌ ' + label + (' ' + extra if extra else ''))
        _failed += 1


def raw():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


@contextlib.contextmanager
def _db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()


def call(uid, limit=20):
    # 把目标函数的数据源换到临时副本；其它模块仍正常 import（完整 schema）
    erp_db.get_db = _db
    return erp_db.forecast_submission_list(uid, limit=limit)


def invariants(rows):
    """既有功能的字段快照 —— 新字段不许动它们。"""
    return {int(r['id']): (
        r.get('can_delete'), r.get('can_recall'), r.get('period_writable'),
        r.get('status'), r.get('order_date'), len(r.get('items') or [])
    ) for r in rows}


try:
    c = raw()
    uid = int(c.execute(
        "SELECT s.user_id FROM forecast_submissions s WHERE EXISTS ("
        " SELECT 1 FROM forecast_submission_items i WHERE i.submission_id=s.id"
        " AND i.product_name != '__列占位__' AND COALESCE(i.quantity,0)>0)"
        " ORDER BY s.id DESC LIMIT 1"
    ).fetchone()[0])
    print('[DB] 只读副本：%s  user_id=%s' % (DB, uid))
    period_arrival = {int(r['id']): (r['arrival_date'] or '').strip()
                      for r in c.execute('SELECT id, arrival_date FROM forecast_periods')}
    c.close()

    # ── A 有值 ────────────────────────────────────────────────
    print('\nA. 有值：逐条与期次表同列核对')
    rows = call(uid, 20)
    ok(len(rows) > 0, '拿到列表记录', '实测 %d 条' % len(rows))
    ok(all('arrival_date' in r for r in rows), '每条都新增了 arrival_date 键')
    ok(all(r['arrival_date'] == period_arrival.get(int(r.get('period_id') or 0), '') for r in rows),
       '到货日期值与 forecast_periods.arrival_date 逐条一致')
    ok(all(re.match(r'^\d{4}-\d{2}-\d{2}$', r['arrival_date'] or '') for r in rows),
       '全部 YYYY-MM-DD（与 order_date 同一格式，未二次格式化）')
    ok(all(re.match(r'^\d{4}-\d{2}-\d{2}$', r['order_date'] or '') for r in rows),
       '报单日期格式仍是原值')
    base_inv = invariants(rows)
    target_pid = int(rows[0].get('period_id') or 0)
    print('     A 组期次 id=%s，到货日期=%s' % (target_pid, rows[0]['arrival_date']))

    # ── F 路由层：GET /my 不是「函数对了但接口没带出来」 ─────────
    print('\nF. 路由层：GET /api/forecast-submissions/my 真的把字段带出来')
    import routers.forecast_submissions as fs  # noqa: E402
    class _Req:
        pass
    fs._auth = lambda r: {'id': uid, 'role': 'boss'}
    try:
        res = fs.my_submissions(_Req(), limit=5)
        rr = (res or {}).get('records') or []
        ok(bool(rr), '路由返回 records', '实测 %d 条' % len(rr))
        ok(all('arrival_date' in r for r in rr), '路由层每条都带 arrival_date')
        ok(all(r['arrival_date'] == period_arrival.get(int(r.get('period_id') or 0), '') for r in rr),
           '路由层到货日期值与期次表一致')
    except Exception as e:
        ok(False, '路由层调用不抛错', '%s: %s' % (type(e).__name__, e))

    # ── B 空值 ────────────────────────────────────────────────
    print('\nB. 空值：期次到货日期为空 ⇒ 该条返回空串，其余条不受影响')
    c = raw()
    c.execute("UPDATE forecast_periods SET arrival_date='' WHERE id=?", (target_pid,))
    c.commit(); c.close()
    rows_b = call(uid, 20)
    ok(len(rows_b) == len(rows), '记录条数不变', '%d → %d' % (len(rows), len(rows_b)))
    ok(all(r['arrival_date'] == '' for r in rows_b if int(r.get('period_id') or 0) == target_pid),
       '该期次的记录 arrival_date 为空串')
    ok(any(r['arrival_date'] != '' for r in rows_b if int(r.get('period_id') or 0) != target_pid)
       or all(int(r.get('period_id') or 0) == target_pid for r in rows_b),
       '其它期次的记录不受影响（或本页恰好全属该期次）')
    ok(invariants(rows_b) == base_inv, '既有字段/闸门不受空值影响')

    # ── C 期次被删 ────────────────────────────────────────────
    print('\nC. 期次被删：查不到期次 ⇒ 空串且不抛错')
    c = raw()
    c.execute('DELETE FROM forecast_periods WHERE id=?', (target_pid,))
    c.commit(); c.close()
    try:
        rows_c = call(uid, 20)
        ok(all(r['arrival_date'] == '' for r in rows_c if int(r.get('period_id') or 0) == target_pid),
           '期次不存在的记录 arrival_date 为空串')
        ok(len(rows_c) == len(rows), '列表没有因缺期次而丢记录', '%d 条' % len(rows_c))
    except Exception as e:
        ok(False, '期次被删时调用不抛错', '抛了 %s: %s' % (type(e).__name__, e))

    # ── D 缺列（老租户）────────────────────────────────────────
    print('\nD. 缺列：期次表没有 arrival_date 列 ⇒ fail-safe 全空、列表不 500')
    c = raw()
    cols = [r[1] for r in c.execute('PRAGMA table_info(forecast_periods)')]
    ok('arrival_date' in cols, '改造前期次表确实有该列（确保 D 是真改造）')
    cols_wo = [x for x in cols if x != 'arrival_date']
    c.execute('ALTER TABLE forecast_periods RENAME TO _fp_v771_bak')
    c.execute('CREATE TABLE forecast_periods AS SELECT %s FROM _fp_v771_bak' % ','.join(cols_wo))
    c.commit()
    ok('arrival_date' not in [r[1] for r in c.execute('PRAGMA table_info(forecast_periods)')],
       '副本里已造出「缺列」的期次表')
    c.close()
    try:
        rows_d = call(uid, 20)
        ok(len(rows_d) == len(rows), '缺列时列表照常返回', '%d 条' % len(rows_d))
        ok(all(r['arrival_date'] == '' for r in rows_d), '缺列时全部归一为空串（前端整段不渲染）')
    except Exception as e:
        ok(False, '缺列时调用不抛错（v765c 教训）', '抛了 %s: %s' % (type(e).__name__, e))

    # ── E 回归 ────────────────────────────────────────────────
    print('\nE. 回归：新增字段不参与任何判据/排序/过滤')
    ok(base_inv == invariants(rows_b), '空值态下 can_delete/can_recall/period_writable/status/order_date/明细数不变')
    ok(all(isinstance(r.get('arrival_date'), str) for r in rows + rows_b),
       'arrival_date 恒为字符串（前端归一函数能吃下，不会渲染 undefined）')

finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('\n' + ('RESULT: ALL PASS (%d checks)' % _n if _failed == 0
              else 'RESULT: FAILED (%d / %d)' % (_failed, _n)))
sys.exit(0 if _failed == 0 else 1)
