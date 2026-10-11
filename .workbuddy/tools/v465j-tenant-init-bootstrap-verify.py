#!/usr/bin/env python
"""v465j 验收 —— 修「新租户建库缺表」（v465i 登记为欠账 ⑤）。

    /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v465j-tenant-init-bootstrap-verify.py

## 欠账的真实全貌（v465i 只看到 4 张，实测 75 张）

`tenant_db_init()` 只 `iterdump()` 复制**主库** schema。线上实测生产库：
**主库 328 张表 / 租户库 391 张** ⇒ 差集 **75 张**全是「只存在于租户库」的表
（`kit_orders` `stock_freezes` `wh_outbound_orders` `fund_*` `loss_*` …），
新租户一张都拿不到，要等**下次服务重启**（`_ensure_tenant_module_tables()` 是模块级调用）。

这 75 张表的 DDL 散落在 `erp_db.py`(25) `routers/loss_accounting.py`(9)
`db/queries/wh.py`(6) `routers/collections.py`(3) 等 **16+ 个文件**，
另有 14 张连 `CREATE TABLE` 都 grep 不到（f-string 拼表名）。

⇒ **枚举清单的修法必然漂移**。本轮改为**对账**：权威源 = 主库 ∪ 其它租户库（真实存在的库），
   不认识表名也能补对，且自愈。

## 修法（两道，都在 `tenant_db_init()` 内）

① `_copy_tenant_only_tables()`  —— 补「主库没有、但其它租户库有」的表（75 张那批）
② `_ensure_tenant_module_tables()` —— 既有的标准自愈/对账（含 v108 的
   `kit_orders` / `stock_freezes` self-heal），它是模块级调用，新库文件此刻才落盘 ⇒
   不显式跑一遍就得等下次重启。

## 判别力（本脚本的核心）

同一套断言在 **旧树（`git archive HEAD`）** 上必须 **FAIL**、在 **新树（含本次改动）**
上必须 **PASS**。做不到这条，"全绿"就只是"断言写得松"。

关键：两个场景的判别力来源**不同**，必须都覆盖 ——
  · 场景 A（第一个租户）：旧树缺 `kit_orders`（self-heal 没跑过）⇒ ①无兄弟库也救不了，
    必须靠 ②。若只实现 ①，A 会在旧树上"碰巧也 FAIL"、在新树上**仍然 FAIL** ⇒ 立刻暴露。
  · 场景 B（第二个租户）：旧树缺 `wh_*`（只在兄弟库里）⇒ 必须靠 ①。若只实现 ②，
    B 在新树上**仍然 FAIL**（主库没有 wh_*）⇒ 立刻暴露。
"""
import json
import os
import shutil
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/hergent-erp"
WORK = "/tmp/v465j-shadow"
OLD = os.path.join(WORK, "old")
NEW = os.path.join(WORK, "new")

CHANGED = ["erp_db.py"]
PY = "/Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python"


def build_trees():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    subprocess.run(f"git -C {REPO} archive HEAD server | tar -x -C {WORK}",
                   shell=True, check=True)
    os.rename(os.path.join(WORK, "server"), OLD)
    # symlinks=True：仓库里的 static 是符号链接，跟随它会因目标不存在而炸
    shutil.copytree(OLD, NEW, symlinks=True)
    for rel in CHANGED:
        shutil.copy2(os.path.join(REPO, "server", rel), os.path.join(NEW, rel))


# ══════════════════════════════════════════ 子进程
CHILD = r'''
import json, os, sys, sqlite3
TREE, DB = sys.argv[2], sys.argv[3]
sys.path.insert(0, TREE)
os.environ["ERP_DB_PATH"] = DB
os.environ["DISABLE_AI"] = "1"
os.environ.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)

import erp_db

R = []
def ok(name, cond, got=None):
    R.append({"name": name, "ok": bool(cond), "got": got if got is not None else cond})

def tabs(p):
    try:
        c = sqlite3.connect(p)
        s = {r[0] for r in c.execute("SELECT name FROM sqlite_master "
                                     "WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        c.close()
        return s
    except Exception as e:
        return set()

def rowcount(p, t):
    try:
        c = sqlite3.connect(p)
        n = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        c.close(); return n
    except Exception as e:
        return -1

DB_DIR = os.path.dirname(DB)
master = tabs(DB)
ok("P0 主库已初始化（表数 > 100）", len(master) > 100, len(master))

SKIP = set(erp_db._TENANT_TABLE_SYNC_SKIP)

# ══════════ 场景 A：系统里还没有任何租户库 ⇒ 建**第一个**租户
#    判别力来源：`kit_orders` 的 DDL 只在 `_ensure_tenant_module_tables()` 的 self-heal 里，
#    而它是**模块级**调用（import 时跑），此刻 tenant_1.db 还没落盘 ⇒ 旧树必然缺。
ok("A0 前置：DB_DIR 里确实还没有租户库",
   not [f for f in os.listdir(DB_DIR) if f.startswith("tenant_") and f.endswith(".db")],
   sorted(os.listdir(DB_DIR))[:6])

p1 = erp_db.tenant_db_init(1)
t1 = tabs(p1)
ok("A1 新租户库文件已创建", os.path.exists(p1), p1)
# ↓↓↓ 判别力断言（必须在旧树 FAIL）
ok("A2 判据：kit_orders 存在（v108 组拆单 self-heal）", "kit_orders" in t1,
   "kit_orders" in t1)
ok("A3 判据：kit_items 存在", "kit_items" in t1, "kit_items" in t1)
ok("A4 判据：stock_freezes 存在（静态盘点）", "stock_freezes" in t1, "stock_freezes" in t1)
ok("A5 判据：stock_freeze_items 存在", "stock_freeze_items" in t1, "stock_freeze_items" in t1)
# 建库本身的既有契约不能被补表流程打破
ok("A6 币种种子已写入（建库既有契约未破）", rowcount(p1, "currencies") == 6,
   rowcount(p1, "currencies"))
# 主库 schema 是否被完整复制（若这里失败 ⇒ iterdump 另有问题，需单独登记）
miss_master = sorted((master - t1) - SKIP)
ok("A7 主库业务表已完整复制（排除集外无遗漏）", not miss_master, miss_master[:8])

# ══════════ 场景 B：给 tenant_1 造出「租户专属表」，再建**第二个**租户
#    用**真实机制**造：`db/queries/wh.py::_ensure_wh()` 是 P1 落地的懒建表入口，
#    它建的 6 张 `wh_*` 表**只存在于租户库**（主库没有）⇒ 正是本轮要补的那批。
from db.queries import wh as _wh
c = sqlite3.connect(p1)
c.row_factory = sqlite3.Row          # _ensure_wh 内部用 r["..."] 取值
_wh._ensure_wh(c)
c.commit(); c.close()
t1b = tabs(p1)
WH6 = ["wh_outbound_orders", "wh_outbound_items", "wh_stock_entries",
       "wh_stock_entry_items", "wh_stock_takes", "wh_stock_take_items"]
ok("B0 前置：tenant_1 已通过真实入口建出 6 张 wh_* 表（主库没有）",
   all(t in t1b for t in WH6) and not any(t in master for t in WH6),
   {"tenant_1有": [t for t in WH6 if t in t1b], "主库有": [t for t in WH6 if t in master]})

p2 = erp_db.tenant_db_init(2)
t2 = tabs(p2)
# ↓↓↓ 判别力断言（必须在旧树 FAIL；且只实现②也救不了 ⇒ 反证 ① 是必需的）
ok("B1 判据：新租户 2 继承了 wh_outbound_orders", "wh_outbound_orders" in t2,
   "wh_outbound_orders" in t2)
ok("B2 判据：新租户 2 继承了 wh_stock_takes", "wh_stock_takes" in t2,
   "wh_stock_takes" in t2)
ok("B3 判据：6 张 wh_* 全部继承", all(t in t2 for t in WH6),
   [t for t in WH6 if t not in t2])
# 补的是**结构**不是数据：新建的表必须空
ok("B4 补的表是空表（只补结构、零数据）",
   rowcount(p2, "wh_outbound_orders") == 0 and rowcount(p2, "wh_stock_takes") == 0,
   (rowcount(p2, "wh_outbound_orders"), rowcount(p2, "wh_stock_takes")))
# 不能在建新库时污染兄弟库
ok("B5 兄弟库 tenant_1 未被改写（表数不减）", len(tabs(p1)) >= len(t1b),
   (len(tabs(p1)), len(t1b)))
ok("B6 新租户 2 币种种子也在", rowcount(p2, "currencies") == 6, rowcount(p2, "currencies"))

# ══════════ 场景 C：幂等 —— 重复建库不报错、不炸
try:
    p2_again = erp_db.tenant_db_init(2)
    ok("C1 重复 tenant_db_init 不抛异常", os.path.exists(p2_again), True)
except Exception as e:
    ok("C1 重复 tenant_db_init 不抛异常", False, str(e))

# ══════════ 场景 D：排除集语义仍成立
#    ⚠️ 不能写成"排除集里的表不在租户库" —— 实测 `_migrations` / `tenants` /
#    `role_permissions` 等**主库级表本来就在租户库里**（是 `iterdump` 复制主库带过去的，
#    与本轮改动无关，新旧两树都会"FAIL" ⇒ 那样写是个**恒假**断言，没有判别力）。
#    真正要守的是：排除集里的表**只能来自主库**，不能由 `_copy_tenant_only_tables`
#    从兄弟库补进来 ⇒ 判据 =「出现在租户库里的排除集表，必须同时存在于主库」。
leaked = sorted((t2 & SKIP) - master)
ok("D1 排除集里的表若出现在租户库，必来自主库（不是从兄弟库补的）", not leaked, leaked)

# 观测项（不判对错，供主进程做新旧对比）
R.append({"name": "__obs_t1__", "ok": True, "got": len(t1)})
R.append({"name": "__obs_t2__", "ok": True, "got": len(t2)})
R.append({"name": "__obs_master__", "ok": True, "got": len(master)})

print("__V465J_JSON__" + json.dumps(R))
'''


def run_child(tree, tag):
    d = os.path.join(WORK, "run_" + tag)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    db = os.path.join(d, "erp.db")
    script = os.path.join(d, "child.py")
    open(script, "w", encoding="utf-8").write(CHILD)
    env = dict(os.environ)
    env["ERP_DB_PATH"] = db
    env["DISABLE_AI"] = "1"
    env.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)
    p = subprocess.run([PY, script, "--child", tree, db],
                       capture_output=True, text=True, env=env, cwd=d)
    out = p.stdout
    marker = "__V465J_JSON__"
    if marker not in out:
        print(f"  ⚠️ {tag} 子进程没有产出结果，stderr 尾部：")
        print(p.stderr[-2500:])
        return {}
    payload = out.split(marker, 1)[1].split("\n", 1)[0]
    res = json.loads(payload)
    return {r["name"]: r for r in res}


def main():
    build_trees()
    print("── 旧树（git archive HEAD，不含本次改动）──")
    old = run_child(OLD, "old")
    print("── 新树（HEAD + erp_db.py）──")
    new = run_child(NEW, "new")

    OBS = ("__obs_master__", "__obs_t1__", "__obs_t2__")
    print("\n══════ 新树逐条结果 ══════")
    for k, r in new.items():
        if k in OBS:
            continue
        print(f"  {'PASS' if r['ok'] else 'FAIL'}  {k}" + ("" if r["ok"] else f"   got={r['got']}"))
    print("\n── 观测：库表数对比（只增量、不减量 ⇒ 证明改动没打破主库复制）──")
    for lbl, k in (("主库", "__obs_master__"), ("tenant_1", "__obs_t1__"),
                   ("tenant_2", "__obs_t2__")):
        o = old.get(k); n = new.get(k)
        print(f"  {lbl:9s} 旧树={o['got'] if o else '—':>5}  新树={n['got'] if n else '—':>5}")

    # 判别力：这些断言必须「旧 FAIL / 新 PASS」
    # ⚠️ B4 归判别力组、不归契约组：它断言"补进来的表是空表"，前提是**表已被补进来**；
    #    旧树连表都没有 ⇒ 必然 FAIL。放进"新旧都 PASS"的契约组会把它误判成回归。
    #    它 FAIL 的含义是"旧实现根本没补表"，与 B1-B3 同源。
    # A7 也归判别力组：**顺带修掉的第二个问题** —— `iterdump()` 对 FTS5 虚表输出的是
    #   `CREATE VIRTUAL TABLE ...`，不以 `CREATE TABLE` 开头 ⇒ 被 `tenant_db_init` 跳过
    #   ⇒ 新租户库**没有** `products_fts` / `contacts_fts`（v131f 注释里写的
    #   "演示租户搜索必然 500" 同病根）。新树跑了 `_ensure_tenant_module_tables()` 的
    #   FTS 段 ⇒ 补上。旧树必然 FAIL、新树必然 PASS，正是判别力。
    DISCRIMINATING = ["A2", "A3", "A4", "A5", "A7", "B1", "B2", "B3", "B4"]
    print("\n── 判别力自证：同一断言在旧代码上必须 FAIL、在新代码上必须 PASS ──")
    disc_ok = True
    for k in DISCRIMINATING:
        o = next((old[n] for n in old if n.startswith(k + " ")), None)
        n = next((new[m] for m in new if m.startswith(k + " ")), None)
        if o is None or n is None:
            print(f"  ⚠️ {k} 缺失（old={o is not None} new={n is not None}）")
            disc_ok = False
            continue
        good = (not o["ok"]) and n["ok"]
        if not good:
            disc_ok = False
        print(f"  {'✅' if good else '❌'} {k:4s} 旧={('PASS' if o['ok'] else 'FAIL')} "
              f"新={('PASS' if n['ok'] else 'FAIL')}"
              + ("" if good else f"  旧got={o['got']} 新got={n['got']}"))

    # 非判别力断言（契约类）：新旧都必须 PASS —— 证明改动没有打破既有行为
    CONTRACT = ["A1", "A6", "B5", "B6", "C1", "D1"]
    print("\n── 契约自证：既有行为新旧都必须 PASS（零回归） ──")
    for k in CONTRACT:
        o = next((old[n] for n in old if n.startswith(k + " ")), None)
        n = next((new[m] for m in new if m.startswith(k + " ")), None)
        good = bool(o and o["ok"]) and bool(n and n["ok"])
        if not good:
            disc_ok = False
        print(f"  {'✅' if good else '❌'} {k:4s} 旧={('PASS' if o and o['ok'] else 'FAIL')} "
              f"新={('PASS' if n and n['ok'] else 'FAIL')}"
              + ("" if good else f"  旧got={o['got'] if o else None} 新got={n['got'] if n else None}"))

    real = {k: r for k, r in new.items() if k not in OBS}
    n_pass = sum(1 for r in real.values() if r["ok"])
    print(f"\n===== 新树 PASS {n_pass} / FAIL {len(real) - n_pass} "
          f"｜ 判别力+契约 {'✅ 全部成立' if disc_ok else '❌ 有反例'} =====")
    return 0 if (disc_ok and n_pass == len(new)) else 1


if __name__ == "__main__":
    sys.exit(main())
