#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""0002（补租户库索引）的离线验证（**不连生产**）。

覆盖五组判据：
  ① 补齐：一台缺全部 9 个索引的库，跑完 9 个全在，且该唯一的确实是 UNIQUE
  ② 幂等：同一台库跑第二遍 ⇒ 0 动作、不报错、不重复登记
  ③ 缺表：表不存在 ⇒ 跳过并记账，不崩（缺表归 doctor 的「缺表」那一类）
  ④ 同名非唯一索引：`IF NOT EXISTS` 会静默跳过 ⇒ 必须报错，且整版回滚
     （这是本 patch 唯一会产生"看起来成功"的路径，必须被拦住）
  ⑤ 主库形状：已有全部索引的库上跑 ⇒ note 写"无（已全部存在）"

用法：python3 test_patch_0002.py
"""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from migrations import runner  # noqa: E402
from migrations.patches import __path__ as _p  # noqa: E402

PASS, FAIL = [], []


def ok(cond, label, extra=""):
    (PASS if cond else FAIL).append(label)
    print(("✅ " if cond else "❌ ") + label + (("  ← " + str(extra)) if extra and not cond else ""))


# 与 0002 里的 INDEXES 同源：这里刻意复述一遍表/列，而不是 import 常量 ——
# 若有人改了 patch 的索引定义而没改测试，测试要能发现，而不是跟着一起变。
EXPECT = {
    "idx_admin_audit_created": ("admin_audit", False),
    "idx_admin_audit_target": ("admin_audit", False),
    "idx_caliber_pk_bk": ("industry_caliber", True),
    "idx_prc_user_open": ("password_reset_codes", False),
    "ix_fte_doc": ("forecast_template_exports", False),
    "ix_fte_fp": ("forecast_template_exports", False),
    "idx_pta_emp": ("product_target_alloc", False),
    "idx_pt_month": ("product_targets", False),
    "uq_product_target_month": ("product_targets", True),
}

SCHEMA = """
CREATE TABLE admin_audit (id INTEGER PRIMARY KEY, target_type TEXT, target_id INTEGER, created_at TEXT);
CREATE TABLE industry_caliber (id INTEGER PRIMARY KEY, param_key TEXT NOT NULL, bucket TEXT DEFAULT '');
CREATE TABLE password_reset_codes (id INTEGER PRIMARY KEY, user_id INTEGER, used_at TEXT);
CREATE TABLE forecast_template_exports (id INTEGER PRIMARY KEY, prefix TEXT, arrival_date TEXT,
    seq_from INTEGER, seq_to INTEGER, period_id INTEGER, fingerprint TEXT);
CREATE TABLE product_target_alloc (id INTEGER PRIMARY KEY, employee_id INTEGER, store_id INTEGER);
CREATE TABLE product_targets (id INTEGER PRIMARY KEY, period_month TEXT, product_id INTEGER,
    status TEXT DEFAULT 'active');
"""


def connect(path):
    c = sqlite3.connect(path, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    return c


def idx_names(c):
    return {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")}


def idx_sql(c, name):
    r = c.execute("SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (name,)).fetchone()
    return r[0] if r else None


def main():
    patches = runner.discover()
    v2 = [p for p in patches if p.version == 2]
    if not v2:
        print("❌ 找不到 patch 0002（patches 目录：%s）" % _p[0])
        return 1
    one = [v2[0]]

    tmp = tempfile.mkdtemp(prefix="v705-p2-")

    # ---------------------------------------------------- ① 补齐
    print("\n=== ① 缺 9 个索引的库 → 全部补齐 ===")
    p1 = os.path.join(tmp, "a.db")
    c = connect(p1)
    ok(idx_names(c) == set(), "起始状态：0 个索引")
    res = runner.apply_all(c, one)
    ok(res["applied"] and res["applied"][0]["version"] == 2, "登记为已执行 0002")
    got = idx_names(c)
    ok(got == set(EXPECT), "9 个索引全部存在", sorted(set(EXPECT) - got))
    for name, (_tbl, uniq) in EXPECT.items():
        sql = idx_sql(c, name) or ""
        ok(("UNIQUE" in sql.upper()) == uniq, "%s 唯一性正确（%s）" % (name, "唯一" if uniq else "普通"))
    ok(len([r for r in c.execute("SELECT name FROM sqlite_master WHERE type='index' "
                                 "AND name NOT LIKE 'sqlite_%'")]) == 9, "没有多建索引")
    c.close()

    # ---------------------------------------------------- ② 幂等
    print("\n=== ② 同一台库跑第二遍：0 动作 ===")
    c = sqlite3.connect(p1, isolation_level=None)
    c.row_factory = sqlite3.Row
    res2 = runner.apply_all(c, one)
    ok(res2["applied"] == [], "第二遍无动作（不重复执行）", res2)
    pl = runner.plan(c, one)
    ok(not pl["pending"] and not pl["mismatch"] and not pl["failed"], "状态干净", pl["pending"])
    ok(len([r for r in c.execute("SELECT * FROM schema_patches")]) == 1, "登记表仍只有 1 行")
    row = c.execute("SELECT note FROM schema_patches WHERE version=2").fetchone()
    # 第二遍没执行 ⇒ 首跑的 note 必须原样保留（"幂等"不等于"把历史改写成看起来没干活"）
    ok("新建=" in (row["note"] or "") and "*" in (row["note"] or ""),
       "note 保留首跑记录（未被第二遍改写）", row["note"])
    c.close()

    # ---------------------------------------------------- ③ 缺表
    print("\n=== ③ 缺表 ⇒ 跳过并记账，不崩 ===")
    p2 = os.path.join(tmp, "b.db")
    c = connect(p2)
    c.execute("DROP TABLE admin_audit")
    res = runner.apply_all(c, one)
    ok(bool(res["applied"]), "其余表照常建索引")
    got = idx_names(c)
    ok("idx_admin_audit_created" not in got and "idx_admin_audit_target" not in got, "缺表的两条被跳过")
    ok(len(got) == 7, "建了 7 个（9-2）", sorted(got))
    note = c.execute("SELECT note FROM schema_patches WHERE version=2").fetchone()["note"]
    ok("跳过=" in (note or "") and "admin_audit" in (note or ""), "跳过项写进 note", note)
    c.close()

    # ---------------------------------------------------- ④ 同名非唯一索引
    print("\n=== ④ 同名非唯一索引 ⇒ 报错 + 整版回滚 ===")
    p3 = os.path.join(tmp, "c.db")
    c = connect(p3)
    # 先造出"同名但非唯一"的 idx_caliber_pk_bk —— IF NOT EXISTS 会因此静默跳过
    c.execute("CREATE INDEX idx_caliber_pk_bk ON industry_caliber(param_key)")
    try:
        runner.apply_all(c, one)
        ok(False, "应当抛错")
    except runner.PatchError as e:
        ok("UNIQUE" in str(e), "报错指出唯一性不符", str(e)[:80])
    got = idx_names(c)
    ok(got == {"idx_caliber_pk_bk"}, "整版回滚：其余 8 个索引没有留下", sorted(got))
    row = c.execute("SELECT status, error FROM schema_patches WHERE version=2").fetchone()
    ok(row is not None and row["status"] == "failed", "失败被登记（不会被静默重试）", row and dict(row))
    ok("UNIQUE" in (row["error"] or ""), "失败原因落库")
    c.close()

    # ---------------------------------------------------- ⑤ 主库形状
    print("\n=== ⑤ 已有全部索引（主库形状）⇒ 空操作 ===")
    p4 = os.path.join(tmp, "d.db")
    c = connect(p4)
    for name, (_tbl, _u) in EXPECT.items():
        pass
    # 用 patch 自己建一遍，再清登记表模拟"索引已存在但未登记"
    runner.apply_all(c, one)
    c.execute("DELETE FROM schema_patches")
    res = runner.apply_all(c, one)
    ok(len(res["applied"]) == 1, "仍登记了 0002（记录起点）")
    note = c.execute("SELECT note FROM schema_patches WHERE version=2").fetchone()["note"]
    ok("无（已全部存在）" in (note or ""), "note 写「已全部存在」", note)
    ok(len(idx_names(c)) == 9, "索引数没变")
    c.close()

    print("\n" + "=" * 60)
    print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
    if FAIL:
        print("失败：")
        for f in FAIL:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
