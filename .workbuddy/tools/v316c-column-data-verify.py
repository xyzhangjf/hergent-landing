#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316c 只读核实：客户档案页两列（应收余额 / 最近下单）的真实数据形态。

为什么要跑：截图上「应收余额」**整列都是 `—`**。本项目铁律是
「恒空恒 0 且零报错 = 静默失效」，所以先问一句「这个恒定值是否恰好等于当前事实」，
再决定它是 bug 还是真没数据。

🔴 两个待验的 SQL 陷阱：
  ① `status!='paid'` —— SQLite 里 `NULL != 'paid'` 求值为 **NULL（假）** ⇒
     若 `receivables.status` 大量为 NULL，这些行会被**静默排除**，余额恒为 0。
  ② `order_date` 若带 `HH:MM:SS`，前端直出就会显示 `2026-08-08 00:00:00`。

🔴 全程只读（`mode=ro`），不打印任何客户名 / 电话（脱敏）。
"""
import sqlite3

DB = "/opt/hergent-erp/tenant_1.db"
con = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
con.row_factory = sqlite3.Row


def q(sql, p=()):
    return con.execute(sql, p).fetchall()


print("== 1. receivables 全量分布（type x status，注意 status=NULL 这一组）==")
rows = q("""SELECT type, status, COUNT(*) n, ROUND(SUM(amount),2) amt,
                   ROUND(SUM(amount-paid_amount),2) unpaid
            FROM receivables GROUP BY type, status ORDER BY type, status""")
if not rows:
    print("   （receivables 表为空）")
for r in rows:
    print("   type=%-4r status=%-10r n=%-6d amount=%-14s unpaid=%s"
          % (r["type"], r["status"], r["n"], r["amt"], r["unpaid"]))

print("== 2. 客户数 vs 有未付应收的客户数 ==")
print("   客户总数(customer+both,含停用) =",
      q("SELECT COUNT(*) n FROM contacts WHERE type IN ('customer','both')")[0]["n"])
print("   上述口径但仅 is_active=1        =",
      q("SELECT COUNT(*) n FROM contacts WHERE type IN ('customer','both') AND is_active=1")[0]["n"])
for cond, tag in [
    ("type='ar' AND status!='paid'", "现状写法 status!='paid'"),
    ("type='ar' AND (status IS NULL OR status!='paid')", "修法 status IS NULL OR !='paid'"),
    ("type='ar'", "不筛 status"),
]:
    n = q("SELECT COUNT(DISTINCT contact_id) n FROM receivables WHERE " + cond)[0]["n"]
    s = q("SELECT ROUND(SUM(amount-paid_amount),2) v FROM receivables WHERE " + cond)[0]["v"]
    print("   [%s] 涉及客户数=%-5s 未付合计=%s" % (tag, n, s))

print("== 3. order_date 格式样本（决定前端要不要格式化）==")
for r in q("""SELECT DISTINCT order_date FROM sale_orders
              WHERE order_date IS NOT NULL AND TRIM(order_date)<>''
              ORDER BY order_date DESC LIMIT 6"""):
    print("   ", repr(r["order_date"]))

print("== 4. 首屏前 5 行复算（只看 id / 日期 / 余额，脱敏）==")
for r in q("""SELECT c.id,
                 COALESCE((SELECT MAX(order_date) FROM sale_orders WHERE customer_id=c.id),'') lo,
                 COALESCE((SELECT SUM(amount-paid_amount) FROM receivables
                           WHERE contact_id=c.id AND type='ar' AND status!='paid'),0) ar,
                 COALESCE((SELECT SUM(amount-paid_amount) FROM receivables
                           WHERE contact_id=c.id AND type='ar'
                             AND (status IS NULL OR status!='paid')),0) ar_fix
              FROM contacts c WHERE c.type IN ('customer','both') AND c.is_active=1
              ORDER BY c.id DESC LIMIT 5"""):
    print("   id=%-5d last_order=%-22r ar=%-10s ar_nullsafe=%s"
          % (r["id"], r["lo"], r["ar"], r["ar_fix"]))

print("== 5. contacts 里 ar 相关列是否存在（防止前端读错字段名）==")
cols = [c[1] for c in q("PRAGMA table_info(contacts)")]
for want in ["ar_balance", "credit_limit", "credit_days", "boss_name", "boss_phone", "channel", "region", "assigned_salesperson"]:
    print("   contacts.%-22s %s" % (want, "存在" if want in cols else "🔴 不存在"))

con.close()
