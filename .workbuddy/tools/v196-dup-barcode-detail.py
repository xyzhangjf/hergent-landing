#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v196 条码重复 12 组明细 + 脏行追踪落点参考（只读）

回答两个问题：
  Q1 那 6 组「同品牌 + 同名 + 同条码」到底是真重复行，还是「同名不同户头/规格」？
  Q2 「蒙牛低温」下有没有真的重复行（同品牌同名同规格同条码出现 2 行）？
"""
import sqlite3

TENANT = "/opt/hergent-erp/tenant_1.db"


def ro():
    return sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)


def main():
    c = ro()
    bc = [r[0] for r in c.execute(
        "SELECT barcode FROM products WHERE TRIM(COALESCE(barcode,''))<>'' "
        "GROUP BY barcode HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC, barcode")]
    print("重复条码组数 =", len(bc))
    for b in bc:
        rs = c.execute(
            "SELECT id, COALESCE(name,''), COALESCE(spec,''), COALESCE(brand,''), "
            "COALESCE(is_active,1), COALESCE(factory_price,0), COALESCE(purchase_price,0) "
            "FROM products WHERE barcode=? ORDER BY id", (b,)).fetchall()
        names = {r[1] for r in rs}
        brands = {r[3] for r in rs}
        specs = {r[2] for r in rs}
        if len(names) == 1 and len(brands) == 1:
            verdict = "★真重复嫌疑（同名同品牌）"
        elif len(names) > 1:
            verdict = "多规格/多名称（正常）"
        else:
            verdict = "跨品牌（户头）"
        print("\n条码 %s | %d 行 | 名称%d种 品牌%d种 规格%d种 ⇒ %s"
              % (b, len(rs), len(names), len(brands), len(specs), verdict))
        for r in rs:
            print("   id=%-5s act=%s spec=%-5s 品牌=%-16s 厂价=%-8s 进价=%-8s %s"
                  % (r[0], r[4], r[2], r[3], r[5], r[6], r[1]))

    print("\n" + "=" * 72)
    print("Q2 「蒙牛低温」下同品牌 + 同名 + 同规格 的重复行")
    print("=" * 72)
    rs = c.execute(
        "SELECT COALESCE(name,'') n, COALESCE(spec,'') s, COUNT(*) c, GROUP_CONCAT(id) ids "
        "FROM products WHERE TRIM(COALESCE(brand,''))='蒙牛低温' "
        "GROUP BY n, s HAVING c>1 ORDER BY c DESC LIMIT 20").fetchall()
    print("命中组数 =", len(rs))
    for r in rs:
        print("   %-46s spec=%-5s x%s  ids=%s" % (r[0][:46], r[1], r[2], r[3]))

    print("\n" + "=" * 72)
    print("Q3 归并前后对比（模拟：把 福宝/恒滋 视作 蒙牛低温）")
    print("=" * 72)
    rs = c.execute(
        "SELECT barcode, COUNT(*) c FROM products "
        "WHERE TRIM(COALESCE(barcode,''))<>'' AND (brand LIKE '%福宝%' OR brand LIKE '%恒滋%') "
        "GROUP BY barcode HAVING c>1").fetchall()
    print("归并后新增重复条码组数 =", len(rs), "（0 = 归并零副作用）", rs)

    print("\n" + "=" * 72)
    print("Q4 其它品牌名的近义情况（供参考，本轮不动）")
    print("=" * 72)
    for r in c.execute("SELECT DISTINCT brand FROM products WHERE brand LIKE '%蒙牛%' ORDER BY brand"):
        n = c.execute("SELECT COUNT(*) FROM products WHERE brand=?", (r[0],)).fetchone()[0]
        print("   %-24s %s 行" % (r[0], n))

    print("\n[READ-ONLY] done.")


if __name__ == "__main__":
    main()
