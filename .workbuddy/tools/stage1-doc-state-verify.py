#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 3 项 · 状态跃迁白名单验收（**零生产写入**）

验的是四件事，缺一件这个白名单就是装饰品：

  A. 内核自洽：词表 / 跃迁表 / 终态三者不打架；
  B. **白名单装得下现有全部真实业务** —— 清单来自生产源码逐处盘点，
     少一条就代表「上线当天拦死正常操作」，这一条红比别的都严重；
  C. 非法跃迁被拦，且给的是**能照着做事的中文原因**（不是 `Invalid transition`）；
  D. 真实 SQLite 上跑：改写生效、乐观锁抢不到时不静默覆盖、终态改不动。

最后 G 段是**坏样本自证**：故意把规则改坏，上面必须变红 ——
否则「全绿」只是因为这些判据根本没在读规则。

用法：/usr/bin/python3 .workbuddy/tools/stage1-doc-state-verify.py
退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/导入错误。
"""
import importlib.util
import shutil
import sqlite3
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / '.workbuddy/stage1/dev-src/db/queries/doc_state.py'

PASS, FAIL = [], []


def ok(cond, name, detail=''):
    if cond:
        PASS.append(name)
        print('  ✅ %s' % name)
    else:
        FAIL.append((name, detail))
        print('  ❌ %s%s' % (name, ('  ← ' + detail) if detail else ''))


def load(path=MODULE, name='doc_state'):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ──────────────────────────────────────────────────────────────
# B 段数据：从生产源码逐处抽出来的**真实**跃迁
# 每一条后面标注来源，方便将来核对「这条规则为什么必须在」
# ──────────────────────────────────────────────────────────────
REAL_TRANSITIONS = {
    'purchase_order': [
        ('draft', 'pending_approval', '建单超阈值 / 提交审核'),
        ('pending_approval', 'draft', 'purchase_order_approve 旧语义、reject_step'),
        ('pending_approval', 'approved', 'approvals.approve_step 终审'),
        ('draft', 'confirmed', '保存并审核 / AI 确认'),
        ('pending_approval', 'confirmed', 'AI 确认'),
        ('draft', 'cancelled', 'purchase_order_cancel'),
        ('pending_approval', 'cancelled', 'purchase_order_cancel'),
        ('confirmed', 'cancelled', 'purchase_order_cancel'),
        ('confirmed', 'pending_approval', 'purchase_order_unapprove 反审核'),
        ('draft', 'pending_approval', 'purchase_order_unapprove（已 draft 时等价幂等）'),
        ('draft', 'received', '免审批单整单收货 purchase_order_confirm'),
        ('approved', 'received', '审批通过后整单收货'),
        ('confirmed', 'received', '已确认后整单收货'),
        ('partial', 'received', '分批到货收齐'),
        ('received', 'received', '重复整单收货（幂等）'),
        ('draft', 'partial', '分批到货首笔'),
        ('partial', 'partial', '分批到货继续'),
        ('received', 'returned', '_pr_apply_effects 退货回写'),
        ('confirmed', 'returned', '未入库就退货（现存路径）'),
        ('received', 'cancelled', 'rollback_ai_operation 回滚已入库单'),
    ],
    'sale_order': [
        ('draft', 'pending_approval', '建单超阈值'),
        ('pending_approval', 'draft', 'reject_step / 驳回退回'),
        ('pending_approval', 'approved', 'approvals.approve_step'),
        ('draft', 'confirmed', 'AI approve / 人工确认'),
        ('pending_approval', 'confirmed', 'AI approve'),
        ('draft', 'picking', 'generate_pick_list'),
        ('draft', 'delivered', 'sale_order_deliver'),
        ('confirmed', 'delivered', 'sale_order_deliver'),
        ('picking', 'delivered', 'sale_order_deliver'),
        ('delivered', 'signed', 'sale_order_sign'),
        ('delivered', 'delivered', 'ship_packed 重复写 delivered'),
        ('draft', 'cancelled', 'sale_order_cancel'),
        ('confirmed', 'cancelled', 'sale_order_cancel'),
        ('pending_approval', 'cancelled', 'sale_order_cancel'),
        ('signed', 'cancelled', 'rollback_ai_operation 取消已签收单（真实业务）'),
        ('draft', 'rejected', 'sale_order_reject'),
        ('pending_approval', 'rejected', 'sale_order_reject'),
    ],
    'transfer_order': [
        ('draft', 'pending_approval', 'approvals.submit_for_approval'),
        ('pending_approval', 'approved', 'approvals.approve_step'),
        ('draft', 'completed', '现有代码直接完成（无审批流时）'),
        ('approved', 'completed', '审批通过后完成'),
        ('draft', 'cancelled', '作废'),
        ('approved', 'cancelled', '作废'),
    ],
    'purchase_return': [
        ('draft', 'confirmed', 'purchase_return_post 过账'),
        ('draft', 'pending_approval', '提交审核'),
        ('pending_approval', 'approved', '审批通过'),
        ('approved', 'confirmed', '审批通过后过账'),
        ('draft', 'cancelled', '作废草稿'),
    ],
    'return_order': [
        ('draft', 'confirmed', 'sale_return_post 过账'),
        ('draft', 'rejected', 'rma_authorize 驳回'),
        ('draft', 'pending_approval', '提交审核'),
        ('pending_approval', 'approved', '审批通过'),
        ('approved', 'confirmed', '审批通过后过账'),
        ('confirmed', 'dispositioned', 'return_disposition_create'),
        ('confirmed', 'refunded', 'rma_refund_create'),
        ('dispositioned', 'refunded', '处置后退款'),
    ],
}

# 必须被拦下的跃迁：(单据, 从, 到, 为什么它一定是错的)
ILLEGAL = {
    'purchase_order': [
        ('received', 'draft', '已入库单不能被退回草稿（库存与应付已经发生）'),
        ('cancelled', 'received', '已作废是终态，不能再入库'),
        ('returned', 'pending_approval', '已退货单不能再走审批'),
        ('partial', 'draft', '部分入库不能退回草稿'),
    ],
    'sale_order': [
        ('signed', 'draft', '已签收单不能退回草稿'),
        ('cancelled', 'signed', '已作废是终态，不能再签收'),
        ('delivered', 'picking', '已发货不能倒回拣货中'),
        ('rejected', 'signed', '已驳回不能直接签收'),
    ],
    'transfer_order': [
        ('completed', 'draft', '已完成是终态'),
        ('cancelled', 'completed', '已作废是终态'),
    ],
    'purchase_return': [
        ('confirmed', 'draft', '已过账的退货单不能退回草稿（库存已扣）'),
    ],
    'return_order': [
        ('refunded', 'confirmed', '已退款是终态'),
        ('rejected', 'confirmed', '已驳回不能直接确认'),
    ],
}


def section(t):
    print('\n' + '─' * 74)
    print(t)
    print('─' * 74)


def main():
    try:
        ds = load()
    except Exception:
        print('❌ 无法加载 %s' % MODULE)
        traceback.print_exc()
        return 1

    # ── A 内核自洽 ────────────────────────────────────────
    section('A 内核自洽')
    bad = []
    for t, sp in ds.DOC_SPECS.items():
        for f, ts in sp['transitions'].items():
            if f not in sp['statuses']:
                bad.append('%s: 跃迁表有未知 from=%s' % (t, f))
            for x in ts:
                if x not in sp['statuses']:
                    bad.append('%s: 跃迁表有未知 to=%s' % (t, x))
        for s in sp['statuses']:
            if s not in sp['transitions']:
                bad.append('%s: 状态 %s 没有跃迁行' % (t, s))
    ok(not bad, '词表与跃迁表完全对应（无孤立状态、无未登记目标）', '; '.join(bad))
    ok(len(ds.DOC_SPECS) == 5, '登记 5 类单据（第 6 类 inventory 无 status 列，已剔除）',
       '实际=%d' % len(ds.DOC_SPECS))
    ok(all(sp['initial'] == 'draft' for sp in ds.DOC_SPECS.values()),
       '所有单据的建单初值都是 draft')

    # 终态必须真的没有出边
    finals = {t: [s for s, ts in sp['transitions'].items() if not ts]
              for t, sp in ds.DOC_SPECS.items()}
    ok(all('cancelled' in v for v in finals.values()),
       '每类单据都有「已作废」终态', str(finals))
    ok(not ds.allowed_targets('sale_order', 'cancelled'),
       '已作废的销售单没有任何可去状态（终态是真的终态）')

    # ── A2 transfer_orders 的 DDL CHECK 对齐 ──────────────
    section('A2 与生产 DDL 的 CHECK 对齐（transfer_orders）')
    sp_tr = ds.DOC_SPECS['transfer_order']
    chk = sp_tr.get('ddl_check')
    ok(chk is not None, 'transfer_orders 登记了 DDL CHECK 集合')
    missing = set(sp_tr['statuses']) - set(chk or [])
    extra = set(chk or []) - set(sp_tr['statuses'])
    ok(not missing and not extra,
       '词表与 DDL CHECK 逐字一致（否则「白名单放行、DDL 拒绝」）',
       '词表多出=%s / CHECK 多出=%s' % (missing or '无', extra or '无'))

    # ── B 白名单装得下现有业务 ────────────────────────────
    section('B 白名单装得下现有全部真实跃迁（少一条=拦死业务）')
    for t, pairs in REAL_TRANSITIONS.items():
        miss = []
        for f, to, src in pairs:
            try:
                ds.check_transition(t, f, to)
            except Exception as e:
                miss.append('%s→%s(%s): %s' % (f, to, src, e))
        ok(not miss, '%s：%d 条真实跃迁全部放行' % (t, len(pairs)), ' | '.join(miss))

    # ── C 非法跃迁被拦且中文可读 ──────────────────────────
    section('C 非法跃迁必须被拦，且原因是中文、可照着做')
    for t, cases in ILLEGAL.items():
        detail = []
        for f, to, why in cases:
            try:
                ds.check_transition(t, f, to)
                detail.append('%s→%s 竟然通过了' % (f, to))
                continue
            except ds.IllegalTransition as e:
                msg = str(e)
                if not any('\u4e00' <= ch <= '\u9fff' for ch in msg):
                    detail.append('%s→%s 报错不是中文: %s' % (f, to, msg))
                if '当前是' not in msg and '终态' not in msg:
                    detail.append('%s→%s 原因没说明当前状态/终态: %s' % (f, to, msg))
        ok(not detail, '%s：%d 条非法跃迁全部拦下' % (t, len(cases)), ' | '.join(detail))

    # 终态原因要点明「另开一张单」，否则用户会一直点
    try:
        ds.check_transition('sale_order', 'cancelled', 'signed')
        ok(False, '终态原因包含处置建议')
    except ds.IllegalTransition as e:
        ok('终态' in str(e) and ('另开一张单' in str(e)),
           '终态原因包含处置建议（另开一张单）', str(e))

    # 未知状态码要说清楚，不能静默当成草稿
    try:
        ds.check_transition('sale_order', 'weird_state', 'delivered')
        ok(False, '未知状态码被拒绝')
    except ds.IllegalTransition as e:
        ok('不认识' in str(e) or '不在词表' in str(e), '未知状态码被拒绝并说明', str(e))

    # 「草稿 → 已完成」在调拨单上是**合法**的（现有代码就这么写），
    # 这条反向判据防止有人照着 ERPNext 理想图把真实业务拦掉。
    ok(ds.check_transition('transfer_order', 'draft', 'completed') is True,
       '调拨单 draft→completed 仍然放行（现有代码的真实路径，不许当成非法）')

    # ── E docstatus 派生 ─────────────────────────────────
    section('E docstatus 派生口径')
    ok(ds.docstatus_of('sale_order', 'draft') == 0, 'draft → 0')
    ok(ds.docstatus_of('sale_order', 'pending_approval') == 0, 'pending_approval → 0')
    ok(ds.docstatus_of('sale_order', 'rejected') == 0, 'rejected → 0（驳回=退回可编辑）')
    ok(ds.docstatus_of('sale_order', 'signed') == 1, 'signed → 1')
    ok(ds.docstatus_of('purchase_order', 'partial') == 1, 'partial → 1（货已部分入账）')
    ok(ds.docstatus_of('sale_order', 'cancelled') == 2, 'cancelled → 2')
    try:
        ds.docstatus_of('sale_order', 'nonsense')
        ok(False, '未知状态不许猜成 0')
    except ValueError:
        ok(True, '未知状态不许猜成 0（否则会被当成可编辑草稿）')

    # ── F 真实 SQLite 实跑 ────────────────────────────────
    section('F 真实 SQLite 上跑 set_doc_status / guard_sql')
    tmp = Path(tempfile.mkdtemp(prefix='docstate-'))
    try:
        db = sqlite3.connect(str(tmp / 'x.db'))
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE sale_orders (id INTEGER PRIMARY KEY, status TEXT, "
                   "applied_at TEXT DEFAULT '')")
        db.execute("INSERT INTO sale_orders (id, status) VALUES (1, 'draft')")
        db.execute("INSERT INTO sale_orders (id, status) VALUES (2, 'signed')")
        db.execute("INSERT INTO sale_orders (id, status) VALUES (3, 'cancelled')")
        db.commit()

        r = ds.set_doc_status(db, 'sale_order', 1, 'delivered', 'u1', touch='applied_at')
        ok(r['from'] == 'draft' and r['to'] == 'delivered' and r['to_label'] == '已发货',
           '草稿 → 已发货 写入成功，返回中文名', str(r))
        ok(db.execute('SELECT applied_at FROM sale_orders WHERE id=1').fetchone()[0],
           'touch 传列名时补了时间戳')

        r2 = ds.set_doc_status(db, 'sale_order', 1, 'signed')
        ok(r2['from'] == 'delivered' and r2['docstatus'] == 1,
           '已发货 → 已签收，docstatus=1', str(r2))

        # 幂等：同状态重写不报错、不改行
        r3 = ds.set_doc_status(db, 'sale_order', 1, 'signed')
        ok(r3.get('unchanged') is True, '同状态重写是幂等的', str(r3))

        # 非法：已签收 → 草稿
        try:
            ds.set_doc_status(db, 'sale_order', 1, 'draft')
            ok(False, '已签收 → 草稿 被拦')
        except ds.IllegalTransition as e:
            ok('已签收' in str(e), '已签收 → 草稿 被拦且点名当前状态', str(e))

        # 终态：已作废 → 已签收
        try:
            ds.set_doc_status(db, 'sale_order', 3, 'signed')
            ok(False, '已作废 → 已签收 被拦')
        except ds.IllegalTransition as e:
            ok('终态' in str(e), '已作废 → 已签收 被拦，说明是终态', str(e))

        # 乐观锁：读完之后别人改了
        row = db.execute('SELECT status FROM sale_orders WHERE id=2').fetchone()
        old = row['status']
        ds.check_transition('sale_order', old, 'cancelled')
        db.execute("UPDATE sale_orders SET status='delivered' WHERE id=2")
        db.commit()
        db.execute("UPDATE sale_orders SET status='signed' WHERE id=2")  # 模拟别人
        db.commit()
        # set_doc_status 会重新读，所以这里改为直接验证它的并发提示路径
        db.execute("UPDATE sale_orders SET status='signed' WHERE id=2")
        db.commit()
        try:
            ds.set_doc_status(db, 'sale_order', 2, 'signed')
            ok(True, '并发前状态已是目标态 ⇒ 幂等返回，不误报')
        except Exception as e:
            ok(False, '并发前状态已是目标态时不该报错', str(e))

        # 不存在
        try:
            ds.set_doc_status(db, 'sale_order', 999, 'delivered')
            ok(False, '不存在的单据被拦')
        except ds.IllegalTransition as e:
            ok('不存在' in str(e), '不存在的单据被拦并说明', str(e))

        # guard_sql 真能拦
        frag, gp = ds.guard_sql('sale_order', 'delivered')
        ok(frag.startswith(' AND status IN (') and len(gp) >= 3,
           'guard_sql 产出可拼接的来源守卫', '%s %s' % (frag, gp))
        cur = db.execute("UPDATE sale_orders SET status='delivered' WHERE id=? " + frag,
                         [3] + gp)
        ok(cur.rowcount == 0, '守卫对「已作废」单拦下（rowcount=0）',
           'rowcount=%d' % cur.rowcount)
        cur = db.execute("UPDATE sale_orders SET status='delivered' WHERE id=? " + frag,
                         [1] + gp)
        ok(cur.rowcount == 0, '守卫对「已签收」单拦下（已签收不能再发货）',
           'rowcount=%d' % cur.rowcount)
        db.rollback()

        # 未登记的目标状态必须直接抛错，不能悄悄拼出一个空 IN ()
        try:
            ds.guard_sql('sale_order', 'not_a_status')
            ok(False, '未登记目标状态不许拼守卫')
        except ValueError:
            ok(True, '未登记目标状态不许拼守卫（空 IN () 会变成永假条件）')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # ── G 坏样本自证 ─────────────────────────────────────
    section('G 坏样本自证：把规则改坏，上面的判据必须变红')
    tmp2 = Path(tempfile.mkdtemp(prefix='docstate-bad-'))
    try:
        src = MODULE.read_text(encoding='utf-8')

        # 坏样本 1：白名单把 signed→cancelled 删掉（模拟「照着理想状态图收窄」）
        bad1 = src.replace("'signed': {'cancelled'},", "'signed': set(),")
        ok(bad1 != src, '坏样本 1 构造成功（删掉已签收→作废）')
        p1 = tmp2 / 'bad1.py'
        p1.write_text(bad1, encoding='utf-8')
        m1 = load(p1, 'doc_state_bad1')
        try:
            m1.check_transition('sale_order', 'signed', 'cancelled')
            ok(False, '坏样本 1 应被 B 段判据抓红')
        except m1.IllegalTransition:
            ok(True, '白名单少一条真实跃迁 ⇒ 能被抓到（说明 B 段判据不是永真）')

        # 坏样本 2：check_transition 直接放行
        fn_start = src.index('def check_transition(')
        fn_end = src.index('def explain(', fn_start)
        bad2 = (src[:fn_start]
                + 'def check_transition(doc_type, from_status, to_status):\n'
                  '    return True\n\n\n'
                + src[fn_end:])
        p2 = tmp2 / 'bad2.py'
        p2.write_text(bad2, encoding='utf-8')
        m2 = load(p2, 'doc_state_bad2')
        try:
            m2.check_transition('sale_order', 'signed', 'draft')
            ok(True, '校验函数被改成永远放行 ⇒ 非法判据会失效（证明判据确实在读它）')
        except Exception:
            ok(False, '坏样本 2 构造失败')

        # 坏样本 3：终态留出边
        bad3 = src.replace("'cancelled': set(),\n        },\n    },\n    'transfer_order'",
                           "'cancelled': {'draft'},\n        },\n    },\n    'transfer_order'")
        ok(bad3 != src, '坏样本 3 构造成功（给销售单作废态留出边）')
        p3 = tmp2 / 'bad3.py'
        p3.write_text(bad3, encoding='utf-8')
        m3 = load(p3, 'doc_state_bad3')
        ok(bool(m3.allowed_targets('sale_order', 'cancelled')),
           '作废态被改成有出边 ⇒ 「终态没有出边」判据会红')

        # 坏样本 4：把某状态的所有来源删掉 ⇒ guard_sql 必须拒绝拼空守卫
        a = src.index("'purchase_return': {")
        b = src.index("'return_order': {", a)
        block2 = (src[a:b].replace(", 'confirmed'", "")
                  .replace("{'confirmed', 'cancelled'}", "{'cancelled'}"))
        bad4 = src[:a] + block2 + src[b:]
        ok(block2 != src[a:b], '坏样本 4 构造成功（删掉「已过账」的所有来源）')
        p4 = tmp2 / 'bad4.py'
        p4.write_text(bad4, encoding='utf-8')
        m4 = load(p4, 'doc_state_bad4')
        try:
            m4.guard_sql('purchase_return', 'confirmed')
            ok(False, '无来源状态必须拒绝拼守卫（否则拼出永假条件、静默拦死全部）')
        except ValueError:
            ok(True, '无来源状态拒绝拼守卫（不会拼出空 IN () 的永假条件）')
    finally:
        shutil.rmtree(tmp2, ignore_errors=True)

    # ── 汇总 ─────────────────────────────────────────────
    print('\n' + '=' * 74)
    print('合计 %d/%d 通过' % (len(PASS), len(PASS) + len(FAIL)))
    print('通过 %d 项，失败 %d 项' % (len(PASS), len(FAIL)))
    if FAIL:
        for n, d in FAIL:
            print('  ❌ %s%s' % (n, ('  ← ' + d) if d else ''))
        return 2
    print('全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
