#!/usr/bin/env python3
"""v612 单元验证：`_sync_period_product_list`（本期商品清单同步）。

🔴 为什么不是重写一份逻辑来测：重写测的是"我理解的那份"，不是**线上跑的那份**。
   这里用 AST 从真实源文件里抽出函数体执行（本项目既定做法，见 v587 单位逻辑测试）。
   依赖两个模块级符号（`db.forecast_period_scope_sql` / `fr.normalize_qty`），
   用与线上逐字相同的 SQL 片段 + 同一条解析规则打桩。
"""
import ast
import sqlite3
import sys

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/forecast_submissions.py"


def load_fn(extra=None):
    tree = ast.parse(open(SRC, encoding="utf-8").read())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "_sync_period_product_list":
            mod = ast.Module(body=[node], type_ignores=[])
            # 🔴 打桩必须放进**同一份** globals —— exec 生成的函数把当时的 globals 记成
            #    自己的 __globals__，事后再往另一个 dict 里塞 `db` 是塞不进去的（首次跑就踩了）。
            ns = dict(extra or {})
            exec(compile(ast.fix_missing_locations(mod), SRC, "exec"), ns)
            return ns["_sync_period_product_list"]
    raise SystemExit("找不到 _sync_period_product_list —— 函数改名了？先更测试再改代码")


class _DB:
    @staticmethod
    def forecast_period_scope_sql(alias=""):
        # 与 erp_db.py::forecast_period_scope_sql 逐字同构
        p = (alias + ".") if alias else ""
        return "(%speriod_id=? OR (%speriod_id=0 AND %sorder_date BETWEEN ? AND ?))" % (p, p, p)


class _FR:
    @staticmethod
    def normalize_qty(v):
        # 与 db/queries/forecast_rules.normalize_qty 同语义：非数字判违规并归 0
        try:
            if v is None or v == "":
                return 0, False
            f = float(v)
            return f, False
        except (TypeError, ValueError):
            return 0, True


def make_db():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, barcode TEXT)")
    c.execute("""CREATE TABLE forecast_import_products(
        id INTEGER PRIMARY KEY AUTOINCREMENT, period_id INTEGER NOT NULL DEFAULT 0,
        order_date TEXT DEFAULT '', product_id INTEGER NOT NULL, product_name TEXT DEFAULT '',
        barcode TEXT DEFAULT '', action TEXT DEFAULT '', imported_at TEXT DEFAULT '',
        imported_by TEXT DEFAULT '', source_file TEXT DEFAULT '', origin TEXT DEFAULT 'import',
        sort_no INTEGER DEFAULT 0, UNIQUE(period_id, product_id))""")
    for pid, nm, bc in [(901, "赠品A", "P901"), (902, "老品B", "P902"), (903, "老品C", "P903"),
                        (904, "新品D", "P904"), (905, "铺满E", "P905")]:
        c.execute("INSERT INTO products(id,name,barcode) VALUES(?,?,?)", (pid, nm, bc))
    # 期次 9：清单里已有 902（有量）、903（零量）
    c.execute("INSERT INTO forecast_import_products(period_id,order_date,product_id,product_name,barcode,origin,sort_no)"
              " VALUES(9,'2026-10-19',902,'老品B','P902','import',1)")
    c.execute("INSERT INTO forecast_import_products(period_id,order_date,product_id,product_name,barcode,origin,sort_no)"
              " VALUES(9,'2026-10-19',903,'老品C','P903','import',2)")
    c.commit()
    return c


def listed(conn):
    return [(r["product_id"], r["origin"], r["sort_no"]) for r in conn.execute(
        "SELECT product_id, origin, sort_no FROM forecast_import_products WHERE period_id=9 ORDER BY sort_no")]


def main():
    fn = load_fn({"db": _DB, "fr": _FR})
    ok = 0
    fail = []

    def chk(name, cond, detail=""):
        nonlocal ok
        if cond:
            ok += 1
            print("PASS", name)
        else:
            fail.append(name)
            print("FAIL", name, detail)

    # A 补录新品（qty 0 但 is_new）⇒ 新增，排末尾，origin=manual
    c = make_db()
    a, r = fn(c, 9, "2026-10-19", "2026-10-25",
              [{"product_id": 902, "qty_by_unit": {"东津": 5}},
               {"product_id": 903, "qty_by_unit": {"东津": 0}},
               {"product_id": 904, "qty_by_unit": {}, "is_new": True}], "老板")
    L = listed(c)
    chk("A1 补录新品被加进清单", a == 1 and r == 0, f"a={a} r={r}")
    chk("A2 新品排末尾且 origin=manual",
        L[-1] == (904, "manual", 3), str(L))
    chk("A3 名称/条码取自档案", c.execute(
        "SELECT product_name,barcode FROM forecast_import_products WHERE period_id=9 AND product_id=904"
    ).fetchone()[:] == ("新品D", "P904"))

    # B 勾「显示全部商品」铺出来的行（qty 0、无 is_new）⇒ 不得进清单
    a2, r2 = fn(c, 9, "2026-10-19", "2026-10-25",
                [{"product_id": 902, "qty_by_unit": {"东津": 5}},
                 {"product_id": 903, "qty_by_unit": {"东津": 0}},
                 {"product_id": 904, "qty_by_unit": {}},
                 {"product_id": 905, "qty_by_unit": {"东津": 0}}], "老板")
    chk("B1 全档案铺开的零量行不入清单", a2 == 0 and r2 == 0
        and 905 not in [x[0] for x in listed(c)], f"a={a2} r={r2} {listed(c)}")

    # C 有正数量但不在清单（小程序先报 / Web 后加）⇒ 新增
    a3, _ = fn(c, 9, "2026-10-19", "2026-10-25",
               [{"product_id": 902, "qty_by_unit": {"东津": 5}},
                {"product_id": 903, "qty_by_unit": {}},
                {"product_id": 904, "qty_by_unit": {}},
                {"product_id": 905, "qty_by_unit": {"东津": 3}}], "老板")
    chk("C1 有量的行即使不是新增也入清单", a3 == 1 and
        905 in [x[0] for x in listed(c)], f"a={a3} {listed(c)}")

    # D 删行（清单里有、payload 没有）⇒ 移除
    a4, r4 = fn(c, 9, "2026-10-19", "2026-10-25",
                [{"product_id": 903, "qty_by_unit": {}},
                 {"product_id": 904, "qty_by_unit": {}},
                 {"product_id": 905, "qty_by_unit": {"东津": 3}}], "老板")
    chk("D1 删行从清单移除", r4 == 1 and 902 not in [x[0] for x in listed(c)],
        f"r={r4} {listed(c)}")

    # E 幂等：同样入参再跑一次 ⇒ 无增减
    a5, r5 = fn(c, 9, "2026-10-19", "2026-10-25",
                [{"product_id": 903, "qty_by_unit": {}},
                 {"product_id": 904, "qty_by_unit": {}},
                 {"product_id": 905, "qty_by_unit": {"东津": 3}}], "老板")
    chk("E1 重复保存幂等", a5 == 0 and r5 == 0, f"a={a5} r={r5}")

    # F 空行集 ⇒ 一个都不删（fail-open）
    c2 = make_db()
    a6, r6 = fn(c2, 9, "2026-10-19", "2026-10-25", [], "老板")
    chk("F1 空载荷不清清单", a6 == 0 and r6 == 0
        and len(listed(c2)) == 2, f"{a6}/{r6} {listed(c2)}")

    # G 无期次 ⇒ 不动
    a7, r7 = fn(c2, 0, "2026-10-19", "2026-10-25",
                [{"product_id": 903, "qty_by_unit": {}}], "老板")
    chk("G1 pid=0 不动清单", a7 == 0 and r7 == 0 and len(listed(c2)) == 2)

    print(f"\n{ok}/{ok + len(fail)} 通过" + (("｜失败：" + "、".join(fail)) if fail else ""))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
