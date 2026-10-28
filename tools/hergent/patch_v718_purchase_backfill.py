#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v718 进货补录 + 商品档案清污

【为什么有这一版】2026-10-28 生产实测（不是推断）：
1. purchase_orders 84 张 / 90.07 万，其中 79 张**没有任何明细**，全库明细仅 14 行。
2. 2026-10-20 上传的「10月1日-10月20日采购订货明细报表.xlsx」（782 行 / 49 张单 /
   57.48 万）被导入器当成 **products** 处理（映射只有 名称+采购价），
   ⇒ 明细从未进入 purchase_order_items。
3. 那次导入顺带把 782 行明细**每行建了一个商品** ⇒ products 1270 个，
   其中 782 个是重复空壳（无条码 / 无规格 / purchase_price=0 / 零引用）。
4. 库存科目 1405 余额 -688.6 万 = 只有销售结转成本、没有进货入库。
   本脚本补 10 月 57.48 万后约为 -631 万，**剩余缺口必须靠 1-9 月进货单**，本脚本补不了。

【两阶段】
  P1 清污：id>=1651 的 782 个空壳商品 → products_quarantine_v718（隔离，不物理删）
  P2 补录：xlsx → purchase_orders + purchase_order_items + inventory + 入库凭证(借1405/贷2202)

【用法】
  python3 patch_v718_purchase_backfill.py                  # dry-run（默认，不写库）
  python3 patch_v718_purchase_backfill.py --apply          # 执行（自动备份）
  python3 patch_v718_purchase_backfill.py --only p1 --apply
  python3 patch_v718_purchase_backfill.py --rollback <备份文件>

【纪律】
- 永远不 import erp_db（导入期会跑 389 条迁移 = 写生产）
- 幂等：单号判重、凭证按 (ref_type, ref_id) 判重
- fail-closed：P1 引用校验不过直接退出，不猜
- dry-run 默认；--apply 前强制备份
"""
import argparse
import os
import shutil
import sqlite3
import sys
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

DB = "/opt/hergent-erp/tenant_1.db"
XLSX = "/opt/hergent-erp/data/chat_files/2/6d700aa7fa3b4cd8b0415aff66dc1fbe.xlsx"
BACKUP_DIR = "/opt/hergent-data/backup"

TAG = "v718"                    # 写进 purchase_orders.source / note 便于识别与回滚
QUARANTINE = "products_quarantine_v718"
SHELL_MIN_ID = 1651             # 那次误导入建的商品起始 id
WH_NAME = "总仓"
SUPPLIER_FALLBACK = "蒙牛酸奶"   # 「蒙牛酸奶（湖北恒滋）」匹配不到时兜底

# P1 引用校验：(表, 列)
REFS = [
    ("sale_order_items", "product_id"),
    ("customer_prices", "product_id"),
    ("inventory", "product_id"),
    ("purchase_order_items", "product_id"),
    ("forecast_import_products", "product_id"),
]


def cents(x):
    return int(round(float(x or 0) * 100))


def money(x):
    return round(float(x or 0), 2)


def hr(title):
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


# ---------------------------------------------------------------- 备份
def backup_db():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(BACKUP_DIR, "tenant_1.pre-v718-%s.db" % ts)
    shutil.copy2(DB, dst)
    print("已备份 → %s (%d bytes)" % (dst, os.path.getsize(dst)))
    return dst


# ---------------------------------------------------------------- P1 清污
def check_refs(con):
    """返回总引用数。>0 表示空壳商品被引用 ⇒ 不许删。"""
    total = 0
    for table, col in REFS:
        try:
            n = con.execute(
                "SELECT COUNT(*) FROM %s WHERE %s>=?" % (table, col), (SHELL_MIN_ID,)
            ).fetchone()[0]
        except sqlite3.OperationalError as e:
            print("  [跳过] %s: %s" % (table, e))
            continue
        total += n
        print("  %-28s 引用 %d 行" % (table, n))
    return total


def phase1(con, apply):
    hr("P1 商品档案清污（隔离 %d 个空壳商品）" % _shell_count(con))
    n_shell = _shell_count(con)
    if n_shell == 0:
        print("没有待隔离的空壳商品（已做过），跳过。")
        return 0

    print("引用校验（必须全为 0，否则 fail-closed）：")
    refs = check_refs(con)
    if refs != 0:
        print("\n🔴 空壳商品仍被引用 %d 行 ⇒ 拒绝执行，请先人工确认。" % refs)
        sys.exit(2)
    print("  ✓ 零引用，可安全隔离")

    rows = con.execute(
        "SELECT COUNT(*), "
        "SUM(CASE WHEN COALESCE(barcode,'')='' THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN COALESCE(factory_price,0)>0 THEN 1 ELSE 0 END) "
        "FROM products WHERE id>=?", (SHELL_MIN_ID,)
    ).fetchone()
    print("\n待隔离：%d 个（无条码 %d 个 / 带厂价 %d 个）" % (rows[0], rows[1], rows[2] or 0))
    print("商品档案将：%d → %d" % (_product_count(con), _product_count(con) - n_shell))

    if not apply:
        print("\n[DRY-RUN] 未写库。")
        return n_shell

    con.execute(
        "CREATE TABLE IF NOT EXISTS %s AS SELECT * FROM products WHERE 0" % QUARANTINE
    )
    con.execute(
        "INSERT INTO %s SELECT * FROM products WHERE id>=? AND id NOT IN "
        "(SELECT id FROM %s)" % (QUARANTINE, QUARANTINE), (SHELL_MIN_ID,)
    )
    moved = con.execute("SELECT COUNT(*) FROM %s" % QUARANTINE).fetchone()[0]
    con.execute("DELETE FROM products WHERE id>=?", (SHELL_MIN_ID,))
    con.commit()
    print("\n✓ 已隔离 %d 个到 %s，剩余商品 %d 个" % (moved, QUARANTINE, _product_count(con)))
    print("  恢复方式：INSERT INTO products SELECT * FROM %s" % QUARANTINE)
    return moved


def _shell_count(con):
    return con.execute("SELECT COUNT(*) FROM products WHERE id>=?", (SHELL_MIN_ID,)).fetchone()[0]


def _product_count(con):
    return con.execute("SELECT COUNT(*) FROM products").fetchone()[0]


# ---------------------------------------------------------------- P2 解析
def parse_xlsx():
    import openpyxl

    if not os.path.exists(XLSX):
        print("🔴 找不到原始文件：%s" % XLSX)
        sys.exit(2)
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    hdr = [str(x) if x is not None else "" for x in rows[0]]
    idx = {h: i for i, h in enumerate(hdr)}
    need = ["单据", "商品名称", "条形码", "供应商", "单据时间",
            "采购入库数量", "单位名称", "采购入库金额", "采购价", "订单状态"]
    miss = [h for h in need if h not in idx]
    if miss:
        print("🔴 缺列：%s" % miss)
        sys.exit(2)

    bills = {}
    for r in rows[1:]:
        if not any(x is not None for x in r):
            continue
        no = str(r[idx["单据"]] or "").strip()
        if not no:
            continue
        qty = r[idx["采购入库数量"]]
        amt = r[idx["采购入库金额"]]
        # 0 元行（赠品）也要入库：有数量就必须进库存，否则库存少行
        if not amt and not qty:
            continue
        b = bills.setdefault(no, {
            "order_no": no,
            "date": str(r[idx["单据时间"]] or "")[:10],
            "supplier": str(r[idx["供应商"]] or "").strip(),
            "status": str(r[idx["订单状态"]] or "").strip(),
            "lines": [],
            "amount": 0.0,
        })
        b["lines"].append({
            "name": str(r[idx["商品名称"]] or "").strip(),
            "barcode": str(r[idx["条形码"]] or "").strip(),
            "qty": float(qty or 0),
            "unit": str(r[idx["单位名称"]] or "").strip(),
            "amount": float(amt or 0),
            "price": float(r[idx["采购价"]] or 0),
        })
        b["amount"] += float(amt or 0)
    return bills


# ---------------------------------------------------------------- P2 匹配
def build_matchers(con):
    """只从「老档案」建索引：排除待隔离的空壳商品（P1 之后它们就不在了）。

    条码重复（老档案 488 里也存在）时取 id 最小的那个 —— id 小的是原始档案，
    并统计重复组数供人工复核。名称仅在全局唯一时才用。
    """
    bc_map, nm_map = {}, {}
    dup_bc = 0
    for pid, barcode, name in con.execute(
        "SELECT id, COALESCE(barcode,''), COALESCE(name,'') FROM products WHERE id<?",
        (SHELL_MIN_ID,)
    ):
        if barcode:
            bc_map.setdefault(barcode, []).append(pid)
        if name:
            nm_map.setdefault(name, []).append(pid)
    bc_uniq = {}
    for k, v in bc_map.items():
        if len(v) > 1:
            dup_bc += 1
        bc_uniq[k] = min(v)
    nm_uniq = {k: v[0] for k, v in nm_map.items() if len(v) == 1}
    print("  商品索引：条码 %d 个（其中重复组 %d，取 id 最小）/ 唯一名称 %d 个"
          % (len(bc_uniq), dup_bc, len(nm_uniq)))
    return bc_uniq, nm_uniq


def match_product(line, bc_uniq, nm_uniq):
    if line["barcode"] and line["barcode"] in bc_uniq:
        return bc_uniq[line["barcode"]], "barcode"
    if line["name"] and line["name"] in nm_uniq:
        return nm_uniq[line["name"]], "name"
    return None, "miss"


def build_suppliers(con):
    sup = {}
    for name, cid in con.execute("SELECT name, id FROM contacts"):
        if name:
            sup.setdefault(name, cid)
    return sup


# ---------------------------------------------------------------- P2 凭证
def next_voucher_no(con, date_str):
    """JBP + YYYYMMDD + 4 位序号，按该日期已有最大序号 +1。"""
    prefix = "JBP" + date_str.replace("-", "")
    row = con.execute(
        "SELECT voucher_no FROM journal_entries WHERE voucher_no LIKE ? "
        "ORDER BY voucher_no DESC LIMIT 1", (prefix + "%",)
    ).fetchone()
    seq = int(row[0][len(prefix):]) + 1 if row else 1
    return prefix + "%04d" % seq


def post_purchase_journal(con, order_id, order_no, date_str, amount, dry):
    amount = money(amount)
    if cents(amount) == 0:
        return None
    if con.execute(
        "SELECT id FROM journal_entries WHERE ref_type='purchase' AND ref_id=? LIMIT 1",
        (order_id,)
    ).fetchone():
        return None
    vno = next_voucher_no(con, date_str)
    if dry:
        return vno
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con.execute(
        "INSERT INTO journal_entries (voucher_no, date, account_code, account_name, "
        "debit, credit, ref_type, ref_id, summary, operator_id, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (vno, date_str, "1405", "库存商品", amount, 0.0, "purchase", order_id,
         "采购入库", 0, now),
    )
    con.execute(
        "INSERT INTO journal_entries (voucher_no, date, account_code, account_name, "
        "debit, credit, ref_type, ref_id, summary, operator_id, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (vno, date_str, "2202", "应付账款", 0.0, amount, "purchase", order_id,
         "采购入库", 0, now),
    )
    return vno


# ---------------------------------------------------------------- P2 主流程
def parse_spec(name):
    """从商品名里提取规格（150g*24杯 / 100g*8杯*12组），提不到就留空。"""
    import re
    m = re.search(r"(\d+(?:\.\d+)?\s*(?:g|G|ml|ML|kg|KG))((?:\s*[*×]\s*\d+(?:\.\d+)?\s*[^\d*\s]*)+)", name)
    return m.group(0).strip() if m else ""


def create_product(con, line):
    """为未匹配明细建档：只填能确证的字段，规格尽力解析，拿不准就留空。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur = con.execute(
        "INSERT INTO products (name, spec, unit, barcode, purchase_price, factory_price, "
        "status, is_active, source, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (line["name"], parse_spec(line["name"]), line["unit"] or None,
         line["barcode"] or None, line["price"], line["price"],
         "active", 1, TAG, now, now),
    )
    return cur.lastrowid


def phase2(con, apply, create_missing=False):
    hr("P2 补录 10 月进货（采购单 + 明细 + 库存 + 入库凭证）")
    bills = parse_xlsx()
    print("解析：%d 张单 / %d 行明细 / 金额合计 %.2f"
          % (len(bills), sum(len(b["lines"]) for b in bills.values()),
             sum(b["amount"] for b in bills.values())))

    wh = con.execute("SELECT id FROM warehouses WHERE name=?", (WH_NAME,)).fetchone()
    if not wh:
        print("🔴 找不到仓库「%s」" % WH_NAME)
        sys.exit(2)
    wh_id = wh[0]
    print("仓库「%s」→ id=%d" % (WH_NAME, wh_id))

    bc_uniq, nm_uniq = build_matchers(con)
    suppliers = build_suppliers(con)

    existing = {r[0] for r in con.execute("SELECT order_no FROM purchase_orders")}

    stat = {"skip": 0, "new": 0, "new_lines": 0, "new_amount": 0.0,
            "by_bc": 0, "by_nm": 0, "by_miss": 0, "miss_lines": [],
            "created": 0, "to_create": 0,
            "sup_ok": 0, "sup_fallback": 0, "sup_fb_names": [], "vouchers": 0,
            "inv_rows": 0, "inv_qty": 0.0}

    # 商品聚合（用于库存 upsert 与成本价）
    inv_delta = {}

    for no in sorted(bills):
        b = bills[no]
        if no in existing:
            stat["skip"] += 1
            continue
        stat["new"] += 1
        stat["new_amount"] += b["amount"]

        # 供应商
        cid = suppliers.get(b["supplier"])
        if cid is None:
            cid = suppliers.get(SUPPLIER_FALLBACK, 0)
            stat["sup_fallback"] += 1
            if b["supplier"] not in stat["sup_fb_names"]:
                stat["sup_fb_names"].append(b["supplier"])
        else:
            stat["sup_ok"] += 1

        # 明细匹配
        lines = []
        for ln in b["lines"]:
            pid, how = match_product(ln, bc_uniq, nm_uniq)
            stat["by_bc" if how == "barcode" else "by_nm" if how == "name" else "by_miss"] += 1
            if pid is None:
                if not create_missing:
                    stat["miss_lines"].append((b["order_no"], ln["name"], ln["barcode"],
                                               ln["qty"], ln["amount"]))
                    continue
                # 建档必须写库才拿得到 id；dry-run 下用负号虚拟 id，保证库存口径一致
                if not apply:
                    stat["to_create"] += 1
                    pid = -stat["to_create"]
                else:
                    pid = create_product(con, ln)
                    stat["created"] += 1
                if ln["barcode"]:
                    bc_uniq[ln["barcode"]] = pid
            lines.append((pid, ln))
            key = (pid, wh_id)
            d = inv_delta.setdefault(key, {"qty": 0.0, "cost": 0.0})
            d["qty"] += ln["qty"]
            d["cost"] = ln["price"] or d["cost"]

        if not apply:
            stat["new_lines"] += len(lines)
            stat["vouchers"] += 1
            continue

        note = "v718 舟谱采购明细导入（原始供应商：%s）" % b["supplier"] if b["supplier"] else "v718 舟谱采购明细导入"
        cur = con.execute(
            "INSERT INTO purchase_orders (order_no, supplier_id, warehouse_id, total_amount, "
            "paid_amount, status, order_date, note, operator_id, created_at, "
            "received_amount, received_at, source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (no, cid, wh_id, money(b["amount"]), 0.0, "received", b["date"] or None,
             note, 0, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             money(b["amount"]), b["date"] or None, TAG),
        )
        oid = cur.lastrowid
        for pid, ln in lines:
            con.execute(
                "INSERT INTO purchase_order_items (order_id, product_id, quantity, "
                "unit_price, amount, unit, base_ratio, base_qty, received_qty, note) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (oid, pid, ln["qty"], ln["price"], money(ln["amount"]),
                 ln["unit"] or None, 1, ln["qty"], ln["qty"], None),
            )
        stat["new_lines"] += len(lines)
        if post_purchase_journal(con, oid, no, b["date"], b["amount"], False):
            stat["vouchers"] += 1

    # 库存
    for (pid, wid), d in inv_delta.items():
        row = con.execute(
            "SELECT id, quantity FROM inventory WHERE product_id=? AND warehouse_id=? "
            "AND COALESCE(batch_no,'')='' LIMIT 1", (pid, wid)
        ).fetchone()
        stat["inv_rows"] += 1
        stat["inv_qty"] += d["qty"]
        if not apply:
            continue
        if row:
            con.execute(
                "UPDATE inventory SET quantity=COALESCE(quantity,0)+?, "
                "cost_price=COALESCE(NULLIF(?,''),cost_price,0), updated_at=? WHERE id=?",
                (d["qty"], d["cost"], datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row[0]),
            )
        else:
            con.execute(
                "INSERT INTO inventory (product_id, warehouse_id, quantity, cost_price, "
                "batch_no, expiry_date, updated_at) VALUES (?,?,?,?,?,?,?)",
                (pid, wid, d["qty"], d["cost"], None, None,
                 datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            )

    if apply:
        con.commit()

    print("\n结果：")
    print("  已存在跳过      %d 张" % stat["skip"])
    print("  新增采购单      %d 张（金额 %.2f）" % (stat["new"], stat["new_amount"]))
    total_lines = stat["new_lines"] + len(stat["miss_lines"])
    print("  新增明细        %d 行（按条码 %d / 按名称 %d / 未匹配 %d）"
          % (total_lines, stat["by_bc"], stat["by_nm"], stat["by_miss"]))
    if stat["created"] or stat["to_create"]:
        print("  自动建档        %d 个（未匹配明细已建档，保证单头=明细）"
              % (stat["created"] or stat["to_create"]))
    print("  入库凭证        %d 张（借1405/贷2202，合计 %.2f）"
          % (stat["vouchers"], stat["new_amount"]))
    print("  库存变更        %d 个商品-仓，数量 +%.0f" % (stat["inv_rows"], stat["inv_qty"]))
    print("  供应商         匹配 %d / 兜底 %d %s"
          % (stat["sup_ok"], stat["sup_fallback"],
             ("（%s）" % "、".join(stat["sup_fb_names"])) if stat["sup_fb_names"] else ""))

    if stat["miss_lines"]:
        print("\n未匹配明细（%d 行，需人工建档）：" % len(stat["miss_lines"]))
        for x in stat["miss_lines"][:10]:
            print("   %s | %s | %s | 数量 %s | 金额 %s" % x)

    if not apply:
        print("\n[DRY-RUN] 未写库。加 --apply 执行。")


# ---------------------------------------------------------------- 体检
def health(con):
    hr("账务体检（改前/改后都要看）")
    r1405 = con.execute(
        "SELECT ROUND(SUM(debit)-SUM(credit),2) FROM journal_entries WHERE account_code LIKE '1405%'"
    ).fetchone()[0]
    r2202 = con.execute(
        "SELECT ROUND(SUM(debit)-SUM(credit),2) FROM journal_entries WHERE account_code LIKE '2202%'"
    ).fetchone()[0]
    bad = con.execute(
        "SELECT COUNT(*) FROM (SELECT voucher_no, ROUND(SUM(debit)-SUM(credit),2) d "
        "FROM journal_entries GROUP BY voucher_no HAVING ABS(d)>0.005)"
    ).fetchone()[0]
    print("  1405 库存商品余额 : %s" % r1405)
    print("  2202 应付账款余额 : %s" % r2202)
    print("  借贷不平凭证数    : %d" % bad)
    print("  采购单 / 明细     : %d / %d" % (
        con.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0],
        con.execute("SELECT COUNT(*) FROM purchase_order_items").fetchone()[0]))
    print("  商品/库存/凭证行  : %d / %d / %d" % (
        con.execute("SELECT COUNT(*) FROM products").fetchone()[0],
        con.execute("SELECT COUNT(*) FROM inventory").fetchone()[0],
        con.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真正写库（默认 dry-run）")
    ap.add_argument("--only", choices=["p1", "p2"], help="只跑某一阶段")
    ap.add_argument("--create-missing", action="store_true",
                    help="未匹配明细自动建档（否则跳过，会导致单头金额≠明细合计）")
    ap.add_argument("--rollback", metavar="BACKUP_DB", help="用备份整库恢复")
    a = ap.parse_args()

    if a.rollback:
        if not os.path.exists(a.rollback):
            print("备份不存在：%s" % a.rollback)
            sys.exit(2)
        shutil.copy2(DB, DB + ".pre-rollback-" + datetime.now().strftime("%H%M%S"))
        shutil.copy2(a.rollback, DB)
        print("已回滚 ← %s" % a.rollback)
        return

    if not os.path.exists(DB):
        print("库不存在：%s" % DB)
        sys.exit(2)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    health(con)

    if a.apply:
        print("\n⚠️  --apply 模式，先备份")
        backup_db()

    try:
        if a.only in (None, "p1"):
            phase1(con, a.apply)
        if a.only in (None, "p2"):
            phase2(con, a.apply, a.create_missing)
    finally:
        health(con)
        con.close()

    if not a.apply:
        print("\n（本次为 DRY-RUN，库未被修改）")


if __name__ == "__main__":
    main()
