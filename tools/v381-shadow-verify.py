#!/usr/bin/env python3
# v381 影子库真机验证 —— 「报单身份(个人仓)」迁移到报单配置
# 用法(服务器上):
#   set -a; . /opt/hergent-erp/.env; set +a
#   HERGENT_SRC=/tmp/v381-src   python3 v381-shadow-verify.py new   # 将部署的那份
#   HERGENT_SRC=/opt/hergent-erp python3 v381-shadow-verify.py old   # 现状(对照)
#
# 纪律：跑写操作前自证连的是副本（§7.9 硬护栏）——不成立就 SystemExit(2)，绝不污染生产。
import json, os, sqlite3, sys

MODE = (sys.argv[1] if len(sys.argv) > 1 else "new")
SRC = os.environ.get("HERGENT_SRC", "/tmp/v381-src")
SCRATCH = "/tmp/v381-shadow-%s" % MODE
PROD = "/opt/hergent-erp"

ok_n = fail_n = 0
def ck(name, got, want):
    global ok_n, fail_n
    good = got == want
    ok_n += good; fail_n += (not good)
    print(("  [OK]   " if good else "  [FAIL] ") + f"{name}: got={got!r} want={want!r}")

def ck_bool(name, cond, detail=""):
    global ok_n, fail_n
    ok_n += bool(cond); fail_n += (not cond)
    print(("  [OK]   " if cond else "  [FAIL] ") + f"{name} {detail}")

def cp(src, dst):
    s = sqlite3.connect("file:%s?mode=ro" % src, uri=True); d = sqlite3.connect(dst)
    s.backup(d); d.close(); s.close()

print(f"##### MODE={MODE}  SRC={SRC}  SCRATCH={SCRATCH} #####")
os.makedirs(SCRATCH, exist_ok=True)
for f in ("erp.db", "tenant_1.db", "tenant_10.db"):
    p = os.path.join(PROD, f)
    if os.path.exists(p):
        cp(p, os.path.join(SCRATCH, f))

# ---- import 前设 ERP_DB_PATH：让 erp_db 与 db.connection 两份都指向副本 ----
os.environ["ERP_DB_PATH"] = os.path.join(SCRATCH, "erp.db")
sys.path.insert(0, SRC)
import erp_db
from db import connection

TEN = os.path.join(SCRATCH, "tenant_1.db")

def q(sql, args=()):
    c = sqlite3.connect("file:%s?mode=ro" % TEN, uri=True); c.row_factory = sqlite3.Row
    r = [dict(x) for x in c.execute(sql, args)]; c.close(); return r

def w(sql, args=()):
    c = sqlite3.connect(TEN); c.execute("PRAGMA busy_timeout=8000"); c.execute(sql, args); c.commit(); c.close()

print("\n== 0. 硬护栏：自证连在副本上 ==")
print("  connection.DB_DIR =", connection.DB_DIR)
ck_bool("DB_DIR == 副本目录", os.path.realpath(connection.DB_DIR) == os.path.realpath(SCRATCH))
connection.set_tenant_context(1)
_tdb = connection._tenant_db.get()
ck_bool("租户库 == 副本 tenant_1.db", os.path.realpath(_tdb) == os.path.realpath(TEN))
with erp_db.get_db() as c:
    main = {r[1]: r[2] for r in c.execute("PRAGMA database_list")}["main"]
print("  写路径 main =", main)
if os.path.realpath(main) != os.path.realpath(TEN):
    print("  🔴 写路径不在副本上 —— 中止"); sys.exit(2)

print("\n  仓库:", {r["id"]: r["name"] for r in q("SELECT id,name FROM warehouses")})
print("  员工个人仓:", {r["id"]: r["warehouse_id"] for r in q("SELECT id,warehouse_id FROM hr_employees") if r["warehouse_id"]})
maps0 = q("SELECT id,employee_id,counterparty_id,counterparty_type,report_alias FROM report_mapping")

# ============ A. _resolve_self_warehouse 单元语义 ============
print("\n== A. `_resolve_self_warehouse` 单元语义（真函数） ==")
has_fn = hasattr(erp_db, "_resolve_self_warehouse")
if MODE == "old":
    ck_bool("老代码**没有**这个新函数（证明它是本轮新增）", has_fn is False, f"hasattr={has_fn}")
else:
    ck_bool("新代码有 `_resolve_self_warehouse`", has_fn is True)
    conn = sqlite3.connect(TEN); conn.row_factory = sqlite3.Row
    def resolve(eid, wh):
        r = erp_db._resolve_self_warehouse(conn, eid, wh); conn.commit(); return r
    def wh_of(eid):
        return conn.execute("SELECT warehouse_id FROM hr_employees WHERE id=?", (eid,)).fetchone()["warehouse_id"]

    r = resolve(2, 10)   # 正例：王老板(wh=0) → 张俊峰仓(10, 空闲)
    ck("正例 返回仓 id", r[0], 10); ck("正例 返回仓名", r[1], "张俊峰仓"); ck("正例 无错误", r[2], "")
    ck("正例 已回写 hr_employees.warehouse_id", wh_of(2), 10)

    r = resolve(2, 5)    # 反例①：悬空仓（生产旧值，仓库表不存在）
    ck("反例① 不返回仓 id", r[0], 0)
    ck_bool("反例① 报「仓库不存在」", "仓库不存在" in r[2], r[2])
    ck("反例① 未改库（仍 10）", wh_of(2), 10)

    r = resolve(2, 7)    # 反例②：已属刘小顶 → 一人一仓
    ck("反例② 不返回仓 id", r[0], 0)
    ck_bool("反例② 报「已指派给 刘小顶」", ("已指派给" in r[2] and "刘小顶" in r[2]), r[2])
    ck("反例② 未改库（仍 10）", wh_of(2), 10)

    r = resolve(99999, 10)   # 反例③：员工不存在
    ck_bool("反例③ 报「员工不存在」", "员工不存在" in r[2], r[2])

    r = resolve(4, 7)    # 自身重入：emp4 本就 7，占用检测须排除自己
    ck("自我重入 返回 7", r[0], 7); ck("自我重入 无错误", r[2], "")
    ck("emp4 仍为 7（未误伤）", wh_of(4), 7)
    conn.close()

# ============ B. 端点级：create / update 本人仓分支 ============
print("\n== B. `report_mapping_create / update` 本人仓分支（真端点函数） ==")
def mk(eid, wh, alias, ctype="self_warehouse", with_key=True):
    body = {"employee_id": eid, "counterparty_type": ctype, "report_alias": alias, "src_wh": 3}
    if with_key:
        body["counterparty_id"] = wh
    return erp_db.report_mapping_create(body)

def get_map(mid):
    r = q("SELECT counterparty_id, system_name FROM report_mapping WHERE id=?", (mid,))
    return r[0] if r else {}

def wh_of(eid):
    return q("SELECT warehouse_id FROM hr_employees WHERE id=?", (eid,))[0]["warehouse_id"]

# 造一个空闲仓 + 两个测试员工（隔离各断言，避免互相撞「同一对象唯一活跃配置」）
w("INSERT INTO warehouses(name, is_active, wh_type, status) VALUES('v381空仓', 1, 'stores', '正常')")
W2 = q("SELECT MAX(id) m FROM warehouses")[0]["m"]
eid2 = erp_db.employee_create("v381回退员")
eid3 = erp_db.employee_create("v381无仓员")
print(f"  造数：空闲仓 W2={W2}  回退员工={eid2}  无仓员工={eid3}")

if MODE == "old":
    res = mk(2, 10, "v381老口径")   # 王老板此时 wh=0（新库；老库生产是 5 悬空）
    print("  老代码 create(self_wh, counterparty_id=10, 员工wh=0) ->", res)
    ck_bool("老代码：counterparty_id 被忽略 ⇒ 报「未配置本人仓」死胡同",
            bool(res.get("error")) and ("本人仓" in str(res.get("error")) or "个人仓" in str(res.get("error"))),
            str(res))
    # 老代码还会**静默接受悬空仓**：员工 wh=5 不存在也能建（无校验）
    w("UPDATE hr_employees SET warehouse_id=5 WHERE id=2")
    res2 = mk(2, 0, "v381老悬空")
    print("  老代码 create(员工wh=5悬空, 不传) ->", res2)
    ck_bool("老代码：悬空仓 **不报错**（无仓库存在性校验）= 病根", res2.get("success") is True, str(res2))
else:
    wh_of_2_before = wh_of(2)

    # (a) 显式 counterparty_id 优先（报单配置页新下拉走此路）
    res = mk(2, 10, "v381测试A")
    ck_bool("(a) 显式传 counterparty_id ⇒ 成功", res.get("success") is True and res.get("mapping_id"), str(res))
    mid = res.get("mapping_id"); m = get_map(mid)
    ck("(a) 落库 counterparty_id=10", m.get("counterparty_id"), 10)
    ck("(a) 落库 system_name=张俊峰仓", m.get("system_name"), "张俊峰仓")
    ck("(a) 连带回写 hr_employees.warehouse_id=10", wh_of(2), 10)

    # (b) 悬空仓（生产旧值 5）被拒
    res = mk(2, 5, "v381测试B")
    ck_bool("(b) 悬空仓被拒", bool(res.get("error")) and "仓库不存在" in res["error"], str(res))

    # (c) 不传 counterparty_id ⇒ 回退读 hr_employees（Excel 导入 / 历史脚本老路）
    w("UPDATE hr_employees SET warehouse_id=? WHERE id=?", (W2, eid2))
    res = mk(eid2, 0, "v381测试C", with_key=False)
    ck_bool("(c) 未传 key ⇒ 回退读 hr_employees 成功", res.get("success") is True, str(res))
    if res.get("mapping_id"):
        ck("(c) 落库 counterparty_id=空闲仓", get_map(res["mapping_id"]).get("counterparty_id"), W2)

    # (d) 既未传、员工也没设 ⇒ 明确报错（非静默）
    res = mk(eid3, 0, "v381测试D", with_key=False)
    ck_bool("(d) 报「请选择该员工的个人仓」", bool(res.get("error")) and "个人仓" in res["error"], str(res))

    # (e) 占用仓被拒
    res = mk(2, 7, "v381测试E")
    ck_bool("(e) 占用仓被拒(刘小顶)", bool(res.get("error")) and "已指派给" in res["error"], str(res))

    # (f) update：换成别人的仓 ⇒ 拒
    res = erp_db.report_mapping_update(mid, {"counterparty_id": W2})
    ck_bool("(f) update 换成已占用仓被拒", bool(res.get("error")) and "已指派给" in res["error"], str(res))

    # (g) update：不传 counterparty_id 键 ⇒ 回退读该员工 hr_employees（=10，等于现值）⇒ 成功
    res = erp_db.report_mapping_update(mid, {"system_name": "v381改名"})
    ck_bool("(g) update 不带 counterparty_id ⇒ 回退成功", res.get("success") is True, str(res))
    ck("(g) 现值仍指向 10", get_map(mid).get("counterparty_id"), 10)

    # (h) update：显式改到另一个空闲仓（新建一个）
    w("INSERT INTO warehouses(name, is_active, wh_type, status) VALUES('v381空仓2', 1, 'stores', '正常')")
    W3 = q("SELECT MAX(id) m FROM warehouses")[0]["m"]
    res = erp_db.report_mapping_update(mid, {"counterparty_id": W3})
    ck_bool("(h) update 显式改到空闲仓成功", res.get("success") is True, str(res))
    ck("(h) 落库 counterparty_id=新仓", get_map(mid).get("counterparty_id"), W3)
    ck("(h) 连带回写 hr_employees.warehouse_id", wh_of(2), W3)

# ============ C. 既有「本人仓」映射未被破坏 ============
print("\n== C. 既有「本人仓」映射未被破坏（超集核对） ==")
maps2 = q("SELECT id,employee_id,counterparty_id,counterparty_type FROM report_mapping")
base = sorted((m["employee_id"], m["counterparty_id"]) for m in maps0 if m["counterparty_type"] == "self_warehouse")
cur = sorted((m["employee_id"], m["counterparty_id"]) for m in maps2 if m["counterparty_type"] == "self_warehouse")
ck_bool("既有 3 条本人仓映射仍在（超集）", set(base).issubset(set(cur)), f"base={base} cur={cur}")

print(f"\n##### MODE={MODE}: {ok_n} PASS / {fail_n} FAIL #####")
print("  副本目录(跑完应删除):", SCRATCH)
sys.exit(1 if fail_n else 0)
