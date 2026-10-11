#!/usr/bin/env python
"""v465i 验收 —— 清 P2 盘点带出的三条后端欠账。

    /usr/bin/python3 .workbuddy/tools/v465i-wastage-assembly-batch-verify.py

三条欠账（都不是"看起来坏了"，是"看起来正常但有错"）：

① **路由遮蔽**：`server.py` 里 `/api/wastage/{wid}` 注册在 `/summary` 与
   `/suggest-from-expiry` **之前** ⇒ 后两个静态段被当成 `wid: int` 解析 ⇒ **恒 422**，
   这两个端点从 v92 落地那天起就没能用过。
② **报损批次盲**：`create_wastage_order` 用 `inventory_adjust` 扣库存，而它内部是
   `SELECT ... WHERE product_id=? AND warehouse_id=?` **取第一条就改**，压根不看 `batch_no`
   ⇒ 报 B01（过期）却扣了 B02（新鲜）；且第一条余量不足就直接报"库存不足"，明明够也报不掉。
   另：`ref_id=0`（注释说 "will update after insert"，但从没 update 过）⇒ 流水挂不上单号。
③ **组拆批次盲 + 静默夹零**：`_asm_apply_inventory` 只认 `batch_no=''` 那一行，
   而低温奶库存几乎全在带批次的行里 ⇒ 扣减分支走到 `else` 的 `INSERT ... max(0, delta)`
   ⇒ 插入一条 `quantity=0` 的**幽灵行**，组件库存一根没扣，函数却正常返回。

判别力（本脚本的核心，不是装饰）：
    同一套断言在 **旧树（`git archive HEAD`）** 上必须 **FAIL**、在 **新树（含本次改动）**
    上必须 **PASS**。做不到这一条，"全绿"就只是"断言写得松"。
    ⚠️ 唯一的例外是撤销场景：旧实现的"扣错批次"与"加错批次"会**正好抵消**，
       终态看起来是对的 ⇒ 那里改用 `inventory_logs.before_qty` 反推"撤销到底作用在哪个批次"。

跑法：主进程建两棵源码树，各起一个子进程跑同一套测试，再对比。
"""
import json
import os
import shutil
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/hergent-erp"
WORK = "/tmp/v465i-shadow"
OLD = os.path.join(WORK, "old")
NEW = os.path.join(WORK, "new")

# 本次改动的文件（"新树" = HEAD + 只这几个文件）
CHANGED = ["server.py", "erp_db.py", "domain/wastage_tracker.py",
           "db/queries/inventory.py", "db/queries/wh.py"]

PY = "/Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python"


# ══════════════════════════════════════════ 建两棵源码树
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


# ══════════════════════════════════════════ 子进程：在一棵树上跑全部测试
CHILD = r'''
import json, os, sys, sqlite3
TREE, DB = sys.argv[2], sys.argv[3]
sys.path.insert(0, TREE)
os.environ["ERP_DB_PATH"] = DB
os.environ["DISABLE_AI"] = "1"
os.environ.setdefault("ERP_SECRET", "shadow-verify-" + "0" * 48)

import erp_db
# `init_db()` 建表不全（实测缺 products / kit_orders 等），用一个**只有 schema、零数据**的
# 库做底板：`tenant_db_init` 走 `iterdump()` 只取 CREATE 语句 —— 这是建租户库的正道。
_SEED = erp_db.tenant_db_init(999)
import shutil as _sh
_sh.copy2(_SEED, DB)
for _sfx in ("-wal", "-shm"):
    if os.path.exists(_SEED + _sfx):
        os.remove(_SEED + _sfx)

# 📌 顺带实证到第 5 个缺陷（本轮**只登记不修**）：
#    `tenant_db_init()` 建出的库**没有** kit_orders / stock_freezes —— 这两张表的 DDL
#    只在 `_ensure_tenant_module_tables()` 里（erp_db.py:1442 那段 self-heal），而
#    `tenant_db_init()`（13880）**不调**它；真正会调它的两处是**模块级**（15232/19030），
#    只在 import 时对「当时已存在」的 `tenant_*.db` 补表 ⇒ **新建租户要等下一次重启**才有
#    这两张表，期间组拆单 / 静态盘点单会 500 `no such table`。
#    ⇒ 这里作为 **fixture 显式建表**（DDL 与生产逐字一致），让被测行为跑在完整 schema 上。
import sqlite3 as _sq
_c = _sq.connect(DB)
_c.executescript("""
CREATE TABLE IF NOT EXISTS kit_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT DEFAULT '',
    type TEXT DEFAULT 'assemble',
    product_id INTEGER DEFAULT 0,
    warehouse_id INTEGER DEFAULT 1,
    total_quantity REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    note TEXT DEFAULT '',
    operator_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    confirmed_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kit_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER DEFAULT 0,
    product_id INTEGER DEFAULT 0,
    quantity REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    is_input INTEGER DEFAULT 1
);
""")
_c.commit(); _c.close()

R = []
def ok(name, cond, got=None):
    R.append({"name": name, "ok": bool(cond), "got": None if cond else repr(got)})

def q(sql, args=()):
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()

def w(sql, args=()):
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    try:
        c.execute(sql, args); c.commit()
    finally:
        c.close()

def inv_of(batch):
    r = q("SELECT quantity FROM inventory WHERE product_id=1 AND warehouse_id=1 AND batch_no=?", (batch,))
    return float(r[0]["quantity"]) if r else None

# ── fixture：商品 1 有两个批次，插入顺序刻意让「新鲜批次排第一」
#    （`inventory_adjust` 取第一条就改 ⇒ 旧实现必然扣到 B02 上）
w("DELETE FROM inventory WHERE product_id IN (1,2,3)")
w("DELETE FROM inventory_logs")
w("DELETE FROM wastage_orders"); w("DELETE FROM wastage_order_items")
w("DELETE FROM kit_orders");     w("DELETE FROM kit_items")
w("INSERT OR REPLACE INTO products (id,name) VALUES (1,'测试奶')")
w("INSERT OR REPLACE INTO products (id,name) VALUES (2,'组件C')")
w("INSERT OR REPLACE INTO products (id,name) VALUES (3,'成品F')")
# ⚠️ 批次号这样命名是**刻意的**，它决定了本脚本有没有判别力：
#    `inventory` 上有 (product_id,warehouse_id,batch_no) 索引 ⇒ 不带 ORDER BY 的
#    `SELECT ... fetchone()`（正是 `inventory_adjust` 的取法）按**索引顺序**取第一条
#    = **B01（新鲜，字典序在前）**；而 `gross_deduct` 按 **expiry_date** 排序 ⇒ 先扣
#    **B99（过期）**。两种顺序**相反**，旧实现的"扣错批次"才会暴露出来。
#    （第一版把批次号取成 B01=过期，结果两个顺序一致 ⇒ 旧实现碰巧扣对 ⇒ 判别力为零。）
w("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) VALUES (1,1,50,4.0,'B01','2099-01-01')")
w("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) VALUES (1,1,30,2.0,'B99','2020-01-01')")

import domain.wastage_tracker as wt
# 隔离被测对象：报损的**库存扣减**是本次要验的，凭证表不是。打桩避免无关失败。
wt._post_wastage_journal = lambda *a, **k: None

# ═══ A. 共享原语 gross_deduct（只有新树有；旧树跳过）
try:
    from db.queries.inventory import gross_deduct as gd
    HAVE_GD = True
except ImportError:
    HAVE_GD = False
ok("A1 共享层存在 gross_deduct 原语", HAVE_GD)
if HAVE_GD:
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    r = gd(c, 1, 1, 40)                      # 未指定批次 ⇒ 过期优先（B99 30 + B01 10）
    ok("A2 未指定批次⇒成功", r.get("success") is True, r)
    used = r.get("used") or []
    ok("A3 跨批次扣减返回 used 两条", len(used) == 2, used)
    ok("A4 首条 used 是**过期**批次 B99（不是索引序在前的 B01）",
       used and used[0]["batch_no"] == "B99", used)
    ok("A5 used 带 cost_price（报损金额要用）", used and "cost_price" in used[0], used)
    c.commit(); c.close()
    ok("A6 过期批次 B99 已被扣光", inv_of("B99") == 0, inv_of("B99"))
    ok("A7 新鲜批次 B01 只被扣掉 10", inv_of("B01") == 40, inv_of("B01"))
    # 恢复 fixture
    w("UPDATE inventory SET quantity=30 WHERE product_id=1 AND batch_no='B99'")
    w("UPDATE inventory SET quantity=50 WHERE product_id=1 AND batch_no='B01'")
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    r2 = gd(c, 1, 1, 5, batch_no="B99")       # 指定批次 ⇒ 只扣该批
    c.commit(); c.close()
    ok("A8 指定批次⇒只扣该批（B99 25 / B01 不动）",
       inv_of("B99") == 25 and inv_of("B01") == 50, (inv_of("B99"), inv_of("B01")))
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    r3 = gd(c, 1, 1, 999)
    ok("A9 总量不足⇒报错且不扣任何", bool(r3.get("error")) and inv_of("B99") == 25, r3)
    c.close()
    w("UPDATE inventory SET quantity=30 WHERE product_id=1 AND batch_no='B99'")
    w("UPDATE inventory SET quantity=50 WHERE product_id=1 AND batch_no='B01'")

# ═══ B. 报损批次精确（判别力核心）
w("DELETE FROM inventory_logs")
res = wt.create_wastage_order(w_type="expired", warehouse_id=1,
                              items=[{"product_id": 1, "quantity": 30, "batch_no": "B99"}],
                              operator_id="probe")
ok("B1 报损单创建成功", isinstance(res, dict) and res.get("wastage_id"), res)
ok("B2 判据：报 B99（过期）⇒ **只有 B99 被扣光**", inv_of("B99") == 0, inv_of("B99"))
ok("B3 判据：新鲜批次 B01 一根没动（旧实现扣的正是它）", inv_of("B01") == 50, inv_of("B01"))

# ═══ C. 库存流水挂得上单号（判别力核心）
wid = res.get("wastage_id") if isinstance(res, dict) else None
logs = q("SELECT ref_type,ref_id,change_qty FROM inventory_logs WHERE ref_type='wastage'")
ok("C1 产生了 wastage 流水", len(logs) > 0, logs)
ok("C2 判据：流水的 ref_id == 报损单 id（旧实现恒为 0）",
   logs and all(l["ref_id"] == wid for l in logs), (logs, wid))

# ═══ D. 撤销要加回**原批次**
before_b99 = inv_of("B99")
rj = wt.reject_wastage(wid, operator_id="probe")
ok("D1 撤销成功", isinstance(rj, dict) and rj.get("status") == "rejected", rj)
ok("D2 撤销后 B99 恢复到 30", inv_of("B99") == 30, inv_of("B99"))
rev = q("SELECT before_qty,after_qty FROM inventory_logs WHERE ref_type='wastage_reversal'")
# ⚠️ 判别力：旧实现「扣错批」与「加回错批」会**正好抵消**，终态看起来是对的
#    ⇒ 改用 `before_qty` 反推撤销究竟作用在哪个批次：撤销前 B99 已被扣光（=0），
#      故 before_qty 必须是 0；旧实现打在 B01 上（当时 20）⇒ 必然是 20。
ok("D3 判据：撤销作用在 B99 上（before_qty==0；旧实现打在 B01 上⇒20）",
   rev and rev[0]["before_qty"] == 0, (rev, before_b99))
ok("D4 撤销后 B01 不该被多加", inv_of("B01") == 50, inv_of("B01"))

# ═══ E. 组拆批次感知（判别力核心）
# fixture：组件 C 只有**带批次**的行，没有 batch_no='' 行（旧实现的盲区）
w("DELETE FROM inventory WHERE product_id=2")
w("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) VALUES (2,1,100,3.0,'CX1','2099-01-01')")
aid = erp_db.assembly_create("assemble", 3, 1, 5,
                             [{"product_id": 2, "quantity": 10, "unit_price": 3.0}],
                             operator_id="probe")
cf = erp_db.assembly_confirm(aid)
ok("E1 组装确认返回成功", isinstance(cf, dict) and cf.get("success") is True, cf)
cx = q("SELECT quantity FROM inventory WHERE product_id=2 AND batch_no='CX1'")
ok("E2 判据：组件库存真的被扣了（100→90；旧实现纹丝不动）",
   cx and cx[0]["quantity"] == 90, cx)
ghost = q("SELECT quantity FROM inventory WHERE product_id=2 AND batch_no=''")
ok("E3 判据：没有留下 quantity=0 的幽灵行（旧实现必留）", ghost == [] or ghost[0]["quantity"] != 0, ghost)
fin = q("SELECT quantity FROM inventory WHERE product_id=3 AND batch_no=''")
ok("E4 成品产出落在 batch_no='' 行（不编造批次）", fin and fin[0]["quantity"] == 5, fin)

# ═══ F. 组拆库存不足 ⇒ 整单回滚，绝不"静默假成功"
aid2 = erp_db.assembly_create("assemble", 3, 1, 5,
                              [{"product_id": 2, "quantity": 1000, "unit_price": 3.0}],
                              operator_id="probe")
cf2 = erp_db.assembly_confirm(aid2)
ok("F1 判据：库存不足 ⇒ success:False（旧实现静默成功）",
   isinstance(cf2, dict) and cf2.get("success") is False, cf2)
st = q("SELECT status FROM kit_orders WHERE id=?", (aid2,))
ok("F2 判据：单据仍是 draft（事务已回滚）", st and st[0]["status"] == "draft", st)
cx2 = q("SELECT quantity FROM inventory WHERE product_id=2 AND batch_no='CX1'")
ok("F3 失败的确认不该动到库存", cx2 and cx2[0]["quantity"] == 90, cx2)

# ═══ G. P1 盘亏行为不变（提升 gross_deduct 的回归证据）
try:
    from db.queries import wh as whdb
    w("DELETE FROM inventory WHERE product_id=1")
    w("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) VALUES (1,1,50,4.0,'B01','2099-01-01')")
    w("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) VALUES (1,1,30,2.0,'B99','2020-01-01')")
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row   # gross_deduct 用 r["quantity"]，裸连接返回 tuple 会炸
    vr = whdb._gross_deduct(c, 1, 1, 40, ref_type="probe", ref_id=1)
    c.commit(); c.close()
    # 只比 (batch_no, quantity)：`batch_id` 随 fixture 重建而变，`cost_price` 是本轮新增字段
    # ⇒ 两者都不是"行为"，把它们算进去会让这次提升被误判成改变行为。
    norm = sorted([(u.get("batch_no"), u.get("quantity")) for u in (vr.get("used") or [])])
    R.append({"name": "__obs_variance__", "ok": True,
              "got": json.dumps({"used": norm,
                                 "b01": inv_of("B01"), "b99": inv_of("B99")})})
except Exception as e:
    R.append({"name": "__obs_variance__", "ok": False, "got": repr(e)})

print("@@JSON@@" + json.dumps(R))
'''


def run_child(tree, tag):
    db = os.path.join(WORK, f"{tag}.db")
    if os.path.exists(db):
        os.remove(db)
    script = os.path.join(WORK, f"child_{tag}.py")
    with open(script, "w", encoding="utf-8") as f:
        f.write(CHILD)
    env = dict(os.environ)
    env.pop("ERP_DB_PATH", None)
    p = subprocess.run([PY, script, "--child", tree, db],
                       capture_output=True, text=True, cwd=tree, env=env)
    out = ""
    for line in p.stdout.splitlines():
        if line.startswith("@@JSON@@"):
            out = line[len("@@JSON@@"):]
    if not out:
        print(f"❌ 子进程 {tag} 没有产出结果：\n{p.stdout[-2000:]}\n{p.stderr[-3000:]}")
        sys.exit(2)
    rows = json.loads(out)
    return {r["name"]: r for r in rows}


# ══════════════════════════════════════════ 静态检查：路由顺序
def route_check(tree, label):
    src = open(os.path.join(tree, "server.py"), encoding="utf-8").read()
    lines = src.split("\n")
    def ln(pat):
        for i, l in enumerate(lines):
            if pat in l:
                return i
        return -1
    i_summary = ln('@app.get("/api/wastage/summary")')
    i_suggest = ln('@app.get("/api/wastage/suggest-from-expiry")')
    i_wid = ln('@app.get("/api/wastage/{wid}")')
    return {
        "summary_before_wid": i_summary >= 0 and i_wid >= 0 and i_summary < i_wid,
        "suggest_before_wid": i_suggest >= 0 and i_wid >= 0 and i_suggest < i_wid,
        "detail": f"{label}: summary@{i_summary} suggest@{i_suggest} {{wid}}@{i_wid}",
    }


# ══════════════════════════════════════════ 主流程
def main():
    print("=" * 74)
    print("v465i 验收 · 清三条后端欠账（报损批次盲 / 组拆批次盲 / wastage 路由遮蔽）")
    print("=" * 74)
    build_trees()
    print(f"  旧树（HEAD 干净）: {OLD}")
    print(f"  新树（+本次 5 个文件）: {NEW}\n")

    old = run_child(OLD, "old")
    new = run_child(NEW, "new")

    PASS, FAIL = [], []
    def ok(name, cond, got=None):
        (PASS if cond else FAIL).append(name)
        print(f"  {'✅' if cond else '❌'} {name}" + ("" if cond else f"   ← {got}"))

    # ── 判别力表：这些断言必须「旧 FAIL / 新 PASS」
    def by_no(d, k):
        """按断言编号取（键是完整 name，`name` 以编号开头，如 'B2 判据：…'）。"""
        for name, r in d.items():
            if name == k or name.startswith(k + " "):
                return r
        return None

    DISCRIMINATING = ["B2", "B3", "C2", "D3", "E2", "E3", "F1", "F2"]
    print("\n── 判别力自证：同一断言在旧代码上必须 FAIL、在新代码上必须 PASS ──")
    disc_ok = True
    for k in DISCRIMINATING:
        o = by_no(old, k); n = by_no(new, k)
        if not o or not n:
            ok(f"{k} 断言存在", False, "缺失")
            disc_ok = False
            continue
        good = (o["ok"] is False) and (n["ok"] is True)
        disc_ok = disc_ok and good
        mark = "旧FAIL/新PASS ✅" if good else f"旧={o['ok']}/新={n['ok']} ❌"
        ok(f"{n['name']}  ⇒ {mark}", good,
           f"旧got={o['got']} 新got={n['got']}")

    print("\n── 新树上的正确性断言（全部要过）──")
    for k in sorted(new):
        if k.startswith("__"):
            continue
        if k in DISCRIMINATING:
            continue
        r = new[k]
        ok(f"{r['name']}", r["ok"], r["got"])

    print("\n── P1 回归：提升 gross_deduct 后盘亏行为必须逐字不变 ──")
    ov = old.get("__obs_variance__"); nv = new.get("__obs_variance__")
    ok("两树的盘亏观测值完全相同", bool(ov) and bool(nv) and ov["ok"] and nv["ok"]
       and ov["got"] == nv["got"], f"旧={ov and ov['got']} 新={nv and nv['got']}")
    if ov and nv:
        print(f"      观测值：{nv['got']}")

    print("\n── 静态：wastage 路由顺序（静态段必须在 {{wid}} 之前）──")
    ro = route_check(OLD, "旧树"); rn = route_check(NEW, "新树")
    print(f"      {ro['detail']}")
    print(f"      {rn['detail']}")
    ok("新树：/summary 在 /{{wid}} 之前", rn["summary_before_wid"])
    ok("新树：/suggest-from-expiry 在 /{{wid}} 之前", rn["suggest_before_wid"])
    ok("判别力：旧树**确实**是错的（summary 在 {{wid}} 之后）", not ro["summary_before_wid"])
    ok("判别力：旧树**确实**是错的（suggest 在 {{wid}} 之后）", not ro["suggest_before_wid"])
    ok("判别力总开关：8 条判别断言全部「旧 FAIL / 新 PASS」", disc_ok)

    print("\n" + "=" * 74)
    print(f"===== PASS {len(PASS)} / FAIL {len(FAIL)} =====")
    if FAIL:
        print("失败项：")
        for f in FAIL:
            print(f"  · {f}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
