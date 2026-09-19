#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v203 写路径验证（**在影子库上跑，绝不碰生产库**）。

要验的承诺：旧 Excel / 旧数据里的 `counterparty_type='customer'` 仍能落库，
但统一**存成 `store`**（门店和客户是同一批对象）；非法值必须被拒。

⚠️ 隔离做法：`connection.DB_PATH` 取自 `ERP_DB_PATH` 环境变量、`DB_DIR = dirname(DB_PATH)`、
   租户库 = `DB_DIR/tenant_<id>.db` ⇒ 把 `ERP_DB_PATH` 指到一个临时目录，
   再把 `tenant_1.db` 拷成 `tenant_99.db`，即可在**真实结构 + 真实数据**的影子租户上跑写测试。

🔴 最重要的断言是 **update 的「data 回写」**：
   `report_mapping_update` 在归一后必须把值写回 `data`，否则下面那个通用字段循环
   会把原始 `customer` 再写一遍 —— 归一被静默覆盖，净效果「改了等于没改」且毫无报错。
"""
import os
import sys

SHADOW = os.environ.get("V203_SHADOW", "/tmp/v203-shadow")
os.environ["ERP_DB_PATH"] = os.path.join(SHADOW, "erp.db")
os.environ.pop("DATABASE_URL", None)        # 防环境里残留 PG 串把引擎切走
os.environ.setdefault("ERP_SECRET", "shadow-test-secret-not-production")

sys.path.insert(0, "/opt/hergent-erp")

from db.connection import set_tenant_context, DB_PATH, DB_DIR   # noqa: E402
set_tenant_context(99)                                          # 影子租户
import erp_db                                                  # noqa: E402

bad = 0
def chk(ok, label, extra=""):
    global bad
    bad += 0 if ok else 1
    print("  %s %s%s" % ("ok " if ok else "BAD", label, ("  " + extra) if extra else ""))

print("=" * 78)
print("0 隔离自证：确认一切读写都落在影子库上")
print("=" * 78)
chk(DB_PATH.startswith(SHADOW), "DB_PATH 指向影子目录", DB_PATH)
chk(DB_DIR == SHADOW, "DB_DIR == 影子目录", DB_DIR)
chk("opt/hergent-erp" not in DB_PATH, "🔴 DB_PATH **不在**生产目录内")
with erp_db.get_db() as db:
    got = db.execute("PRAGMA database_list").fetchall()
    files = [r[2] for r in got]
chk(all(SHADOW in f for f in files), "实际打开的库文件全在影子目录", str(files))

def q(sql, args=()):
    with erp_db.get_db() as db:
        return db.execute(sql, args).fetchall()

def ctype_of(alias):
    r = q("SELECT counterparty_type FROM report_mapping WHERE report_alias=?", (alias,))
    return r[0]["counterparty_type"] if r else None

# 取真实员工名/门店名（影子库就是 tenant_1 的副本）
emp_name = q("SELECT name FROM hr_employees WHERE id=7")[0]["name"]
store_name = q("SELECT name FROM contacts WHERE id=2562")[0]["name"]
print("      员工7=%s 门店2562=%s" % (emp_name, store_name))

print()
print("=" * 78)
print("1 create：customer → store（旧 Excel / 旧数据的兼容承诺）")
print("=" * 78)
r = erp_db.report_mapping_create({
    "employee_id": 7, "counterparty_type": "customer", "counterparty_id": 2562,
    "system_name": store_name, "report_alias": "V203甲", "order_template": "自提订单",
})
chk(r.get("success"), "create(counterparty_type='customer') 成功", str(r))
chk(ctype_of("V203甲") == "store",
    "🔴 落库类型为 `store`（不是 customer）", "实为 %r" % ctype_of("V203甲"))

r = erp_db.report_mapping_create({
    "employee_id": 7, "counterparty_type": "store", "counterparty_id": 2562,
    "system_name": store_name, "report_alias": "V203乙", "order_template": "自提订单",
})
chk(r.get("success") and ctype_of("V203乙") == "store", "create('store') 正常落 store")

r = erp_db.report_mapping_create({
    "employee_id": 7, "counterparty_type": "foo", "counterparty_id": 2562,
    "system_name": store_name, "report_alias": "V203丙", "order_template": "自提订单",
})
chk(bool(r.get("error")), "🔴 非法类型 'foo' 被拒", str(r.get("error")))
chk(ctype_of("V203丙") is None, "非法值**未落库**（不留脏行）")

print()
print("=" * 78)
print("2 update：归一必须回写 data（否则被通用字段循环覆盖）")
print("=" * 78)
mid = q("SELECT id FROM report_mapping WHERE report_alias='V203乙'")[0]["id"]
r = erp_db.report_mapping_update(mid, {"counterparty_type": "customer"})
chk(r.get("success"), "update(counterparty_type='customer') 成功", str(r))
chk(ctype_of("V203乙") == "store",
    "🔴 归一后落库仍是 `store`（证明归一值确实回写进 SET 子句）",
    "实为 %r —— 若此处为 'customer'，说明归一被通用字段循环覆盖" % ctype_of("V203乙"))

r = erp_db.report_mapping_update(mid, {"report_alias": "V203乙"})
chk(r.get("success") and ctype_of("V203乙") == "store", "update 不传类型时不改写类型")

r = erp_db.report_mapping_update(mid, {"counterparty_type": "bar"})
chk(bool(r.get("error")), "非法类型 update 被拒", str(r.get("error")))
chk(ctype_of("V203乙") == "store", "拒绝时未破坏既有值")

print()
print("=" * 78)
print("3 import：旧 Excel 填 customer 仍可导入，且统一落 store")
print("=" * 78)
rows = [
    {"employee": emp_name, "counterparty_type": "customer", "system_name": store_name,
     "report_alias": "V203导甲", "order_template": "自提订单", "src_wh": "", "dst_wh": ""},
    {"employee": emp_name, "counterparty_type": "store", "system_name": store_name,
     "report_alias": "V203导乙", "order_template": "自提订单", "src_wh": "", "dst_wh": ""},
    {"employee": emp_name, "counterparty_type": "nope", "system_name": store_name,
     "report_alias": "V203导丙", "order_template": "自提订单", "src_wh": "", "dst_wh": ""},
]
r = erp_db.report_mapping_import(rows)
print("      回执: imported=%s failed=%s" % (r.get("imported"), r.get("failed")))
for f in r.get("failures", []):
    print("        第 %s 行：%s" % (f.get("row"), f.get("reason")))
chk(r.get("imported") == 2, "导入成功 2 行（customer 与 store 各一）", "实为 %s" % r.get("imported"))
chk(r.get("failed") == 1, "非法类型 1 行失败")
chk(ctype_of("V203导甲") == "store", "🔴 导入的 customer 行落库为 `store`", "实为 %r" % ctype_of("V203导甲"))
chk(ctype_of("V203导乙") == "store", "导入的 store 行落 store")
chk(ctype_of("V203导丙") is None, "非法行未落库")
chk(any("门店 / 本人仓" in (f.get("reason") or "") for f in r.get("failures", [])),
    "失败文案已改为「应为 门店 / 本人仓」",
    str([f.get("reason") for f in r.get("failures", [])]))

print()
print("=" * 78)
print("4 存量 customer 行：读端仍认、可见范围不受影响（向后兼容）")
print("=" * 78)
with erp_db.get_db_tx() as db:
    db.execute("INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, system_name,"
               " report_alias, order_template, is_active) VALUES (7,'customer',2868,'永辉东津店','V203存量','自提订单',1)")
lst = erp_db.report_mapping_list(include_inactive=1)
legacy = [x for x in lst if x["report_alias"] == "V203存量"]
chk(len(legacy) == 1, "🔴 存量 customer 行**仍能被列出**（读端未收紧 ⇒ 不静默消失）")
chk(erp_db.report_mapping_list(counterparty_type="customer", include_inactive=1)
    and any(x["report_alias"] == "V203存量" for x in erp_db.report_mapping_list(counterparty_type="customer", include_inactive=1)),
    "按 counterparty_type='customer' 过滤仍查得到（list 过滤参数刻意不归一）")
st = erp_db.employee_stores_get(7)
chk(any(s["id"] == 2868 for s in st), "存量 customer 行派生的门店仍在可见范围内", str([s["name"] for s in st]))

print()
print("=" * 78)
print("BAD=%d  %s" % (bad, "全部通过" if not bad else "有失败项"))
print("=" * 78)
sys.exit(1 if bad else 0)
