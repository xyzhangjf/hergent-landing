#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v706 第②步（遗留副本清理）的离线验证（**不连生产**）。

三组判据：
  ① 建库复制口径：`tenant_db_init` 的复制循环**不再**把平台表建进新租户库
     —— 这段逻辑直接从被 patch 过的源码里抠出来跑，避免"测的是另写一份"
  ② DROP patch 0003：主库跳过（一行不动）/ 租户库删净 / 行数记账 / 回读核对
  ③ fail-closed：判不出主库路径时**拒绝执行**，而不是猜

用法：
    python3 test_legacy_cleanup.py [--src .tmp-audit]
"""
import argparse
import logging
import os
import re
import sqlite3
import sys
import tempfile
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / ".." / "v705"))
sys.path.insert(0, str(HERE / ".." / "v705" / "migrations" / "patches"))

PASS, FAIL = [], []


def ok(cond, label, extra=""):
    (PASS if cond else FAIL).append(label)
    print(("✅ " if cond else "❌ ") + label + (("  ← " + str(extra)) if extra else ""))


def extract_copy_block(src_path):
    """从 erp_db.py 里抠出 tenant_db_init 的复制循环（被 patch 过的那段）。"""
    lines = Path(src_path).read_text(encoding="utf-8").split("\n")
    start = None
    for i, l in enumerate(lines):
        if "Copy schema only (no data)" in l:
            start = i
            break
    if start is None:
        return None
    for j in range(start, min(start + 40, len(lines))):
        if "tenant_db.commit()" in lines[j]:
            return "\n".join(lines[start:j])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".tmp-audit", help="已打过 v706 补丁的后端源码目录")
    a = ap.parse_args()

    # ---------------------------------------------- ① 建库复制口径
    print("\n=== ① 新租户建库不再复制平台表 ===")
    src = Path(a.src) / "erp_db.py"
    if not src.exists():
        print("❌ 找不到 %s（先跑 patch_v706_legacy_copies.py --root=%s）" % (src, a.src))
        return 1
    block = extract_copy_block(src)
    ok(block is not None, "从 patched erp_db.py 抠到复制循环")
    if not block:
        return 1
    ok("_platform_skip" in block, "复制循环里带平台表跳过集")

    tmp = tempfile.mkdtemp(prefix="v706-copy-")
    master_p = os.path.join(tmp, "erp.db")
    tenant_p = os.path.join(tmp, "tenant_99.db")
    m = sqlite3.connect(master_p)
    m.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
        CREATE UNIQUE INDEX uq_users_username ON users(username);
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER);
        CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE user_tenants (user_id INTEGER, tenant_id INTEGER);
        CREATE TABLE invite_codes (code TEXT PRIMARY KEY);
        CREATE TABLE invite_uses (id INTEGER PRIMARY KEY);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
        CREATE INDEX idx_products_name ON products(name);
        INSERT INTO users (username) VALUES ('admin'), ('boss');
    """)
    m.commit()
    t = sqlite3.connect(tenant_p)
    ns = {"re": re, "logging": logging, "master_db": m, "tenant_db": t}
    exec(textwrap.dedent(block), ns)   # ← 跑的就是生产里那段代码（dedent 只为能顶层 exec）
    names = {r[0] for r in t.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    idxs = {r[0] for r in t.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")}
    ok("products" in names, "业务表照常复制")
    ok("users" not in names, "users 未被建进租户库", sorted(names))
    ok("sessions" not in names and "tenants" not in names and "user_tenants" not in names,
       "sessions / tenants / user_tenants 均未复制", sorted(names))
    ok("invite_codes" not in names and "invite_uses" not in names, "invite_* 未复制", sorted(names))
    ok("idx_products_name" in idxs, "业务表索引照常复制", sorted(idxs))
    ok("uq_users_username" not in idxs, "平台表上的索引也跳过（否则复制会报 no such table）")
    ok(t.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0, "只复制结构不复制数据")
    t.close() if hasattr(t, "close") else None
    m.close()

    # ---------------------------------------------- ② DROP patch 0003
    print("\n=== ② patch 0003：主库跳过 / 租户库删净 / 行数记账 ===")
    from migrations import runner  # noqa: E402
    patches = [p for p in runner.discover() if p.version == 3]
    ok(bool(patches), "发现 patch 0003")
    if not patches:
        return 1

    # 造一套 <tmp>/erp.db + tenant_7.db，并把 ERP_DB_PATH 指向它 ⇒ 主库判定走真实逻辑
    root = tempfile.mkdtemp(prefix="v706-drop-")
    master = os.path.join(root, "erp.db")
    c = sqlite3.connect(master)
    c.executescript("""
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
        CREATE TABLE sessions (token TEXT PRIMARY KEY);
        CREATE TABLE products (id INTEGER PRIMARY KEY);
        INSERT INTO users (username, password_hash) VALUES ('admin','bcrypt$1');
    """)
    c.commit()
    c.close()

    old_env = os.environ.get("ERP_DB_PATH")
    os.environ["ERP_DB_PATH"] = master
    try:
        cm = sqlite3.connect(master, isolation_level=None)
        cm.row_factory = sqlite3.Row
        runner.apply_all(cm, patches)
        note = cm.execute("SELECT note FROM schema_patches WHERE version=3").fetchone()["note"]
        ok("master" in note, "主库被跳过并记账", note)
        ok(cm.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1, "主库 users 一行未动")
        cm.close()

        tenant = os.path.join(root, "tenant_7.db")
        c = sqlite3.connect(tenant, isolation_level=None)
        c.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT);
            CREATE TABLE sessions (token TEXT PRIMARY KEY);
            CREATE TABLE tenants (id INTEGER PRIMARY KEY);
            CREATE TABLE user_tenants (user_id INTEGER);
            CREATE TABLE products (id INTEGER PRIMARY KEY);
            INSERT INTO users (username, password_hash)
                 VALUES ('admin','bcrypt$a'),('boss','bcrypt$b');
            INSERT INTO sessions (token) VALUES ('t1'),('t2'),('t3');
        """)
        c.close()

        c = sqlite3.connect(tenant, isolation_level=None)
        c.row_factory = sqlite3.Row
        runner.apply_all(c, patches)
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        ok("users" not in names and "sessions" not in names and "tenants" not in names
           and "user_tenants" not in names, "租户库 4 张副本已删除", sorted(names))
        ok("products" in names, "业务表不受影响")
        note = c.execute("SELECT note FROM schema_patches WHERE version=3").fetchone()["note"]
        ok("users(2行)" in note and "sessions(3行)" in note, "删前行数记进 note", note)
        ok("本就没有 invite_codes" in note, "本来没有的表如实记为「本就没有」", note)
        c.close()

        # ---------------------------------------------- ③ fail-closed
        print("\n=== ③ 判不出主库路径 ⇒ 拒绝执行 ===")
        # patch 模块名以数字开头、`patches/` 也不是包 ⇒ 不能用 import_module，按文件加载
        # （与 runner._run_py_patch 同一种加载方式，测的才是生产真正会跑的那份）。
        import importlib.util
        p3_path = HERE.parent / "v705" / "migrations" / "patches" / \
            "0003_drop_legacy_platform_copies.py"
        spec = importlib.util.spec_from_file_location("hg_patch_0003_t", str(p3_path))
        p3 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(p3)

        # 重建一台带副本的租户库（上一步已删净），用来验证"拒绝执行时一行不动"
        victim = os.path.join(root, "tenant_8.db")
        v = sqlite3.connect(victim, isolation_level=None)
        v.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
            INSERT INTO users (username) VALUES ('admin');
        """)
        v.row_factory = sqlite3.Row
        saved = p3._master_file
        p3._master_file = lambda: ""
        try:
            try:
                p3.upgrade(v)
                ok(False, "应当拒绝执行")
            except RuntimeError as e:
                ok("拒绝执行" in str(e), "主库路径不可知时抛错而非猜", str(e)[:60])
            ok(v.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1,
               "拒绝执行时一行未动（fail-closed 不留半截）")
        finally:
            p3._master_file = saved
            v.close()
    finally:
        if old_env is None:
            os.environ.pop("ERP_DB_PATH", None)
        else:
            os.environ["ERP_DB_PATH"] = old_env

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
