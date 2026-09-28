# -*- coding: utf-8 -*-
"""只读核查：员工档案到底存在哪张表、现有谁、缺的是谁。

背景：`RefIndex.emp` 不是读独立的 employees 表，而是读 contacts 里 type='employee' 的行
（zhoupu_documents.py:464）。与此同时租户库里还有一张 `hr_employees`。
本脚本回答三个问题：
  1) contacts 里 type 分布如何、员工类(type='employee') 有多少人、都叫什么；
  2) hr_employees 有多少人、叫什么（是不是另一套 HR 档案，会不会是「同一批人的第二个家」）；
  3) 两边是否存在交叉/重名 —— 决定「建档建到哪儿」（建错地方等于白建）。

只读：全部连接用 mode=ro 且**不带 immutable**（活库）。
"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"


def main():
    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    print("DB =", DB)
    print()

    print("=== 1) contacts 按 type 分布 ===")
    for t, n, act in c.execute(
            "SELECT type, COUNT(*) n, SUM(CASE WHEN COALESCE(is_active,1)=1 THEN 1 ELSE 0 END) "
            "FROM contacts GROUP BY type ORDER BY n DESC"):
        print("   %-14s 总=%-5d 启用=%s" % (t, n, act))
    print()

    print("=== 2) contacts 里 type='employee' 的档案 ===")
    rows = list(c.execute(
        "SELECT id, name, is_active FROM contacts WHERE type='employee' ORDER BY id"))
    print("   共 %d 人：" % len(rows))
    for i, n, a in rows:
        print("      id=%-5s active=%-3s | %s" % (i, a, n))
    print()

    # contacts 其它列（是否存在 phone / department 等，决定建档要填什么）
    print("=== 3) contacts 全部列 ===")
    cols = [r[1] for r in c.execute("PRAGMA table_info(contacts)")]
    print("  ", cols)
    print()

    print("=== 4) hr_employees ===")
    try:
        hcols = [r[1] for r in c.execute("PRAGMA table_info(hr_employees)")]
        cnt = c.execute("SELECT COUNT(*) FROM hr_employees").fetchone()[0]
        print("   列:", hcols)
        print("   共 %d 人：" % cnt)
        take = [k for k in ("id", "name", "status", "is_active", "department", "position")
                if k in hcols]
        sel = ", ".join('"%s"' % x for x in take) if take else "id"
        for r in c.execute("SELECT %s FROM hr_employees ORDER BY id" % sel):
            d = dict(zip(take or ["id"], r))
            print("     ", d)
    except Exception as e:
        print("   读取失败:", e)
        hcols = []

    # 交叉比对
    print()
    print("=== 5) 交叉比对（重名 ⇒ 建档前必须先弄清楚哪边是真身）===")
    if hcols and "name" in hcols:
        ce = {str(n or "").strip() for _i, n, _a in rows}
        he = {str(r[0] or "").strip() for r in c.execute("SELECT name FROM hr_employees")}
        print("   contacts(employee) 独有: ", sorted(ce - he))
        print("   hr_employees 独有      : ", sorted(he - ce))
        print("   两边都有（重名）       : ", sorted(ce & he))
    c.close()


if __name__ == "__main__":
    main()
