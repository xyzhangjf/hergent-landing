#!/usr/bin/env python3
"""v316d 排序改动 —— 生产快照上的只读比对验收。

判据（每条都要有判别力，不能恒真）：
  A 新排序：有应收的行必须【全部】连续排在前面（前缀性质），前缀/后缀各自按最近下单倒序
  B 动态反例：旧排序前 20 行里有应收的行数 应 显著少于 新排序 —— 证明新旧确实不同
  C 零影响自证：供应商列表 旧 vs 新 top-30 逐 id 完全一致（并解释为什么恒等）
  D 分页确定：每页 20 翻完全量 与 一次性取全量 的 id 序列逐项一致（无重复/无遗漏）
  E 计数自洽：条数统计与全量长度一致
  F 阈值有据：报告 0 < ar <= 0.005 的残差行数（阈值是否真的在挡东西）

脱敏：只打印 id / 金额 / 日期 / 计数，绝不打印客户名与电话。
"""
import sqlite3

DB = '/tmp/v316d-shadow/tenant_1-snapshot.db'
con = sqlite3.connect('file:' + DB + '?immutable=1', uri=True)
con.row_factory = sqlite3.Row

SEL = """SELECT c.id, c.type, c.is_active,
    COALESCE((SELECT MAX(order_date) FROM sale_orders WHERE customer_id=c.id),'') as last_order,
    COALESCE((SELECT SUM(amount-paid_amount) FROM receivables WHERE contact_id=c.id AND type='ar' AND status!='paid'),0) as ar_balance
    FROM contacts c WHERE __W__ ORDER BY __O__ LIMIT ? OFFSET ?"""

OLD = 'c.id DESC'
NEW = "(CASE WHEN c.type IN ('customer','both') AND ar_balance > 0.005 THEN 0 ELSE 1 END), last_order DESC, c.id DESC"
# 第一版实现（未限定客户侧，只写 CASE WHEN ar_balance > 0.005）—— 留作负向对照
NEW_NAIVE = "(CASE WHEN ar_balance > 0.005 THEN 0 ELSE 1 END), last_order DESC, c.id DESC"

CUST_W = "c.is_active=1 AND c.type IN ('customer','both')"
SUPP_W = "c.is_active=1 AND c.type IN ('supplier','both')"

PASS = []
FAIL = []


def ok(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(('  [OK]   ' if cond else '  [FAIL] ') + name + ('  | ' + str(detail) if detail else ''))


def fetch(where, order, limit, offset=0):
    sql = SEL.replace('__W__', where).replace('__O__', order)
    return [dict(r) for r in con.execute(sql, (limit, offset)).fetchall()]


def page_all(where, order, page=20):
    """按每页 page 条翻完，返回 id 序列。"""
    ids, off = [], 0
    while True:
        rs = fetch(where, order, page, off)
        if not rs:
            break
        ids.extend([r['id'] for r in rs])
        if len(rs) < page:
            break
        off += page
    return ids


print('快照：' + DB)
print('')

# ---------- A 新排序正确性（客户） ----------
print('A 新排序前缀性质（客户）')
cust_new = fetch(CUST_W, NEW, 100000)
n_cust = len(cust_new)
front = [i for i, r in enumerate(cust_new) if r['ar_balance'] > 0.005]
tail = [i for i, r in enumerate(cust_new) if r['ar_balance'] <= 0.005]
n_front = len(front)
prefix_ok = (not front) or (not tail) or (max(front) < min(tail))
ok('A1 有应收的行全部连续排在无应收之前（前缀性质）', prefix_ok,
   '有应收=%d 无应收=%d 最大前置位=%s 最小后继位=%s'
   % (n_front, len(tail), max(front) if front else '-', min(tail) if tail else '-'))

pre = [r for r in cust_new[:n_front]]
suf = [r for r in cust_new[n_front:]]
pre_sorted = all(pre[i]['last_order'] >= pre[i + 1]['last_order'] for i in range(len(pre) - 1))
suf_sorted = all(suf[i]['last_order'] >= suf[i + 1]['last_order'] for i in range(len(suf) - 1))
ok('A2 前缀（有应收组）内部按最近下单倒序', pre_sorted, 'n=%d' % len(pre))
ok('A3 后缀（无应收组）内部按最近下单倒序', suf_sorted, 'n=%d' % len(suf))
ok('A4 有应收的行数 > 0（否则本组判据空转）', n_front > 0, 'n=%d' % n_front)

# ---------- B 动态反例 ----------
print('')
print('B 动态反例：旧排序 vs 新排序（客户前 20 行）')
old20 = fetch(CUST_W, OLD, 20)
new20 = fetch(CUST_W, NEW, 20)
c_old = len([r for r in old20 if r['ar_balance'] > 0.005])
c_new = len([r for r in new20 if r['ar_balance'] > 0.005])
ok('B1 新旧排序结果确实不同（有判别力）', c_old != c_new or [r['id'] for r in old20] != [r['id'] for r in new20],
   '旧前20有应收=%d 新前20有应收=%d' % (c_old, c_new))
ok('B2 新排序前 20 行里「有应收」的比旧排序多（主诉求达成）', c_new > c_old,
   '旧=%d → 新=%d' % (c_old, c_new))
print('    旧前20 id: ' + ','.join(str(r['id']) for r in old20[:10]) + ' ...')
print('    新前20 id: ' + ','.join(str(r['id']) for r in new20[:10]) + ' ...')
print('    旧前20 应收结余(元): ' + ','.join('%.2f' % r['ar_balance'] for r in old20[:10]))
print('    新前20 应收结余(元): ' + ','.join('%.2f' % r['ar_balance'] for r in new20[:10]))

# ---------- C 供应商零影响 ----------
print('')
print('C 供应商列表：旧 vs 新（应逐行恒等）')
supp_old = fetch(SUPP_W, OLD, 100000)
supp_new = fetch(SUPP_W, NEW, 100000)
ok('C1 供应商【全量】新旧逐 id 完全一致（选供应商场景零影响）',
   [r['id'] for r in supp_old] == [r['id'] for r in supp_new],
   'n_old=%d n_new=%d' % (len(supp_old), len(supp_new)))

# 直击本轮踩到的坑：纯供应商 id=2919 挂着 type='ar' 未付
tgt_old = [i for i, r in enumerate(supp_old) if r['id'] == 2919]
tgt_new = [i for i, r in enumerate(supp_new) if r['id'] == 2919]
ok('C2 有应收的【纯供应商】id=2919 位置不变，且未被提到首位',
   tgt_old == tgt_new and (not tgt_new or tgt_new[0] != 0),
   '旧位置=%s 新位置=%s' % (tgt_old, tgt_new))
ok('C2b id=2919 确实在供应商列表里（否则 C2 空转）', len(tgt_new) == 1, 'hit=%d' % len(tgt_new))
n_s_ar = len([r for r in supp_new if r['ar_balance'] > 0.005])
n_s_lo = len([r for r in supp_new if (r['last_order'] or '') != ''])
print('    （背景）供应商中有应收的行数 = %d/%d；last_order 非空 = %d/%d'
      % (n_s_ar, len(supp_new), n_s_lo, len(supp_new)))

# 负向对照：若去掉客户侧限定，2919 会怎样？
supp_naive = fetch(SUPP_W, NEW_NAIVE, 100000)
ok('C3 负向对照：去掉「客户侧」限定后 2919 会跳到供应商首位（证明该限定是必要的）',
   bool(supp_naive) and supp_naive[0]['id'] == 2919,
   'naive首位=%s' % (supp_naive[0]['id'] if supp_naive else '-'))

# ---------- C' 客户侧主诉求仍然成立 ----------
print('')
print("C' 客户列表主诉求")
cust_first = cust_new[0] if cust_new else None
ok("C'1 客户列表第 1 行就是「有应收」的行（首屏不再全是新建空客户）",
   bool(cust_first) and cust_first['ar_balance'] > 0.005,
   'id=%s ar=%.2f' % (cust_first['id'], cust_first['ar_balance']) if cust_first else '-')
ok("C'2 有应收的客户数 = 180（基线，便于日后回归）", n_front == 180, 'n=%d' % n_front)
r = con.execute(
    "SELECT "
    "(CASE WHEN 'customer' IN ('customer','both') AND 100 > 0.005 THEN 0 ELSE 1 END) a,"
    "(CASE WHEN 'both'     IN ('customer','both') AND 100 > 0.005 THEN 0 ELSE 1 END) b,"
    "(CASE WHEN 'supplier' IN ('customer','both') AND 100 > 0.005 THEN 0 ELSE 1 END) c,"
    "(CASE WHEN 'employee' IN ('customer','both') AND 100 > 0.005 THEN 0 ELSE 1 END) d").fetchone()
ok("C'3 表达式语义：customer/both 享受优先(0)，supplier/employee 不享受(1)",
   (r['a'], r['b'], r['c'], r['d']) == (0, 0, 1, 1), tuple(r))


# ---------- D 分页确定性 ----------
print('')
print('D 分页确定性（每页 20 翻完 vs 一次取全量）')
ids_full = [r['id'] for r in fetch(CUST_W, NEW, 100000)]
ids_paged = page_all(CUST_W, NEW, 20)
ok('D1 分页序列 == 全量序列（逐项一致）', ids_full == ids_paged,
   'full=%d paged=%d' % (len(ids_full), len(ids_paged)))
ok('D2 分页序列无重复 id', len(set(ids_paged)) == len(ids_paged),
   'uniq=%d total=%d' % (len(set(ids_paged)), len(ids_paged)))
ids_full_old = [r['id'] for r in fetch(CUST_W, OLD, 100000)]
ok('D3 旧排序同样确定（对照组，说明这条判据不是新排序专属）',
   len(set(ids_full_old)) == len(ids_full_old), 'uniq=%d' % len(set(ids_full_old)))

# ---------- E 计数自洽 ----------
print('')
print('E 计数自洽')
cnt = con.execute('SELECT COUNT(*) FROM contacts c WHERE ' + CUST_W).fetchone()[0]
ok('E1 客户总数 == 全量列表长度', cnt == n_cust, 'count=%d list=%d' % (cnt, n_cust))
cnt_s = con.execute('SELECT COUNT(*) FROM contacts c WHERE ' + SUPP_W).fetchone()[0]
ok('E2 供应商总数 == 全量列表长度', cnt_s == len(supp_new), 'count=%d list=%d' % (cnt_s, len(supp_new)))

# ---------- F 阈值有据 ----------
print('')
print('F 0.005 阈值是否真在挡东西')
resid = [r for r in cust_new if 0 < r['ar_balance'] <= 0.005]
neg = [r for r in cust_new if r['ar_balance'] < 0]
print('    0 < ar <= 0.005 的残差行数 = %d' % len(resid))
print('    ar < 0（多收/贷方）的行数   = %d' % len(neg))
ok('F1 阈值不误伤真实欠款（最小真实欠款额 > 0.005）',
   all(r['ar_balance'] > 0.005 for r in cust_new if r['ar_balance'] > 0),
   '最小正欠款=%.4f' % min([r['ar_balance'] for r in cust_new if r['ar_balance'] > 0] or [0]))
print('    （说明）残差行数=0 表示 0.005 目前是空保险，不是空转的判据')

print('')
print('==== 合计：PASS=%d  FAIL=%d ====' % (len(PASS), len(FAIL)))
if FAIL:
    print('失败项：')
    for f in FAIL:
        print('  - ' + f)
    raise SystemExit(1)
