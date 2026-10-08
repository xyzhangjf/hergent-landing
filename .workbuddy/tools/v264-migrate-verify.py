#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v264 迁移沙箱验证（商品目标管理 P0）—— **不碰生产**。

做法：把 `ERP_DB_PATH` 指到一个空目录再 `import erp_db`，让真实的 `init_db()` +
启动期 schema 对账在**隔离库**上跑一遍，然后逐项断言：
  ① product_targets / product_target_alloc 两张表 + 索引建出来了
  ② rebate_achievements.actual_unit / forecast_extra_qty.source 两列补上了
  ③ `_migrations` 三条记录 status='ok'（没有 FAILED 落库）
  ④ 冷启动写进去的数据，热启动后**还在**（没有被重建抹掉）

🔴 为什么必须实测而不是只 `py_compile`：`_safe_migrate*` 在模块加载期执行，
   一旦 DDL 语法错 / 顺序错（如 ALTER 的表还没建），它只往 stderr 打一行
   `[Migration] FAILED ...` 就**继续往下跑** —— py_compile 完全看不出来。

⚠️ 沙箱主库是空库，日志里 `no such table: users` 一类 FAILED 属**环境差异**
   （users 是主库专属表，生产上早已存在），与本批无关。本脚本只认 v264_*。
"""
import contextlib
import io
import os
import shutil
import sqlite3
import sys

SANDBOX = "/tmp/v264-migrate-sandbox"
BE = "/Users/zhangjunfeng/Documents/hergent-erp"
DB = os.path.join(SANDBOX, "erp.db")

TABLES = ["product_targets", "product_target_alloc"]
INDEXES = ["uq_product_target_month", "idx_pt_month", "uq_pt_alloc", "idx_pta_emp"]
COLS = [("rebate_achievements", "actual_unit"), ("forecast_extra_qty", "source")]
MIGRATIONS = ["v264_product_targets", "v264_rba_actual_unit", "v264_feq_source"]

fails = []


def run_init():
    """在沙箱里跑一次 erp_db 模块加载（= 真实启动路径）。

    ⚠️ 空库冷启动会刷出大量 `[Migration] FAILED ... no such table: products/users/...`
    —— 那是**沙箱环境差异**（既有历史迁移依赖生产主库早已存在的表），与本批无关。
    这些行由 `print(..., file=sys.stderr)` 发出（运行期取 sys.stderr）⇒ 用 redirect 捕获后
    **只留含 v264 的行**；同时落一份全量日志到 `/tmp/v264-migrate-sandbox/boot.log` 备查。
    """
    for m in list(sys.modules):
        if m.split(".")[0] in ("erp_db", "db", "core", "crypto_utils"):
            del sys.modules[m]
    sys.path.insert(0, os.path.join(BE, "server"))
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(buf):
        import erp_db  # noqa: F401
    log = buf.getvalue()
    with open(os.path.join(SANDBOX, "boot.log"), "a", encoding="utf-8") as fh:
        fh.write("\n===== boot =====\n" + log)
    for line in log.splitlines():
        if "v264" in line:
            print("   [启动日志·v264] " + line.strip())


def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def check_schema(tag):
    c = conn()
    have_t = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    have_i = {r["name"] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    for t in TABLES:
        if t not in have_t:
            fails.append("[%s] 缺表 %s" % (tag, t))
    for ix in INDEXES:
        if ix not in have_i:
            fails.append("[%s] 缺索引 %s" % (tag, ix))
    for tbl, col in COLS:
        if tbl not in have_t:
            fails.append("[%s] 缺表 %s（列检查前置）" % (tag, tbl))
            continue
        cols = {r["name"] for r in c.execute("PRAGMA table_info(%s)" % tbl).fetchall()}
        if col not in cols:
            fails.append("[%s] 缺列 %s.%s" % (tag, tbl, col))
    if "product_targets" in have_t:
        il = {r["name"]: r["unique"] for r in
              c.execute("PRAGMA index_list(product_targets)").fetchall()}
        if il.get("uq_product_target_month") != 1:
            fails.append("[%s] uq_product_target_month 不是 UNIQUE" % tag)
        il2 = {r["name"]: r["unique"] for r in
               c.execute("PRAGMA index_list(product_target_alloc)").fetchall()}
        if il2.get("uq_pt_alloc") != 1:
            fails.append("[%s] uq_pt_alloc 不是 UNIQUE" % tag)
    for m in MIGRATIONS:
        r = c.execute("SELECT status FROM _migrations WHERE name=?", (m,)).fetchone()
        if not r:
            fails.append("[%s] _migrations 无记录 %s" % (tag, m))
        elif r["status"] != "ok":
            fails.append("[%s] 迁移 %s status=%s（应为 ok）" % (tag, m, r["status"]))
    c.close()


def check_rw():
    """只在冷启动后跑一次：真写一行、读回来、并验证 UNIQUE 拦得住重复。"""
    c = conn()
    c.execute("INSERT INTO product_targets (name,period_month,product_id,target_qty) "
              "VALUES ('沙箱目标','2026-09',999999,150)")
    c.commit()   # 🔴 必须先提交：下面的 UNIQUE 冲突分支会 rollback，否则把这一行一起回滚掉
    row = c.execute("SELECT id,name,target_qty,status FROM product_targets "
                    "WHERE product_id=999999").fetchone()
    if not row or abs(row["target_qty"] - 150) > 1e-9:
        fails.append("product_targets 读写异常")
        c.close()
        return 0
    try:
        c.execute("INSERT INTO product_targets (name,period_month,product_id) "
                  "VALUES ('重复','2026-09',999999)")
        c.commit()
        fails.append("uq_product_target_month 未拦住重复 (月,商品)")
    except sqlite3.IntegrityError:
        c.rollback()
    tid = row["id"]
    for eid, nm, rt, tq in ((1, '张三', 60.0, 90.0), (2, '李四', 40.0, 60.0)):
        c.execute("INSERT INTO product_target_alloc "
                  "(target_id,employee_id,employee_name,ratio,target_qty) VALUES (?,?,?,?,?)",
                  (tid, eid, nm, rt, tq))
    c.commit()
    s = c.execute("SELECT SUM(ratio) r, COUNT(*) n, SUM(target_qty) q "
                  "FROM product_target_alloc WHERE target_id=?", (tid,)).fetchone()
    if abs(s["r"] - 100.0) > 1e-9 or s["n"] != 2 or abs(s["q"] - 150.0) > 1e-9:
        fails.append("product_target_alloc 汇总异常 %s" % dict(s))
    # 明细也受 UNIQUE(target_id,employee_id) 约束
    try:
        c.execute("INSERT INTO product_target_alloc (target_id,employee_id,ratio) "
                  "VALUES (?,?,?)", (tid, 1, 10.0))
        c.commit()
        fails.append("uq_pt_alloc 未拦住同人重复分解")
    except sqlite3.IntegrityError:
        c.rollback()
    c.close()
    return tid


print("=" * 74)
print("沙箱：%s" % DB)
shutil.rmtree(SANDBOX, ignore_errors=True)
os.makedirs(SANDBOX)
os.environ["ERP_DB_PATH"] = DB

print("\n--- 第 1 遍：空目录冷启动 ---")
run_init()
check_schema("run1")
tid = check_rw()

print("\n--- 第 2 遍：已有库热启动（幂等）---")
run_init()
check_schema("run2")

c = conn()
t1 = c.execute("SELECT COUNT(*) c FROM product_targets").fetchone()["c"]
t2 = c.execute("SELECT COUNT(*) c FROM product_target_alloc").fetchone()["c"]
c.close()
if t1 != 1 or t2 != 2:
    fails.append("幂等失败：热启动后 targets=%d alloc=%d（应仍为 1/2，数据不该被抹）" % (t1, t2))
else:
    print("   数据完好：product_targets=%d 行 · product_target_alloc=%d 行（target_id=%s）" % (t1, t2, tid))

print("\n" + "=" * 74)
if fails:
    print("❌ 失败 %d 项：" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("✅ 全绿：2 张表 + 4 个索引 + 2 个补列 + 3 条迁移 ok + UNIQUE 生效 + 热启动幂等")
print("=" * 74)
