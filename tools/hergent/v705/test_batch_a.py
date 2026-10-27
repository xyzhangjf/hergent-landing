#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v705 batch A 的离线验证（**不连生产**）。

覆盖七组判据：
  ① 运行器：执行 / 幂等 / 状态
  ② 指纹护栏：改历史 patch 内容 ⇒ 直接失败（这是本模块存在的唯一理由）
  ③ 失败原子性：一版里第 2 条语句坏 ⇒ 第 1 条也不许留下，且失败被记录
  ④ 未知版本：盘上删了 patch、库里执行过 ⇒ 报出来
  ⑤ SQL 切分：字符串字面量里的分号不许切错；结尾未闭合必须报错
  ⑥ 体检：缺表/缺索引/缺列/平台表例外 四类判定
  ⑦ 精度：round_money 与旧实现逐位等价；容差边界判据不变

用法：python3 test_batch_a.py
"""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from migrations import runner, doctor, dbutil  # noqa: E402

PASS, FAIL = [], []


def ok(cond, label, extra=""):
    (PASS if cond else FAIL).append(label)
    print(("✅ " if cond else "❌ ") + label + (("  ← " + str(extra)) if extra and not cond else ""))


def mkdb(path, sql=""):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path)
    if sql:
        c.executescript(sql)
    c.commit()
    c.close()


def patchdir(tmp, files):
    d = Path(tmp) / "patches"
    d.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        (d / name).write_text(body, encoding="utf-8")
    return d


BASELINE_PY = "def upgrade(conn):\n    return 'baseline'\n"


def main():
    tmp = tempfile.mkdtemp(prefix="v705-test-")

    # ---------------------------------------------------------- ① 执行 / 幂等
    print("\n=== ① 运行器：执行 / 幂等 / 状态 ===")
    pd = patchdir(tmp + "/t1", {
        "0001_baseline.py": BASELINE_PY,
        "0002_add_col.sql": "ALTER TABLE t_a ADD COLUMN v2 TEXT DEFAULT '';\n",
    })
    dbp = tmp + "/t1/a.db"
    mkdb(dbp, "CREATE TABLE t_a(id INTEGER PRIMARY KEY, v1 TEXT);")

    c = dbutil.connect_rw(dbp)
    patches = runner.discover(str(pd))
    ok([p.version for p in patches] == [1, 2], "发现 2 个 patch 且顺序正确")
    r1 = runner.apply_all(c, patches)
    ok([a["version"] for a in r1["applied"]] == [1, 2], "首次执行 1、2 两个版本")
    ok("v2" in {x[0] for x in dbutil.columns(c, "t_a")}, "ALTER 真的生效了（t_a.v2 存在）")
    r2 = runner.apply_all(c, patches)
    ok(r2["applied"] == [], "再跑一次不重复执行（幂等）")
    pl = runner.plan(c, patches)
    ok(pl["max_applied"] == 2 and not pl["pending"] and not pl["mismatch"],
       "状态：已到 v2，无待执行、无指纹冲突")
    ok(all(row["status"] == "ok" for row in pl["applied"].values()), "登记表里两条都是 ok")
    c.close()

    # ---------------------------------------------------------- ② 指纹护栏
    print("\n=== ② 指纹护栏：改历史 patch 内容 ===")
    (pd / "0002_add_col.sql").write_text(
        "ALTER TABLE t_a ADD COLUMN v2 TEXT DEFAULT 'x';\n", encoding="utf-8")
    c = dbutil.connect_rw(dbp)
    patches2 = runner.discover(str(pd))
    pl2 = runner.plan(c, patches2)
    ok([p.version for p, _ in pl2["mismatch"]] == [2], "plan 报出 v2 指纹不符")
    try:
        runner.apply_all(c, patches2)
        ok(False, "指纹不符时 apply 必须抛错")
    except runner.PatchError as e:
        ok("指纹不符" in str(e) or "内容变了" in str(e), "apply 拒绝执行并说明原因", e)
    # 已有的 v2 列没有被"重跑"抹掉，也没被重复加
    ok("v2" in {x[0] for x in dbutil.columns(c, "t_a")}, "拒绝执行后库仍是原结构（未半途改动）")
    c.close()

    # ---------------------------------------------------------- ③ 失败原子性
    print("\n=== ③ 失败原子性：一版里第 2 条语句坏 ===")
    pd3 = patchdir(tmp + "/t3", {
        "0001_baseline.py": BASELINE_PY,
        "0002_half_bad.sql": "CREATE TABLE t_probe(id INTEGER);\nINSERT INTO no_such_table VALUES(1);\n",
    })
    db3 = tmp + "/t3/a.db"
    mkdb(db3, "CREATE TABLE t_seed(id INTEGER);")
    c = dbutil.connect_rw(db3)
    p3 = runner.discover(str(pd3))
    try:
        runner.apply_all(c, p3)
        ok(False, "坏 SQL 必须抛错")
    except runner.PatchError as e:
        ok("执行失败" in str(e), "坏 SQL 抛 PatchError", e)
    tables = dbutil.table_names(c)
    ok("t_probe" not in tables, "整版回滚：t_probe 没有被留下")
    rows = runner.applied_rows(c)
    ok(rows.get(2, {}).get("status") == "failed", "失败被记进登记表（status=failed）")
    # 修好后重跑：**失败版本**改内容是被允许的 —— 它从未生效，等于还没执行过。
    # 指纹护栏保护的是「已经成功执行过的版本」，不是「执行失败的版本」。
    (Path(pd3) / "0002_half_bad.sql").write_text("CREATE TABLE t_probe(id INTEGER);\n", encoding="utf-8")
    p3b = runner.discover(str(pd3))
    r3 = runner.apply_all(c, p3b)
    ok([a["version"] for a in r3["applied"]] == [2], "失败版本改好后可原地重跑（不算改历史）")
    ok("t_probe" in dbutil.table_names(c), "重跑成功：t_probe 已建")
    ok(runner.applied_rows(c)[2]["status"] == "ok", "登记表从 failed 翻成 ok")
    c.close()

    # ---------------------------------------------------------- ④ 未知版本
    print("\n=== ④ 未知版本：盘上删掉已执行的 patch ===")
    (pd / "0002_add_col.sql").unlink()
    c = dbutil.connect_ro(dbp)
    pl4 = runner.plan(c, runner.discover(str(pd)))
    ok([r["version"] for r in pl4["unknown"]] == [2], "报出「库里执行过、盘上没有」的版本 2")
    c.close()

    # ---------------------------------------------------------- ⑤ SQL 切分
    print("\n=== ⑤ SQL 切分 ===")
    stmts = list(runner._iter_statements(
        "INSERT INTO t VALUES('a;b');\n-- 注释里的分号; 也是分号\nCREATE TABLE t2(id INTEGER);\n"))
    ok(len(stmts) == 2, "字符串里的分号没被切错（得到 2 条语句）", stmts)
    ok("'a;b'" in stmts[0], "第一条保留了 'a;b' 原文")
    try:
        list(runner._iter_statements("CREATE TABLE broken(id INTEGER\n"))
        ok(False, "未闭合语句必须报错")
    except runner.PatchError:
        ok(True, "结尾未闭合语句报错（不静默跳过）")
    stmts2 = list(runner._iter_statements("INSERT INTO t VALUES(1);\n-- 说明性尾注释\n"))
    ok(len(stmts2) == 1, "文件以注释收尾不算未闭合（不误报）", stmts2)

    # ---------------------------------------------------------- ⑥ 体检
    print("\n=== ⑥ 体检：缺表 / 缺索引 / 缺列 / 平台表例外 ===")
    master = tmp + "/doc/master.db"
    mkdb(master, """
        CREATE TABLE biz_a(id INTEGER PRIMARY KEY, v1 TEXT, v2 TEXT);
        CREATE TABLE biz_b(id INTEGER PRIMARY KEY, x TEXT);
        CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);
        CREATE INDEX idx_biz_b_x ON biz_b(x);
        CREATE INDEX idx_biz_a_v1 ON biz_a(v1);
        CREATE INDEX idx_users_name ON users(name);
        CREATE TABLE platform_only(id INTEGER);
    """)
    tenant = tmp + "/doc/tenant_9.db"
    mkdb(tenant, """
        CREATE TABLE biz_a(id INTEGER PRIMARY KEY, v1 TEXT);
        CREATE TABLE biz_b(id INTEGER PRIMARY KEY, x TEXT);
        CREATE TABLE users(id INTEGER PRIMARY KEY);   -- 遗留平台表副本（少一列、少一索引）
        CREATE TABLE tenant_extra(id INTEGER);
    """)
    mconn = dbutil.connect_ro(master)
    msnap = dbutil.snapshot(mconn)
    mconn.close()
    r = doctor.check_db("tenant_9", tenant, msnap, {"platform_only"}, [])
    ok(r["missing_tables"] == [], "平台表 platform_only 不算缺表", r["missing_tables"])
    ok([x["index"] for x in r["missing_indexes"]] == ["idx_biz_a_v1", "idx_biz_b_x", "idx_users_name"],
       "缺三个索引（且 index 只在表存在时才报）", [x["index"] for x in r["missing_indexes"]])
    ok(r["missing_columns"] == ["biz_a.v2", "users.name"], "缺列判为 biz_a.v2 与 users.name", r["missing_columns"])
    ok(r["extra_tables"] == ["tenant_extra"], "租户独有表只作为信息，不算故障", r["extra_tables"])
    ok(not r["ok"], "有缺索引 ⇒ 整体判为不干净")
    # 平台表未被排除时应当报缺表
    r2 = doctor.check_db("tenant_9", tenant, msnap, set(), [])
    ok(r2["missing_tables"] == ["platform_only"], "不排除平台表时会报出来（说明清单真的在起作用）")

    # 遗留平台表副本：单独归类，不再刷成"缺列/缺索引"
    r3 = doctor.check_db("tenant_9", tenant, msnap, {"platform_only"}, [],
                         legacy_copies={"users"})
    ok(r3["legacy_platform_copies"] == ["users"], "遗留平台表副本被单独识别", r3["legacy_platform_copies"])
    ok(r3["missing_columns"] == ["biz_a.v2"], "遗留副本不再刷成缺列（噪音不淹真问题）", r3["missing_columns"])
    ok("idx_users_name" not in [x["index"] for x in r3["missing_indexes"]],
       "遗留副本也不再要求有主库的索引")

    # ---------------------------------------------------------- ⑦ 精度
    print("\n=== ⑦ 精度：round_money 与旧实现逐位等价 ===")
    sys.path.insert(0, str(HERE))
    from precision import (MONEY_EPS, MONEY_EPS_CENTS, money_balanced, money_eq,
                           qty_eq, round_money, to_cents)

    def old_money(x):
        try:
            return round(float(x or 0), 2)
        except (ValueError, TypeError):
            return 0.0

    corpus = [0, 1, -1, 0.005, 1.005, -0.005, 2.675, 0.1 + 0.2, None, "", "abc",
              "1.115", 1e-9, -1e-9, 1e15, 123456.789, True, False, "12.345"]
    diffs = [(x, old_money(x), round_money(x)) for x in corpus if old_money(x) != round_money(x)]
    ok(diffs == [], "19 个样本（含 .xx5 边界、None、字符串、布尔）逐位一致", diffs)
    # v706 修掉了那个浮点缺陷（batch A 时刻意保留为证据）：
    #   老判据 abs(100.00-99.99) = 0.010000000000005116 > 0.01 ⇒ 判不平（拒单）；
    #   而 abs(1234.56-1234.55) = 0.010000000000000009 <= 0.01 ⇒ 判平。
    #   同样差 1 分结论相反，取决于二进制表示 —— 现在统一按整数分判。
    ok(money_balanced(100.00, 99.99) is True, "修好后：恰好差 1 分判为平衡（原先因浮点判不平）")
    ok(money_balanced(1234.56, 1234.55) is True, "同样是 1 分差，与上一行结论一致（不再看二进制）")
    ok(abs(float(100.00) - float(99.99)) > MONEY_EPS,
       "并留证据：老式浮点判据在这组数上仍会判不平衡（说明修复的是真问题）")
    ok(money_balanced(100.00, 99.98) is False, "差额 2 分 ⇒ 判为不平衡")
    ok(money_balanced(1000000.00, 999999.99) is True, "七位金额差 1 分同样判平（大数也稳）")
    ok(money_balanced(0.1 + 0.2, 0.3) is True, "0.1+0.2 与 0.3 判为相等（容差吸收浮点尾差）")
    ok(money_eq(100.00, 99.99) is False, "money_eq 按分严格比：差 1 分就是不相等")
    ok(money_eq(0.1 + 0.2, 0.3) is True, "money_eq 不受浮点尾差影响")
    ok(to_cents(2.675) == 267 and to_cents(100.00) == 10000, "to_cents 先 round 再取整（2.675→267，不丢分）")
    ok(qty_eq(12, 12 + 1e-9) is True and qty_eq(12, 13) is False, "qty_eq 容差判据正确")
    ok(MONEY_EPS == 0.01, "MONEY_EPS = 0.01（1 分）")
    ok(MONEY_EPS_CENTS == 1, "MONEY_EPS_CENTS = 1（整数分口径，money_balanced 实际用它）")
    ok(money_balanced(2.675, 2.66) is True,
       "三分位输入（2.675）按分规整后只差 1 分 ⇒ 判平（金额最小单位就是分）")

    print("\n" + "=" * 60)
    print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
    if FAIL:
        print("失败项：")
        for f in FAIL:
            print("  - " + f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
