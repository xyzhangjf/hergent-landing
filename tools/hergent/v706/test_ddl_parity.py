#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`extract_ddl_schema.py` + `check_ddl_parity.py` 的离线验证（**不连生产**）。

诊断类工具最危险的失败模式不是报错，而是**恒绿**：明明有故障却什么都不说。
所以这里的重点是"造一个已知缺陷的库快照，看它能不能指出来，以及能不能不冤枉别的东西"。

判据：
  ① 抽取：CREATE TABLE 解析出列；`ADD COLUMN {变量}` 不许被当成"列名叫 column"
  ② 抽取：带函数名（否则无法区分懒建与真无人建）
  ③ 对账：租户库缺表 ⇒ 1 处故障、退出码 2；主库有租户无 ⇒ 故障；反过来不报
  ④ 对账：`_init_*` 里的表全库缺失 ⇒ **不算故障**（按需懒建）
  ⑤ 对账：独立库模块（memory.py 等）的表 ⇒ 不算故障
  ⑥ 对账：只有主库缺列 ⇒ 归"主库滞后"，不算故障；任一租户缺列 ⇒ 故障
  ⑦ 负向自检：全绿场景退出 0（证明不是恒红）

用法：
    python3 test_ddl_parity.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent          # <repo>/tools/hergent/v706
ROOT = HERE.parent.parent.parent                # <repo>
EXTRACT = HERE / "extract_ddl_schema.py"
CHECK = HERE / "check_ddl_parity.py"

PASS, FAIL = [], []


def ok(cond, msg, detail=""):
    (PASS if cond else FAIL).append(msg)
    print(("  ✅ " if cond else "  ❌ ") + msg + (("   ← %s" % detail) if (detail and not cond) else ""))


SRC = '''\
def _init_qms_tables():
    with get_db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS inspection_plans (
            id INTEGER PRIMARY KEY, name TEXT)""")


def normal_thing():
    with get_db() as db:
        db.execute("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, amount REAL)")


def loop_cols(cols):
    for c in cols:
        db.execute(f"ALTER TABLE orders ADD COLUMN {c} TEXT")


def add_real_col():
    db.execute("ALTER TABLE orders ADD COLUMN real_col TEXT DEFAULT ''")
'''

SRC_OTHER_DB = '''\
DB_PATH = os.path.join(os.path.dirname(__file__), "dami_memory.db")
db.execute("CREATE TABLE IF NOT EXISTS patterns (id INTEGER PRIMARY KEY, t TEXT)")
'''


def run(cmd, *args):
    r = subprocess.run([sys.executable, str(cmd), *args], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def schema_master(extra_table=True, orders_cols=("id", "amount", "real_col")):
    m = {"inspection_plans": ["id", "name"], "orders": list(orders_cols)}
    if extra_table:
        m["only_master"] = ["id"]
    return m


def main():
    print("=" * 74)
    print("账外 DDL 抽取 / 对账工具 · 离线验证")
    print("=" * 74)
    tmp = tempfile.mkdtemp()
    try:
        src = Path(tmp) / "src"
        src.mkdir()
        (src / "code.py").write_text(SRC, encoding="utf-8")
        (src / "memory.py").write_text(SRC_OTHER_DB, encoding="utf-8")

        ddl = Path(tmp) / "ddl.json"
        rc, out = run(EXTRACT, str(src), "-o", str(ddl))
        ok(rc == 0, "抽取退出 0", out[-200:])
        d = json.loads(ddl.read_text(encoding="utf-8"))

        print("\n=== ① 抽取正确性 ===")
        ok("inspection_plans" in d["tables"] and "orders" in d["tables"],
           "两张表都抽到", list(d["tables"]))
        # CREATE TABLE 里声明的列进 cols；ALTER 加的列进 columns（两条独立口径，别混）
        ok(set(d["tables"]["orders"]["cols"]) >= {"id", "amount"},
           "orders 的 CREATE 列解出来", d["tables"]["orders"]["cols"])
        ok({"orders", "real_col"} and "orders.real_col" in d["columns"], "ALTER 列进清单")
        ok("orders.column" not in d["columns"],
           "`ADD COLUMN {c}` 不被误当成「列名叫 column」", list(d["columns"]))
        ok(any("ADD COLUMN" in x["text"] for x in d["dynamic"]),
           "拼接列名被记进 dynamic（不静默丢）", d["dynamic"])

        print("\n=== ② 带函数名（区分懒建 / 真无人建）===")
        ok(any("_init_qms_tables" in f for f in d["tables"]["inspection_plans"]["funcs"]),
           "inspection_plans 标注了 _init_qms_tables", d["tables"]["inspection_plans"]["funcs"])

        print("\n=== ③ 真故障必须被指出（声明的表在租户库缺失）===")
        scen = Path(tmp) / "s1.json"
        scen.write_text(json.dumps({
            "erp.db": schema_master(),
            # 故意让 tenant_1 少一张**已声明**的表 orders
            "tenant_1.db": {"inspection_plans": ["id", "name"]},
        }), encoding="utf-8")
        rc, out = run(CHECK, "--ddl", str(ddl), "--schema", str(scen), "--fail-on-fault")
        ok(rc == 2, "有故障时 --fail-on-fault 退出 2", rc)
        ok("缺表" in out and "orders" in out, "报出租户库缺表 orders", out[-500:])

        print("\n=== ④ 懒建表全库缺失 ⇒ 不算故障 ===")
        scen_l = Path(tmp) / "sl.json"
        scen_l.write_text(json.dumps({
            "erp.db": {"orders": ["id", "amount", "real_col"]},
            "tenant_1.db": {"orders": ["id", "amount", "real_col"]},
        }), encoding="utf-8")
        rc, out = run(CHECK, "--ddl", str(ddl), "--schema", str(scen_l))
        ok("其中真故障 0 张" in out, "inspection_plans 未计入真故障", out[:400])
        ok("inspection_plans(_init_qms_tables)" in out, "归入「按需懒建」", out[:900])
        ok("patterns(memory.py)" in out, "patterns 归入「建在独立库」（不算故障）", out[:1000])

        print("\n=== ⑤ 缺列：主库滞后 vs 租户真缺 ===")
        scen2 = Path(tmp) / "s2.json"
        scen2.write_text(json.dumps({
            "erp.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount"]},
            "tenant_1.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount", "real_col"]},
        }), encoding="utf-8")
        rc, out = run(CHECK, "--ddl", str(ddl), "--schema", str(scen2))
        ok("真故障 0 处" in out, "只有主库缺列 ⇒ 真故障 0", rc)
        ok("orders.real_col" in out and "只有主库缺" in out, "归入「只有主库缺、租户库都有」", out[-500:])

        print("\n=== ⑥ 租户也缺 ⇒ 必须是故障 ===")
        scen3 = Path(tmp) / "s3.json"
        scen3.write_text(json.dumps({
            "erp.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount"]},
            "tenant_1.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount"]},
            "tenant_10.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount"]},
        }), encoding="utf-8")
        rc, out = run(CHECK, "--ddl", str(ddl), "--schema", str(scen3), "--fail-on-fault")
        ok(rc == 2, "两个租户都缺 ⇒ 退出 2", rc)
        ok("orders" in out and "real_col" in out, "报出 orders.real_col 缺于租户", out[-400:])

        print("\n=== ⑦ 全绿时不许恒红 ===")
        scen4 = Path(tmp) / "s4.json"
        scen4.write_text(json.dumps({
            "erp.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount", "real_col"]},
            "tenant_1.db": {"inspection_plans": ["id", "name"], "orders": ["id", "amount", "real_col"]},
        }), encoding="utf-8")
        rc, out = run(CHECK, "--ddl", str(ddl), "--schema", str(scen4), "--fail-on-fault")
        ok(rc == 0, "无故障时退出 0", out[-300:])
        ok("真故障 0 处" in out, "结论写 0 处故障")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "=" * 74)
    print("通过 %d / 失败 %d" % (len(PASS), len(FAIL)))
    if FAIL:
        print("失败项：" + "; ".join(FAIL))
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
