#!/usr/bin/env python3
"""v719b：库存台账补记 —— 让 `inventory`（余额）与 `inventory_logs`（流水）对得上

## 两个阶段，各自独立幂等

### 阶段 1 `ledger`：补 v718 的入库流水（**这是 v718 的欠账**）
v718 把 10 月 49 张采购单的 782 行明细按商品-仓聚合，只 `UPDATE/INSERT inventory`
（`patch_v718_purchase_backfill.py:416-434`），**一行 `inventory_logs` 都没写**。
实测：`inventory` 合计 310,409 / `inventory_logs` 合计 27,985 / 差 **282,424**。
后果：`get_inventory_aging()` 按 `change_type='batch_in'` 取最近入库时间算库龄 ⇒
这 282,424 没有入库时间，库龄回落成 `inventory.updated_at`，aging 报表不可信。

### 阶段 2 `outflow`：销售出库回补（**这才是「库存不是余额」的根因**）
22,505 张签收单是舟谱导入的（`pick_waves` 0 行、`delivery_status` 全空串），
绕过 `sale_order_deliver` ⇒ 零出库流水。净销售出库 **3,923,642**（已排除
`order_type='transfer'` 的 276,541 —— 那 251 张是调拨单，v716 已确认不能当销售）。

## 🔴 阶段 2 的后果必须事先知道

回补后 `inventory` 从 **+310,409** 变成 **-3,613,233**，且 233 个商品里 211 个变负。
这不是 bug —— 是「1-9 月进货单从未进系统」的直接量化。
它与资产负债表 1405（-631 万）**方向一致**；而现在 +310,409 与 -631 万**方向相反**，
才是最危险的状态：老板看库存表觉得有货、看资产负债表觉得缺货。
进货补齐后（A2）这个负数会自然收敛。故默认 dry-run，`--apply` 才写。

## 口径（每条都实测过，不是猜）

- 数量取 `COALESCE(NULLIF(base_qty,0), quantity)`：v683 起发货按折小单位量扣库存。
  实测历史 142,859 行里**只有 1 行**有 `base_qty`，两种口径差 **0.0** ⇒ 对存量零影响。
- 排除 `order_type='transfer'`：251 张、276,541 数量，金额 0 但成本 55.16 万。
- 只认 `status IN ('signed','delivered')`：草稿单还没出货。
- 退货（负数量 9,681 行 / -87,629）**不单独处理** —— 它本来就是负数，SUM 自然抵消，
  等价于「退回来的货回到仓里」。

## 不做什么（防止越界）

- **不生成凭据、不动三表**：GL 里 22,505 单的成本早已过账（`auto_journal_for_cogs`），
  本脚本只修库存数量与流水，不碰 `journal_entries`。
- **不 import erp_db**（导入期就跑 389 条迁移 = 会写生产）。

用法：
    python3 patch_v719b_stock_ledger.py                     # 两阶段 dry-run
    python3 patch_v719b_stock_ledger.py --phase ledger --apply
    python3 patch_v719b_stock_ledger.py --phase outflow --apply
    python3 patch_v719b_stock_ledger.py --verify
    python3 patch_v719b_stock_ledger.py --revert <备份.db>
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

BASE = os.environ.get("ERP_HOME", "/opt/hergent-erp")
TENANT = os.path.join(BASE, "tenant_1.db")
BAKDIR = "/opt/hergent-data/backup"

REF_LEDGER = "v718_backfill"   # 阶段 1 的幂等键
REF_OUTFLOW = "sale_history"   # 阶段 2 的幂等键

QTY_EXPR = "CASE WHEN COALESCE(soi.base_qty,0)>0 THEN soi.base_qty ELSE soi.quantity END"


def hr(t):
    print("\n" + "=" * 74)
    print(t)
    print("=" * 74)


def connect(ro=False):
    if ro:
        return sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
    c = sqlite3.connect(TENANT)
    c.row_factory = sqlite3.Row
    return c


def _neg_count(con, where=""):
    q = "SELECT COUNT(*) FROM inventory WHERE quantity < 0" + ((" AND " + where) if where else "")
    return con.execute(q).fetchone()[0]


# ---------------------------------------------------------------- 阶段 1
def phase_ledger(con, apply_it):
    hr("阶段 1  ledger —— 补 v718 入库流水")
    done = con.execute("SELECT COUNT(*) FROM inventory_logs WHERE ref_type=?",
                       (REF_LEDGER,)).fetchone()[0]
    if done:
        print("  已补过 %d 行（ref_type=%s），跳过" % (done, REF_LEDGER))
        return "already"

    rows = con.execute("""
        SELECT i.product_id AS pid, o.warehouse_id AS wid,
               SUM(i.quantity) AS qty, SUM(i.amount) AS amt
          FROM purchase_order_items i
          JOIN purchase_orders o ON o.id = i.order_id
         WHERE o.source = 'v718'
         GROUP BY i.product_id, o.warehouse_id
         ORDER BY i.product_id
    """).fetchall()

    tot_q = sum(float(r["qty"] or 0) for r in rows)
    print("  v718 采购明细聚合：%d 个商品-仓，数量合计 %.2f" % (len(rows), tot_q))
    if not rows:
        print("  🔴 没找到 source='v718' 的采购单 —— 无法补记")
        return "missing"

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    wrote = 0
    for r in rows:
        qty = float(r["qty"] or 0)
        if abs(qty) < 0.0001:
            continue
        cur = con.execute(
            "SELECT COALESCE(SUM(quantity),0) AS q FROM inventory WHERE product_id=? AND warehouse_id=?",
            (r["pid"], r["wid"])).fetchone()["q"]
        after = float(cur or 0)
        before = after - qty
        unit_cost = (float(r["amt"] or 0) / qty) if qty else 0.0
        if apply_it:
            con.execute(
                "INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,"
                "before_qty,after_qty,cost_price,ref_type,ref_id,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (r["pid"], r["wid"], "batch_in", qty, before, after,
                 round(unit_cost, 6), REF_LEDGER, 0, now))
        wrote += 1

    print("  写入流水：%d 行（change_type=batch_in, ref_type=%s）" % (wrote, REF_LEDGER))
    print("  ⚠️ before_qty 是按「当前余额 - 本批数量」反推的近似值 ——")
    print("     v718 已把数量合并进 inventory，当时的前后值已不可还原。")
    if apply_it:
        con.commit()
        print("  ✅ 已提交")
    return "apply"


# ---------------------------------------------------------------- 阶段 2
def phase_outflow(con, apply_it):
    hr("阶段 2  outflow —— 销售出库回补")
    done = con.execute("SELECT COUNT(*) FROM inventory_logs WHERE ref_type=?",
                       (REF_OUTFLOW,)).fetchone()[0]
    if done:
        print("  已补过 %d 行（ref_type=%s），跳过" % (done, REF_OUTFLOW))
        return "already"

    rows = con.execute(f"""
        SELECT soi.product_id AS pid, o.warehouse_id AS wid,
               SUM({QTY_EXPR}) AS qty
          FROM sale_order_items soi
          JOIN sale_orders o ON o.id = soi.order_id
         WHERE o.order_type <> 'transfer'
           AND o.status IN ('signed','delivered')
         GROUP BY soi.product_id, o.warehouse_id
        HAVING ABS(SUM({QTY_EXPR})) > 0.0001
         ORDER BY ABS(SUM({QTY_EXPR})) DESC
    """).fetchall()

    tot = sum(float(r["qty"] or 0) for r in rows)
    cur_total = con.execute("SELECT COALESCE(SUM(quantity),0) FROM inventory").fetchone()[0]
    print("  净销售出库：%d 个商品-仓，数量合计 %.2f" % (len(rows), tot))
    print("  当前库存合计 %.2f  ⇒  回补后 %.2f" % (cur_total, cur_total - tot))

    # 预演：哪些会变负
    will_neg, will_ok = [], []
    for r in rows:
        cur = con.execute(
            "SELECT COALESCE(SUM(quantity),0) AS q FROM inventory WHERE product_id=? AND warehouse_id=?",
            (r["pid"], r["wid"])).fetchone()["q"]
        left = float(cur or 0) - float(r["qty"] or 0)
        (will_neg if left < -0.0001 else will_ok).append((r["pid"], r["wid"], float(r["qty"] or 0), left))

    print("  ⇒ 回补后 %d 个变负 / %d 个仍 >= 0" % (len(will_neg), len(will_ok)))
    if will_neg:
        print("\n  变负最严重的 8 个（负值 = 进货缺口）：")
        for pid, wid, q, left in sorted(will_neg, key=lambda x: x[3])[:8]:
            nm = con.execute("SELECT name FROM products WHERE id=?", (pid,)).fetchone()
            print("     商品%-6s 仓%-3s %-24s 应出 %-10.0f ⇒ %.0f"
                  % (pid, wid, (nm["name"] if nm else "?")[:24], q, left))

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    wrote = 0
    for r in rows:
        qty = float(r["qty"] or 0)
        cur = con.execute(
            "SELECT COALESCE(SUM(quantity),0) AS q FROM inventory WHERE product_id=? AND warehouse_id=?",
            (r["pid"], r["wid"])).fetchone()["q"]
        before = float(cur or 0)
        after = before - qty
        price = con.execute("SELECT COALESCE(purchase_price,0) AS p FROM products WHERE id=?",
                            (r["pid"],)).fetchone()
        cost = float(price["p"] or 0) if price else 0.0
        if apply_it:
            # 更新余额：优先改「未分批次」那一行；没有就建一行
            row = con.execute(
                "SELECT id FROM inventory WHERE product_id=? AND warehouse_id=? "
                "AND COALESCE(batch_no,'')='' LIMIT 1", (r["pid"], r["wid"])).fetchone()
            if row:
                con.execute("UPDATE inventory SET quantity=quantity-?, updated_at=? WHERE id=?",
                            (qty, now, row["id"]))
            else:
                con.execute(
                    "INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,"
                    "batch_no,expiry_date,updated_at) VALUES (?,?,?,?,?,?,?)",
                    (r["pid"], r["wid"], -qty, cost, None, None, now))
            con.execute(
                "INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,"
                "before_qty,after_qty,cost_price,ref_type,ref_id,created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (r["pid"], r["wid"], "sale", -qty, before, after, cost, REF_OUTFLOW, 0, now))
        wrote += 1

    print("\n  写入流水：%d 行（change_type=sale, ref_type=%s）" % (wrote, REF_OUTFLOW))
    if apply_it:
        con.commit()
        print("  ✅ 已提交")
    else:
        print("\n  ⚠️ 这是 dry-run。加 --apply 才会写库。")
        print("     ⚠️ 写完之后库存会变成负数，这是「1-9 月进货没进系统」的真实信号，")
        print("        不是 bug；补完进货（A2）后自然会收敛。")
    return "apply"


# ---------------------------------------------------------------- 对账
def do_verify(con):
    hr("对账  inventory（余额） vs inventory_logs（流水）")
    inv = con.execute("SELECT COALESCE(SUM(quantity),0) FROM inventory").fetchone()[0]
    lg = con.execute("SELECT COALESCE(SUM(change_qty),0) FROM inventory_logs").fetchone()[0]
    print("  inventory 合计 %.2f" % inv)
    print("  logs      合计 %.2f" % lg)
    print("  差        %.2f" % (inv - lg))

    per = con.execute("""
        SELECT i.product_id pid, i.warehouse_id wid,
               SUM(i.quantity) AS q_inv,
               COALESCE((SELECT SUM(l.change_qty) FROM inventory_logs l
                          WHERE l.product_id=i.product_id AND l.warehouse_id=i.warehouse_id),0) AS q_log
          FROM inventory i GROUP BY i.product_id, i.warehouse_id
        HAVING ABS(SUM(i.quantity) - COALESCE((SELECT SUM(l.change_qty) FROM inventory_logs l
                          WHERE l.product_id=i.product_id AND l.warehouse_id=i.warehouse_id),0)) > 0.01
    """).fetchall()
    print("  逐商品-仓不符：%d 组" % len(per))
    for r in per[:8]:
        print("     商品%-6s 仓%-3s 余额 %-10.0f 流水 %-10.0f 差 %.0f"
              % (r["pid"], r["wid"], r["q_inv"], r["q_log"], r["q_inv"] - r["q_log"]))
    print("\n  负库存行 %d 个" % _neg_count(con))
    print("  流水构成：")
    for x in con.execute("SELECT ref_type, change_type, COUNT(*), ROUND(SUM(change_qty),0) "
                         "FROM inventory_logs GROUP BY 1,2 ORDER BY 3 DESC"):
        print("     %-16s %-12s %5d 行  数量 %s" % (x[0], x[1], x[2], x[3]))
    return 0 if (abs(inv - lg) < 0.01 and not per) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["ledger", "outflow", "all"], default="all")
    ap.add_argument("--apply", action="store_true", help="写库（默认 dry-run）")
    ap.add_argument("--verify", action="store_true", help="只读对账")
    ap.add_argument("--revert", metavar="BAK", help="从指定备份文件恢复")
    a = ap.parse_args()

    if not os.path.exists(TENANT):
        print("🔴 找不到 %s" % TENANT)
        return 2

    if a.verify:
        return do_verify(connect(ro=True))

    if a.revert:
        if not os.path.exists(a.revert):
            print("🔴 备份不存在：%s" % a.revert)
            return 2
        shutil.copy2(a.revert, TENANT)
        for suf in ("-wal", "-shm"):
            p = TENANT + suf
            if os.path.exists(p):
                os.remove(p)
        print("✅ 已从 %s 恢复 tenant_1.db" % a.revert)
        print("   记得重启服务：systemctl restart hergent-erp")
        return 0

    bak = None
    if a.apply:
        os.makedirs(BAKDIR, exist_ok=True)
        bak = os.path.join(BAKDIR, "tenant_1.pre-v719b-%s.db" % datetime.now().strftime("%Y%m%d-%H%M%S"))
        src = sqlite3.connect(TENANT)
        dst = sqlite3.connect(bak)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        print("备份：%s（%.1f MB）" % (bak, os.path.getsize(bak) / 1e6))

    con = connect()
    try:
        if a.phase in ("ledger", "all"):
            phase_ledger(con, a.apply)
        if a.phase in ("outflow", "all"):
            phase_outflow(con, a.apply)
    finally:
        con.close()

    print("\n" + "-" * 74)
    if a.apply:
        print("完成。下一步：")
        print("  1) python3 %s --verify" % os.path.basename(__file__))
        print("  2) systemctl restart hergent-erp")
    else:
        print("dry-run 结束，未写库。确认后加 --apply。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
