#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v387-purchase-link-precheck.py —— 批次 1.2 续查：供应商 ⇄ 采购单 能不能连起来（**只读**）

起因：`v387-supplier-precheck.py` 查出两条会改变页面设计的事实 ——
  ① `receivables` 里 **`type='ap'`（应付）行数 = 0** ⇒ 供应商列表**不能**放「应付余额」列
     （放了就是恒显示「—」的空列，本项目已多次付代价的反模式）；
  ② 供应商的 `contact_person` / `phone` 填充率 **38/38 = 100%**（16 / 35 个不同值）⇒ 这两列**值得放**；
     而 `settlement_method` / `credit_days` / `auto_writeoff` 虽然也是 38/38，但**只有 1 个不同值**
     ⇒ 每行都一样 = 放上去是纯噪音。
  ⇒ 于是供应商列表只剩「名称 + 对接人 + 电话」，太薄。
     本脚本回答：**能不能用 `purchase_orders` 补出真正有用的列**（最近采购 / 累计采购额）。

要回答的三个问题：
  Q4a `purchase_orders` 的列里，有没有「指向 contacts 的供应商外键」+「日期」+「金额」？
      —— 缺任何一个，这列就补不出来，供应商页就只能回到「名称 + 对接人 + 电话」。
  Q4b 81 行里**有多少行真能挂到 38 个供应商上**？（外键为空 / 指向不存在的 contact 都要算出来）
  Q4c 供应商侧的采购单**时间跨度**（最早 / 最晚）—— 若全挤在某一天，说明是**一次性导入**，
      列表里放「最近采购」会 38 行显示同一个日期（又一个"恒同值"噪音列）。

🔴 只读纪律：`?mode=ro`；无写语句。
🔴 脱敏纪律：**只出计数 / 列名 / 聚合金额**，不回显供应商名、单号、单价。
   金额只出**供应商维度合计**（用于判断"值不值得加列"），不逐家列出。

用法（服务器上）：python3 v387-purchase-link-precheck.py
"""
import json
import os
import sqlite3
import sys

DBS = [
    ("tenant_1",  "/opt/hergent-erp/tenant_1.db"),
    ("tenant_10", "/opt/hergent-erp/tenant_10.db"),
]


def ro(path):
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    con.row_factory = sqlite3.Row
    return con


def table_exists(con, name):
    return con.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()[0] > 0


def cols(con, name):
    try:
        return [(r[1], r[2]) for r in con.execute("PRAGMA table_info(%s)" % name).fetchall()]
    except Exception:
        return []


def scalar(con, sql, args=()):
    try:
        r = con.execute(sql, args).fetchone()
        return None if r is None else r[0]
    except Exception as e:
        return "ERR:%s" % e


def main():
    report = {}
    for label, path in DBS:
        if not os.path.exists(path):
            report[label] = {"_missing": True, "path": path}
            continue
        con = ro(path)
        d = {}
        try:
            if not table_exists(con, "purchase_orders"):
                report[label] = {"_no_table": "purchase_orders"}
                continue

            po_cols = cols(con, "purchase_orders")
            d["Q4a_po_columns"] = [{"name": c, "type": t} for c, t in po_cols]
            colnames = [c for c, _ in po_cols]
            d["Q4a_candidates"] = {
                # 可能的供应商外键名（本项目历史上供应商在 contacts 里，字段名不统一）
                "supplier_fk_like": [c for c in colnames if "supplier" in c.lower() or c.lower() in
                                     ("contact_id", "vendor_id", "partner_id")],
                "date_like": [c for c in colnames if "date" in c.lower() or "time" in c.lower()]
                             + [c for c in colnames if c.lower() in ("created_at",)],
                "amount_like": [c for c in colnames if "amount" in c.lower() or "total" in c.lower()
                                or "price" in c.lower()],
            }

            n_po = scalar(con, "SELECT COUNT(*) FROM purchase_orders")
            d["Q4b_rows"] = {"purchase_orders": n_po}

            # 若存在供应商外键，算「能挂上几家」「有几行外键为空」「有几行指向不存在的 contact」
            fk = next((c for c in ("supplier_id", "contact_id", "vendor_id", "partner_id")
                       if c in colnames), None)
            d["Q4b_chosen_fk"] = fk
            if fk:
                d["Q4b_rows"]["fk_null_or_zero"] = scalar(
                    con, "SELECT COUNT(*) FROM purchase_orders WHERE COALESCE(%s,0)=0" % fk)
                d["Q4b_rows"]["fk_orphan"] = scalar(
                    con, "SELECT COUNT(*) FROM purchase_orders po WHERE COALESCE(po.%s,0)>0 "
                         "AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id=po.%s)" % (fk, fk))
                d["Q4b_rows"]["distinct_suppliers_linked"] = scalar(
                    con, "SELECT COUNT(DISTINCT po.%s) FROM purchase_orders po "
                         "JOIN contacts c ON c.id=po.%s WHERE c.type IN ('supplier','both')" % (fk, fk))
                d["Q4b_rows"]["rows_linked_to_supplier_contacts"] = scalar(
                    con, "SELECT COUNT(*) FROM purchase_orders po "
                         "JOIN contacts c ON c.id=po.%s WHERE c.type IN ('supplier','both')" % fk)
                # 供应商侧合计金额（只出合计，不逐家）
                amt = next((c for c in ("total_amount", "amount", "total", "grand_total")
                            if c in colnames), None)
                d["Q4b_chosen_amount"] = amt
                if amt:
                    d["Q4b_rows"]["supplier_side_amount_sum"] = scalar(
                        con, "SELECT COALESCE(SUM(po.%s),0) FROM purchase_orders po "
                             "JOIN contacts c ON c.id=po.%s WHERE c.type IN ('supplier','both')"
                             % (amt, fk))
                    d["Q4b_rows"]["amount_coverage_nonzero"] = scalar(
                        con, "SELECT COUNT(*) FROM purchase_orders po "
                             "JOIN contacts c ON c.id=po.%s "
                             "WHERE c.type IN ('supplier','both') AND COALESCE(po.%s,0)>0"
                             % (fk, amt))
                # 时间跨度（只出最早/最晚 + 不同日期数，判断是否"一次性导入"）
                dt = next((c for c in ("order_date", "po_date", "date", "created_at")
                           if c in colnames), None)
                d["Q4b_chosen_date"] = dt
                if dt:
                    d["Q4b_rows"]["date_min"] = scalar(
                        con, "SELECT MIN(%s) FROM purchase_orders WHERE COALESCE(%s,'')<>''" % (dt, dt))
                    d["Q4b_rows"]["date_max"] = scalar(
                        con, "SELECT MAX(%s) FROM purchase_orders WHERE COALESCE(%s,'')<>''" % (dt, dt))
                    d["Q4b_rows"]["distinct_dates"] = scalar(
                        con, "SELECT COUNT(DISTINCT %s) FROM purchase_orders WHERE COALESCE(%s,'')<>''"
                             % (dt, dt))
                    d["Q4b_rows"]["suppliers_with_purchase"] = scalar(
                        con, "SELECT COUNT(DISTINCT po.%s) FROM purchase_orders po "
                             "JOIN contacts c ON c.id=po.%s "
                             "WHERE c.type IN ('supplier','both')" % (fk, fk)) if fk else None
                # 状态列：作废/草稿单要不要排除
                d["Q4b_status_like"] = [c for c in colnames
                                        if "status" in c.lower() or "state" in c.lower()]
                for sc in d["Q4b_status_like"]:
                    d["Q4b_rows"]["status_dist__" + sc] = [
                        dict(r) for r in con.execute(
                            "SELECT COALESCE(%s,'(null)') AS v, COUNT(*) AS n "
                            "FROM purchase_orders GROUP BY 1 ORDER BY n DESC LIMIT 10" % sc).fetchall()]

            # 明细表能不能把「供应商 → 品牌」连出来（若将来要显示"这家供哪些品牌"）
            if table_exists(con, "purchase_order_items"):
                it_cols = [c for c, _ in cols(con, "purchase_order_items")]
                d["Q4c_items"] = {
                    "columns": it_cols,
                    "rows": scalar(con, "SELECT COUNT(*) FROM purchase_order_items"),
                    "has_po_fk": next((c for c in ("po_id", "purchase_order_id", "order_id")
                                       if c in it_cols), None),
                    "has_product_fk": next((c for c in ("product_id", "sku_id", "goods_id")
                                            if c in it_cols), None),
                }
        finally:
            con.close()
        report[label] = d

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FATAL: %s" % e, file=sys.stderr)
        sys.exit(1)
