# -*- coding: utf-8 -*-
"""v264c 沙箱端到端（2026-09-24）—— P0 剩余三项的隔离库验收。

覆盖：
  ① `/api/products/fill-search` 的单位打通（R2 / 方案 §2.3 陷阱 B）
     `unit` 改为「`order_unit` 优先 → 空回退 `unit`」，与 Web 主表同源；
     只增 `order_unit` / `unit_raw` 两个键。
  ② `/api/product-targets/mapping-audit` 报单列名对账（R9 的"可见"部分，**只读**）。
  ③ `POST /api/forecast-submissions/save-matrix` 的 `store_id`（R9 的"写"部分）
     —— 修前硬编码 0，修后走唯一解析 `resolve_alias_to_contact`；
     ⚠️ 解析**必须在写事务之前**（另开连接读同一 SQLite 会与写事务互锁）。

跑法：python3 .workbuddy/tools/v264c-sandbox.py
⚠️ 全程只在 /tmp 下的隔离库上跑，绝不碰生产。
"""
import asyncio
import json
import os
import shutil
import sqlite3
import sys

BE = "/Users/zhangjunfeng/Documents/hergent-erp"
SANDBOX = "/tmp/v264c-sandbox"
DB = os.path.join(SANDBOX, "erp.db")
TDB = os.path.join(SANDBOX, "tenant_1.db")
TENANT = 1
PERIOD_ID = 18

# 生产 tenant_1 的**真实值**（2026-09-24 实测读出，不是编的）：
PID_GOD = 1449      # 蒙牛0蔗糖…150g*5袋*8包 | unit=袋 order_unit=''  大=件/40 中=包/5
PID_OU = 1596       # unit=瓶 order_unit=组                  ← 生产上唯一「两口径不同」的那个
PID_RAW = 7001      # 无任何大单位换算（large_ratio=0）—— 目标页该禁选
CID_STORE = 9527    # 门店：永辉东津店
ALIAS_OK = "东津"    # 在 report_mapping 里配了 ⇒ 能解析
ALIAS_NO = "吾悦"    # 没配 ⇒ 解析不到，落 0 并被点名

fails = []


def ck(name, got, want, tol=1e-6):
    ok = (abs(got - want) <= tol) if isinstance(want, (int, float)) and not isinstance(want, bool) \
        else (got == want)
    print("   %s %-52s got=%-16s want=%s" % ("ok  " if ok else "FAIL", name, got, want))
    if not ok:
        fails.append("%s: got=%r want=%r" % (name, got, want))


class FakeReq:
    """只实现端点用到的那点 Request 接口（json()）。"""
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def call(x):
    """调端点，并**过一遍 JSON 往返** —— 复刻真 HTTP 的序列化。

    🔴 必须：端点返回的 `items` 是 **int 键**字典（`{1449: {...}}`）；走 HTTP 时
    FastAPI 会序列化成 `{"1449": {...}}`，直接调函数则保留 int 键。
    不往返就会写出「本地通过、线上 KeyError」的假绿断言。

    ⚠️ 两个端点的形态不同：`product_targets` 的都是 `async def`，
    而 `data.fill_search_products` 是**同步 def** ⇒ 这里必须两种都接。
    """
    if asyncio.iscoroutine(x):
        x = asyncio.run(x)
    return json.loads(json.dumps(x, ensure_ascii=False))


print("=" * 78)
print("v264c 沙箱：%s" % SANDBOX)
shutil.rmtree(SANDBOX, ignore_errors=True)
os.makedirs(SANDBOX)
os.environ["ERP_DB_PATH"] = DB
# core.py 在 import 期就硬校验 ERP_SECRET（生产由 systemd 注入）。沙箱只验业务逻辑，
# 用一个一次性占位值，**绝不**落到磁盘。
os.environ.setdefault("ERP_SECRET", "sandbox-only-not-a-real-secret-" + "0" * 32)
sys.path.insert(0, os.path.join(BE, "server"))

import erp_db as db                                             # noqa: E402
from db.connection import get_db, set_tenant_context, _ensure_tenant_db  # noqa: E402
import routers.product_targets as pt                            # noqa: E402
import routers.data as data                                     # noqa: E402
import routers.forecast_submissions as fs                       # noqa: E402

# 端点鉴权在沙箱里换成固定身份（只替 `_auth`，其余逻辑全走真实实现）
pt._auth = lambda request: {"username": "tester", "role": "admin", "name": "测试经理"}
data._auth = lambda request: {"username": "tester", "role": "admin", "name": "测试经理"}
fs._auth = lambda request: {"id": 99, "username": "tester", "role": "admin", "name": "测试经理"}

# v206 的生产守卫（**保留**）：`_ensure_tenant_db` 只给主库 `tenants` 表里确有其人的 tid 建库。
with get_db() as c:
    c.execute("INSERT OR REPLACE INTO tenants (id,name,subdomain,is_active) VALUES (?,?,?,1)",
              (TENANT, "沙箱租户", "sandbox"))
    c.commit()
_ensure_tenant_db(TENANT, TDB)
set_tenant_context(TENANT)

# `tenant_db_init` 只复制主库 schema；`report_mapping` 这类模块表由
# `_ensure_tenant_module_tables` 惰性下发（生产同一步），必须显式补 —— 否则沙箱拿一个
# 比生产"年轻"的库去测，断言失败会是脚本的假阳/假阴，而不是产品缺陷。
_con = sqlite3.connect(TDB)
db._ensure_forecast_tables(_con)
try:
    # ⚠️ 本函数**不收参数**（内部自己开连接/取租户上下文）—— 与 `_ensure_forecast_tables` 不同，
    #    别照抄签名（沙箱第一版就因此静默跳过，`report_mapping` 没被下发）。
    db._ensure_tenant_module_tables()
except Exception as e:
    print("   ⚠️ _ensure_tenant_module_tables 调用异常（继续，看后续是否真缺表）：%s" % e)
_con.commit()
_con.close()

# ---------------- 灌数据 ----------------
print("\n灌数据（商品字段逐字取生产 tenant_1 真值）")
with get_db() as c:
    c.execute("INSERT OR REPLACE INTO products "
              "(id,name,spec,unit,order_unit,large_unit,large_ratio,"
              " medium_unit,medium_ratio,brand,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
              (PID_GOD, "蒙牛0蔗糖原味百利包150g*5袋*8包", "150g*5袋*8包", "袋", "",
               "件", 40, "包", 5, "蒙牛低温"))
    # 🔴 生产 id=1596 的真实形态：unit='瓶' / order_unit='组' / large_ratio=0 / spec='24'
    c.execute("INSERT OR REPLACE INTO products "
              "(id,name,spec,unit,order_unit,large_unit,large_ratio,is_active) "
              "VALUES (?,?,?,?,?,?,?,1)",
              (PID_OU, "蒙牛真果粒（组报单测试品）", "24", "瓶", "组", "", 0))
    c.execute("INSERT OR REPLACE INTO products "
              "(id,name,spec,unit,order_unit,large_unit,large_ratio,is_active) "
              "VALUES (?,?,?,?,?,?,?,1)",
              (PID_RAW, "无换算测试品", "500g", "瓶", "", "", 0))
    c.execute("INSERT OR REPLACE INTO contacts (id,name,type,is_active) VALUES (?,?,?,1)",
              (CID_STORE, "永辉东津店", "customer"))
    c.execute("INSERT OR REPLACE INTO forecast_periods "
              "(id,name,order_start,order_end,arrival_date,status) VALUES (?,?,?,?,?,'open')",
              (PERIOD_ID, "9月第19期", "2026-09-23", "2026-09-24", "2026-09-25"))
    for pid in (PID_GOD, PID_OU):
        c.execute("INSERT INTO forecast_import_products (period_id, product_id, sort_no) "
                  "VALUES (?,?,?)", (PERIOD_ID, pid, (PID_GOD - pid) + 10))
    # 报单配置：只有「东津」这一个别名（「吾悦」故意不配）
    c.execute("INSERT INTO report_mapping "
              "(employee_id, counterparty_type, counterparty_id, system_name, report_alias, is_active) "
              "VALUES (?,?,?,?,?,1)", (6, "store", CID_STORE, "永辉东津店", ALIAS_OK))
    # 存量报单（#1 带 id、#2/#3 是历史 0 —— 复刻生产「38/39 为 0」的形态）
    c.execute("INSERT INTO forecast_submissions "
              "(user_id,role,store_id,store_name,order_date,status,period_id) "
              "VALUES (6,'sales',?,?, '2026-09-23','submitted',?)", (CID_STORE, ALIAS_OK, PERIOD_ID))
    c.execute("INSERT INTO forecast_submissions "
              "(user_id,role,store_id,store_name,order_date,status,period_id) "
              "VALUES (7,'sales',0,?, '2026-09-23','submitted',?)", (ALIAS_NO, PERIOD_ID))
    c.commit()

# ============================================================================
print("\n① fill-search：单位与 Web 主表**同源**（R2 / 陷阱 B）")
r = call(data.fill_search_products(FakeReq(), q="", limit=50, offset=0, period_id=PERIOD_ID))
by = {str(x["id"]): x for x in r["items"]}
ck("返回条数 == 本期清单 2 个", len(r["items"]), 2)
ck("scope == period（走期次清单分支）", r["scope"], "period")

a = by[str(PID_GOD)]
ck("1449（order_unit=''）unit 回退档案「袋」", a["unit"], "袋")
ck("1449 unit_raw == 袋", a["unit_raw"], "袋")
ck("1449 order_unit 原值 == 空串", a["order_unit"], "")

b = by[str(PID_OU)]
ck("🔴 1596 unit == 报单单位「组」（不是档案「瓶」）", b["unit"], "组")
ck("1596 unit_raw == 档案小单位「瓶」", b["unit_raw"], "瓶")
ck("1596 order_unit 原值 == 组", b["order_unit"], "组")
ck("既有键 sale_price 仍在（只增不减）", "sale_price" in b, True)

# 档案兜底分支（不带 period_id）也必须同源
r2 = call(data.fill_search_products(FakeReq(), q="", limit=50, offset=0, period_id=0))
by2 = {str(x["id"]): x for x in r2["items"]}
ck("档案兜底分支 scope == catalog", r2["scope"], "catalog")
ck("🔴 档案兜底分支同样按 order_unit 优先", by2[str(PID_OU)]["unit"], "组")

# ============================================================================
print("\n② avg-target 的单位 == fill-search 的单位（同源，防'两把尺子'）")
res = call(pt.create_target(FakeReq({
    "name": "9月组报单测试目标", "period_month": "2026-09", "product_id": PID_GOD,
    "target_qty": 30, "basis": "qty",
    "allocs": [{"employee_id": 1, "employee_name": "张三", "ratio": 100}],
})))
ck("1449 建目标成功（有换算）", res["ok"], True)
avg = call(pt.avg_target(FakeReq(), period_id=PERIOD_ID))
ck("1449 avg-target.unit == fill-search.unit",
   avg["items"][str(PID_GOD)]["unit"], by[str(PID_GOD)]["unit"])
ck("1596 avg-target.unit == fill-search.unit",
   avg["items"][str(PID_OU)]["unit"], by[str(PID_OU)]["unit"])
ck("1596 无目标 ⇒ 打 no_target 标（不编数）",
   avg["items"][str(PID_OU)]["flags"].get("no_target"), True)

# ============================================================================
print("\n③ mapping-audit：列名 ↔ 报单对象 对账（只读）")
audit = call(pt.mapping_audit(FakeReq()))
cols = {x["name"]: x for x in audit["columns"]}
ck("总报单行数", audit["rows_total"], 2)
ck("带 store_id 的行数", audit["rows_with_id"], 1)
ck("不带 store_id 的行数", audit["rows_without_id"], 1)
ck("「东津」状态 = mapped", cols[ALIAS_OK]["status"], "mapped")
ck("「东津」解析出的门店 id", cols[ALIAS_OK]["contact_id"], CID_STORE)
ck("「吾悦」状态 = unknown（没配映射、也无同名客户）", cols[ALIAS_NO]["status"], "unknown")
ck("未配映射名单 == ['吾悦']", audit["unmapped"], [ALIAS_NO])
ck("unmapped_count", audit["unmapped_count"], 1)

# ============================================================================
print("\n④ save-matrix：store_id 走唯一解析（R9 的「写」部分）")
before = None
with get_db() as c:
    before = c.execute("SELECT COUNT(*) FROM forecast_submissions WHERE role='导入'").fetchone()[0]
ck("保存前 role='导入' 行数 == 0", before, 0)

res2 = call(fs.save_matrix(FakeReq({
    "start": "2026-09-23", "end": "2026-09-24", "period_id": PERIOD_ID,
    "customers": [ALIAS_OK, ALIAS_NO],
    "rows": [{"product_id": PID_GOD, "product_name": "蒙牛0蔗糖原味百利包150g",
              "spec": "150g*5袋*8包", "unit": "袋", "price": 0,
              "qty_by_unit": {ALIAS_OK: 40, ALIAS_NO: 8}}],
})))
ck("保存成功", res2.get("success"), True)
ck("落库客户数 == 2", res2["saved_customers"], 2)
ck("🔴 回执点名未配映射的列 == ['吾悦']", res2["unmapped_columns"], [ALIAS_NO])

with get_db() as c:
    c.row_factory = sqlite3.Row
    rows = {r["store_name"]: dict(r) for r in c.execute(
        "SELECT store_id, store_name FROM forecast_submissions WHERE role='导入'").fetchall()}
ck("两条列都落了库", len(rows), 2)
ck("🔴 「东津」store_id == 门店 id（修前恒 0）", rows[ALIAS_OK]["store_id"], CID_STORE)
ck("🔴 「东津」store_name 仍是**列名**（没裂成系统全称）", rows[ALIAS_OK]["store_name"], ALIAS_OK)
ck("「吾悦」解析不到 ⇒ 保持 0（不猜）", rows[ALIAS_NO]["store_id"], 0)
ck("「吾悦」store_name 也保持列名", rows[ALIAS_NO]["store_name"], ALIAS_NO)

print("\n④b 幂等：同一期次再存一次，仍只有 2 条（先清后建）")
res3 = call(fs.save_matrix(FakeReq({
    "start": "2026-09-23", "end": "2026-09-24", "period_id": PERIOD_ID,
    "customers": [ALIAS_OK],
    "rows": [{"product_id": PID_GOD, "product_name": "蒙牛0蔗糖原味百利包150g",
              "spec": "150g*5袋*8包", "unit": "袋", "price": 0,
              "qty_by_unit": {ALIAS_OK: 24}}],
})))
with get_db() as c:
    n = c.execute("SELECT COUNT(*) FROM forecast_submissions WHERE role='导入'").fetchone()[0]
ck("重存后 role='导入' 行数 == 1（旧的被清）", n, 1)
ck("本次无未配映射列 ⇒ 回执为空", res3["unmapped_columns"], [])

# ============================================================================
print("\n⑤ 回归：mapping-audit 在保存后仍自洽")
audit2 = call(pt.mapping_audit(FakeReq()))
cols2 = {x["name"]: x for x in audit2["columns"]}
ck("「东津」现在所有行都带 id", cols2[ALIAS_OK]["rows_with_id"], cols2[ALIAS_OK]["rows"])
# ⚠️ 第一版这里断言「吾悦已消失」是**错的**：`save_matrix` 的幂等清理只清 `role='导入'`，
#    而「吾悦」还剩一条 `role='sales'` 的小程序报单 —— 它本就不该被 Web 端保存动作删掉。
ck("「吾悦」的导入单已被幂等清理（只剩小程序报单那条）", cols2[ALIAS_NO]["rows"], 1)
ck("🔴 「吾悦」历史行仍是 0（**本次不回填存量**，只堵新增）",
   cols2[ALIAS_NO]["rows_with_id"], 0)

print("\n" + "=" * 78)
if fails:
    print("❌ 失败 %d 项：" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("✅ v264c 沙箱全部通过")
print("=" * 78)
