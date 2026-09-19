#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v197 只读核查：① `products.brand='蒙牛'` 那 1 行；② 3 组「同名同规格的在售重复建档」。

用户 2026-09-19 定调（逐字）：
    1.要（蒙牛 并入 蒙牛低温）；2.要（清理 3 组在售重复建档）；3.做（P1-2 b/c/d + P2）

本脚本**纯只读**（sqlite3 以 mode=ro 打开），回答四个问题：
  Q1 那 1 行 `蒙牛` 的完整字段 + 是否与「蒙牛低温」里某行重名
  Q2 3 组共 6 行的完整字段（含 is_active / created_at / updated_at / product_code / extra_json）
  Q3 这 6 行被哪些表引用（**运行时内省 schema**：凡有 product_id / id 关联的表都数一遍）
      —— 决定「停用哪一条」而不是拍脑袋留新删旧
  Q4 期次 14 的实际引用（谁真被本期用到）+ barcode 唯一索引是否存在（1485 那个迁移成功没）
用法: python3 v197-dup-archive-audit.py
"""
import json
import sqlite3

DB = "/opt/hergent-erp/tenant_1.db"
PAIRS = [
    ("每日鲜酪桂花马蹄", 1199, 1438),
    ("青青柚子", 1198, 1439),
    ("阿慕乐黄桃", 1219, 1451),
]
IDS = [i for _, a, b in PAIRS for i in (a, b)]


def main():
    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    c.row_factory = sqlite3.Row
    cur = c.cursor()
    P = lambda *a: print(*a)

    P("=" * 78)
    P("Q0 · products 表结构 + barcode 唯一索引（v89 迁移成功没）")
    P("=" * 78)
    cols = [r["name"] for r in cur.execute("PRAGMA table_info(products)")]
    P("  列:", ", ".join(cols))
    idx = [dict(r) for r in cur.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'")]
    P("  索引:")
    for r in idx:
        P("    -", r["name"], "=>", r["sql"])
    P("  （若上表无 barcode 唯一索引 ⇒ erp_db.py:1485 的 v89 迁移当年被静默跳过）")

    P("")
    P("=" * 78)
    P("Q1 · brand='蒙牛' 那 1 行")
    P("=" * 78)
    for r in cur.execute("SELECT * FROM products WHERE brand='蒙牛'"):
        P("  ", json.dumps(dict(r), ensure_ascii=False))
    P("  「蒙牛低温」里是否有同名行？")
    for r in cur.execute(
            "SELECT id,name,spec,barcode,is_active FROM products "
            "WHERE brand='蒙牛低温' AND name IN (SELECT name FROM products WHERE brand='蒙牛')"):
        P("    ", dict(r))

    P("")
    P("=" * 78)
    P("Q2 · 3 组重复建档的 6 行全字段")
    P("=" * 78)
    for label, a, b in PAIRS:
        P("  ── %s（%d / %d）──" % (label, a, b))
        for r in cur.execute(
                "SELECT id,name,spec,barcode,brand,is_active,product_code,"
                "purchase_price,sale_price,factory_price,created_at,updated_at,"
                "LENGTH(COALESCE(extra_json,'')) ej FROM products WHERE id IN (?,?) "
                "ORDER BY id", (a, b)):
            P("    ", json.dumps(dict(r), ensure_ascii=False))

    P("")
    P("=" * 78)
    P("Q3 · 全库引用（运行时内省：凡有 product_id 列的表都数一遍）")
    P("=" * 78)
    tables = [r["name"] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    ref_tables = []
    for t in tables:
        try:
            tcols = [r["name"] for r in cur.execute("PRAGMA table_info(%s)" % t)]
        except Exception:
            continue
        if "product_id" in tcols:
            ref_tables.append((t, "product_id"))
    P("  含 product_id 列的表共 %d 个：%s" % (len(ref_tables), ", ".join(t for t, _ in ref_tables)))
    P("")
    P("  按表 × 目标 id 的引用行数（非零才打印）：")
    total_by_id = {i: 0 for i in IDS}
    for t, col in ref_tables:
        try:
            rows = cur.execute(
                "SELECT %s pid, COUNT(*) n FROM %s WHERE %s IN (%s) GROUP BY %s"
                % (col, t, col, ",".join("?" * len(IDS)), col), IDS).fetchall()
        except Exception as e:
            P("    [%s] 查询失败: %s" % (t, e))
            continue
        for r in rows:
            if r["n"]:
                P("    %-34s pid=%-6s %d 行" % (t, r["pid"], r["n"]))
                total_by_id[r["pid"]] = total_by_id.get(r["pid"], 0) + r["n"]
    P("")
    P("  ★ 每个 id 的引用合计：")
    for label, a, b in PAIRS:
        P("    %s： id=%d → %d 行 ｜ id=%d → %d 行"
          % (label, a, total_by_id.get(a, 0), b, total_by_id.get(b, 0)))
    for i in IDS:
        if total_by_id.get(i, 0) == 0:
            pass

    P("")
    P("=" * 78)
    P("Q3b · 其它可能间接引用（barcode / name 软引用，或 product_code）")
    P("=" * 78)
    bcodes = [r["barcode"] for r in cur.execute(
        "SELECT barcode FROM products WHERE id IN (%s)" % ",".join("?" * len(IDS)), IDS)]
    for t in tables:
        try:
            tcols = [r["name"] for r in cur.execute("PRAGMA table_info(%s)" % t)]
        except Exception:
            continue
        if "barcode" in tcols and t not in [x for x, _ in ref_tables]:
            n = cur.execute("SELECT COUNT(*) FROM %s WHERE barcode IN (%s)"
                            % (t, ",".join("?" * len(bcodes))), bcodes).fetchone()[0]
            if n:
                P("    %-34s barcode 命中 %d 行" % (t, n))
    P("    （无输出＝没有其它表按 barcode 引用）")

    P("")
    P("=" * 78)
    P("Q4 · 期次 14 的实际引用 + 本期用到哪些 id")
    P("=" * 78)
    ft = [t for t in tables if "forecast" in t]
    P("  forecast 相关表：", ", ".join(ft))
    for t in ft:
        try:
            tcols = [r["name"] for r in cur.execute("PRAGMA table_info(%s)" % t)]
        except Exception:
            continue
        P("    %s: %s" % (t, ", ".join(tcols)))

    P("")
    P("  ★ 目标 6 行是否出现在本期（期次 14）报单明细里：")
    for t in ft:
        tcols = [r["name"] for r in cur.execute("PRAGMA table_info(%s)" % t)]
        if "product_id" not in tcols:
            continue
        for r in cur.execute(
                "SELECT product_id, COUNT(*) n FROM %s WHERE product_id IN (%s) GROUP BY product_id"
                % (t, ",".join("?" * len(IDS))), IDS):
            P("    %s: pid=%s → %d 行" % (t, r["product_id"], r["n"]))
    P("    （无输出＝本期没用到这 6 行，停用它们在期次 14 上零影响）")

    P("")
    P("  ★ 停用后的可验证副作用：按 (brand,name,spec) 看这 3 组是否还有第二对")
    for label, a, b in PAIRS:
        rows = cur.execute(
            "SELECT id,is_active FROM products WHERE name=(SELECT name FROM products WHERE id=?) "
            "AND spec=(SELECT spec FROM products WHERE id=?) ORDER BY id", (a, a)).fetchall()
        P("    %s：%s" % (label, [(r["id"], r["is_active"]) for r in rows]))

    P("")
    P("=" * 78)
    P("Q5 · 在售(1) / 已停用(0) 分布 —— 确认现有「停用旧档」惯例")
    P("=" * 78)
    rows = cur.execute(
        "SELECT is_active, COUNT(*) n FROM products GROUP BY is_active").fetchall()
    P("  ", [(r["is_active"], r["n"]) for r in rows])
    P("  已被停用且与在售行同名同规格的组（现有惯例样本）：")
    rows = cur.execute("""
        SELECT p1.id on_id, p1.name, p1.spec, p2.id off_id
        FROM products p1 JOIN products p2
          ON p1.name=p2.name AND p1.spec=p2.spec AND p1.id<p2.id
        WHERE p1.is_active=1 AND p2.is_active=0 LIMIT 8""").fetchall()
    for r in rows:
        P("    在用 %s ←→ 停用 %s ｜ %s ｜ %s" % (r["on_id"], r["off_id"], r["name"][:28], r["spec"][:20]))
    P("   （有输出＝「停用重复档」是本库既有惯例，不是新发明）")
    c.close()


if __name__ == "__main__":
    main()
