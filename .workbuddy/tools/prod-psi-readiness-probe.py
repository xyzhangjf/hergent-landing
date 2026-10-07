"""v391 · 进销存上线前只读体检（**绝不写库**）

用途：批次 4/5 动手前回答计划文档「十、未验证项」里的 #5/#6，并量化一个现存缺陷：
      采购入库的「批次号 / 到期日」是否真的落得了库。

为什么单独写这个脚本（而不是 ssh 里塞 python -c）：
  heredoc / 多层引号经 ssh 会被吞，本仓已有踩坑记录（见 local-machine-pitfalls）。
  所以：本地写盘 → scp → 远端 runuser 执行，输出原样带回。

纪律：
  · 连接串一律 `file:...?mode=ro`（SQLite 只读 URI），**不 commit、不写任何表**
  · 服务以 hergent 用户跑，DB 文件属主 hergent ⇒ 必须 runuser（否则 Permission denied）
  · 绝不 import 应用（core.py 第 12 行要 ERP_SECRET；且 import 会写 __pycache__）
用法：
  scp 到生产 → runuser -u hergent -- python3 prod-psi-readiness-probe.py
"""
import glob
import os
import sqlite3
import sys

BASE = os.environ.get("ERP_DIR", "/opt/hergent-erp")
TARGETS = ("tenant_1.db",)


def q(cur, sql, params=()):
    try:
        return cur.execute(sql, params).fetchall()
    except Exception as e:  # 表/列可能不存在 —— 显式说出，不吞
        return [("__ERR__", str(e))]


def section(title):
    print("\n" + "=" * 62)
    print(title)
    print("=" * 62)


def main():
    print(f"ERP_DIR = {BASE}")
    found = []
    for name in TARGETS:
        p = os.path.join(BASE, name)
        if os.path.exists(p):
            found.append(p)
    # 兜底：目录里实际有哪些租户库（不改 TARGETS 的语义，只是告知）
    others = sorted(os.path.basename(x) for x in glob.glob(os.path.join(BASE, "tenant_*.db")))
    print(f"目标库存在：{found}")
    print(f"目录内全部租户库：{others}")

    for path in found:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        section(f"{os.path.basename(path)}")

        print("\n-- #5 既有库存表是否真有数据 --")
        print("inventory 总行数 :", q(cur, "SELECT COUNT(*) FROM inventory")[0][0])
        print("inventory 有货行 :", q(cur, "SELECT COUNT(*) FROM inventory WHERE quantity>0")[0][0])
        print("warehouses 行数  :", q(cur, "SELECT COUNT(*) FROM warehouses")[0][0])
        for r in q(cur, "SELECT id,name,is_default FROM warehouses LIMIT 10"):
            print("   ·", tuple(r))

        print("\n-- 🔴 缺陷量化：入库批次的效期覆盖率（低温奶命根子）--")
        tot = q(cur, "SELECT COUNT(*) FROM inventory")[0][0]
        print(f"inventory 行数              : {tot}")
        print("batch_no 为空的行           :", q(cur, "SELECT COUNT(*) FROM inventory WHERE COALESCE(batch_no,'')=''")[0][0])
        print("expiry_date 为空的行        :", q(cur, "SELECT COUNT(*) FROM inventory WHERE COALESCE(expiry_date,'')=''")[0][0])
        print("有货但 expiry_date 为空的行 :",
              q(cur, "SELECT COUNT(*) FROM inventory WHERE quantity>0 AND COALESCE(expiry_date,'')=''")[0][0])
        print("\n  sample（前 8 行）:")
        for r in q(cur, "SELECT id,product_id,warehouse_id,quantity,batch_no,expiry_date,production_date "
                        "FROM inventory ORDER BY id LIMIT 8"):
            print("   ", tuple(r))

        print("\n-- 采购单：明细里的批次字段有没有被写过 --")
        n_items = q(cur, "SELECT COUNT(*) FROM purchase_order_items")[0][0]
        print("purchase_order_items 行数        :", n_items)
        print("  其中 batch_no 非空             :",
              q(cur, "SELECT COUNT(*) FROM purchase_order_items WHERE COALESCE(batch_no,'')<>''")[0][0])
        print("  其中 expiry_date 非空          :",
              q(cur, "SELECT COUNT(*) FROM purchase_order_items WHERE COALESCE(expiry_date,'')<>''")[0][0])
        print("\n  按状态分布:")
        for r in q(cur, "SELECT status, COUNT(*) c FROM purchase_orders GROUP BY status ORDER BY c DESC"):
            print("   ", tuple(r))

        print("\n-- 销售单：#6 信用额度口径（赊销客户有多少）--")
        print("sale_orders 行数 :", q(cur, "SELECT COUNT(*) FROM sale_orders")[0][0])
        for r in q(cur, "SELECT status, COUNT(*) c FROM sale_orders GROUP BY status ORDER BY c DESC LIMIT 12"):
            print("   ", tuple(r))
        print("\n  客户信用额度分布（credit_limit>0 的客户数）:",
              q(cur, "SELECT COUNT(*) FROM contacts WHERE type='customer' AND COALESCE(credit_limit,0)>0")[0][0])
        print("  客户总数（type=customer）                  :",
              q(cur, "SELECT COUNT(*) FROM contacts WHERE type='customer'")[0][0])
        print("  应收未清行数                              :",
              q(cur, "SELECT COUNT(*) FROM receivables WHERE COALESCE(status,'')<>'paid'")[0][0])

        print("\n-- 供应商 / 商品（批次 5 建档前置）--")
        print("供应商数（type=supplier）:", q(cur, "SELECT COUNT(*) FROM contacts WHERE type='supplier'")[0][0])
        print("商品数（is_active=1）    :", q(cur, "SELECT COUNT(*) FROM products WHERE is_active=1")[0][0])
        print("  其中 order_unit 为空的 :",
              q(cur, "SELECT COUNT(*) FROM products WHERE is_active=1 AND COALESCE(order_unit,'')=''")[0][0])
        print("  其中 large_ratio>0 的  :",
              q(cur, "SELECT COUNT(*) FROM products WHERE is_active=1 AND COALESCE(large_ratio,0)>0")[0][0])

        con.close()

    print("\n完成（全程只读，未写任何表）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
