# -*- coding: utf-8 -*-
"""v313 M0.1 验收：三份**真实**舟谱财务单据走完整导入管线（影子库 + 播种真实档案名）。

三层证据：
  T1 判别与列绑定：形态/sheet/表头行/列清单（含 `_unit_in` 不外露）
  T2 空库预览：62/3/1 单、1134/11/1 行、非供应商侧被拦住并**可见**
  T3 播种后真写：62 单 1134 行落库、金额 = 936,599.78（权威列）、单位入列、幂等重跑
  T4 反例：非舟谱文件必须报错（证明判别器有判别力）

跑法（必须用**系统** python 3.9，它带 fastapi/openpyxl）：
  cd /Users/zhangjunfeng/Documents/hergent-erp/server && /usr/bin/python3 <本文件>
"""
from __future__ import print_function

import os
import shutil
import sqlite3
import sys
import time

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
SHADOW_DIR = "/tmp/v313-m01-shadow"
SHADOW = os.path.join(SHADOW_DIR, "erp.db")
FILES = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"
F_PUR = os.path.join(FILES, "20260801-20260831采购单明细.xlsx")
F_INC = os.path.join(FILES, "2026年8月收入明细表.xlsx")
F_EXP = os.path.join(FILES, "2026年8月费用明细表.xlsx")

OK, BAD = [], []


def check(label, cond, extra=""):
    (OK if cond else BAD).append(label)
    print("   %s %s%s" % ("✅" if cond else "❌", label, ("  " + extra) if extra else ""))
    return cond


def scan_file(fp):
    """**独立**从 xlsx 直接数文件里的单据（不经过被测模块的 SPECS / 计数逻辑）。

    🔴 为什么必须独立：被测代码的计数口径一旦错，拿它的读数当期望值只会得到
       「两个错的一致」。本轮实测就踩到了 —— 收入表真实 **6 张单**（3 供应商 + 3 内部），
       被测代码当时只报 3 张，而会计恒等式 `created+existed+failed+empty+blocked==total`
       **照样"通过"**（两边同时少了那 3 张），是标准的假绿。

    返回 (数据行数, OrderedDict(单号 -> [单据类型, 行数]))。口径与业务一致：
      · 「合计」尾行 / 空行剔除（判据取代码同款：单据号列值长度 < 6）
      · 表头行按列名找（不写死行号，两份文件都是第 5 行但不把结论建在这个巧合上）
    """
    import openpyxl
    wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    ws.reset_dimensions()          # 🔴 舟谱的 <dimension ref="A1"/> 是假的，不 reset 只读到 1 行
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    hr = None
    for i, r in enumerate(rows[:8]):
        if r and any(str(x or "").strip() in ("单据号", "单据") for x in r):
            hr = i
            break
    if hr is None:
        raise RuntimeError("找不到表头行: %s" % fp)
    hd = [str(x or "").strip() for x in rows[hr]]
    i_no = hd.index("单据号") if "单据号" in hd else hd.index("单据")
    i_ty = hd.index("单据类型") if "单据类型" in hd else None
    n_lines, seen = 0, {}
    for r in rows[hr + 1:]:
        if not r or not r[i_no]:
            continue
        no = str(r[i_no]).strip()
        if len(no) < 6:            # 「合计」尾行
            continue
        n_lines += 1
        e = seen.setdefault(no, [str(r[i_ty] or "").strip() if i_ty is not None else "", 0])
        e[1] += 1
    return n_lines, seen


# M0.1 的**业务规则**（用户拍板：「② 按你的建议」= 只导供应商侧）。
# 这里独立写一遍，不复用被测模块的 `_ALLOW_TYPES` —— 复用就等于没验证。
ALLOWED_TYPE = {"zhoupu_income": {"供应商收入单"},
                "zhoupu_expense": {"供应商费用单"},
                "zhoupu_purchase": None}   # None = 不过滤（采购明细表天然只有采购单）


def _ident(tag, st):
    """会计恒等式：单据数必须能被「已建+已存在+失败+空+阻塞」**完全解释**。

    🔴 这是抓「单据凭空消失」的核心判据（本文件头 v271 段记的坑）。
       但**它不能单独使用**：若某类单据在过滤阶段就 `continue`（v313 实测的缺陷），
       它会从 `orders_total` 与分项里**同时**消失 ⇒ 两侧同为 0 ⇒ 式子照样"通过"。
       ⇒ 必须**同时**断言「`orders_total` == 文件里独立数出的单据数」。
    """
    acc = (st["orders_created"] + st["orders_existed"] + st["orders_failed"]
           + st["orders_empty"] + st["orders_blocked"])
    return check("%s 单据数可被完全解释（%d = %d）" % (tag, st["orders_total"], acc),
                 acc == st["orders_total"],
                 "created=%d existed=%d failed=%d empty=%d blocked=%d"
                 % (st["orders_created"], st["orders_existed"], st["orders_failed"],
                    st["orders_empty"], st["orders_blocked"]))


def main():
    if os.path.isdir(SHADOW_DIR):
        shutil.rmtree(SHADOW_DIR)
    os.makedirs(SHADOW_DIR)
    shutil.copy2(os.path.join(SRV, "erp.db"), SHADOW)
    os.environ["ERP_DB_PATH"] = SHADOW
    # `core.py` 在 import 期就要求 ERP_SECRET（缺失直接 RuntimeError）。这里只是**跑管线**，
    # 不走任何 HTTP 鉴权 ⇒ 给个测试值即可，绝不碰真实密钥。
    os.environ.setdefault("ERP_SECRET", "v313-shadow-test-secret-not-a-real-key")
    os.chdir(SRV)
    sys.path.insert(0, SRV)

    import openpyxl
    from db.connection import get_db
    import routers.zhoupu_documents as Z

    # ------------------------------------------------------------------
    print("=" * 76)
    print("T1 判别与列绑定")
    cases = [(F_PUR, "zhoupu_purchase", "采购明细"),
             (F_INC, "zhoupu_income", "收入单明细表"),
             (F_EXP, "zhoupu_expense", "费用单明细表")]
    binds = {}
    for fp, ekind, esheet in cases:
        kind, sheet, hr, headers = Z.detect_file(fp)
        spec = Z.SPECS[kind]
        b = Z.bind_columns(headers, spec)
        binds[kind] = (fp, sheet, hr, b)
        check("T1 %-16s kind=%s sheet=%s 表头第 %d 行" % (ekind, kind, sheet, hr + 1),
              kind == ekind and sheet == esheet)
        cols = [spec["fields"][f][0] for f in spec["fields"] if f in b and not f.startswith("_")]
        print("      列绑定: %s" % cols)
    # `_unit_in` 必须绑上但**不对外暴露**
    fb, sb, hb, bb = binds["zhoupu_purchase"]
    check("T1 采购 `_unit_in` 绑到了第 2 个「单位名称」列（且与 unit 不同列）",
          "_unit_in" in bb and bb.get("unit") != bb.get("_unit_in"),
          "unit=col%s _unit_in=col%s" % (bb.get("unit"), bb.get("_unit_in")))
    check("T1 采购 qty 绑到「采购入库数量」列（= 用户指定口径）",
          bb.get("qty") == 13, "qty=col%s" % bb.get("qty"))

    # ------------------------------------------------------------------
    print()
    print("=" * 76)
    print("T2 空库预览（dev 库里没有真实供应商/商品 ⇒ 单据全部进不了，但**数目**必须对）")
    print("   ⚠️ `lines_total` 数的是**文件里全部数据行**（含被类型挡下的非供应商行）——")
    print("      那是对的：用户要看到「这份文件一共多少行」，而不是「我导了多少行」。")
    print("   ⚠️ 期望值全部**从 xlsx 独立数出来**（`scan_file`），不硬编码、不复用被测代码 ——")
    print("      否则代码口径错时探针会跟着错（本轮实测踩到过）。")

    # 文件侧独立读数：单数 / 行数 / 「本批可导入的单数」（== 供应商侧）
    FSCAN, IMPORTABLE = {}, {}
    for kind, fp in (("zhoupu_purchase", F_PUR), ("zhoupu_income", F_INC),
                     ("zhoupu_expense", F_EXP)):
        n_lines, seen = scan_file(fp)
        allow = ALLOWED_TYPE[kind]
        imp = sum(1 for ty, _ in seen.values() if allow is None or ty in allow)
        FSCAN[kind] = (n_lines, len(seen))
        IMPORTABLE[kind] = imp
        by_ty = {}
        for ty, n in seen.values():
            by_ty[ty] = by_ty.get(ty, 0) + 1
        print("   📄 %-16s 文件实数: 单 %-4d 行 %-5d 本批可导入 %-4d  分类 %s"
              % (kind, len(seen), n_lines, imp, by_ty))

    # 采购表无类型列（天然只有采购单）⇒ 全部可导入；两份钱单据表里混着三类
    EXPECT = {
        # 空库预览：钱单据表**每一张都进不来**（非供应商被类型挡 / 供应商单往来单位查不到）
        #                    ⇒ blocked == 全部；采购表则全部 empty（商品档案里没有）
        "zhoupu_purchase": dict(ord=FSCAN["zhoupu_purchase"][1], line=FSCAN["zhoupu_purchase"][0],
                                created=0, blocked=0, empty=FSCAN["zhoupu_purchase"][1]),
        "zhoupu_income":   dict(ord=FSCAN["zhoupu_income"][1], line=FSCAN["zhoupu_income"][0],
                                created=0, blocked=FSCAN["zhoupu_income"][1], empty=0),
        "zhoupu_expense":  dict(ord=FSCAN["zhoupu_expense"][1], line=FSCAN["zhoupu_expense"][0],
                                created=0, blocked=FSCAN["zhoupu_expense"][1], empty=0),
    }
    with get_db() as conn:
        for kind, e in EXPECT.items():
            fp, sheet, hr, b = binds[kind]
            runner = Z.do_import_money if Z.SPECS[kind]["family"] == "money" else Z.do_import
            rep = runner(conn, Z.RefIndex(conn), fp, kind, sheet, hr, b, dry_run=True)
            st = rep["stats"]
            check("T2 %-16s orders_total=%-3d lines_total=%-5d created=%d blocked=%d empty=%d"
                  % (kind, st["orders_total"], st["lines_total"], st["orders_created"],
                     st["orders_blocked"], st["orders_empty"]),
                  st["orders_total"] == e["ord"] and st["lines_total"] == e["line"]
                  and st["orders_created"] == e["created"] and st["orders_blocked"] == e["blocked"]
                  and st["orders_empty"] == e["empty"])
            # 🔴 会计恒等式：单据数必须能被「已建+已存在+失败+空+阻塞」**完全解释**。
            #    不成立就说明有单据在报告里"凭空消失"（本文件头 v271 段记的就是这个坑）。
            acc = (st["orders_created"] + st["orders_existed"] + st["orders_failed"]
                   + st["orders_empty"] + st["orders_blocked"])
            check("T2 %-16s 单据数可被完全解释（%d = %d）" % (kind, st["orders_total"], acc),
                  acc == st["orders_total"])
            if kind != "zhoupu_purchase":
                w = rep["warnings"]
                print("      非供应商侧被挡住（可见）: %s" % [(x["reason"], x["lines"]) for x in w])
            else:
                print("      缺漏 Top2: %s" % [(x["reason"], x["lines"]) for x in rep["missing"][:2]])

    # ------------------------------------------------------------------
    print()
    print("=" * 76)
    print("T3 播种真实档案名后**真写**（影子库）")
    # 用文件自身的供应商名 / 商品名+条码+单位播种（不发明数据）
    def seed():
        """用**文件自身的值**播种（不发明数据）。关键约束：
        `products.barcode` 上有 `UNIQUE INDEX ... WHERE barcode!=''`
        ⇒ 每个非空条码只能建一份档案。而实测舟谱侧**同一非空条码会挂两个商品名**
        （6934665091254 → 28 行 / 2 个名字），所以按条码去重、保留首个名字；
        空条码的行只能靠名字匹配，故按名字单独去重。"""
        c = sqlite3.connect(SHADOW)
        sup = set()
        prods = {}
        wb = openpyxl.load_workbook(F_PUR, read_only=True, data_only=True)
        ws = wb[wb.sheetnames[0]]
        ws.reset_dimensions()
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        for r in rows[5:]:
            if not r or str(r[0] or "") in ("合计", ""):
                continue
            sup.add(str(r[3]).strip())
            nm, bar, u = str(r[1]).strip(), str(r[2]).strip(), str(r[9]).strip()
            key = bar if bar else ("NAME:" + nm)
            prods.setdefault(key, (nm, u, bar))
        for fp in (F_INC, F_EXP):
            wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
            ws = wb[wb.sheetnames[0]]
            ws.reset_dimensions()
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            wb.close()
            for r in rows[5:]:
                if not r or not r[2]:
                    continue
                if str(r[1]).startswith("供应商"):
                    sup.add(str(r[3]).strip())
        for nm in sorted(sup):
            c.execute("INSERT INTO contacts (type,name) VALUES ('supplier',?)", (nm,))
        for (nm, u, bar) in sorted(prods.values()):
            c.execute("INSERT INTO products (name,unit,barcode) VALUES (?,?,?)", (nm, u, bar))
        c.execute("INSERT INTO warehouses (name,is_default) VALUES ('总仓',0)")
        c.commit()
        n_s = c.execute("SELECT COUNT(*) FROM contacts WHERE type='supplier'").fetchone()[0]
        n_p = c.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        c.close()
        return n_s, n_p, len(sup), len(prods)

    n_s, n_p, e_s, e_p = seed()
    print("   播种: 供应商 %d 个（含文件里的 %d 个）· 商品档案 %d 份（源唯一键 %d 个）"
          % (n_s, e_s, n_p, e_p))

    db = sqlite3.connect(SHADOW)
    # 🔴 应收/应付必须取**导入前基线**，断言「净增 0」。
    #    教训：上一版把断言写成 `rec == 0`（全表硬编码），而 dev 库里本来就有 10 条
    #    2026-06-18 的历史应收（ref_type 只有 purchase / sale_order）⇒ 假红。
    #    判据是「恒定值是否恰好等于当前事实」，不是「数全表」。
    _qb = lambda s, a=(): db.execute(s, a).fetchall()
    rec_base = _qb("SELECT COUNT(*) FROM receivables")[0][0]
    rec_base_kind = _qb("SELECT ref_type, COUNT(*) FROM receivables GROUP BY ref_type")
    print("   导入前基线: receivables=%d 条 %s（历史 dev 数据，与本次无关）"
          % (rec_base, dict(rec_base_kind)))
    with get_db() as conn:
        # 采购
        fp, sheet, hr, b = binds["zhoupu_purchase"]
        rep = Z.do_import(conn, Z.RefIndex(conn), fp, "zhoupu_purchase", sheet, hr, b,
                          dry_run=False, commit_every=200)
        st = rep["stats"]
        print("   采购: %s" % {k: st[k] for k in ("orders_total", "orders_created", "orders_failed",
                                                 "orders_blocked", "orders_empty",
                                                 "lines_total", "lines_created", "lines_skipped")})
        if rep["missing"]:
            print("      缺漏: %s" % [(x["reason"], x["lines"], x["sample"]) for x in rep["missing"][:5]])
        check("T3 采购 %d 单 / %d 行全部落库（文件侧独立读数）"
              % (FSCAN["zhoupu_purchase"][1], FSCAN["zhoupu_purchase"][0]),
              st["orders_created"] == FSCAN["zhoupu_purchase"][1]
              and st["lines_created"] == FSCAN["zhoupu_purchase"][0]
              and st["orders_failed"] == 0 and st["orders_blocked"] == 0 and st["lines_skipped"] == 0,
              "created=%d/%d lines=%d/%d failed=%d blocked=%d skipped=%d"
              % (st["orders_created"], FSCAN["zhoupu_purchase"][1],
                 st["lines_created"], FSCAN["zhoupu_purchase"][0],
                 st["orders_failed"], st["orders_blocked"], st["lines_skipped"]))
        _ident("T3 采购", st)
        # 收入 / 费用（期望值全部来自文件侧独立读数）
        for kind, e_amt in (("zhoupu_income", 176709.08), ("zhoupu_expense", 12900.30)):
            e_ord = IMPORTABLE[kind]
            e_tot = FSCAN[kind][1]
            fp, sheet, hr, b = binds[kind]
            rf = Z.RefIndex(conn)
            rep2 = Z.do_import_money(conn, rf, fp, kind, sheet, hr, b, dry_run=False)
            st2 = rep2["stats"]
            print("   %s: orders_total=%d created=%d blocked=%d" %
                  (kind, st2["orders_total"], st2["orders_created"], st2["orders_blocked"]))
            check("T3 %-16s 本批可导入 %d 单全部落库" % (kind, e_ord),
                  st2["orders_created"] == e_ord)
            # 🔴 关键新增断言：被挡下的单**必须出现在 orders_total 里**，
            #    且等于「文件单数 − 本批可导入单数」。不查这条，「消失的单据」就查不出来。
            check("T3 %-16s 被挡 %d 单**在总数里可见**（%d = %d 文件单数 − %d 可导入）"
                  % (kind, st2["orders_blocked"], e_tot, e_tot, e_ord),
                  st2["orders_total"] == e_tot and st2["orders_blocked"] == e_tot - e_ord,
                  "实际 total=%d blocked=%d；文件单数=%d" %
                  (st2["orders_total"], st2["orders_blocked"], e_tot))
            _ident("T3 " + kind, st2)

    # --- 库内核对 ---
    print()
    q = lambda s, a=(): db.execute(s, a).fetchall()
    n_po = q("SELECT COUNT(*) FROM purchase_orders WHERE order_no LIKE 'CD%'")[0][0]
    n_it = q("SELECT COUNT(*) FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id"
             " WHERE po.order_no LIKE 'CD%'")[0][0]
    tot = q("SELECT ROUND(SUM(total_amount),2) FROM purchase_orders WHERE order_no LIKE 'CD%'")[0][0]
    toti = q("SELECT ROUND(SUM(amount),2) FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id"
             " WHERE po.order_no LIKE 'CD%'")[0][0]
    st_ok = q("SELECT COUNT(*) FROM purchase_orders WHERE order_no LIKE 'CD%' AND status='received'")[0][0]
    dt_ok = q("SELECT COUNT(*) FROM purchase_orders WHERE order_no LIKE 'CD%'"
              " AND substr(order_date,1,7)='2026-08'")[0][0]
    unit_empty = q("SELECT COUNT(*) FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id"
                   " WHERE po.order_no LIKE 'CD%' AND COALESCE(poi.unit,'')=''")[0][0]
    unit_dist = q("SELECT poi.unit, COUNT(*) FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id"
                  " WHERE po.order_no LIKE 'CD%' GROUP BY poi.unit ORDER BY 2 DESC")[:4]
    check("T3 库内采购单 = 62 张", n_po == 62, "实际 %d" % n_po)
    check("T3 库内明细 = 1134 行", n_it == 1134, "实际 %d" % n_it)
    check("T3 单头合计 = 936,599.78（**权威金额列**；若按数量×单价会是 936,604.87）",
          abs(float(tot) - 936599.78) < 0.005, "实际 %s" % tot)
    check("T3 明细合计 = 936,599.78 且与单头一致", abs(float(toti) - 936599.78) < 0.005
          and abs(float(toti) - float(tot)) < 0.005, "明细 %s / 单头 %s" % (toti, tot))
    check("T3 全部 status='received'（不是 pending_approval）", st_ok == 62, "实际 %d" % st_ok)
    check("T3 全部 order_date 在 2026-08（用「单据时间」列，不是单号内日期）",
          dt_ok == 62, "实际 %d" % dt_ok)
    check("T3 明细 unit 列无空值（原始单位已持久化）", unit_empty == 0, "空 %d 行" % unit_empty)
    print("      单位分布: %s" % unit_dist)
    n_inc = q("SELECT COUNT(*), ROUND(SUM(amount),2) FROM income_orders WHERE order_no LIKE 'GYSR%'")[0]
    n_exp = q("SELECT COUNT(*), ROUND(SUM(amount),2) FROM expense_orders WHERE order_no LIKE 'GYFY%'")[0]
    check("T3 收入单 3 张 / ¥176,709.08", n_inc[0] == 3 and abs(float(n_inc[1]) - 176709.08) < 0.005,
          "实际 %s" % (n_inc,))
    check("T3 费用单 1 张 / ¥12,900.30", n_exp[0] == 1 and abs(float(n_exp[1]) - 12900.30) < 0.005,
          "实际 %s" % (n_exp,))
    rec = q("SELECT COUNT(*) FROM receivables")[0][0]
    rec_kind = q("SELECT ref_type, COUNT(*) FROM receivables GROUP BY ref_type")
    rec_money = q("SELECT COUNT(*) FROM receivables WHERE ref_type IN ('income','expense')")[0][0]
    # 三重量：① 全表净增 0（基线对照）② 钱单据类账一行都没落 ③ 形制与导入前完全一致
    check("T3 未生成任何应收/应付（post_ledger=False）：净增 0 条",
          rec == rec_base and rec_money == 0 and rec_kind == rec_base_kind,
          "基线 %d → 现在 %d；钱单据类账 %d 条；%s" % (rec_base, rec, rec_money, dict(rec_kind)))
    one = q("SELECT order_no,type,status,note,order_date FROM expense_orders WHERE order_no='GYFY2609160001'")
    print("      费用单样例: %s" % ((one[0] if one else None),))
    check("T3 费用单 status 保持默认 'unpaid'（「已审核」只进 note）",
          bool(one) and one[0][2] == 'unpaid' and '已审核' in (one[0][3] or ""),
          "status=%s" % (one[0][2] if one else None))
    multi = q("SELECT order_no, amount FROM income_orders WHERE order_no='GYSR2609090001'")
    check("T3 收入多行单已按单号**汇总**为一条（GYSR2609090001 = ¥135,317.90）",
          bool(multi) and abs(float(multi[0][1]) - 135317.90) < 0.005, "实际 %s" % (multi,))

    # --- 幂等 ---
    print()
    with get_db() as conn:
        fp, sheet, hr, b = binds["zhoupu_purchase"]
        r2 = Z.do_import(conn, Z.RefIndex(conn), fp, "zhoupu_purchase", sheet, hr, b,
                         dry_run=False, commit_every=200)
        n_po2 = q("SELECT COUNT(*) FROM purchase_orders WHERE order_no LIKE 'CD%'")[0][0]
        check("T3 重跑幂等：62 单全部 existed 且库内仍 62 张",
              r2["stats"]["orders_existed"] == 62 and n_po2 == 62,
              "existed=%d 库内=%d" % (r2["stats"]["orders_existed"], n_po2))
        for kind in ("zhoupu_income", "zhoupu_expense"):
            fp, sheet, hr, b = binds[kind]
            Z.do_import_money(conn, Z.RefIndex(conn), fp, kind, sheet, hr, b, dry_run=False)
    n_inc2 = q("SELECT COUNT(*) FROM income_orders WHERE order_no LIKE 'GYSR%'")[0][0]
    n_exp2 = q("SELECT COUNT(*) FROM expense_orders WHERE order_no LIKE 'GYFY%'")[0][0]
    check("T3 收入/费用重跑不新增（3 / 1）", n_inc2 == 3 and n_exp2 == 1,
          "收入 %d / 费用 %d" % (n_inc2, n_exp2))

    # ------------------------------------------------------------------
    print()
    print("=" * 76)
    print("T4 反例：非舟谱文件必须被判别器拒绝（证明它**不是**来者不拒）")
    bad_fp = os.path.join(SHADOW_DIR, "not-zhoupu.xlsx")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["姓名", "电话", "备注"])
    ws.append(["张三", "13800000000", "随便什么表"])
    wb.save(bad_fp)
    try:
        Z.detect_file(bad_fp)
        check("T4 非舟谱文件应报错", False, "居然识别通过了")
    except ValueError as e:
        check("T4 非舟谱文件报 ValueError（判别器有判别力）", True, str(e)[:60])

    # ------------------------------------------------------------------
    print()
    print("=" * 76)
    print("T5 探针判别力自证（反例对照）：把「允许类型」清空，账单的单据**必须仍全部**")
    print("   出现在 orders_total 里 —— 旧口径下它们会从总数与分项里**同时**消失，")
    print("   恒等式两侧同为 0 照样成立 ⇒ 探针会认同 bug（v313 修的就是这个）。")
    e_tot_exp = FSCAN["zhoupu_expense"][1]
    _orig_allow = dict(Z._ALLOW_TYPES)
    try:
        Z._ALLOW_TYPES["zhoupu_expense"] = ()
        with get_db() as conn:
            _fp, _sh, _hr, _b = binds["zhoupu_expense"]
            s5 = Z.do_import_money(conn, Z.RefIndex(conn), _fp, "zhoupu_expense",
                                   _sh, _hr, _b, dry_run=True)["stats"]
        check("T5 全被挡时 orders_total 仍 = 文件单数 %d（**不是 0**）" % e_tot_exp,
              s5["orders_total"] == e_tot_exp, "实际 %d" % s5["orders_total"])
        check("T5 全被挡时 created=0 / blocked=%d" % e_tot_exp,
              s5["orders_created"] == 0 and s5["orders_blocked"] == e_tot_exp,
              "created=%d blocked=%d" % (s5["orders_created"], s5["orders_blocked"]))
        _ident("T5", s5)
    finally:
        Z._ALLOW_TYPES.clear()
        Z._ALLOW_TYPES.update(_orig_allow)

    # ------------------------------------------------------------------
    print()
    print("=" * 76)
    print("T6 `can_execute` 真机正反 —— 走**生产真实代码路径** `_worker_preview`（不是复算公式）")
    print("   口径改动后必须按「本批真能落的单」判；否则上传一份纯客户费用单的文件")
    print("   也会显示「可执行」，点下去导 0 张 ⇒ 用户以为系统坏了。")
    if not os.path.isdir(Z._TMP_DIR):
        os.makedirs(Z._TMP_DIR)

    def _preview(tag, allow_patch):
        """复制一份费用表 → 调真实 `_worker_preview`（它会 os.replace 移走文件，故必须用副本）。"""
        src = os.path.join(SHADOW_DIR, "t6-%s.xlsx" % tag)
        shutil.copy2(F_EXP, src)
        job = Z._new_job("zhoupu_expense", None, "probe")
        _o = dict(Z._ALLOW_TYPES)
        try:
            for k, v in allow_patch.items():
                Z._ALLOW_TYPES[k] = v
            Z._worker_preview(job, src, os.path.basename(src))
        finally:
            Z._ALLOW_TYPES.clear()
            Z._ALLOW_TYPES.update(_o)
        return job

    def _ce(job):
        r = job.get("result") or {}
        st = r.get("stats") or {}
        return (job.get("status"), r.get("can_execute"),
                {k: st.get(k) for k in ("orders_total", "orders_blocked", "orders_failed",
                                        "orders_created")})

    j_ok = _preview("ok", {})
    _s, _ce_ok, _st_ok = _ce(j_ok)
    check("T6 正例：默认放行供应商侧 ⇒ can_execute=True（账单本批可落 1 单）",
          _s == "done" and _ce_ok is True, "status=%s can_execute=%s %s" % (_s, _ce_ok, _st_ok))

    j_no = _preview("none", {"zhoupu_expense": ()})
    _s2, _ce_no, _st_no = _ce(j_no)
    check("T6 反例：一张也落不了 ⇒ can_execute=False（**旧口径这里会是 True**）",
          _s2 == "done" and _ce_no is False, "status=%s can_execute=%s %s" % (_s2, _ce_no, _st_no))
    check("T6 反例侧 orders_total 仍是文件单数 %d（证明不是靠「数不上单」凑出来的 False）" % e_tot_exp,
          _st_no.get("orders_total") == e_tot_exp, "实际 %s" % _st_no.get("orders_total"))

    db.close()
    print()
    print("=" * 76)
    print("结果: ✅ %d 项通过 / ❌ %d 项失败" % (len(OK), len(BAD)))
    for b in BAD:
        print("   ❌", b)
    if BAD:
        sys.exit(1)


if __name__ == "__main__":
    main()
