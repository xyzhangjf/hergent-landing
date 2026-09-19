#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v196 品牌归并 + 条码判据 前置只读核查（生产 tenant_1 / 主库 erp.db）

只读：所有连接都以 mode=ro 打开。不做任何写入。
目的：
  1. products.brand 全量分布（含 福宝 / 恒滋 到底怎么写）
  2. 福宝/恒滋 的商品行：name / barcode / spec 是否成对重复
  3. brands 表里有哪些品牌行（归并要同时收拾这里）
  4. brand_pending 全部条目（归并后 14 个涌入的待审品牌长什么样）
  5. 全库「同条码」分组：同品牌 / 跨品牌 / 同名 各多少
  6. 除 products 外，还有哪些表存了品牌名（返利规则 scope_name / 目标 等）
"""
import json
import os
import sqlite3
import sys

TENANT = "/opt/hergent-erp/tenant_1.db"
MAIN = "/opt/hergent-erp/erp.db"
LABEL = "福宝|恒滋"


def ro(path):
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def rows(cur, sql, *a):
    try:
        return cur.execute(sql, a).fetchall()
    except Exception as e:
        return [("ERR", str(e))]


def hr(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)


def main():
    print("tenant_1.db exists:", os.path.exists(TENANT), "| erp.db exists:", os.path.exists(MAIN))

    t = ro(TENANT)
    tc = t.cursor()

    hr("1) products.brand 全量分布")
    for r in rows(tc, "SELECT COALESCE(NULLIF(TRIM(brand),''),'(空)') b, COUNT(*) c FROM products GROUP BY b ORDER BY c DESC"):
        print("   %-24s %s" % (r[0], r[1]))

    hr("2) 含 福宝/恒滋 的商品行（brand LIKE）")
    q = "SELECT id, product_code, name, barcode, COALESCE(spec,'') spec, COALESCE(brand,'') brand, " \
        "COALESCE(is_active,1) act, COALESCE(factory_price,0) fp, COALESCE(purchase_price,0) pp, " \
        "COALESCE(sale_price,0) sp FROM products WHERE brand LIKE ? OR brand LIKE ? ORDER BY barcode, id"
    rs = rows(tc, q, "%福宝%", "%恒滋%")
    print("   命中行数 =", len(rs))
    for r in rs:
        print("   id=%-5s code=%-12s bc=%-14s spec=%-8s act=%s | %s | 品牌=%s" %
              (r[0], r[1] or '', r[3] or '', r[4], r[6], r[2], r[5]))

    hr("2b) 这些行的条码，在同库里还有没有别的商品（跨品牌同名条码）")
    bcs = sorted({r[3] for r in rs if r[3]})
    print("   涉及条码数 =", len(bcs))
    for bc in bcs:
        others = rows(tc, "SELECT id,name,COALESCE(spec,''),COALESCE(brand,'') FROM products WHERE barcode=? ORDER BY id", bc)
        print("   条码 %s 共 %d 行：" % (bc, len(others)))
        for o in others:
            print("      id=%-5s 品牌=%-14s spec=%-8s %s" % (o[0], o[3], o[2], o[1]))

    hr("3) brands 表")
    cols = rows(tc, "PRAGMA table_info(brands)")
    print("   列:", [c[1] for c in cols])
    for r in rows(tc, "SELECT * FROM brands ORDER BY id"):
        print("   ", r)

    hr("4) brand_pending 全部条目")
    pcols = rows(tc, "PRAGMA table_info(brand_pending)")
    print("   列:", [c[1] for c in pcols])
    for r in rows(tc, "SELECT * FROM brand_pending ORDER BY id"):
        print("   ", r)

    hr("5) 全库同条码分组统计")
    tot = rows(tc, "SELECT COUNT(*) FROM products WHERE TRIM(COALESCE(barcode,''))<>''")[0][0]
    grp = rows(tc, "SELECT barcode, COUNT(*) c, COUNT(DISTINCT COALESCE(NULLIF(TRIM(brand),''),'(空)')) nb, "
                    "COUNT(DISTINCT COALESCE(name,'')) nn FROM products "
                    "WHERE TRIM(COALESCE(barcode,''))<>'' GROUP BY barcode HAVING c>1 ORDER BY c DESC")
    print("   有条码商品行 =", tot, "| 重复条码组 =", len(grp))
    print("   %-16s %-4s %-8s %-8s %s" % ("条码", "行数", "品牌数", "名称数", "判定"))
    for g in grp:
        if g[1] == g[2] and g[3] == 1:
            verdict = "同品牌+同名（真重复候选）"
        elif g[3] > 1:
            verdict = "多规格（名称不同）"
        elif g[2] > 1:
            verdict = "跨品牌（户头不同）"
        else:
            verdict = "?"
        print("   %-16s %-4s %-8s %-8s %s" % (g[0], g[1], g[2], g[3], verdict))

    hr("6) 其它表里是否也存了品牌名")
    tabs = [r[0] for r in rows(tc, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    hits = []
    for tb in tabs:
        cs = rows(tc, "PRAGMA table_info(%s)" % tb)
        for c in cs:
            cn = c[1]
            if cn and ("brand" in cn.lower() or "scope" in cn.lower()):
                try:
                    n = tc.execute("SELECT COUNT(*) FROM %s WHERE CAST(\"%s\" AS TEXT) LIKE '%%福宝%%' OR CAST(\"%s\" AS TEXT) LIKE '%%恒滋%%'" % (tb, cn, cn)).fetchone()[0]
                except Exception:
                    n = -1
                hits.append((tb, cn, n))
    for h in hits:
        print("   %-28s %-20s 含福宝/恒滋 = %s" % (h[0], h[1], h[2]))

    hr("7) 主库 erp.db 里的品牌相关")
    if os.path.exists(MAIN):
        m = ro(MAIN)
        mc = m.cursor()
        mtabs = [r[0] for r in rows(mc, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        print("   主库表数 =", len(mtabs))
        for tb in mtabs:
            cs = rows(mc, "PRAGMA table_info(%s)" % tb)
            for c in cs:
                cn = c[1]
                if cn and ("brand" in cn.lower() or "scope" in cn.lower()):
                    try:
                        n = mc.execute("SELECT COUNT(*) FROM %s WHERE CAST(\"%s\" AS TEXT) LIKE '%%福宝%%' OR CAST(\"%s\" AS TEXT) LIKE '%%恒滋%%'" % (tb, cn, cn)).fetchone()[0]
                    except Exception:
                        n = -1
                    if n:
                        print("   %-28s %-20s 含福宝/恒滋 = %s" % (tb, cn, n))
        m.close()
    t.close()
    print("\n[READ-ONLY] done.")


if __name__ == "__main__":
    main()
