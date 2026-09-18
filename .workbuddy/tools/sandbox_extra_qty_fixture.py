#!/usr/bin/env python3
"""v191b 沙箱夹具：给隔离沙箱租户的 `forecast_extra_qty` 造一条**往期**手工单价，
用来验证「本期留空 = 自动沿用上一期录入的价」。

为什么需要它：沙箱会把全部 order_date 改写成今天 ⇒ 打开页面永远是「今日报单」窗口，
而「沿用」的边界是 `period_start < 本期 start`（不含本期）⇒ 沙箱里**天然没有**可沿用的历史行，
必须手工造一条，否则该判据在沙箱里恒为「无来源」，验不出真假。

⚠️ 只在沙箱库（id ≥ 9997）上跑，绝不可指向 tenant_1 / tenant_10。

用法（服务器上，/opt/hergent-erp 为工作目录）：
  python3 sandbox_extra_qty_fixture.py --db tenant_9997.db show
  python3 sandbox_extra_qty_fixture.py --db tenant_9997.db seed --name 红桶 --price 88
  python3 sandbox_extra_qty_fixture.py --db tenant_9997.db clear
"""
import argparse
import sqlite3
import sys

FIXTURE_PERIOD = ("2026-08-30", "2026-09-15")   # 一个**早于今天(2026-09-18)**的历史期窗口


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("cmd", choices=["show", "seed", "clear"])
    ap.add_argument("--name", default="红桶")
    ap.add_argument("--price", type=float, default=88.0)
    a = ap.parse_args()

    if "/999" not in a.db and not a.db.startswith("tenant_999"):
        sys.exit("拒绝：只允许操作沙箱库（tenant_999*），收到 %s" % a.db)
    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    c = con.cursor()

    if a.cmd == "show":
        print("--- forecast_extra_qty 现有行 ---")
        for r in c.execute("SELECT period_start, period_end, product_id, product_name, unit, extra_qty, "
                           "case_price FROM forecast_extra_qty ORDER BY period_start"):
            print(dict(r))
        print("--- 候选商品（名字含 %s）---" % a.name)
        for r in c.execute("SELECT id, name, spec, unit, purchase_price FROM products WHERE name LIKE ? LIMIT 8",
                           ("%" + a.name + "%",)):
            print(dict(r))
        return

    if a.cmd == "clear":
        n = c.execute("DELETE FROM forecast_extra_qty WHERE period_start=? AND period_end=?",
                      FIXTURE_PERIOD).rowcount
        con.commit()
        print("已清除夹具行数 =", n)
        return

    row = c.execute("SELECT id, name, unit FROM products WHERE name LIKE ? ORDER BY id LIMIT 1",
                    ("%" + a.name + "%",)).fetchone()
    if not row:
        sys.exit("沙箱库里找不到名字含「%s」的商品" % a.name)
    ps, pe = FIXTURE_PERIOD
    c.execute("INSERT INTO forecast_extra_qty (period_start, period_end, product_id, product_name, unit, "
              "extra_qty, case_price) VALUES (?,?,?,?,?,?,?) "
              "ON CONFLICT(period_start, period_end, product_id) DO UPDATE SET case_price=excluded.case_price",
              (ps, pe, row["id"], row["name"], row["unit"], 0, a.price))
    con.commit()
    print("已写入往期夹具：period=%s~%s product_id=%s name=%s case_price=%s"
          % (ps, pe, row["id"], row["name"], a.price))


if __name__ == "__main__":
    main()
