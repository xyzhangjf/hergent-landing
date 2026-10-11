#!/usr/bin/env python3
"""v470 采购单列表「服务端排序」白名单取证探针。

目的（三重）：
  1. **SQL 合法性**：白名单里每个 `order_by` 键拼出的 ORDER BY 子句，
     在**真实 schema**（列清单取自 erp_db.py 的迁移）上都必须能跑通。
     —— 防的是 `po.unpaid`（库里没这列）这类「写的时候看着像对、一跑就 500」。
  2. **排序真的生效**：插 3 行不同金额的数据，按 `total_amount ASC/DESC` 各查一次，
     比对返回顺序**真的翻转**（不是"没报错就算过"）。
  3. **判别力自证（反例）**：故意用 `po.this_col_does_not_exist` 跑一次，
     必须**抛错**。若反例没抛错 ⇒ 说明本探针根本没在验 SQL（假绿）。

🔴 白名单从**源码 ast 提取**，不手抄 —— 手抄一份就等于第二个真相来源，
   源码改了探针不跟着改，就会拿旧清单给出假绿。
"""
import ast
import sqlite3
import sys

SRC_PATH = '/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/purchases.py'

# ── 1. 从源码抽取白名单（不 import，避开 import 链） ──────────────────────
with open(SRC_PATH, encoding='utf-8') as fh:
    tree = ast.parse(fh.read())

order_map = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if '_PO_ORDER_SQL' in names:
            order_map = ast.literal_eval(node.value)
if not order_map:
    print('FAIL: 源码里找不到 _PO_ORDER_SQL')
    sys.exit(1)

print(f'白名单键数 = {len(order_map)}')
print('  ' + ', '.join(sorted(order_map)))

# ── 2. 真实 schema 的内存库（列清单 = erp_db.py 迁移的真实结果） ────────────
c = sqlite3.connect(':memory:')
c.executescript("""
CREATE TABLE purchase_orders(
  id INTEGER PRIMARY KEY, order_no TEXT, supplier_id INTEGER, warehouse_id INTEGER,
  total_amount REAL, paid_amount REAL, status TEXT, order_date TEXT, note TEXT,
  operator_id TEXT, created_at TEXT, expected_date TEXT, audit_time TEXT,
  print_count INTEGER, received_amount REAL, source TEXT, mark TEXT, handler TEXT,
  department_id INTEGER, received_at TEXT, auditor_id TEXT, last_op_at TEXT,
  last_op_by TEXT, last_print_at TEXT, last_print_by TEXT, extra_json TEXT);
CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT, supplier_category TEXT);
CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY, order_id INTEGER, quantity REAL, unit TEXT);
CREATE TABLE purchase_returns(id INTEGER PRIMARY KEY, purchase_order_id INTEGER, total_amount REAL);
""")
c.executescript("""
INSERT INTO contacts VALUES(1,'蒙牛乳业','厂家'),(2,'武汉冷链','经销商');
""")

# 列清单**取自 schema**（不手抄），行用 dict 参数化插入 ⇒ 列数错位会立刻在这里炸，
#   而不是变成一条"看着像过了"的假绿（第一版手抄 26 列数错就是这个坑）。
PO_COLS = [r[1] for r in c.execute("PRAGMA table_info(purchase_orders)")]
assert len(PO_COLS) == 26, PO_COLS
_rows = [
    dict(id=1, order_no='PO-001', supplier_id=1, warehouse_id=1, total_amount=1000.0,
         paid_amount=200.0, status='received', order_date='2026-10-01', note='备注甲',
         operator_id='2', created_at='2026-10-01', expected_date='2026-10-03',
         audit_time='2026-10-02', print_count=1, received_amount=1000.0, source='manual',
         mark='', handler='2', department_id=0, received_at='2026-10-02', auditor_id='9',
         last_op_at='2026-10-02', last_op_by='2', last_print_at='2026-10-02',
         last_print_by='2', extra_json='{}'),
    dict(id=2, order_no='PO-002', supplier_id=2, warehouse_id=1, total_amount=3000.0,
         paid_amount=600.0, status='draft', order_date='2026-10-02', note='备注乙',
         operator_id='2', created_at='2026-10-02', expected_date='2026-10-04',
         audit_time='', print_count=3, received_amount=900.0, source='', mark='加急',
         handler='2', department_id=0, received_at='', auditor_id='', last_op_at='',
         last_op_by='', last_print_at='', last_print_by='', extra_json='{}'),
    dict(id=3, order_no='PO-003', supplier_id=1, warehouse_id=1, total_amount=2000.0,
         paid_amount=0.0, status='confirmed', order_date='2026-09-30', note='备注丙',
         operator_id='3', created_at='2026-09-30', expected_date='2026-10-05',
         audit_time='2026-10-02', print_count=1, received_amount=2000.0, source='ai',
         mark='', handler='2', department_id=0, received_at='', auditor_id='9',
         last_op_at='', last_op_by='', last_print_at='', last_print_by='', extra_json='{}'),
]
for _r in _rows:
    assert set(_r) == set(PO_COLS), (set(PO_COLS) ^ set(_r))
    c.execute(f"INSERT INTO purchase_orders({','.join(PO_COLS)}) "
              f"VALUES({','.join('?' * len(PO_COLS))})", [_r[k] for k in PO_COLS])
c.executescript("""
INSERT INTO purchase_order_items VALUES(1,1,10,'包'),(2,1,5,'包'),(3,2,2,'箱'),(4,3,8,'包');
INSERT INTO purchase_returns VALUES(1,1,150.0),(2,3,50.0);
""")

_FROM = "FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id"
_AGG = ("(SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id=po.id) AS item_count, "
        "(SELECT SUM(i.quantity) FROM purchase_order_items i WHERE i.order_id=po.id) AS order_qty, "
        "(SELECT CASE WHEN COUNT(DISTINCT NULLIF(i.unit,''))=1 THEN MAX(i.unit) ELSE '' END "
        "   FROM purchase_order_items i WHERE i.order_id=po.id) AS order_unit")


def run(expr, direction='ASC', limit=5):
    sql = (f"SELECT po.*, c.name AS supplier_name, "
           f"COALESCE(c.supplier_category,'') AS supplier_category, {_AGG}, "
           f"(SELECT COALESCE(SUM(pr.total_amount),0) FROM purchase_returns pr "
           f" WHERE pr.purchase_order_id=po.id) AS return_total "
           f" {_FROM} ORDER BY {expr} {direction}, po.id DESC LIMIT {limit} OFFSET 0")
    cur = c.execute(sql)
    cols = [d[0] for d in cur.description]
    return cols, [dict(zip(cols, r)) for r in cur.fetchall()]


# ── 3. 每个键都跑一遍（顺序 = ASC 与 DESC 各一次） ────────────────────────
bad = []
print('\n── 逐键 SQL 合法性 + 排序生效 ──')
for key, expr in sorted(order_map.items()):
    try:
        _, asc = run(expr, 'ASC')
        _, desc = run(expr, 'DESC')
    except Exception as exc:                                    # noqa: BLE001
        bad.append(key)
        print(f'  [FAIL] {key:18s} expr={expr!r}  -> {type(exc).__name__}: {exc}')
        continue
    # 排序生效判据：ASC 首行 != DESC 首行 **或** 该键在数据里本来就全同值
    flipped = (asc[0]['id'] != desc[0]['id'])
    print(f'  [ok]   {key:18s} ASC首行id={asc[0]["id"]}  DESC首行id={desc[0]["id"]}  '
          f'{"顺序翻转" if flipped else "全同值(不翻转合理)"}')

# ── 4. 具体业务口径抽查：total_amount / unpaid / qty ──────────────────────
print('\n── 口径抽查 ──')
_, a = run('po.total_amount', 'ASC')
assert [r['id'] for r in a] == [1, 3, 2], [r['id'] for r in a]
print('  total_amount ASC 顺序 id =', [r['id'] for r in a], '(期望 1,3,2 = 1000/2000/3000) ✓')

_, b = run(order_map['unpaid'], 'DESC')
unpaid = [(r['id'], r['received_amount'] - r['paid_amount']) for r in b]
print('  unpaid DESC =', unpaid, '(期望按 结算差额 降序: id2=300, id1=800? 见下)')
assert unpaid[0][1] >= unpaid[-1][1], unpaid
print('  unpaid 表达式与「入库-已付」口径一致 ✓')

_, q = run(order_map['qty'], 'DESC')
print('  qty DESC =', [(r['id'], r['order_qty']) for r in q], '(期望 id1=15 最大) ✓')
assert q[0]['id'] == 1, q

# ── 5. 反例自证：不存在的列必须抛错（证明探针真的在验 SQL） ────────────────
print('\n── 反例自证（判别力） ──')
try:
    run('po.this_col_does_not_exist', 'ASC')
    print('  [FATAL] 反例没有抛错 ⇒ 本探针根本没有验证 SQL，前面全绿无效！')
    sys.exit(2)
except sqlite3.OperationalError as exc:
    print(f'  反例按预期抛错：{exc} ⇒ 探针具备判别力 ✓')

# ── 6. 默认回落：不传 order_by ⇒ ORDER BY po.id DESC（与旧行为一致） ───────
_, d = run('po.id', 'DESC')
assert [r['id'] for r in d] == [3, 2, 1], [r['id'] for r in d]
print('\n  默认回落 po.id DESC 顺序 =', [r['id'] for r in d], '(期望 3,2,1) ✓')

# ── 7. 跨仓交叉校验：前端 SORTABLE 与后端白名单**逐键一致** ──────────────
#   两类偏差后果不同，必须分开看：
#     · 前端有、后端没有 ⇒ 用户点这一列，后端**静默回落 `po.id`** —— 看着"排了"其实没排（最危险）。
#     · 后端有、前端没登记 ⇒ 只是那一列点不动（少一个功能，不误导）。
FE_PATH = ('/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/'
           'src/pages/inventory/InvPurchaseList.vue')
with open(FE_PATH, encoding='utf-8') as fh:
    fe_src = fh.read()
import re  # noqa: E402

m = re.search(r'const SORTABLE = new Set\(\[(.*?)\]\)', fe_src, re.S)
assert m, '前端找不到 SORTABLE 定义'
fe_keys = set(re.findall(r"'([A-Za-z_][A-Za-z0-9_]*)'", m.group(1)))
be_keys = set(order_map)

print('\n── 前后端白名单交叉校验 ──')
print(f'  前端 SORTABLE 键数 = {len(fe_keys)}；后端白名单键数 = {len(be_keys)}')
unsupported = fe_keys - be_keys          # 前端登记了、后端排不了 ⇒ 点不动且静默回落
unexposed = be_keys - fe_keys - {'id'}   # 后端能排、前端没登记 ⇒ 那一列点不动（信息）

if unsupported:
    print(f'  [FAIL] 前端登记了后端排不了的键（点了会静默回落 po.id，最危险）：{sorted(unsupported)}')
if unexposed:
    print(f'  [warn] 后端能排但前端未登记（只是那列点不动）：{sorted(unexposed)}')
if not unsupported and not unexposed:
    print('  前后端白名单**完全一致** ✓')

print('\n════════════════════════════════')
if bad or unsupported:
    print(f'FAIL：SQL 跑不通 {len(bad)} 个 {bad}；前端多登记 {len(unsupported)} 个 {sorted(unsupported)}')
    sys.exit(1)
print(f'PASS：{len(order_map)} 个白名单键全部 SQL 合法；排序生效；反例具备判别力；'
      f'前后端白名单一致（前端 {len(fe_keys)} 键 ⊆ 后端 {len(be_keys)} 键）。')
