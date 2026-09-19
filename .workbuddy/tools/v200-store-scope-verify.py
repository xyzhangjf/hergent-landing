#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v200「报单人门店配置收敛」——函数级验证。

做法：**不重新实现一遍**，而是用 AST 从 `erp_db.py` 抽取本轮改动的三个真实函数源码，
exec 进一个提供假 `get_db` / `get_db_tx` 的命名空间，在内存 sqlite 上跑。
⇒ 验的是真源码，不是复刻品（复刻品全绿 = 什么都没验）。

覆盖：
  T1  并集：历史层 ∪ 报单配置派生
  T2  去重：同一门店两边都有只出现一次
  T3  prune 只删「已被映射覆盖」的历史行
  T4  prune 不误伤未被覆盖的行
  T5  prune 不改变可见集合（删前删后 get 结果一致）—— 幂等安全的前提
  T6  停用映射 ⇒ 门店消失（历史层已收敛的前提下）
  T7  prune 的参数收口：employee_id=0 清全租户，传具体 id 只清该员工
  T8  counterparty_type 过滤（self_warehouse 不进门店列表）
  T9  contacts.type 过滤（供应商不是门店）
  T10 缺 report_mapping 表 ⇒ 回落历史层，不抛错（老租户库）
  T11 无员工身份（0/None/非法）⇒ 空数组，不越权
  T12 legacy 列表口径 = 历史层 − 已覆盖；hr_employees 缺表也不抛错

退出码：0 全绿 / 1 有失败。
"""
import ast
import io
import os
import sqlite3
import sys
import contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_PATH = os.environ.get(
    "ERP_DB", "/Users/zhangjunfeng/Documents/hergent-erp/server/erp_db.py")

WANT = ("employee_stores_get", "employee_stores_prune_covered",
        "report_mapping_legacy_stores")

_passed = 0
_failed = []


def check(cond, msg):
    global _passed
    if cond:
        _passed += 1
        print("     \u2713 " + msg)
    else:
        _failed.append(msg)
        print("     \u2717 " + msg)


def eq(a, b):
    return a == b


# ---------- 1. 抽真实函数源码 ----------
src = io.open(SRC_PATH, encoding="utf-8").read()
tree = ast.parse(src)
picked = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT:
        picked.append(node)
names = sorted(n.name for n in picked)
print("从 %s 抽到函数: %s" % (os.path.basename(SRC_PATH), ", ".join(names)))
assert names == sorted(WANT), "抽取失败：期望 %s，实得 %s" % (sorted(WANT), names)
func_src = "\n\n".join(ast.unparse(n) for n in picked)


# ---------- 2. 造内存库 + 假连接层 ----------
def build_db(with_mapping=True, with_employees=True):
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT, type TEXT, is_active INTEGER DEFAULT 1);
        CREATE TABLE employee_stores (employee_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
                                      PRIMARY KEY (employee_id, store_id));
    """)
    if with_mapping:
        con.executescript("""
        CREATE TABLE report_mapping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER, counterparty_type TEXT, counterparty_id INTEGER,
            system_name TEXT, report_alias TEXT, order_template TEXT,
            src_wh INTEGER DEFAULT 0, dst_wh INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
        """)
    if with_employees:
        con.executescript("""
        CREATE TABLE hr_employees (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
        """)
    # 门店/客户（id 与生产 tenant_1 形态一致：一份利 2562 / 一扫光 2804 / 永辉东津店 2868）
    con.executescript("""
        INSERT INTO contacts (id, name, type, is_active) VALUES
          (2562, '一分利', 'customer', 1),
          (2804, '一扫光', 'customer', 1),
          (2868, '永辉东津店', 'customer', 1),
          (2220, '永诺旗舰店', 'customer', 1),
          (7001, '某供应商', 'supplier', 1);
    """)
    if with_employees:
        con.executescript("""
            INSERT INTO hr_employees (id, name, is_active) VALUES (7, '张俊峰', 1), (4, '刘小顶', 1);
        """)
    return con


def make_env(con):
    """把真实函数 exec 进来，只把 IO 边界换成内存连接。"""
    @contextlib.contextmanager
    def fake_get_db():
        yield con

    @contextlib.contextmanager
    def fake_get_db_tx():
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise

    def fake_ensure(_db):
        return None

    glb = {"get_db": fake_get_db, "get_db_tx": fake_get_db_tx,
           "_ensure_forecast_tables": fake_ensure}
    exec(compile(func_src, "<erp_db-extract>", "exec"), glb)
    return glb


def ids_of(stores):
    return [s["id"] for s in stores]


# ================= T1 / T2 并集与去重 =================
print("\n[T1/T2] 并集：历史层 ∪ 报单配置派生")
con = build_db()
con.executescript("""
    INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 2562), (7, 2804);
    INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, report_alias, is_active)
      VALUES (7, 'store', 2868, '东津', 1),
             (7, 'self_warehouse', 9, '本人仓', 1),
             (7, 'store', 7001, '供应商误配', 1);
""")
g = make_env(con)
got = ids_of(g["employee_stores_get"](7))
check(eq(got, [2562, 2804, 2868]), "历史层 2 家 + 映射派生 1 家 = %s（缺一即『配了看不到』）" % got)

con.execute("INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 2868)")
g = make_env(con)
got = ids_of(g["employee_stores_get"](7))
check(eq(got, [2562, 2804, 2868]), "两边都有 2868 时只出现一次（去重）=%s" % got)
check(len(got) == len(set(got)), "无重复 id")

# ================= T3 / T4 / T5 prune =================
print("\n[T3/T4/T5] prune：只删被映射覆盖的历史行，且不改变可见集合")
before = ids_of(g["employee_stores_get"](7))
res = g["employee_stores_prune_covered"](7)
after = ids_of(g["employee_stores_get"](7))
check(eq(res["removed"], 1), "删了 1 行（只有 2868 被映射覆盖）实得 removed=%s" % res["removed"])
check(eq(after, before), "🔴 删除**不改变可见集合**：前 %s / 后 %s" % (before, after))
left = [r["store_id"] for r in con.execute("SELECT store_id FROM employee_stores WHERE employee_id=7")]
check(eq(sorted(left), [2562, 2804]), "未被覆盖的 2562/2804 保留 = %s" % sorted(left))
check(eq(g["employee_stores_prune_covered"](7)["removed"], 0), "再跑一次是幂等的（removed=0）")

# ================= T6 停用映射 =================
print("\n[T6] 停用报单配置 ⇒ 门店从可见范围消失")
con.execute("UPDATE report_mapping SET is_active=0 WHERE counterparty_id=2868")
g = make_env(con)
got = ids_of(g["employee_stores_get"](7))
check(eq(got, [2562, 2804]), "停用后东津(2868)消失 = %s（这是「停用能收回」的保证）" % got)

# ================= T7 prune 作用域 =================
print("\n[T7] prune 的作用域：指定员工不乱清别人")
con.execute("UPDATE report_mapping SET is_active=1 WHERE counterparty_id=2868")
con.executescript("INSERT INTO employee_stores (employee_id, store_id) VALUES (4, 2868);")
con.execute("INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, report_alias, is_active) "
            "VALUES (4, 'customer', 2868, '小顶东津', 1)")
g = make_env(con)
g["employee_stores_prune_covered"](7)
r7 = [r["store_id"] for r in con.execute("SELECT store_id FROM employee_stores WHERE employee_id=7")]
r4 = [r["store_id"] for r in con.execute("SELECT store_id FROM employee_stores WHERE employee_id=4")]
check(eq(r7, [2562, 2804]), "prune(7) 后员工 7 只剩未被覆盖的 = %s" % r7)
check(eq(r4, [2868]), "员工 4 的行**未被误清** = %s（作用域收口）" % r4)
con.execute("DELETE FROM employee_stores WHERE employee_id=4")
n_all = g["employee_stores_prune_covered"](0)["removed"]
check(eq(n_all, 0), "prune(0)=全租户，此处已无可清（removed=%s）" % n_all)
con.execute("INSERT INTO employee_stores (employee_id, store_id) VALUES (4, 2868)")
check(eq(g["employee_stores_prune_covered"](0)["removed"], 1), "prune(0) 能清到别的员工（跨员工收口正确）")

# ================= T8 / T9 过滤 =================
print("\n[T8/T9] 对象过滤：本人仓不进门店列表 / 供应商不是门店")
con2 = build_db()
con2.executescript("""
    INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, report_alias, is_active)
      VALUES (7, 'self_warehouse', 9, '本人仓', 1),
             (7, 'store', 7001, '供应商', 1);
    INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 7001);
""")
g2 = make_env(con2)
check(eq(g2["employee_stores_get"](7), []), "self_warehouse 与 supplier 均不进门店列表")

# ================= T10 缺表回落 =================
print("\n[T10] 老租户库没有 report_mapping 表 ⇒ 回落历史层，不抛错")
con3 = build_db(with_mapping=False)
con3.execute("INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 2562)")
g3 = make_env(con3)
try:
    got = ids_of(g3["employee_stores_get"](7))
    check(eq(got, [2562]), "缺表时读历史层 = %s" % got)
except Exception as e:
    check(False, "缺表时抛错：%r" % e)
try:
    r = g3["employee_stores_prune_covered"](7)
    check(eq(r["removed"], 0), "缺表时 prune 安全跳过 = %s" % r)
except Exception as e:
    check(False, "缺表时 prune 抛错：%r" % e)

# ================= T11 无员工身份 =================
print("\n[T11] 无员工身份（0 / None / 非数字）⇒ 空数组")
g4 = make_env(build_db())
check(eq(g4["employee_stores_get"](0), []), "emp=0 → []")
check(eq(g4["employee_stores_get"](None), []), "emp=None → []（不炸）")
check(eq(g4["employee_stores_get"]("abc"), []), "emp='abc' → []（不炸）")

# ================= T12 legacy 列表 =================
print("\n[T12] legacy-stores：历史层 − 已覆盖，且缺 hr_employees 也不抛错")
con5 = build_db()
con5.executescript("""
    INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 2562), (7, 2804), (9001, 2220);
    INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, report_alias, is_active)
      VALUES (7, 'store', 2804, '一扫光', 1);
""")
g5 = make_env(con5)
items = g5["report_mapping_legacy_stores"]()
got_pairs = sorted((r["employee_id"], r["store_id"]) for r in items)
check(eq(got_pairs, [(7, 2562), (9001, 2220)]),
      "只列未被覆盖的 = %s（2804 已被映射覆盖，不该出现）" % got_pairs)
check(all(r["store_name"] for r in items), "带门店名便于提示条渲染")
orphan = [r for r in items if r["employee_id"] == 9001][0]
check(eq(orphan["employee_name"], ""), "孤儿员工（9001 不存在）employee_name 为空 = %r" % orphan["employee_name"])
con6 = build_db(with_employees=False)
con6.execute("INSERT INTO employee_stores (employee_id, store_id) VALUES (7, 2562)")
g6 = make_env(con6)
try:
    items6 = g6["report_mapping_legacy_stores"]()
    check(eq([(r["employee_id"], r["store_id"]) for r in items6], [(7, 2562)]),
          "缺 hr_employees 时不 JOIN 也能列 = %s" % items6)
except Exception as e:
    check(False, "缺 hr_employees 时抛错：%r" % e)

# ================= 汇总 =================
print("\n" + "=" * 60)
print("通过 %d 项，失败 %d 项" % (_passed, len(_failed)))
for m in _failed:
    print("  ✗ " + m)
print("=" * 60)
sys.exit(1 if _failed else 0)
