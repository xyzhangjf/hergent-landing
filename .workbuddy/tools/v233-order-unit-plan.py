# -*- coding: utf-8 -*-
"""v233 P2-3 只读试算：`products.order_unit`（报单单位）回填方案会改什么。

用法：
    python3 v233-order-unit-plan.py /tmp/v233-dryrun/tenant_1.db

产出三张表：
  A. 条码覆盖层（`forecast_barcode_units`）命中 ⇒ 回填 order_unit = 人工单位（最权威）
  B. 明细单位**唯一**且 ≠ 档案 unit ⇒ 回填 order_unit = 明细单位（历史事实）
  C. 明细**混用** / 无明细 ⇒ **不动**，列出待人工
并给出：主表显示单位会变的商品数（= A ∪ B 中值真的不同的那些）。

🔴 只读保证：`file:...?mode=ro`。
"""
import sqlite3
import sys

if len(sys.argv) < 2:
    print('用法: python3 v233-order-unit-plan.py <tenant_x.db>')
    sys.exit(2)
DB = sys.argv[1]

R = lambda v: ('' if v is None else str(v).strip())


def fmt_bc(v):
    if v is None or str(v).strip() == '':
        return ''
    try:
        return str(int(float(str(v).strip())))
    except Exception:
        return str(v).strip()


db = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
db.row_factory = sqlite3.Row

# ---------- 取数（一次读全，后面纯内存计算） ----------
prods = {}
for r in db.execute("SELECT id, name, barcode, unit, medium_unit, large_unit, "
                    "medium_ratio, large_ratio, spec "
                    "FROM products WHERE COALESCE(is_active,1)=1"):
    prods[int(r['id'])] = dict(r)
print('启用商品 =', len(prods))

by_bc = {}
for pid, p in prods.items():
    b = fmt_bc(p['barcode'])
    if b:
        by_bc.setdefault(b, []).append(pid)

manual = {}
for r in db.execute("SELECT barcode, unit, product_name FROM forecast_barcode_units"):
    manual[fmt_bc(r['barcode'])] = (R(r['unit']), R(r['product_name']))
print('条码覆盖层行数 =', len(manual))

detail = {}   # pid -> {unit: qty}
try:
    for r in db.execute("SELECT product_id, TRIM(COALESCE(unit,'')) u, SUM(quantity) q "
                        "FROM forecast_submission_items GROUP BY 1,2"):
        pid = int(r['product_id'] or 0)
        if not pid:
            continue
        detail.setdefault(pid, {})[R(r['u'])] = r['q'] or 0
except Exception as e:
    print('明细读取失败:', e)
print('有明细的商品 =', len(detail))

# ---------- A. 条码覆盖层 ----------
A, A_nohit = [], []
for bc, (u, pn) in manual.items():
    pids = by_bc.get(bc) or []
    if not u:
        continue
    if not pids:
        A_nohit.append((bc, u, pn))
        continue
    for pid in pids:
        A.append((pid, prods[pid], u, bc))

# ---------- B. 明细唯一单位且 ≠ 档案 unit ----------
B, C_mixed, C_same = [], [], []
for pid, us in detail.items():
    if pid not in prods:
        continue
    p = prods[pid]
    real = [k for k in us.keys() if k]          # 去掉空
    if not real:
        continue
    if len(real) > 1:
        C_mixed.append((pid, p, real, us))
        continue
    u = real[0]
    if u == R(p['unit']):
        C_same.append((pid, p, u))
        continue
    B.append((pid, p, u))

# ---------- C. 无明细的商品（不动） ----------
no_detail = [pid for pid in prods if pid not in detail]

# ---------- 汇总 ----------
def show(title, rows, macro):
    print()
    print('=' * 92)
    print('%s（%d 条）' % (title, len(rows)))
    print('=' * 92)
    for it in rows:
        print('   ' + macro(it))
    if not rows:
        print('   （无）')


show('A. 条码覆盖层命中 ⇒ order_unit = 人工单位', A,
     lambda t: 'id=%-6s 人工=%-5s 档案=%-5s    %s' % (t[0], t[2], R(t[1]['unit']), R(t[1]['name'])[:30]))
show('A2. 条码覆盖层里**对不上任何启用商品**的（需人工核）', A_nohit,
     lambda t: 'bc=%-14s 人工=%-5s  %s' % (t[0], t[1], t[2][:30]))
show('B. 明细单位唯一且 ≠ 档案 unit ⇒ order_unit = 明细单位', B,
     lambda t: 'id=%-6s 明细=%-5s 档案=%-5s spec=%-10s  %s'
               % (t[0], t[2], R(t[1]['unit']), R(t[1]['spec'])[:10], R(t[1]['name'])[:26]))
show('C. 明细单位**混用** ⇒ 不动（待人工）', C_mixed,
     lambda t: 'id=%-6s 档案=%-5s 混用=%s  %s'
               % (t[0], R(t[1]['unit']), t[2], R(t[1]['name'])[:26]))

print()
print('=' * 92)
print('汇总')
print('=' * 92)
print('   A 命中商品        : %d（其中档案 unit 与人工值相同 %d ⇒ 显示零变化）'
      % (len(A), len([t for t in A if R(t[1]['unit']) == t[2]])))
print('   B 明细唯一且不同  : %d  ⇒ **主表单位会变**' % len(B))
print('   C 明细混用        : %d  ⇒ 不动' % len(C_mixed))
print('   明细与档案已相同  : %d  ⇒ 不动' % len(C_same))
print('   无明细的商品      : %d  ⇒ 不动' % len(no_detail))
print()
print('   ⇒ 将回填 order_unit 的商品 = A(%d) ∪ B(%d) = %d'
      % (len(A), len(B), len({t[0] for t in A} | {t[0] for t in B})))
print('   ⇒ 主表「单位」列**数值/文案真的会变**的 = %d'
      % len({t[0] for t in A if R(t[1]['unit']) != t[2]} | {t[0] for t in B}))
