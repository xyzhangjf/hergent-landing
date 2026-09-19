#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v197b 深查：3 组重复建档「留谁停谁」的取证（纯只读）。

pairs 1/2（桂花马蹄 1199/1438、青青柚子 1198/1439）引用是**一边倒**的：
  低 id 只有自索引、高 id 有 forecast_extra_qty ⇒ 停低 id 即可。

pair 3（阿慕乐黄桃 1219/1451）**两边都有价值**，需要逐项对齐：
  · 1451: customer_prices 137 / sale_order_items 4 / inventory 1 / inventory_logs 1 / forecast_extra_qty 4
  · 1219: product_code=130200003134 / factory_price=39.6 / forecast_import_products 3 / product_change_logs 1
  本脚本回答：**哪一条是「活档」**，以及被停的那条的**主数据是否需要搬运**。
"""
import json
import sqlite3

DB = "/opt/hergent-erp/tenant_1.db"
IDS = [1198, 1199, 1219, 1438, 1439, 1451]


def main():
    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    c.row_factory = sqlite3.Row
    cur = c.cursor()
    P = print

    P("=" * 78)
    P("A · 6 行的关键主数据对照（含 zhoupu_seq / ordering_entity / arrival_lead_days）")
    P("=" * 78)
    for r in cur.execute("""
        SELECT id,name,brand,barcode,product_code,is_active,ordering_entity,zhoupu_seq,
               factory_price,dist_price,sale_price,purchase_price,arrival_lead_days,
               lead_time_days,created_at,updated_at
        FROM products WHERE id IN (1198,1199,1219,1438,1439,1451) ORDER BY id"""):
        d = dict(r)
        P("  id=%-5s code=%-14s orig=%-8s zpseq=%-3s 厂价=%-7s 到货=%-2s upd=%s"
          % (d["id"], d["product_code"] or "—", d["ordering_entity"] or "—", d["zhoupu_seq"],
             d["factory_price"], d["arrival_lead_days"], d["updated_at"]))
        P("         name=%s" % d["name"])

    P("")
    P("=" * 78)
    P("B · pair3（1219 vs 1451）逐表对照 —— 哪条是活档")
    P("=" * 78)
    for t, col in [("customer_prices", "product_id"), ("sale_order_items", "product_id"),
                   ("inventory", "product_id"), ("inventory_logs", "product_id"),
                   ("forecast_extra_qty", "product_id"), ("forecast_import_products", "product_id"),
                   ("product_change_logs", "product_id"), ("stock_locks", "product_id"),
                   ("price_history", "product_id"), ("product_barcodes", "product_id")]:
        try:
            rows = cur.execute(
                "SELECT %s pid, COUNT(*) n, MAX(COALESCE(created_at,'')) latest FROM %s "
                "WHERE %s IN (1219,1451) GROUP BY %s" % (col, t, col, col)).fetchall()
        except Exception:
            try:
                rows = cur.execute(
                    "SELECT %s pid, COUNT(*) n, '' latest FROM %s WHERE %s IN (1219,1451) "
                    "GROUP BY %s" % (col, t, col, col)).fetchall()
            except Exception as e:
                P("  %-24s 查询失败 %s" % (t, e)); continue
        if rows:
            P("  %-24s %s" % (t, " ｜ ".join("pid=%s: %s 行 最新=%s" % (r["pid"], r["n"], r["latest"] or "—") for r in rows)))

    P("")
    P("  ★ customer_prices 的 137 行样本（1451 的定价是否真实在用）：")
    for r in cur.execute("SELECT * FROM customer_prices WHERE product_id=1451 LIMIT 3"):
        P("    ", json.dumps({k: r[k] for k in r.keys()}, ensure_ascii=False)[:220])

    P("")
    P("  ★ sale_order_items 的 4 行（1451 真被卖过？连单号/日期）：")
    for r in cur.execute("""
        SELECT i.id,i.product_id,i.quantity,i.unit_price,o.order_no,o.order_date,o.status
        FROM sale_order_items i LEFT JOIN sale_orders o ON o.id=i.order_id
        WHERE i.product_id=1451 ORDER BY o.order_date DESC LIMIT 6"""):
        P("    ", dict(r))

    P("")
    P("  ★ forecast_extra_qty 的 4 行（期次期间）：")
    for r in cur.execute("""
        SELECT product_id,period_start,period_end,product_name,unit,extra_qty,case_price
        FROM forecast_extra_qty WHERE product_id IN (1438,1439,1451) ORDER BY product_id,period_start"""):
        P("    ", dict(r))

    P("")
    P("  ★ forecast_import_products 的 3 行（pid=1219 的导入登记）：")
    for r in cur.execute("""
        SELECT id,period_id,order_date,product_id,product_name,barcode,action,imported_at,imported_by,origin
        FROM forecast_import_products WHERE product_id=1219 OR barcode IN
          (SELECT barcode FROM products WHERE id=1219) ORDER BY id"""):
        P("    ", dict(r))

    P("")
    P("  ★ 1219 的那条修改日志：")
    for r in cur.execute("""
        SELECT * FROM product_change_logs WHERE product_id=1219 ORDER BY id"""):
        P("    ", json.dumps({k: r[k] for k in r.keys()}, ensure_ascii=False)[:300])

    P("")
    P("=" * 78)
    P("C · pair1/2 复核：低 id 是否真的「零外部引用」")
    P("=" * 78)
    tables = [r["name"] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for pid in (1198, 1199):
        hits = []
        for t in tables:
            if t == "products_fts":
                continue
            try:
                tcols = [r["name"] for r in cur.execute("PRAGMA table_info(%s)" % t)]
            except Exception:
                continue
            for col in ("product_id", "id"):
                if col in tcols and col == "product_id":
                    try:
                        n = cur.execute("SELECT COUNT(*) FROM %s WHERE product_id=?" % t, (pid,)).fetchone()[0]
                        if n:
                            hits.append("%s(%s)=%d" % (t, col, n))
                    except Exception:
                        pass
        P("  id=%s 外部引用: %s" % (pid, ", ".join(hits) if hits else "无（零引用）"))

    P("")
    P("=" * 78)
    P("D · 高 id（1438/1439/1451）是否被「本期网格」引用 —— 决定停低 id 后是否影响页面")
    P("=" * 78)
    P("  期次表（period_id / period_start）：")
    for r in cur.execute("SELECT id,name,order_start_date,order_end_date,status FROM forecast_periods ORDER BY id DESC LIMIT 5"):
        P("    ", dict(r))

    P("")
    P("  在售档案里 name 与 6 行相同的**全部**行（确认无第三行）：")
    for pid in IDS:
        r = cur.execute("SELECT name,spec FROM products WHERE id=?", (pid,)).fetchone()
        rows = cur.execute("SELECT id,is_active,barcode FROM products WHERE name=? AND spec=? ORDER BY id",
                           (r["name"], r["spec"])).fetchall()
        P("    id=%-5s → 同 (name,spec) 的行: %s" % (pid, [(x["id"], x["is_active"]) for x in rows]))

    c.close()


if __name__ == "__main__":
    main()
