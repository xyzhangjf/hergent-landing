#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v264 商品目标管理 · 端到端沙箱冒烟（**隔离库，绝不碰生产**）。

在 `/tmp/v264-e2e-sandbox` 里造一个租户库 → 灌进 1 个商品（带三级换算）+ 1 个期次 +
1 笔报单 + 1 条达成填报 + 1 条品牌到货规则 → 然后**真调** `routers/product_targets` 的
端点函数（只把 `_auth` 换成假用户，业务代码一行不改）→ 断言方案 §5.1/§5.2 的公式。

断言策略：**查关系，不查死数**。
  · 均单剩余  == (月目标 − 已达成) ÷ 剩余期次
  · 加单预填  == 均单剩余 − 本期报单合计（**不含加单**）
  · per_unit  == 均单剩余 × 该单位每箱数
理由：剩余期次取自「整月到货日历 vs 今天」，会随运行日期变；写死 3 会让脚本隔天就红。
"""
import asyncio
import json
import os
import shutil
import sqlite3
import sys

SANDBOX = "/tmp/v264-e2e-sandbox"
BE = "/Users/zhangjunfeng/Documents/hergent-erp"
DB = os.path.join(SANDBOX, "erp.db")
TENANT = 1
TDB = os.path.join(SANDBOX, "tenant_1.db")

PID_GOD = 1449         # 有三级换算：袋/包/件，5 袋=1 包，40 袋=1 件（= 8 包/件）
PID_RAW = 1550         # 故意没有大单位换算 ⇒ 不允许设目标
PID_ORPHAN = 8888      # 明细里有、但 products 里没有（前端整行丢弃；本接口必须显式打标）
PERIOD_ID = 18

fails = []


def ck(name, got, want, tol=1e-6):
    ok = (abs(got - want) <= tol) if isinstance(want, (int, float)) and not isinstance(want, bool) \
        else (got == want)
    print("   %s %-50s got=%-14s want=%s" % ("ok  " if ok else "FAIL", name, got, want))
    if not ok:
        fails.append("%s: got=%r want=%r" % (name, got, want))


class FakeReq:
    """只实现端点用到的那点 Request 接口（json()）。"""
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def call(coro):
    """调端点协程，并**过一遍 JSON 往返** —— 复刻真 HTTP 的序列化。

    🔴 为什么必须：端点返回的 `items` 是 **int 键**字典（`{1449: {...}}`）。
    走 HTTP 时 FastAPI 会把它序列化成 `{"1449": {...}}`；**直接 `asyncio.run()`
    调函数则保留 int 键**。不往返就会写出「本地通过、线上 KeyError」的假绿断言 ——
    正是本项目「探针口径必须与生产一致」那条铁律在测试脚本上的同型问题。
    """
    return json.loads(json.dumps(asyncio.run(coro), ensure_ascii=False))


print("=" * 78)
print("沙箱：%s" % SANDBOX)
shutil.rmtree(SANDBOX, ignore_errors=True)
os.makedirs(SANDBOX)
os.environ["ERP_DB_PATH"] = DB
# core.py 在 import 期就硬校验 ERP_SECRET（生产由 systemd 注入）。
# 沙箱只验业务逻辑、不碰任何真实密钥 ⇒ 用一次性占位值，且**绝不**落到磁盘。
os.environ.setdefault("ERP_SECRET", "sandbox-only-not-a-real-secret-" + "0" * 32)
sys.path.insert(0, os.path.join(BE, "server"))

import erp_db as db                                    # noqa: E402
from db.connection import get_db, set_tenant_context, _ensure_tenant_db  # noqa: E402
import routers.product_targets as pt                   # noqa: E402
from domain import product_targets as algo             # noqa: E402

pt._auth = lambda request: {"username": "tester", "role": "admin", "name": "测试经理"}
print("主库就绪，准备租户库 …")
# v206 的生产守卫（**必须保留**）：`_ensure_tenant_db` 只给主库 `tenants` 表里
# 确有其人的 tid 建库 —— 防止任何带「早已不存在的租户 id」的请求凭空造空壳库。
# 沙箱是新建主库 ⇒ 必须先按真实注册流程登记一行，否则守卫会（正确地）拒建。
with get_db() as c:
    c.execute("INSERT OR REPLACE INTO tenants (id,name,subdomain,is_active) VALUES (?,?,?,1)",
              (TENANT, "沙箱租户", "sandbox"))
    c.commit()
_ensure_tenant_db(TENANT, TDB)
set_tenant_context(TENANT)

# `tenant_db_init` 只复制**主库 schema**，而 `forecast_submissions.period_id` 这类列在
# 生产是由**惰性建表** `_ensure_forecast_tables(db)` 在首个请求时补上的（主库 DDL 里没有）。
# 沙箱若不补这一步，就会拿一个比生产「年轻」的租户库去测 —— 断言失败会是**脚本的假阳/假阴**，
# 而不是产品缺陷。故此处显式调用同一个生产函数（不自己写 ALTER）。
_con_t = sqlite3.connect(TDB)
db._ensure_forecast_tables(_con_t)
_con_t.commit()
_con_t.close()

# ---------------- 灌数据 ----------------
# 🔴 商品字段**逐字取生产 tenant_1 的真值**（2026-09-24 实测读出，不是编的）：
#    id=1449 蒙牛0蔗糖原味百利包150g*5袋*8包 | spec=150g*5袋*8包 | unit=袋 | order_unit=''
#            | medium_unit=包/5 | large_unit=件/40     ⇒ 每箱 8 包 = 40÷5
#    ⚠️ `order_unit=''` 是关键：报单单位全链回退「袋」⇒ 用户报「40」= 40 **袋** = 1 件 = 1 箱。
#       本脚本上一版把明细行写成「40 包」并期望 5 箱 —— 那是**不现实的数据**，
#       断言本身错了（前端 `rowBoxes` 在售行按**档案 unit** 折箱，与生产汇总表同源）。
with get_db() as c:
    c.execute("INSERT OR REPLACE INTO products "
              "(id,name,spec,unit,order_unit,large_unit,large_ratio,"
              " medium_unit,medium_ratio,brand,is_active) "
              "VALUES (?,?,?,?,?,?,?,?,?,?,1)",
              (PID_GOD, "蒙牛0蔗糖原味百利包150g*5袋*8包", "150g*5袋*8包", "袋", "",
               "件", 40, "包", 5, "蒙牛低温"))
    c.execute("INSERT OR REPLACE INTO products "
              "(id,name,spec,unit,large_unit,large_ratio,is_active) VALUES (?,?,?,?,?,?,1)",
              (PID_RAW, "无换算测试品", "500g", "瓶", "", 0))
    c.execute("INSERT OR REPLACE INTO forecast_periods "
              "(id,name,order_start,order_end,arrival_date,status) VALUES (?,?,?,?,?,'open')",
              (PERIOD_ID, "9月第18期", "2026-09-23", "2026-09-24", "2026-09-25"))
    try:
        c.execute("INSERT INTO forecast_import_products (period_id, product_id) VALUES (?,?)",
                  (PERIOD_ID, PID_GOD))
    except Exception as e:
        print("   ⚠️ forecast_import_products 灌入失败（不影响主链）：%s" % e)
    # 品牌到货规则：每 2 天一次、覆盖次数 15（= 用户说的「可报 15 单」）
    c.execute("INSERT INTO rebate_target_rules "
              "(rule_name,dimension,scope_key,scope_name,is_active,arrival_mode,"
              " arrival_first_dom,arrival_cadence_days,arrival_count_override) "
              "VALUES (?,?,?,?,1,'interval',1,2,15)",
              ("蒙牛低温2026年目标", "brand", "蒙牛低温", "蒙牛低温"))
    # 本期报单：刘善涛报 40 袋（报单单位 = 袋 ⇒ 40 ÷ 40 袋/件 = 1 箱）
    cur = c.execute("INSERT INTO forecast_submissions "
                    "(user_id,role,store_id,store_name,order_date,status,period_id) "
                    "VALUES (6,'sales',0,'刘善涛','2026-09-23','submitted',?)", (PERIOD_ID,))
    sid = cur.lastrowid
    c.execute("INSERT INTO forecast_submission_items "
              "(submission_id,product_id,product_name,spec,unit,quantity) VALUES (?,?,?,?,?,?)",
              (sid, PID_GOD, "蒙牛0蔗糖原味百利包150g", "150g*5袋*8包", "袋", 40))
    # 🔴 探针行 1：`/save-matrix` 写的**列占位行**（生产 47 条明细里 37 条是它）
    #    数量刻意写 999 当**金丝雀** —— 权威汇总 `forecast_submission_summary` 有
    #    `i.product_name != '__列占位__'` 判据，本模块必须同样排除；不排除就会多出一个 pid=0 假商品。
    c.execute("INSERT INTO forecast_submission_items "
              "(submission_id,product_id,product_name,spec,unit,quantity) VALUES (?,?,?,?,?,?)",
              (sid, 0, "__列占位__", "", "件", 999))
    # 🔴 探针行 2：**商品不在档案**的明细（pid 不在 products）—— 前端整行丢弃，本接口保留并打标
    c.execute("INSERT INTO forecast_submission_items "
              "(submission_id,product_id,product_name,spec,unit,quantity) VALUES (?,?,?,?,?,?)",
              (sid, PID_ORPHAN, "已删除的老商品", "8", "条", 16))
    # 被撤回的单（必须**不算**进本期报单合计）
    cur = c.execute("INSERT INTO forecast_submissions "
                    "(user_id,role,store_id,store_name,order_date,status,period_id) "
                    "VALUES (7,'sales',0,'已撤回店','2026-09-23','recalled',?)", (PERIOD_ID,))
    c.execute("INSERT INTO forecast_submission_items "
              "(submission_id,product_id,product_name,spec,unit,quantity) VALUES (?,?,?,?,?,?)",
              (cur.lastrowid, PID_GOD, "蒙牛0蔗糖原味百利包150g", "150g*5袋*8包", "袋", 999))
    # 达成填报（D1：商品维度）
    c.execute("INSERT INTO rebate_achievements "
              "(period_month,dimension,scope_key,scope_name,actual_amount,actual_qty,actual_unit) "
              "VALUES ('2026-09','product','1449','蒙牛0蔗糖原味百利包150g',0,15,'件')")
    c.commit()

# ---------------- ① 建目标 ----------------
print("\n① 新建目标（自动分解 60% / 40%）")
res = call(pt.create_target(FakeReq({
    "name": "9月0糖袋目标", "period_month": "2026-09", "product_id": PID_GOD,
    "target_qty": 150, "basis": "qty",
    "allocs": [{"employee_id": 1, "employee_name": "张三", "ratio": 60},
               {"employee_id": 2, "employee_name": "李四", "ratio": 40}],
})))
ck("创建成功", res["ok"], True)
TID = res["id"]
ck("可报单数快照 = 15", res["effective_count"], 15)

print("\n② 分解明细：目标 150 箱 ⇒ 90 / 60")
lst = call(pt.list_targets(FakeReq(), month="2026-09"))
row = lst["items"][0]
ck("分解目标 = 目标 × 占比", [a["target_qty"] for a in row["allocs"]], [90.0, 60.0])
ck("Σ 分解 == 目标 150", row["alloc_total"], 150.0)
ck("已达成（箱）= 15 件（大单位）", row["achieved_box"], 15.0)

print("\n③ 均单目标 + 加单预填（方案 §5.1 / §5.2 的核心公式）")
avg = call(pt.avg_target(FakeReq(), period_id=PERIOD_ID))
it = avg["items"][str(PID_GOD)]
rem = it.get("remaining_periods")
print("     剩余可报期次 = %s（整月到货日历里 >= 今天 的天数，1/3/5…/29 共 %s 期）"
      % (rem, it.get("total_periods")))
# 报单合计的**正确期望值**：40 袋 ÷ 40 袋/件 = 1 件 = 1 箱。
# ⚠️ 折箱基准 = **档案 `products.unit`（袋）** —— 这是前端 `rowBoxes` 的事实口径
#    （在售档案行 r.unit 直接取自 /api/products/grid），故与用户同屏的「合计(箱)」可比。
EXP_BOX = 1.0
if rem:
    ck("均单剩余 == (150 − 15) ÷ 剩余期次", it["avg_box"], round(135.0 / rem, 3), tol=0.002)
    ck("本期报单合计 == 40 袋 ÷ 40 袋/件 = 1 箱", it["reported_box"], EXP_BOX, tol=0.002)
    ck("报单单位（回退档案 unit）= 袋", it["unit"], "袋")
    ck("折箱基准单位 = 袋", it["box_unit"], "袋")
    ck("🔴 撤回的单不算（999 袋没被计入）", it["reported_box"] < 5, True)
    ck("加单预填 == 均单剩余 − 1（**不含加单**）", it["prefill_box"],
       round(it["avg_box"] - EXP_BOX, 3), tol=0.002)
    ck("按「包」显示 == 均单 × 8（用户口径：8 包/箱）",
       it["per_unit"]["包"], round(it["avg_box"] * 8, 3), tol=0.01)
    ck("按「袋」显示 == 均单 × 40", it["per_unit"]["袋"], round(it["avg_box"] * 40, 3), tol=0.01)
    ck("按「件」显示 == 均单 × 1", it["per_unit"]["件"], round(it["avg_box"], 3), tol=0.002)
    ck("无 flags（正常路径）", it["flags"], {})
else:
    print("   （剩余期次为 0：今天已过完本月到货日，跳过公式断言）")

print("\n③b 折箱的行级判据：列占位行必须排除、档案外行必须显式打标")
rm = pt._reported_box_map(PERIOD_ID, "2026-09-23", "2026-09-24")
ck("🔴 `/save-matrix` 的 `__列占位__` 行被排除（否则多出 pid=0 假商品）", 0 in rm, False)
ck("   ↳ 该占位行数量是 999 的**金丝雀**，若未排除必现形", 0 not in rm, True)
ck("档案外商品（pid=%d）被保留而非丢弃" % PID_ORPHAN, PID_ORPHAN in rm, True)
ck("   ↳ 且标了 orphan", (rm.get(PID_ORPHAN) or {}).get("orphan"), True)
ck("在档商品的 orphan = False", (rm.get(PID_GOD) or {}).get("orphan"), False)
ck("档案外行按明细自带单位折箱：16 条 ÷ 8 条/箱 = 2 箱",
   (rm.get(PID_ORPHAN) or {}).get("box"), 2.0, tol=0.002)
orph = call(pt.avg_target(FakeReq(), period_id=PERIOD_ID,
                          product_ids="%d,%d" % (PID_GOD, PID_ORPHAN)))
ck("档案外行在响应里带 orphan_row 标",
   orph["items"][str(PID_ORPHAN)]["flags"].get("orphan_row", False) is True, True)

print("\n④ 单位换算的边界：无大单位换算的商品")
raw = call(pt.avg_target(FakeReq(), period_id=PERIOD_ID,
                                product_ids=str(PID_RAW)))
it2 = raw["items"].get(str(PID_RAW), {})
ck("无换算 ⇒ 明确标 no_convert（不填 0 冒充）", it2.get("flags", {}).get("no_convert"), True)

print("\n⑤ 写入口门禁：无换算的商品**不许**建目标（否则后面每步都静默错）")
try:
    call(pt.create_target(FakeReq({
        "period_month": "2026-09", "product_id": PID_RAW, "target_qty": 10,
        "allocs": [{"employee_id": 1, "ratio": 100}]})))
    fails.append("无换算商品竟然建目标成功了")
    print("   FAIL 无换算商品竟然建目标成功了")
except Exception as e:
    code = getattr(e, "status_code", None)
    ck("拒绝并说明原因（422）", code, 422)

print("\n⑥ 分解校验：Σratio 必须 = 100")
try:
    call(pt.create_target(FakeReq({
        "period_month": "2026-07", "product_id": PID_GOD, "target_qty": 10,
        "allocs": [{"employee_id": 1, "ratio": 60}, {"employee_id": 2, "ratio": 30}]})))
    fails.append("Σratio=90 竟然通过了")
    print("   FAIL Σratio=90 竟然通过了")
except Exception as e:
    ck("Σratio=90 被拒（422）", getattr(e, "status_code", None), 422)
try:
    call(pt.create_target(FakeReq({
        "period_month": "2026-07", "product_id": PID_GOD, "target_qty": 10,
        "allocs": [{"employee_id": 1, "ratio": 60}, {"employee_id": 1, "ratio": 40}]})))
    fails.append("同一人重复分解竟然通过")
    print("   FAIL 同一人重复分解竟然通过")
except Exception as e:
    ck("同一人重复被拒（422）", getattr(e, "status_code", None), 422)

print("\n⑦ 唯一键：同商品同月只能一条")
try:
    call(pt.create_target(FakeReq({
        "period_month": "2026-09", "product_id": PID_GOD, "target_qty": 50,
        "allocs": [{"employee_id": 1, "ratio": 100}]})))
    fails.append("同月同商品重复建竟然通过")
    print("   FAIL 同月同商品重复建竟然通过")
except Exception as e:
    ck("重复建被拒（409）", getattr(e, "status_code", None), 409)

print("\n⑧ 改目标量 → 按原占比重算各人目标")
call(pt.update_target(TID, FakeReq({"target_qty": 200})))
lst = call(pt.list_targets(FakeReq(), month="2026-09"))
row = lst["items"][0]
ck("目标量已改为 200", row["target_qty"], 200.0)
ck("占比保持 60/40 ⇒ 120 / 80", [a["target_qty"] for a in row["allocs"]], [120.0, 80.0])
ck("Σ 分解 == 200", row["alloc_total"], 200.0)

print("\n⑨ 删除 → 分解明细级联删（不留孤儿行）")
call(pt.delete_target(TID, FakeReq()))
lst = call(pt.list_targets(FakeReq(), month="2026-09"))
ck("目标已删", len(lst["items"]), 0)
con = sqlite3.connect(TDB)
left = con.execute("SELECT COUNT(*) FROM product_target_alloc WHERE target_id=?", (TID,)).fetchone()[0]
con.close()
ck("分解明细级联删净", left, 0)

print("\n" + "=" * 78)
if fails:
    print("❌ 失败 %d 项：" % len(fails))
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print("✅ 端到端全绿：建目标 / 分解 / 均单 / 预填 / 换算 / 门禁 / 唯一键 / 级联删")
print("=" * 78)
