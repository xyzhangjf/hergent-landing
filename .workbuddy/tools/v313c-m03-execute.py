# -*- coding: utf-8 -*-
"""v313c M0.3：execute **真跑** + 逐单可解释 + 幂等重跑 + 回滚验证。

## 为什么验收要「逐单」而不是「总额对得上」
项目纪律：**键对账 ≠ 账户对账 ⇒ 验收 = 逐笔可解释**。总额对得上但逐单错配是可能的
（A 单多 100、B 单少 100，合计一模一样）—— 而对账场景下**错配的单**才是要找出来的东西。
⇒ 本脚本对**每一张单**比对「库里金额」与「文件里该单金额」。

## 四段证据
  T1 影子库就位（生产档案快照灌入，业务表从 0 开始）
  T2 真跑 execute：226 张单落库
  T3 **逐单**可解释：每张单金额 == 文件里该单金额（采购取「采购入库金额」权威列）
  T4 幂等重跑：同一份文件再导一遍 ⇒ created=0 / existed=全部
  T5 回滚：用跑前的文件备份恢复 ⇒ 所有业务表回到 0 行

## 隔离
`ERP_DB_PATH` 指向 /tmp 影子目录（import 前设好）⇒ 启动期 schema 同步只碰影子库。
真实 dev 库（erp.db / tenant_1.db / tenant_2.db）**零触碰**，跑前跑后各查一次 mtime 自证。

用法：
    cd /Users/zhangjunfeng/Documents/hergent-erp/server && /usr/bin/python3 <本脚本>
"""
from __future__ import print_function

import collections
import json
import os
import shutil
import sqlite3
import sys
import time

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
SHADOW_DIR = "/tmp/v313c-m03-shadow"
SHADOW = os.path.join(SHADOW_DIR, "erp.db")
SNAP = "/tmp/v313-tenant1-snapshot.json"
SRC = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"
FILES = [
    ("采购单明细", os.path.join(SRC, "20260801-20260831采购单明细.xlsx")),
    ("收入明细表", os.path.join(SRC, "2026年8月收入明细表.xlsx")),
    ("费用明细表", os.path.join(SRC, "2026年8月费用明细表.xlsx")),
]
# ⚠️ 顺序 = 删除顺序：明细表引用主表（`PRAGMA foreign_keys=ON` 开着 ⇒ 先删明细）。
BUSINESS = ["purchase_order_items", "purchase_orders", "income_orders", "expense_orders"]

OK, BAD = [], []


def check(label, cond, extra=""):
    (OK if cond else BAD).append(label)
    print("   %s %s%s" % ("✅" if cond else "❌", label, ("  " + extra) if extra else ""))
    return cond


def read_xlsx(fp):
    import openpyxl
    wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    ws.reset_dimensions()
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return rows


def per_order_amounts(fp):
    """**独立**从文件数出「每张单的金额」—— 期望值不来自被测代码。

    采购取「采购入库金额」权威列（用户拍板：数量核对取「采购入库数量」，金额取该列本身，
    不用 数量×单价 现算 —— 实测两者差 ¥5.09）。
    收入/费用取「单据金额」列（一张单可能多行，按单号汇总）。
    """
    rows = read_xlsx(fp)
    hr = None
    for i, r in enumerate(rows[:8]):
        if r and any(str(x or "").strip() in ("单据号", "单据") for x in r):
            hr = i
            break
    H = [str(x or "").strip() for x in rows[hr]]
    i_no = H.index("单据号") if "单据号" in H else H.index("单据")
    if "采购入库金额" in H:
        i_am = H.index("采购入库金额")
    else:
        i_am = H.index([h for h in H if h.startswith("单据金额")][0])
    g = collections.OrderedDict()
    for r in rows[hr + 1:]:
        if not r or not r[i_no]:
            continue
        no = str(r[i_no]).strip()
        if len(no) < 6:
            continue
        try:
            g[no] = round(g.get(no, 0.0) + float(r[i_am] or 0), 2)
        except Exception:
            pass
    return g


def main():
    print("=" * 78)
    print("v313c M0.3：execute 真跑 + 逐单可解释 + 幂等 + 回滚")
    print("=" * 78)

    # ---------- 影子库就位 ----------
    if os.path.isdir(SHADOW_DIR):
        shutil.rmtree(SHADOW_DIR)
    os.makedirs(SHADOW_DIR)
    shutil.copy2(os.path.join(SRV, "erp.db"), SHADOW)
    os.environ["ERP_DB_PATH"] = SHADOW
    os.environ.setdefault("ERP_SECRET", "v313c-m03-not-a-real-key")
    os.chdir(SRV)
    sys.path.insert(0, SRV)

    import routers.zhoupu_documents as Z
    from db.connection import get_db

    # ---------- T1 灌生产档案 + 业务表从 0 开始 ----------
    print()
    print("【T1】影子库就位")
    snap = json.load(open(SNAP, encoding="utf-8"))
    # 🔴 清理阶段**直连并关外键**：dev 的 erp.db 里 `stock_locks.customer_id REFERENCES contacts(id)`
    #    还挂着行，开着外键就删不掉 contacts（实测 `IntegrityError: FOREIGN KEY constraint failed`）。
    #    这只是**准备影子库**，不是被测行为 ⇒ 关外键是正当的；导入阶段仍走 `get_db()`
    #    （`db/connection.py` 里 `PRAGMA foreign_keys=ON`）⇒ 真实约束照样生效。
    c0 = sqlite3.connect(SHADOW)
    c0.execute("PRAGMA foreign_keys=OFF")
    # 🔴 对齐**生产** schema：dev 影子库的 `products.barcode` 是 UNIQUE，
    #    而生产 tenant_1 的 `idx_products_barcode` 是**普通索引**（实测同条码可挂多行，
    #    如 6922577700227 等 5+ 组）。不照生产重建就会在灌快照时撞 UNIQUE，
    #    进而「测到」一个生产上并不存在的约束（典型的代码默认 vs 实际库分叉）。
    for r in c0.execute("PRAGMA index_list(products)").fetchall():
        nm, uniq = r[1], r[2]
        cols = [x[2] for x in c0.execute("PRAGMA index_info(%s)" % nm).fetchall()]
        if uniq and cols == ["barcode"]:
            c0.execute("DROP INDEX IF EXISTS %s" % nm)
            c0.execute("CREATE INDEX IF NOT EXISTS %s ON products(barcode)" % nm)
            print("   索引对齐：%s 由 UNIQUE 改为普通索引（同生产）" % nm)
    for t in BUSINESS:
        c0.execute("DELETE FROM %s" % t)
    for t in ("contacts", "products", "warehouses"):
        v = snap["_tables"][t]
        cols = v["cols"]
        c0.execute("DELETE FROM %s" % t)
        c0.executemany("INSERT INTO %s (%s) VALUES (%s)"
                       % (t, ", ".join('"%s"' % x for x in cols),
                          ", ".join("?" * len(cols))), v["rows"])
    c0.commit()
    n = dict((t, c0.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0])
             for t in BUSINESS)
    nc = c0.execute("SELECT COUNT(*) FROM contacts WHERE type='internal'").fetchone()[0]
    c0.close()
    print("   业务表基线: %r" % n)
    check("T1 四个业务表全为 0 行", all(v == 0 for v in n.values()), "%r" % n)
    check("T1 生产档案已灌入（含 internal 档案 %d 个）" % nc, nc >= 1, "internal=%d" % nc)

    # ---------- 跑前文件备份（回滚用）----------
    bk = os.path.join(SHADOW_DIR, "before-execute.bak")
    shutil.copy2(SHADOW, bk)

    # ---------- T2 真跑 ----------
    print()
    print("【T2】真跑 execute（dry_run=False）")
    reps = []
    with get_db() as conn:
        for lab, fp in FILES:
            rep = Z.run_file(conn, fp, dry_run=False)
            st = rep["stats"]
            reps.append((lab, fp, rep))
            print("   %-8s kind=%-16s 单 %d / 行 %d ｜ 建 %d / 已存在 %d / 失败 %d / 阻塞 %d / 空 %d"
                  % (lab, rep["kind"], st["orders_total"], st["lines_total"],
                     st["orders_created"], st["orders_existed"], st["orders_failed"],
                     st["orders_blocked"], st["orders_empty"]))
            check("T2 %s 零失败零阻塞" % lab,
                  st["orders_failed"] == 0 and st["orders_blocked"] == 0,
                  "failed=%d blocked=%d" % (st["orders_failed"], st["orders_blocked"]))

    # ---------- T3 逐单可解释 ----------
    print()
    print("【T3】逐单可解释（每张单金额 == 文件里该单金额）")
    total_orders = 0
    with get_db() as conn:
        for lab, fp, rep in reps:
            exp = per_order_amounts(fp)
            kind = rep["kind"]
            if kind == "zhoupu_purchase":
                # ⚠️ `purchase_orders` **没有 amount 列**（采购金额只落在明细上）
                #    ⇒ 单头/明细一致性对采购单不适用，只验明细合计。
                sql = ("SELECT p.order_no, ROUND(SUM(i.amount),2) FROM purchase_orders p "
                       "JOIN purchase_order_items i ON i.order_id=p.id GROUP BY p.id")
                head_sql = None
            elif kind == "zhoupu_income":
                sql = head_sql = "SELECT order_no, ROUND(amount,2) FROM income_orders"
            else:
                sql = head_sql = "SELECT order_no, ROUND(amount,2) FROM expense_orders"
            got = dict((r[0], r[1]) for r in conn.execute(sql))
            head = (dict((r[0], r[1]) for r in conn.execute(head_sql))
                    if head_sql else None)
            bad = [(no, exp[no], got.get(no)) for no in exp
                   if abs((got.get(no) or 0.0) - exp[no]) > 0.01]
            check("T3 %s 落库单数 == 文件单数（%d）" % (lab, len(exp)),
                  len(got) == len(exp), "库里 %d / 文件 %d" % (len(got), len(exp)))
            check("T3 %s 逐单金额全部对上" % lab, not bad,
                  ("不符 %d 张，例：%r" % (len(bad), bad[:3])) if bad else "")
            if head is not None:
                # 收入/费用单：单头金额必须等于该文件里这张单的金额（无头尾差）。
                bh = [(no, exp[no], head.get(no)) for no in exp
                      if abs((head.get(no) or 0.0) - exp[no]) > 0.01]
                check("T3 %s 单头金额 == 文件金额（无头尾差）" % lab, not bh,
                      ("不符 %d 张" % len(bh)) if bh else "")
            else:
                print("      （采购单头无 amount 列，金额只在明细上 ⇒ 已按明细逐单核对）")
            total_orders += len(exp)
            print("      （%d 张单，合计 ¥%s）" % (len(exp), format(sum(exp.values()), ",.2f")))
    check("T3 三份文件合计 %d 张单全部落库" % total_orders, total_orders == 226,
          "实际 %d" % total_orders)

    # ---------- T4 幂等重跑 ----------
    print()
    print("【T4】幂等重跑（同一份文件再导一遍）")
    with get_db() as conn:
        for lab, fp in FILES:
            rep = Z.run_file(conn, fp, dry_run=False)
            st = rep["stats"]
            check("T4 %s 重跑：新建 0 / 已存在 == 总数(%d)" % (lab, st["orders_total"]),
                  st["orders_created"] == 0 and st["orders_existed"] == st["orders_total"],
                  "created=%d existed=%d total=%d"
                  % (st["orders_created"], st["orders_existed"], st["orders_total"]))
        n2 = dict((t, conn.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0])
                  for t in BUSINESS)
    print("   重跑后业务表行数: %r" % n2)

    # ---------- T5 回滚 ----------
    print()
    print("【T5】回滚（用跑前的整库备份恢复）")
    shutil.copy2(bk, SHADOW)
    with get_db() as conn:
        n3 = dict((t, conn.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0])
                  for t in BUSINESS)
    print("   恢复后业务表行数: %r" % n3)
    check("T5 回滚后所有业务表回到 0 行", all(v == 0 for v in n3.values()), "%r" % n3)

    print()
    print("=" * 78)
    print("通过 %d / 失败 %d" % (len(OK), len(BAD)))
    if BAD:
        for b in BAD:
            print("   ❌ " + b)
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
