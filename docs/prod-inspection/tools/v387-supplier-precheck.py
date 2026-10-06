#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v387-supplier-precheck.py —— 批次 1.2「供应商档案页签」前置核查（**只读**）

为什么不能只看行数就动手：`batch1-precheck.py` 已证 tenant_1 有 **38 个 type='supplier'**、
四列（supplier_category / bank_name / bank_account / business_license）**列都在**。
但「列在」≠「有值」—— v386（批次 1.1）刚因为「列在 + 全空」把「补入口」重判成「新功能」。
本脚本回答三个决定**页面长什么样**的问题：

  Q1 那 38 行四个供应商列的**填充率**各是多少？
     → 决定列表要不要放这一列、弹窗要不要放这个输入框。
       全 0 的列放上去就是「恒显示 —」= 本项目的经典反模式（白占一列宽）。
  Q2 `receivables` 里 `type='ap'`（**应付**）有几行、挂在几个供应商上？
     → 决定列表要不要放「应付余额」列。若 0 行，放了就是恒空列。
       ⚠️ 已知数据异常：库里有【纯供应商】挂 `type='ar'`（应收）—— 本脚本把 ar/ap
          按 contact 的 type 交叉统计，把这个异常**量化**出来而不是当它不存在。
  Q3 `contacts` 里供应商的**联系人/电话/结算方式**填充率？
     → 决定列表右侧放什么（供应商页真正要联系的是"对接人 + 电话"）。

🔴 只读纪律：`?mode=ro` 打开，脚本**不含任何写语句**（无 INSERT/UPDATE/DELETE/DDL）。
🔴 脱敏纪律：**只输出计数与列名**，不回显任何供应商名称 / 电话 / 银行账号原文。
   需要看值时另开一次性人肉核查，不落产物。
🔴 服务器上没有 `sqlite3` CLI ⇒ 走 python 标准库。

用法（服务器上）：python3 v387-supplier-precheck.py
"""
import json
import os
import sqlite3
import sys

# tenant_1 = 公司自家生产租户（38 个供应商在这）；tenant_10 = demo（对照组）
DBS = [
    ("tenant_1",  "/opt/hergent-erp/tenant_1.db"),
    ("tenant_10", "/opt/hergent-erp/tenant_10.db"),
]

# 供应商侧关心「列在不在 + 有没有值」的全部列。
SUPPLIER_COLS = [
    "supplier_category",   # 供应商类别（品类）
    "bank_name",           # 开户行
    "bank_account",        # 银行账号
    "business_license",    # 营业执照号
    "supplier_batch_code",  # v107.19 批次码
    "bank_account_name",   # v107 银行户名
    "auto_writeoff",       # v107.19 自动核销
    "contact_person",      # 对接人
    "phone",               # 电话
    "settlement_method",   # 结算方式
    "credit_days",         # 账期
    "tax_id",              # 税号
    "note",                # 备注
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
        return [r[1] for r in con.execute("PRAGMA table_info(%s)" % name).fetchall()]
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
        d = {"path": path}
        try:
            if not table_exists(con, "contacts"):
                report[label] = {"_no_table": "contacts"}
                continue
            cs = cols(con, "contacts")

            # ---------- 分母：供应商总数（与列表页过滤口径一致） ----------
            n_sup = scalar(con, "SELECT COUNT(*) FROM contacts WHERE type IN ('supplier','both')")
            n_cus = scalar(con, "SELECT COUNT(*) FROM contacts WHERE type IN ('customer','both')")
            n_all = scalar(con, "SELECT COUNT(*) FROM contacts")
            d["denominator"] = {
                "supplier": n_sup,
                "customer": n_cus,
                "all": n_all,
                # 与列表页 `type=customer` 的实际过滤口径对齐（含 both）
                "_note": "列表页口径 = type IN (?,'both')，见 _contact_where",
            }

            # ---------- Q1 四个（及同族）供应商列的填充率 ----------
            fill = {}
            for c in SUPPLIER_COLS:
                if c not in cs:
                    fill[c] = {"_column_missing": True}
                    continue
                nz = scalar(con, "SELECT COUNT(*) FROM contacts WHERE type IN ('supplier','both') "
                                 "AND COALESCE(%s,'')<>''" % c)
                dis = scalar(con, "SELECT COUNT(DISTINCT %s) FROM contacts WHERE type IN ('supplier','both') "
                                  "AND COALESCE(%s,'')<>''" % (c, c))
                fill[c] = {"nonempty": nz, "distinct_nonempty": dis,
                           "rate": (round(nz / n_sup, 3) if n_sup else None)}
            d["Q1_supplier_column_fill"] = fill

            # ---------- Q2 应付 / 应收 交叉（按 contact 的 type 分组） ----------
            if table_exists(con, "receivables"):
                rcs = cols(con, "receivables")
                q2 = {"columns": rcs}
                if "contact_id" in rcs and "type" in rcs:
                    rows = con.execute("""
                        SELECT COALESCE(c.type,'(null)') AS ctype,
                               COALESCE(r.type,'(null)') AS rtype,
                               COUNT(*) AS rows_n,
                               COUNT(DISTINCT r.contact_id) AS contacts_n
                        FROM receivables r LEFT JOIN contacts c ON c.id = r.contact_id
                        GROUP BY ctype, rtype ORDER BY rows_n DESC""").fetchall()
                    q2["cross"] = [dict(r) for r in rows]
                    # 供应商挂着「应收」的行 —— 已知数据异常，量化它（v316d 注释里提过）
                    q2["anomaly_supplier_holding_ar"] = scalar(
                        con, "SELECT COUNT(*) FROM receivables r JOIN contacts c ON c.id=r.contact_id "
                             "WHERE c.type='supplier' AND r.type='ar'")
                    # 供应商「应付」未付余额合计（**只出金额合计与供应商个数**，不点名）
                    q2["supplier_ap_unpaid"] = {
                        "suppliers_n": scalar(
                            con, "SELECT COUNT(DISTINCT r.contact_id) FROM receivables r "
                                 "JOIN contacts c ON c.id=r.contact_id "
                                 "WHERE c.type IN ('supplier','both') AND r.type='ap' AND r.status!='paid'"),
                        "sum_amount": scalar(
                            con, "SELECT COALESCE(SUM(r.amount - r.paid_amount),0) FROM receivables r "
                                 "JOIN contacts c ON c.id=r.contact_id "
                                 "WHERE c.type IN ('supplier','both') AND r.type='ap' AND r.status!='paid'"),
                    }
                    # 列表页 contact_list 目前只算 ar_balance ⇒ 若要让供应商页显「应付余额」，
                    #   必须在 contact_list 里补 ap_balance（本脚本用这个数字判断值不值得补）。
                    q2["supplier_ar_unpaid_sum"] = scalar(
                        con, "SELECT COALESCE(SUM(r.amount - r.paid_amount),0) FROM receivables r "
                             "JOIN contacts c ON c.id=r.contact_id "
                             "WHERE c.type IN ('supplier','both') AND r.type='ar' AND r.status!='paid'")
                d["Q2_receivables"] = q2
            else:
                d["Q2_receivables"] = {"_no_table": "receivables"}

            # ---------- Q2b 供应商有没有过采购单（进销存未上线 ⇒ 预期 0/无表） ----------
            for t in ("purchase_orders", "po_orders", "purchase_order_items"):
                d.setdefault("Q2b_purchase_tables", {})[t] = table_exists(con, t)
            if table_exists(con, "purchase_orders"):
                d["Q2b_purchase_tables"]["purchase_orders_rows"] = scalar(
                    con, "SELECT COUNT(*) FROM purchase_orders")
                #
                # ↑ 若为 0：供应商页**不能**放「最近采购 / 采购额」列 —— 没有数据源，
                #   放上去就是恒空列（等批次 4/5 进销存上线后再加）。

            # ---------- Q3「谁在用 supplier 类型」——两个写入方都要照顾 ----------
            d["Q3_writers"] = {
                "_note": "contact_create 的 allowed 白名单 与 import_zhoupu.py 是两个建口；"
                         "本项只记录代码事实，不查库",
                "contact_create_allowed_has": {
                    c: None for c in ("bank_name", "bank_account",
                                      "supplier_category", "business_license")
                },
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
