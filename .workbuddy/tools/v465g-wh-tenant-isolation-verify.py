#!/usr/bin/env python
"""v465g 验收 —— P1 懒建表的多租户隔离缺陷（`_ensure_wh` 进程级缓存）。

跑法：
    SRC=/tmp/v465f-shadow-src \
    /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v465g-wh-tenant-isolation-verify.py

缺陷：`db/queries/wh.py::_ensure_wh()` 原用**进程级**布尔 `_ensured` 做幂等缓存，
      而 `wh_*` 表是**每租户库一套** ⇒ 只有**第一个**调用它的租户真的建了表，
      其余租户被 `_ensured=True` 跳过 ⇒ 出库 / 其它出入库 / 盘点对「除首个租户外」
      的所有租户一路 500 `no such table: wh_*`。

判别力（本脚本的核心）：
  · 单租户测试**测不出**这个缺陷（P1 影子验收 135/135 全绿就是这么漏掉的）
    ⇒ 必须**两个租户、两种顺序**都跑，并断言**两个库都有表**。
  · 相位反转：把 `_ensured` 还原成缓存语义（本脚本内联复刻旧实现）⇒
    第二个租户**必然缺表**，证明这个断言真的能抓住该缺陷。
"""
import ast
import os
import shutil
import sqlite3
import sys

SRC = os.environ.get("SRC", "/tmp/v465f-shadow-src")
WORK = os.environ.get("WORK", "/tmp/v465g-shadow")
SERVER_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"

WH_TABLES = ["wh_outbound_orders", "wh_outbound_items", "wh_stock_entries",
             "wh_stock_entry_items", "wh_stock_takes", "wh_stock_take_items"]

PASS, FAIL = [], []


def ok(name, cond, got=None):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + ("" if cond else f"   ← got={got!r}"))
    return cond


def section(t):
    print(f"\n{'─' * 72}\n{t}\n{'─' * 72}")


def tables_of(path):
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return sorted(r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'wh_%'"))
    finally:
        c.close()


# ══════════════════════════════ 基线
section("Phase 0 · 基线：两个租户库都**没有** wh_* 表（干净起点）")
if not os.path.isdir(SRC):
    print(f"❌ 快照目录不存在：{SRC}")
    sys.exit(2)

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SRC, f), os.path.join(WORK, f))
# 第二个租户：内容无所谓，只要**是另一个库文件**（缺陷正是「跨库张冠李戴」）
shutil.copy2(os.path.join(SRC, "tenant_1.db"), os.path.join(WORK, "tenant_10.db"))

T1 = os.path.join(WORK, "tenant_1.db")
T10 = os.path.join(WORK, "tenant_10.db")
ok("基线：tenant_1 无 wh_* 表", tables_of(T1) == [], tables_of(T1))
ok("基线：tenant_10 无 wh_* 表", tables_of(T10) == [], tables_of(T10))

os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
os.environ["DISABLE_AI"] = "1"
os.environ.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)
sys.path.insert(0, SERVER_DIR)
import erp_db as db                                       # noqa: E402
from db.connection import tenant_scope                    # noqa: E402
from db.queries import wh as whdb                         # noqa: E402


def touch(tid):
    """走真实入口：任意一个读写入口都会先 `_ensure_wh`。"""
    with tenant_scope(tid):
        return whdb.wh_outbound_list()


# ══════════════════════════════ Phase 1 · 顺序 A（1 → 10）
section("Phase 1 · 顺序 A：先租户 1、后租户 10 —— 两个库都必须建表")
try:
    ok("租户 1 列表可调用（不抛 no such table）", isinstance(touch(1), list))
except Exception as e:
    ok("租户 1 列表可调用（不抛 no such table）", False, f"{type(e).__name__}: {e}")
t1_after = tables_of(T1)
ok("tenant_1 建齐 6 张 wh_* 表", t1_after == sorted(WH_TABLES), t1_after)

try:
    ok("租户 10 列表可调用（**这正是旧实现会崩的一步**）", isinstance(touch(10), list))
except Exception as e:
    ok("租户 10 列表可调用（**这正是旧实现会崩的一步**）", False, f"{type(e).__name__}: {e}")
t10_after = tables_of(T10)
ok("tenant_10 建齐 6 张 wh_* 表", t10_after == sorted(WH_TABLES), t10_after)

# ══════════════════════════════ Phase 2 · 顺序 B（10 → 1，换向再证）
section("Phase 2 · 顺序 B：清库重来，先租户 10、后租户 1")
for name in WH_TABLES:
    for p in (T1, T10):
        c = sqlite3.connect(p)
        c.execute(f"DROP TABLE IF EXISTS {name}")
        c.commit()
        c.close()
ok("已清空两库的 wh_* 表", tables_of(T1) == [] and tables_of(T10) == [], (tables_of(T1), tables_of(T10)))

try:
    touch(10)
    ok("先租户 10 ⇒ 它自己有表", tables_of(T10) == sorted(WH_TABLES), tables_of(T10))
except Exception as e:
    ok("先租户 10 ⇒ 它自己有表", False, f"{type(e).__name__}: {e}")
try:
    touch(1)
    ok("再租户 1 ⇒ 它也必须有表（旧实现此处为空）", tables_of(T1) == sorted(WH_TABLES), tables_of(T1))
except Exception as e:
    ok("再租户 1 ⇒ 它也必须有表（旧实现此处为空）", False, f"{type(e).__name__}: {e}")

# ══════════════════════════════ Phase 3 · 相位反转（证明断言有判别力）
section("Phase 3 · 相位反转：内联复刻**旧实现**（进程级缓存）⇒ 第二个租户必然缺表")
for name in WH_TABLES:
    for p in (T1, T10):
        c = sqlite3.connect(p)
        c.execute(f"DROP TABLE IF EXISTS {name}")
        c.commit()
        c.close()

_OLD_ensured = False


def old_ensure_wh(conn):
    """旧实现逐字复刻（进程级缓存）。"""
    global _OLD_ensured
    if _OLD_ensured:
        return
    for stmt in whdb._DDL:
        conn.execute(stmt)
    _OLD_ensured = True


def old_touch(path):
    c = sqlite3.connect(path)
    try:
        old_ensure_wh(c)
        c.commit()
    finally:
        c.close()


old_touch(T1)
old_touch(T10)
ok("相位反转：旧实现在 tenant_1 建了表", tables_of(T1) == sorted(WH_TABLES), tables_of(T1))
ok("相位反转：旧实现在 tenant_10 **一张都没有** ⇒ 该断言确实能抓住本缺陷",
   tables_of(T10) == [], tables_of(T10))

# ══════════════════════════════ Phase 4 · 源码侧（无残留进程级标志）
section("Phase 4 · 源码侧：进程级缓存已彻底移除（**按 AST 判定，不受注释/文档字符串干扰**）")
#
# ⚠️ 初版这里用的是 `"global _ensured" not in src` 这种**纯文本** grep，结果误报：
#    修复说明的注释块里**逐字引用了旧实现的这几行**（为了让后人看懂"修了什么"），
#    于是文本匹配命中的是注释，不是真代码 ⇒ 2 条假 FAIL。
#   教训（已并入 §8.F）：**校验"某种写法已消失"时，不能用会匹配到注释的文本 grep** ——
#    要么剥注释、要么上 AST。这里用 AST（ast.walk 只看语法节点，注释/字符串天然不在树里）。
src = open(os.path.join(SERVER_DIR, "db/queries/wh.py"), encoding="utf-8").read()
tree = ast.parse(src, filename="db/queries/wh.py")

# 1) 全模块不得再有任何 `global _ensured`
globals_named = [n for n in ast.walk(tree)
                 if isinstance(n, ast.Global) and "_ensured" in n.names]
ok("AST：模块内无 `global _ensured`", not globals_named,
   [g.names for g in globals_named])

# 2) `_ensured` 不得作为任何标识符出现（读或写都算；注释里的不算）
name_refs = [n.id for n in ast.walk(tree) if isinstance(n, ast.Name)]
attr_refs = [n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)]
ok("AST：`_ensured` 不再是任何变量/属性引用",
   "_ensured" not in name_refs and "_ensured" not in attr_refs,
   sorted(set(name_refs + attr_refs) & {"_ensured"}) or None)

# 3) 正面断言：`_ensure_wh` 确实每次遍历全部 `_DDL`（而非条件跳过）
fn = next((n for n in ast.walk(tree)
           if isinstance(n, ast.FunctionDef) and n.name == "_ensure_wh"), None)
ok("AST：存在 `_ensure_wh` 定义", fn is not None)
if fn is not None:
    fn_src = ast.get_source_segment(src, fn)
    # 必须有一次 `for ... in _DDL`（把整份 DDL 都跑一遍）
    has_loop_over_ddl = any(
        isinstance(n, (ast.For, ast.AsyncFor))
        and any(isinstance(x, ast.Name) and x.id == "_DDL" for x in ast.walk(n.iter))
        for n in ast.walk(fn))
    ok("AST：`_ensure_wh` 无条件遍历 `_DDL`（每入口都跑全量 DDL）",
       has_loop_over_ddl, fn_src.strip().splitlines()[0] if fn_src else None)
    # 体内不得出现任何 `_DDL` 之外的早退守卫（`if <module-level flag>: return`）
    early_returns = [n for n in ast.walk(fn)
                     if isinstance(n, ast.If)
                     and any(isinstance(x, ast.Return) for x in n.body)]
    ok("AST：`_ensure_wh` 体内无「标志早退」分支", not early_returns,
       len(early_returns) or None)

ok("`_DDL` 仍在且含 6 张表", all(t in src for t in WH_TABLES))

# ── Phase 4b · 判别力：把同一组 AST 断言打到**修复前**的版本上，必须**失败**
#    （否则"全绿"没有意义 —— 断言可能根本抓不到缺陷）
section("Phase 4b · 判别力：同一组 AST 断言打在 `HEAD`（修复前）上必须失败")
import subprocess                                        # noqa: E402
head_src = subprocess.run(
    ["git", "-C", os.path.dirname(SERVER_DIR), "show", "HEAD:server/db/queries/wh.py"],
    capture_output=True, text=True, check=True).stdout
try:
    head_tree = ast.parse(head_src, filename="HEAD:db/queries/wh.py")
    head_globals = [n for n in ast.walk(head_tree)
                    if isinstance(n, ast.Global) and "_ensured" in n.names]
    head_names = [n.id for n in ast.walk(head_tree) if isinstance(n, ast.Name)]
    ok("判别力：`HEAD` 版本**有** `global _ensured`（⇒ 断言 1 能抓住缺陷）",
       bool(head_globals), [g.names for g in head_globals])
    ok("判别力：`HEAD` 版本**有** `_ensured` 变量引用（⇒ 断言 2 能抓住缺陷）",
       "_ensured" in head_names)
except SyntaxError as e:                                 # pragma: no cover
    ok("判别力：`HEAD` 版本可解析", False, f"{type(e).__name__}: {e}")

print(f"\n{'═' * 72}")
print(f"  汇总：PASS {len(PASS)} / FAIL {len(FAIL)}")
if FAIL:
    for f in FAIL:
        print(f"    ❌ {f}")
else:
    print("  ✅ ALL PASS")
print(f"{'═' * 72}")
sys.exit(1 if FAIL else 0)
