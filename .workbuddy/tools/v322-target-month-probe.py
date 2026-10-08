# -*- coding: utf-8 -*-
"""v322 只读探针：商品目标「月份锚点」取证。

问题：月底报单（报单日在 9 月、到货日在 10 月）时，小程序仍显示 9 月的商品目标。
验证三件事：
  ① 期次表里 order_start / order_end / arrival_date 的实际形态（是否存在跨月期次）
  ② product_targets.period_month 的分布（目标到底按哪个月建的）
  ③ 复算 avg-target 的取月逻辑：_month_of(order_start) 与 _month_of(arrival_date) 是否分叉
只读：sqlite3 uri mode=ro，不带 immutable（活库）。
"""
import os
import sqlite3
import glob
import sys

DB_DIR = os.environ.get("ERP_DB_DIR", "/opt/hergent-erp")
MASTER = os.path.join(DB_DIR, "erp.db")


def ro(path):
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def q(con, sql, args=()):
    try:
        cur = con.execute(sql, args)
        cur.row_factory = sqlite3.Row
        return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        return [{"__err__": str(e)}]


print("=" * 78)
print("DB_DIR =", DB_DIR)
print("库文件：", sorted(os.path.basename(p) for p in glob.glob(os.path.join(DB_DIR, "*.db"))))
print("=" * 78)

# ── 主库：租户登记 ──────────────────────────────────────────────────────────
mc = ro(MASTER)
print("\n[主库] tenants:")
for r in q(mc, "SELECT id,name,status FROM tenants ORDER BY id"):
    print("   ", r)

# ── 每个租户库 ─────────────────────────────────────────────────────────────
for p in sorted(glob.glob(os.path.join(DB_DIR, "tenant_*.db"))):
    tid = os.path.basename(p)
    c = ro(p)
    print("\n" + "=" * 78)
    print("### %s" % tid)
    print("=" * 78)

    # ① 期次：最近 12 期
    print("\n[① forecast_periods] 最近 12 期（按 order_start 倒序）")
    rows = q(c, "SELECT id,name,order_start,order_end,arrival_date,status "
                "FROM forecast_periods ORDER BY order_start DESC, id DESC LIMIT 12")
    if rows and rows[0].get("__err__"):
        print("   !!", rows[0]["__err__"])
    for r in rows:
        os_ = str(r.get("order_start") or "")
        ar = str(r.get("arrival_date") or "")
        cross = "  <<< 跨月期次（报单月 %s → 到货月 %s）" % (os_[:7], ar[:7]) if (os_[:7] and ar[:7] and os_[:7] != ar[:7]) else ""
        print("    id=%-5s %-22s 报单 %s ~ %s  到货 %s  %-8s%s"
              % (r.get("id"), r.get("name"), os_, r.get("order_end"), ar, r.get("status"), cross))

    # ② 目标按月分布
    print("\n[② product_targets] 按月分布")
    rows = q(c, "SELECT period_month, COUNT(*) n, SUM(status='active') act "
                "FROM product_targets GROUP BY period_month ORDER BY period_month DESC")
    if rows and rows[0].get("__err__"):
        print("   !!", rows[0]["__err__"])
    for r in rows:
        print("    %s  总 %-4s  active %-4s" % (r["period_month"], r["n"], r["act"]))

    # ③ 用户点名的那个目标
    print("\n[③ 用户点名目标] 含「现代牧场0乳糖软牛奶185ml」的商品目标")
    rows = q(c, "SELECT id,period_month,product_id,product_name,target_qty,target_unit,"
                "order_count,status FROM product_targets "
                "WHERE product_name LIKE '%现代牧场%乳糖%' ORDER BY period_month DESC")
    if rows and rows[0].get("__err__"):
        print("   !!", rows[0]["__err__"])
    for r in rows:
        print("    %s  pid=%-6s %s  %s%s  可报单数=%s  %s"
              % (r["period_month"], r["product_id"], r["product_name"],
                 r["target_qty"], r["target_unit"], r["order_count"], r["status"]))

    # ④ 该商品档案
    print("\n[④ 档案] 该商品 products 行")
    rows = q(c, "SELECT id,name,brand,unit,large_unit,large_ratio,order_unit,status "
                "FROM products WHERE name LIKE '%现代牧场%乳糖%' LIMIT 8")
    if rows and rows[0].get("__err__"):
        print("   !!", rows[0]["__err__"])
    for r in rows:
        print("    pid=%-6s %-40s 品牌=%-8s 单位=%s 大单位=%s 换算=%s 报单单位=%s %s"
              % (r["id"], r["name"], r["brand"], r["unit"], r["large_unit"],
                 r["large_ratio"], r["order_unit"], r.get("status")))

    # ⑤ 到货规则
    print("\n[⑤ 品牌到货规则] rebate_target_rules dimension=brand 且启用")
    rows = q(c, "SELECT id,scope_key,scope_name,is_active FROM rebate_target_rules "
                "WHERE dimension='brand' ORDER BY is_active DESC, id DESC LIMIT 12")
    if rows and rows[0].get("__err__"):
        print("   !!", rows[0]["__err__"])
    for r in rows:
        print("    id=%-5s scope=%-14s 名=%-16s active=%s"
              % (r["id"], r["scope_key"], r["scope_name"], r["is_active"]))

    c.close()
print("\nDONE")
