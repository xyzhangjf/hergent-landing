"""v391 · 进销存上线前只读体检（第二轮 · 补数）

第一轮（prod-psi-readiness-probe.py）已经回答：库存 54 行效期 100% 为空、order_unit 91.7% 为空、
credit_limit 全 0。这一轮只补三个「读数需要上下文才能归因」的问题：

  ① 库存到底落在哪个仓（`warehouse_id=1` 是「临期仓」还是事实上的主仓？）
     —— 决定薄壳 list 的默认仓不能用硬编码 1
  ② `order_unit` 有值的那 30 个商品是什么样（能反推单位口径的落法）
  ③ 采购主表 79 张 vs 明细 10 行的缺口有多大；销售主表 22505 张的明细量级

只读 URI，不写任何表。
"""
import os
import sqlite3
import sys

BASE = os.environ.get("ERP_DIR", "/opt/hergent-erp")
DB = os.path.join(BASE, "tenant_1.db")


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    print("=" * 62)
    print("① 库存落在哪个仓")
    print("=" * 62)
    for r in cur.execute(
        "SELECT i.warehouse_id, COALESCE(w.name,'(无此仓)') wname, COUNT(*) rows_, "
        "       SUM(i.quantity) qty "
        "FROM inventory i LEFT JOIN warehouses w ON w.id=i.warehouse_id "
        "GROUP BY i.warehouse_id ORDER BY rows_ DESC"
    ):
        print(f"  仓 {r['warehouse_id']:>3} {r['wname']:<10} 行={r['rows_']:>4} 数量={r['qty']}")

    print("\n  products 表里 order_unit 的取值分布（只看在售）:")
    for r in cur.execute(
        "SELECT COALESCE(NULLIF(order_unit,''),'(空)') u, COUNT(*) c "
        "FROM products WHERE is_active=1 GROUP BY u ORDER BY c DESC LIMIT 12"
    ):
        print(f"   {r['u']:<8} {r['c']:>4}")

    print("\n  products 有 order_unit 的样本（前 12）:")
    for r in cur.execute(
        "SELECT id,name,unit,order_unit,large_ratio,medium_ratio,has_multi_unit "
        "FROM products WHERE is_active=1 AND COALESCE(order_unit,'')<>'' LIMIT 12"
    ):
        print("   ", tuple(r))

    print("\n  ⚠️ 对照：order_unit 为空但 large_ratio>0 的商品数 =",
          cur.execute("SELECT COUNT(*) FROM products WHERE is_active=1 "
                      "AND COALESCE(order_unit,'')='' AND COALESCE(large_ratio,0)>0").fetchone()[0])

    print("\n" + "=" * 62)
    print("③ 主表 vs 明细 的行数缺口")
    print("=" * 62)
    for po, poi_ in (("purchase_orders", "purchase_order_items"),
                     ("sale_orders", "sale_order_items")):
        a = cur.execute(f"SELECT COUNT(*) FROM {po}").fetchone()[0]
        b = cur.execute(f"SELECT COUNT(*) FROM {poi_}").fetchone()[0]
        print(f"  {po:<22} {a:>7} 行")
        print(f"  {poi_:<22} {b:>7} 行   ← 平均每单 {b / a:.2f} 行" if a else "")

    print("\n  采购主表按年月分布（最近 8 个月）:")
    for r in cur.execute(
        "SELECT substr(order_date,1,7) ym, COUNT(*) c, SUM(total_amount) amt "
        "FROM purchase_orders GROUP BY ym ORDER BY ym DESC LIMIT 8"
    ):
        print(f"   {r['ym']}  单数={r['c']:>4}  金额={r['amt']}")

    print("\n  销售主表按年月分布（最近 4 个月）:")
    for r in cur.execute(
        "SELECT substr(order_date,1,7) ym, COUNT(*) c FROM sale_orders "
        "WHERE COALESCE(order_date,'')<>'' GROUP BY ym ORDER BY ym DESC LIMIT 4"
    ):
        print(f"   {r['ym']}  单数={r['c']:>6}")

    con.close()
    print("\n完成（只读）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
