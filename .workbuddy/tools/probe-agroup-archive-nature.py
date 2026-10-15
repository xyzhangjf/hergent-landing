# -*- coding: utf-8 -*-
"""A 组 20 个商品定性侦察（只读）。核心问题：它们是"下单专用档案"还是"正常销售商品"？
判据：① 生命周期是否进过销售明细 ② 是否存在"同名兄弟档案"（去掉下单标记后）且兄弟档案有销售
"""
import sqlite3, re

DB = '/opt/hergent-erp/tenant_1.db'
IDS = [1439, 1535, 1537, 1538, 1541, 1542, 1547, 1549, 1550, 1551, 1552,
       1557, 1558, 1561, 1566, 1569, 1573, 1580, 1584, 1586]

con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.text_factory = lambda b: b.decode('utf-8', 'replace')
cur = con.cursor()

# ---- 1. 结构侦察（先确认真实列名，绝不猜）----
def cols(t):
    try:
        cur.execute(f"PRAGMA table_info({t})")
        return [r[1] for r in cur.fetchall()]
    except Exception as e:
        return ['ERR:' + str(e)]

for t in ['products', 'sale_order_items', 'purchase_order_items']:
    print(f"[SCHEMA] {t}: {cols(t)}")

pc, sc, puc = cols('products'), cols('sale_order_items'), cols('purchase_order_items')
if any(c and c[0].startswith('ERR') for c in (pc, sc, puc)):
    raise SystemExit('表缺失，先核库')

# 销售明细里产品列 / 数量列 / 金额列 自适应
def pick(cs, cands, default):
    for c in cands:
        if c in cs:
            return c
    return default

S_PID = pick(sc, ['product_id', 'productId'], 'product_id')
S_QTY = pick(sc, ['quantity', 'qty'], 'quantity')
S_AMT = pick(sc, ['amount', 'total'], 'amount')
P_PID = pick(puc, ['product_id', 'productId'], 'product_id')
P_QTY = pick(puc, ['quantity', 'qty'], 'quantity')
print(f"[BIND] sale: pid={S_PID} qty={S_QTY} amt={S_AMT} | purch: pid={P_PID} qty={P_QTY}")

# ---- 2. 20 个商品全景 ----
print('\n=== A 组 20 个商品：生命周期销售/采购实况 ===')
print(f"{'id':>5} | {'单位':<4} | {'销售行数':>6} | {'销量':>8} | {'销售额':>10} | {'采购行数':>6} | 商品名")
rows = cur.execute(f"""
  SELECT p.id, p.name, p.unit, p.is_active, p.purchase_price
  FROM products p WHERE p.id IN ({','.join('?' * len(IDS))})
""", IDS).fetchall()

base_names = {}
for pid, name, unit, act, pp in rows:
    sale = cur.execute(
        f"SELECT COUNT(*), COALESCE(SUM({S_QTY}),0), COALESCE(SUM({S_AMT}),0) "
        f"FROM sale_order_items WHERE {S_PID}=?", (pid,)).fetchone()
    pur = cur.execute(
        f"SELECT COUNT(*), COALESCE(SUM({P_QTY}),0) "
        f"FROM purchase_order_items WHERE {P_PID}=?", (pid,)).fetchone()
    print(f"{pid:>5} | {str(unit):<4} | {sale[0]:>6} | {sale[1]:>8} | {sale[2]:>10.2f} | {pur[0]:>6} | {name}")

    # 去掉下单/排期标记取基名（（恒滋下单）/ +4到货 / 单号下单 / 双号排期 / +3发货 / 16连 等）
    base = re.split(r'[（(]|\+\d|单号下单|双号排期|双号下单|16连', str(name))[0].strip()
    if len(base) >= 3:
        base_names[pid] = (base, str(name))

# ---- 3. 兄弟档案侦察（决定性证据）----
print('\n=== 兄弟档案侦察（同基名的其它商品档案，看谁在真正跑销售）===')
found_any = False
for pid, (base, full) in base_names.items():
    sib = cur.execute("""
      SELECT p.id, p.name, p.unit, p.is_active,
        (SELECT COUNT(*) FROM sale_order_items s WHERE s.%(sp)s = p.id) AS sr,
        (SELECT COALESCE(SUM(%(sa)s),0) FROM sale_order_items s WHERE s.%(sp)s = p.id) AS sa
      FROM products p
      WHERE p.name LIKE ? AND p.id != ?
      ORDER BY sa DESC
    """ % {'sp': S_PID, 'sa': S_AMT}, (base + '%', pid)).fetchall()
    if sib:
        found_any = True
        print(f"\n  基名「{base}」(来自 #{pid} {full}) 的其它档案：")
        for sid, sname, sunit, sact, sr, sa in sib:
            print(f"    #{sid} 单位={sunit} 活跃={sact} 销售行数={sr} 销售额={sa:.2f} | {sname}")
if not found_any:
    print('  （未发现任何同基名兄弟档案 ⇒ 不是"重复建档"，20 个都是唯一档案）')

con.close()
