#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""货损核算 · `/trend` 端点 + `_subtotal` 重构的**本地隔离验证**（可复跑）。

为什么要这个脚本：
  · `/trend` 是仪表盘的唯一数据源，它的**空月语义**（未录入 = null，不是 0）、
    **跨期加权口径**（Σ分子 ÷ Σ分母，不是各月率的平均）、以及**逐期必须复用 `_compute`**
    这三条，一旦错了在页面上都表现为"看起来正常的错数" —— 必须由断言锁住。
  · 本轮为了跨期累计还动了 `_subtotal`（把率算法抽成 `_agg`）—— 这是**既有代码**，
    必须证明它对既有输出**零影响**。故脚本会把 HEAD 版的模块 exec 进来，
    逐期**逐叶子路径**对比 `_compute` 的输出（见 ⑬「变更集封印」）。
    ⚠️ 该封印的形态随轮次而变：v186-1 是「差异只允许是登记的那 13 条」，
       v186-2（只改显示标签）已收紧成「**零差异**」。别照抄上一轮的白名单 ——
       上一轮那批已进 HEAD，照抄必报 missing（那是封印在提示"该重写登记集合"）。
  · ⑫ 段（v186-1）锁住 ③ 直调行新增「临期销售」后的六个消费点：写路径 / 行净额 /
    组小计 / 公司口径的包含关系 / 跨期累积 / 旧词清零。
  · ⑬-2（v186-2）锁住「三个粒度统一成同一个词」：带 HEAD 反证的双向断言 +
    三粒度取同一个字符串，最后扫全文旧变体 = 0。

隔离保证：全部落在 /tmp/loss-trend-harness/（含一个**自建的空租户库 tenant_9998.db**），
不读也不写仓库里的 erp.db / tenant_1.db，不碰生产。
"""
import json
import os
import shutil
import subprocess
import sys
import types

BACKEND = "/Users/zhangjunfeng/Documents/hergent-erp"
SERVER = os.path.join(BACKEND, "server")
HARNESS = "/tmp/loss-trend-harness"
TENANT = 9998

FAILED = []
PASSED = [0]


def ok(cond, name, extra=""):
    if cond:
        PASSED[0] += 1
        print("  \u2713 " + name + (("  \u2192 " + str(extra)) if extra != "" else ""))
    else:
        FAILED.append(name)
        print("  \u2717 " + name + (("  \u2192 " + str(extra)) if extra != "" else ""))


def head(txt):
    print("\n" + txt)


# ── 环境（必须在 import 后端模块**之前**设置）──────────────────────────────
def setup_env():
    if os.path.isdir(HARNESS):
        shutil.rmtree(HARNESS)
    os.makedirs(HARNESS)
    # 主库：本地仓库里是 0 字节占位文件（真实主库只在生产）⇒ 这里也放一个空的，
    # erp_db 的模块级连接读它会报 "no such table" 但不影响本模块（只碰 loss_* 表）
    open(os.path.join(HARNESS, "erp.db"), "wb").close()
    # ⭐ 预先放一个**空租户库**：set_tenant_context 见文件已存在就不再调 tenant_db_init，
    #    于是本脚本完全不依赖主库 schema，也绝不会走到"复制主库数据"那条老路
    open(os.path.join(HARNESS, "tenant_%d.db" % TENANT), "wb").close()
    os.environ["ERP_DB_PATH"] = os.path.join(HARNESS, "erp.db")
    os.environ.setdefault("ERP_SECRET", "harness" + "0" * 57)
    os.chdir(SERVER)
    sys.path.insert(0, SERVER)


setup_env()

from fastapi import FastAPI                                    # noqa: E402
from fastapi.testclient import TestClient                      # noqa: E402
from db.connection import set_tenant_context                   # noqa: E402
from routers import loss_accounting as la                      # noqa: E402
import erp_db                                                  # noqa: E402

set_tenant_context(TENANT)
# `_auth` 是这一层；结账/反结账走 `core._admin`（内部又会调**原始的** `_auth`），
# 所以必须一并替换 —— 只换 `_auth` 的话 close 会以「未登录」401 失败。
la._auth = lambda request=None: {"username": "harness", "display_name": "harness"}
la._admin = lambda request=None: {"username": "harness", "display_name": "harness"}

app = FastAPI()
app.include_router(la.router)
client = TestClient(app)

MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
EMPTY_MONTH = "2026-06"          # 整月无任何录入
NO_DEN_MONTH = "2026-08"         # 有分组数据，但公司口径两项都没录 ⇒ 率算不出

# 每期：stores{key:(分母,分子)} · ops{key:(分母,分子,抵扣)} · company(分母,抵扣)
#       · direct=(直调额, 直调临期销售) · wastage
# 2026-05 特意让 ② 组净额为负（自售抵扣 3200 > 调拨损失 3000）
# 2026-07 特意让 ③ 直调行净额为负（直调临期销售 900 > 直调额 800）⇒ 该行的质量提示必须出现
# 2026-08 直调额填了但**临期销售未填**（ded_filled=0 ⇒ 前端小计必须显示「—」而不是 0）
# 2026-09 ③ 两项都没填（整组未录入）
PLAN = {
    "2026-04": {"stores": {"S1": (400000, 5000), "S2": (200000, 2000)},
                "ops": {"O1": (300000, 4000, 1200), "O2": (200000, 1500)},
                "company": (1200000, 7000), "direct": (3000, 1200), "wastage": 2000},
    "2026-05": {"stores": {"S1": (400000, 6000), "S2": (150000, 1500)},
                "ops": {"O1": (300000, 2000, 3000), "O2": (200000, 1000, 200)},
                "company": (1100000, 6600), "direct": (1000, 400), "wastage": 1500},
    "2026-06": None,
    "2026-07": {"stores": {"S1": (380000, 4200), "S2": (180000, 1800)},
                "ops": {"O1": (280000, 3500, 900), "O2": (150000, 1200)},
                "company": (1050000, 6000), "direct": (800, 900), "wastage": 900},
    "2026-08": {"stores": {"S1": (360000, 3000), "S2": (160000, 1200)},
                "ops": {"O1": (260000, 2600, 800)},
                "company": None, "direct": (600, None), "wastage": 700},
    "2026-09": {"stores": {"S1": (300000, 2500), "S2": (140000, 1000)},
                "ops": {"O1": (240000, 2000, 500)},
                "company": (900000, 5000), "direct": (None, None), "wastage": None},
}

# ══════════════════════════════════════════════════════════════════════
head("① 种子：主体 + 六个月的录入（走真实写路径 PUT /subjects、PUT /manual）")
for key, label in (("S1", "门店A"), ("S2", "门店B")):
    r = client.put("/api/loss/accounting/subjects",
                   json={"subject_kind": "store", "subject_key": key, "subject_label": label})
    assert r.status_code == 200, r.text
for key, label in (("O1", "张三"), ("O2", "李四")):
    r = client.put("/api/loss/accounting/subjects",
                   json={"subject_kind": "operator", "subject_key": key, "subject_label": label})
    assert r.status_code == 200, r.text

for p, plan in PLAN.items():
    if not plan:
        continue
    rows = []
    for k, t in (plan.get("stores") or {}).items():
        rows.append({"subject_kind": "store", "subject_key": k,
                     "col_key": "store_sales_amt", "value": t[0]})
        rows.append({"subject_kind": "store", "subject_key": k,
                     "col_key": "store_return_amt", "value": t[1]})
    for k, t in (plan.get("ops") or {}).items():
        rows.append({"subject_kind": "operator", "subject_key": k,
                     "col_key": "op_from_good_amt", "value": t[0]})
        rows.append({"subject_kind": "operator", "subject_key": k,
                     "col_key": "op_to_loss_amt", "value": t[1]})
        if len(t) > 2 and t[2] is not None:
            rows.append({"subject_kind": "operator", "subject_key": k,
                         "col_key": "op_loss_sale_amt", "value": t[2]})
    dt = plan.get("direct")
    if dt is not None:
        if dt[0] is not None:
            rows.append({"subject_kind": "direct", "subject_key": "",
                         "col_key": "direct_amt", "value": dt[0]})
        if len(dt) > 1 and dt[1] is not None:
            # 🔴 本轮新增的填报入口：③ 良品仓直调临期仓 的「临期销售」（抵扣列）
            rows.append({"subject_kind": "direct", "subject_key": "",
                         "col_key": "direct_loss_sale_amt", "value": dt[1]})
    if plan.get("wastage") is not None:
        rows.append({"subject_kind": "wastage", "subject_key": "",
                     "col_key": "wastage_amt", "value": plan["wastage"]})
    if plan.get("company"):
        rows.append({"subject_kind": "company", "subject_key": "",
                     "col_key": "company_sales_amt", "value": plan["company"][0]})
        rows.append({"subject_kind": "company", "subject_key": "",
                     "col_key": "loss_wh_sale_amt", "value": plan["company"][1]})
    r = client.put("/api/loss/accounting/manual", json={"period": p, "rows": rows})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"]["skipped_count"] == 0, (p, body["data"]["skipped"])
ok(True, "六个月录入完成（空月 2026-06 不写任何值；2026-08 不写公司口径两项）")

# ══════════════════════════════════════════════════════════════════════
head("② /trend 基本结构")
r = client.get("/api/loss/accounting/trend", params={"from": "2026-04", "to": "2026-09"})
ok(r.status_code == 200, "HTTP 200", r.status_code)
body = r.json()
ok(body.get("ok") is True, "ok=true")
d = body["data"]
ok(d["from"] == "2026-04" and d["to"] == "2026-09", "from/to 回显", d["from"] + " → " + d["to"])
ok([m["period"] for m in d["months"]] == MONTHS, "六个月齐全且升序（空月也在序列里）",
   ",".join(m["period"] for m in d["months"]))
ok(d["pricing"] == "sale", "带回 pricing（只读回显，非入参）", d["pricing"])
ok(len(d["row_groups"]) == 4, "带回 row_groups（图例名只有后端一份）")
ok("trend" not in json.dumps(d.get("col_defs") or []), "未冗余下发 col_defs")

by = {m["period"]: m for m in d["months"]}

# ══════════════════════════════════════════════════════════════════════
head("③ 🔴 空月语义：未录入 = null（**不是 0**），且分组也要服从同一规则")
e = by[EMPTY_MONTH]
ok(e["has_data"] is False, "空月 has_data=false")
ok(e["updated_at"] == "", "空月 updated_at 为空")
ok(e["gross_amt"] is None and e["net_amt"] is None, "空月 毛额/净额 = null",
   "%s / %s" % (e["gross_amt"], e["net_amt"]))
ok(e["rate_den"] is None and e["rate_net"] is None, "空月 分母/净率 = null")
ok(e["ded_amt"] is None, "空月 抵扣 = null")
ok(all(e["groups"][k]["net_amt"] is None for k in ("store", "operator", "direct", "wastage")),
   "空月**分组**金额也是 null（否则任何直读 groups 的图都会把空月画成 0 柱）")
ok(e["gaps"] == [], "空月不给缺口清单（整月未录不是一个「缺项」）")

# ══════════════════════════════════════════════════════════════════════
head("④ 🔴 负数净额必须保留（自售抵扣 > 调拨损失 = 好事，不许 clamp 到 0）")
m5 = by["2026-05"]
ok(m5["groups"]["operator"]["net_amt"] == -200.0,
   "② 组净额 = 3000 − 3200 = −200", m5["groups"]["operator"]["net_amt"])
ok(m5["groups"]["operator"]["rate_net"] is not None and m5["groups"]["operator"]["rate_net"] < 0,
   "② 组净率同为负（率的分母在，故给率）", m5["groups"]["operator"]["rate_net"])
ok(m5["groups"]["store"]["net_amt"] == 7500.0, "① 组净额 = 6000 + 1500", m5["groups"]["store"]["net_amt"])

# ══════════════════════════════════════════════════════════════════════
head("⑤ 缺分母 ≠ 0：2026-08 有分组数据但公司口径两项未录")
m8 = by[NO_DEN_MONTH]
ok(m8["has_data"] is True, "2026-08 has_data=true（有录别的）")
ok(m8["rate_den"] is None and m8["rate_net"] is None, "缺公司销售金额 ⇒ 率为 null（不是 0.00%）")
ok(m8["net_amt"] is not None, "净额仍给（分子齐），只是率算不出", m8["net_amt"])
ok("缺公司销售金额" in m8["gaps"], "缺口清单含「缺公司销售金额」", m8["gaps"])
ok("缺临期仓销售总额" in m8["gaps"], "缺口清单含「缺临期仓销售总额」", m8["gaps"])

# ══════════════════════════════════════════════════════════════════════
head("⑥ 缺口清单：2026-09 只录了 ①② 与公司两项")
m9 = by["2026-09"]
ok("③ 未录入" in m9["gaps"] and "④ 报损未录入" in m9["gaps"], "含 ③④ 未录入", m9["gaps"])
ok(not [g for g in m9["gaps"] if g.startswith("①")], "① 两店都录了 ⇒ 不该报缺")
ok([g for g in m9["gaps"] if g.startswith("②")] == ["② 还差 1 行未录"],
   "② 该报「还差 1 行」—— 李四这期一个数都没填", m9["gaps"])
ok(d["summary"]["months_with_gaps"] == 2,
   "有缺口的月数 = 2（08 缺公司口径 + ②漏一行；09 缺 ③④；04/05/07 齐全）",
   d["summary"]["months_with_gaps"])

# ══════════════════════════════════════════════════════════════════════
head("⑦ 🔴 同源：trend 的月行与 /summary 逐字相等（不许第二份数学）")
for p in MONTHS:
    s = client.get("/api/loss/accounting/summary", params={"period": p}).json()["data"]
    co = s["company"]
    m = by[p]
    if not m["has_data"]:
        # 空月的分工是**有意**的：trend 归一化成 null（图表合同），/summary 保持
        # `_compute` 原样（详见表要能区分"没录"与"录了 0"，靠 updated_at 空 + rate_den null）
        ok(s["updated_at"] == "" and m["rate_den"] is None and co["rate_den"] is None,
           "%s：空月双方都判为「无录入」（trend=null / summary 靠 updated_at 空）" % p)
        continue
    same = (m["gross_amt"] == co["gross_amt"] and m["net_amt"] == co["net_amt"]
            and m["rate_den"] == co["rate_den"] and m["rate_net"] == co["rate_net"]
            and m["rate_gross"] == co["rate_gross"]
            and m["groups"]["store"]["net_amt"] == s["groups"][0]["subtotal"]["net_amt"])
    ok(same, "%s：trend 与 /summary 的毛额/净额/毛率/净率/①组净额全等" % p)

# 公司与四组的一致性：公司毛额 = 四组毛额之和（表尾校验的跨期版本）
ok(by["2026-05"]["gross_amt"] == round(sum(
    by["2026-05"]["groups"][k]["gross_amt"] for k in ("store", "operator", "direct", "wastage")), 2),
   "公司毛额 = ①+②+③+④ 毛额（逐期可自证）")

# ══════════════════════════════════════════════════════════════════════
head("⑧ 🔴 跨期口径：∑分子 ÷ ∑分母（不是各月率的平均）")
mon = [m for m in d["months"] if m["has_data"]]
num = sum(m["net_amt"] for m in mon)
den = sum(m["rate_den"] for m in mon if m["rate_den"])
want = round(num / den * 100.0, 4)
sm = d["summary"]
ok(sm["rate_net"] == want, "summary.rate_net == ∑净额 ÷ ∑分母", "%s vs %s" % (sm["rate_net"], want))
ok(sm["rate_num"] == round(num, 2), "summary.rate_num == ∑净额", sm["rate_num"])
ok(sm["rate_den"] == round(den, 2), "summary.rate_den == ∑分母", sm["rate_den"])
avg = round(sum(m["rate_net"] for m in mon if m["rate_net"] is not None)
            / len([m for m in mon if m["rate_net"] is not None]), 4)
ok(sm["rate_net"] != avg, "加权率 ≠ 各月率的算术平均（构造数据使两者可区分）",
   "加权 %s / 平均 %s" % (sm["rate_net"], avg))
ok(sm["months_total"] == 6 and sm["months_with_data"] == 5,
   "计数：共 6 月 / 有数据 5 月", "%s / %s" % (sm["months_total"], sm["months_with_data"]))
ok(sm["months_with_den"] == 4, "**率的实际基数** = 4 月（08 缺分母不计入）", sm["months_with_den"])

# ══════════════════════════════════════════════════════════════════════
head("⑨ 主体合计：操作数先相加、率最后相除")
subs = {(x["row_kind"], x["subject_key"]): x for x in d["subject_totals"]}
s1 = subs[("store", "S1")]
want_den = sum(PLAN[p]["stores"]["S1"][0] for p in MONTHS if PLAN.get(p))
want_num = round(sum(PLAN[p]["stores"]["S1"][1] for p in MONTHS if PLAN.get(p)), 2)
ok(s1["rate_den"] == want_den, "门店A 跨期分母 = ∑四期销售额", s1["rate_den"])
ok(s1["rate_num"] == want_num, "门店A 跨期分子 = ∑四期退货额", s1["rate_num"])
ok(s1["rate_net"] == round(want_num / want_den * 100.0, 4), "门店A 跨期率 = ∑分子 ÷ ∑分母", s1["rate_net"])
ok(s1["months_filled"] == 5, "门店A 有 5 个月填过（04/05/07/08/09，空月不计）", s1["months_filled"])
o1 = subs[("operator", "O1")]
ok(o1["net_amt"] == round(4000 + 2000 + 3500 + 2600 + 2000 - (1200 + 3000 + 900 + 800 + 500), 2),
   "业务员张三 跨期净额 = ∑分子 − ∑抵扣", o1["net_amt"])
ok(d["subject_totals"][0]["net_amt"] >= d["subject_totals"][-1]["net_amt"], "主体按净额降序（最重的在前）")
ok(not [x for x in d["subject_totals"] if x["row_kind"] in ("direct", "wastage")],
   "③④ 是单行组，不出现在主体排行里")

head("⑩ 组合计 / 确定性")
gt = {x["row_kind"]: x for x in d["group_totals"]}
ok(gt["store"]["gross_amt"] == round(sum(m["groups"]["store"]["gross_amt"] for m in mon), 2),
   "①组跨期毛额 = ∑逐期", gt["store"]["gross_amt"])
ok(gt["operator"]["net_amt"] == round(sum(m["groups"]["operator"]["net_amt"] for m in mon), 2),
   "②组跨期净额 = ∑逐期", gt["operator"]["net_amt"])
ok(gt["store"]["filled_months"] == 5, "①组有录入的月数 = 5", gt["store"]["filled_months"])
body2 = client.get("/api/loss/accounting/trend",
                   params={"from": "2026-04", "to": "2026-09"}).json()
ok(json.dumps(body, sort_keys=True, ensure_ascii=False)
   == json.dumps(body2, sort_keys=True, ensure_ascii=False), "重复请求逐字一致（确定性）")

# ══════════════════════════════════════════════════════════════════════
head("⑪ 默认区间与参数校验（fail-closed 422）")
d12 = client.get("/api/loss/accounting/trend", params={"to": "2026-09"}).json()["data"]
ok(len(d12["months"]) == 12 and d12["from"] == "2025-10", "默认近 12 月（to=2026-09 → from=2025-10）",
   d12["from"])
d5 = client.get("/api/loss/accounting/trend", params={"to": "2026-09", "limit": 5}).json()["data"]
ok(len(d5["months"]) == 5 and d5["from"] == "2026-05", "limit=5 生效", d5["from"])
for params, label in (({"from": "2026-9", "to": "2026-09"}, "from 格式非法"),
                      ({"from": "2026-13", "to": "2026-09"}, "月份 13 非法"),
                      ({"from": "2026-09", "to": "2026-04"}, "from 晚于 to"),
                      ({"from": "2020-01", "to": "2026-09"}, "区间 > 36 月")):
    rr = client.get("/api/loss/accounting/trend", params=params)
    ok(rr.status_code == 422, "%s → 422" % label, rr.status_code)

dz = client.get("/api/loss/accounting/trend", params={"from": "2026-06", "to": "2026-06"}).json()["data"]
ok(dz["summary"]["months_with_data"] == 0, "整区间无数据 ⇒ months_with_data=0（前端据此显示空状态）")
ok(dz["summary"]["ded_sum"] is None,
   "🔴 一次都没录抵扣 ⇒ ded_sum=null（不是 0.00，否则会被读成「临期货一分钱没卖」）",
   dz["summary"]["ded_sum"])
ok(dz["summary"]["rate_den"] is None and dz["summary"]["rate_net"] is None,
   "整区间无分母 ⇒ 率为 null（不是 0.00%）")

# ══════════════════════════════════════════════════════════════════════
head("⑫ 🔴 ③「良品仓 → 临期仓」新增「临期销售」填报入口 —— 三个消费点必须同步")


def put_direct_sale(period, val):
    return client.put("/api/loss/accounting/manual", json={
        "period": period,
        "rows": [{"subject_kind": "direct", "subject_key": "",
                  "col_key": "direct_loss_sale_amt", "value": val}]})


def boot(p):
    return client.get("/api/loss/accounting/bootstrap", params={"period": p}).json()["data"]


# ⑫-1 写路径 + 即时重算：改成 1500 ⇒ 行净额 / 组小计 / 公司「其他渠道」三处必须一起变
r = put_direct_sale("2026-04", 1500)
ok(r.status_code == 200 and r.json()["data"]["saved"] == 1,
   "③ 行「临期销售」可保存（PUT /manual 200 且 saved=1）", r.json()["data"]["saved"])
t = boot("2026-04")
tdir = [g for g in t["groups"] if g["row_kind"] == "direct"][0]
ok(tdir["rows"][0]["net_amt"] == 1500.0, "改后 ③ 行净额 = 3000 − 1500 = 1500",
   tdir["rows"][0]["net_amt"])
ok(tdir["subtotal"]["ded_sum"] == 1500.0, "改后 ③ 组小计 ded_sum 同步 = 1500",
   tdir["subtotal"]["ded_sum"])
ok(t["company"]["values"]["loss_wh_sale_other_amt"] == 4300.0,
   "改后公司「其他渠道」同步 = 7000 − 1200 − 1500 = 4300",
   t["company"]["values"]["loss_wh_sale_other_amt"])
ok(t["company"]["net_amt"] == round(t["company"]["gross_amt"] - 7000.0, 2),
   "🔴 改后公司净额**不变**（仍 = 公司毛额 − 临期仓销售总额）",
   t["company"]["net_amt"])
ok(put_direct_sale("2026-04", 1200).json()["data"]["saved"] == 1,
   "改回 1200 还原种子（后续断言按 PLAN 的值）")

# ⑫-2 该列**只对 ③ 行**可填 —— 对别的行写必须被拒
#      （前端靠 scope 不渲染输入框，后端还得兜一层：两处都拦才算收口）
r2 = client.put("/api/loss/accounting/manual", json={
    "period": "2026-04",
    "rows": [{"subject_kind": "store", "subject_key": "S1",
              "col_key": "direct_loss_sale_amt", "value": 1}]})
ok(r2.status_code == 200 and r2.json()["data"]["skipped_count"] == 1,
   "① 门店行写「临期销售（直调）」被拒（scope 收紧）",
   r2.json()["data"]["skipped"][:1])

bb = {p: boot(p) for p in MONTHS}
g3 = {p: [g for g in bb[p]["groups"] if g["row_kind"] == "direct"][0] for p in MONTHS}

# ⑫-3 行内：净额 = 直调额 − 临期销售（毛额不变）
ok(g3["2026-04"]["rows"][0]["net_amt"] == 1800.0, "③ 行净额 = 3000 − 1200 = 1800",
   g3["2026-04"]["rows"][0]["net_amt"])
ok(g3["2026-04"]["rows"][0]["gross_amt"] == 3000.0, "③ 行毛额仍 = 直调额（抵扣不进毛额）")
ok(g3["2026-04"]["rows"][0]["values"]["direct_loss_sale_amt"] == 1200.0,
   "③ 行 values 带上临期销售额（前端据此回填输入框）")

# ⑫-4 ③ 组小计：ded_sum / net_amt 同步；「整组是否填过」由**原始行数据**判定
#      （不给后端加"填过几行"的字段 —— 显示的判据前端手里已经有）
ok(g3["2026-04"]["subtotal"]["ded_sum"] == 1200.0, "③ 组小计 ded_sum = 1200",
   g3["2026-04"]["subtotal"]["ded_sum"])
ok(g3["2026-04"]["subtotal"]["net_amt"] == 1800.0, "③ 组小计净额 = 毛额 − 临期销售")
ok(g3["2026-04"]["rows"][0]["values"]["direct_loss_sale_amt"] is not None,
   "③ 组「填过」的判据：行 values 里有真值 ⇒ 前端小计可显示金额")
ok(g3["2026-08"]["rows"][0]["values"]["direct_loss_sale_amt"] is None
   and g3["2026-08"]["subtotal"]["ded_sum"] == 0.0,
   "🔴 2026-08 直调额填了但临期销售未填 ⇒ ded_sum=0 且行值为 null"
   "（前端据此显示「—」而不是 0 —— 否则会被读成「一分钱没卖回来」）")
ok(g3["2026-09"]["rows"][0]["values"]["direct_loss_sale_amt"] is None,
   "2026-09 ③ 两项都没填（整组未录入）")

# ⑫-5 ③ 组仍然**不给率**（没有分母；加了一列不等于有分母）
ok(g3["2026-04"]["subtotal"]["has_rate"] is False
   and g3["2026-04"]["subtotal"]["rate_net"] is None,
   "③ 组仍不给率（has_rate=False / rate_net=None）")

# ⑫-6 负数净额保留 + 质量提示
ok(g3["2026-07"]["rows"][0]["net_amt"] == -100.0 and g3["2026-07"]["rows"][0]["data_quality"],
   "③ 行净额为负时保留负数并给质量提示", g3["2026-07"]["rows"][0]["data_quality"])

# ⑫-7 公司口径：包含关系（公司行照旧只扣临期仓销售总额，不因 ③ 行抵扣而改）
K = "2026-04"
co, cov, bd = bb[K]["company"], bb[K]["company"]["values"], bb[K]["company"]["breakdown"]
op_self = 1200.0          # 2026-04：张三自售 1200
ok(bd["direct_loss_sale_amt"] == 1200.0, "公司构成里能看到 ③ 行的临期销售",
   bd["direct_loss_sale_amt"])
ok(cov["loss_wh_sale_other_amt"] == round(7000 - op_self - 1200, 2),
   "🔴 其他渠道 = 总额 − ②自售 − ③直调临期销售",
   cov["loss_wh_sale_other_amt"])
ok(round(op_self + bd["direct_loss_sale_amt"] + cov["loss_wh_sale_other_amt"], 2) == 7000.0,
   "  三项相加恰好 = 临期仓销售总额（包含关系自证：不重不漏）")
ok(co["net_amt"] == round(co["gross_amt"] - 7000.0, 2),
   "🔴 公司净额**不受** ③ 行抵扣影响（= 公司毛额 − 临期仓销售总额）", co["net_amt"])

# ⑫-8 跨期：③ 组走的是**同一份** `_KIND_DED_COL`（分组小计与 trend 共用，不另写一份）
gt3 = [g for g in d["group_totals"] if g["row_kind"] == "direct"][0]
ok(gt3["gross_amt"] == 5400.0, "跨期 ③ 毛额 = 3000+1000+800+600", gt3["gross_amt"])
ok(gt3["ded_sum"] == 2500.0, "跨期 ③ 抵扣 = 1200+400+900", gt3["ded_sum"])
ok(gt3["net_amt"] == 2900.0, "跨期 ③ 净额 = 5400 − 2500", gt3["net_amt"])

# ⑫-9 改名：全站不得再出现旧词（payload 全量扫，防"改了一半"）
alljson = json.dumps(bb, ensure_ascii=False) + json.dumps(d, ensure_ascii=False)
ok("临期销售抵扣" not in alljson, "bootstrap + trend 全量 payload 已无旧词「临期销售抵扣」")
sl = bb[K]["slots"]
ok(sl[2]["key"] == "ded" and sl[2]["label"] == "临期销售",
   "抵扣列位表头 = 「临期销售」", sl[2]["label"])

# ══════════════════════════════════════════════════════════════════════
head("⑬ 🔴 变更集封印：`_compute` 与 HEAD 逐字比对（本轮只改标签 ⟹ **零差异**）+ 标签双向封印")
src = subprocess.check_output(["git", "-C", BACKEND, "show",
                               "HEAD:server/routers/loss_accounting.py"])
old_mod = types.ModuleType("la_head")
old_mod.__file__ = "<HEAD:loss_accounting.py>"
exec(compile(src.decode("utf-8"), "<HEAD:loss_accounting.py>", "exec"), old_mod.__dict__)


_MISS = object()

# 🔴 本轮（v186-2：三个粒度统一成「临期销售」）与上一轮（v186-1：③ 行新增直调抵扣列）
#   的关系是：**上一轮那批改动已随 `505ebe1` 提交成 HEAD**。
#   ⟹ 本轮相对 HEAD 只动了 3 处**显示标签**，`_compute` 的输出必须**逐字相同**。
#   ⟹ 封印因此比上一轮更强：不是"允许登记过的几条差异"，而是**零差异**。
#   ⚠️ 别把上一轮那 13 条白名单照抄回来 —— 它们已经是 HEAD 的既成事实，照抄会报
#      「登记集合里每一条都真的变了」失败。**那是封印在提示"HEAD 推进了、登记集合该
#      重写"，不是代码出错**（上一轮为这条自证踩过一次，见 ⑬-2 的双向写法）。
ALLOWED = set()
# 纯定义（列注册表 / 列位 / 行分组）不参与数值封印 —— 本轮改的**恰恰就是它们**，
#   改由 ⑬-2 用**双向**断言单独覆盖（既要求现在 == 新词，也要求 HEAD 版 != 新词）。
#   这比"允许它变"更严：既证明改了，也证明没连带改坏别处。
DROP_TOP = ("col_defs", "slots", "row_groups")


def allowed(pa):
    """本轮恒为 False（`ALLOWED` 是空集）—— 保留这个扩展位，是为了将来万一又出现
    "只能登记、无法消除"的差异时有地方落笔。**本轮不要往里加东西。**"""
    return pa in ALLOWED or any(pa.startswith(a + "[") for a in ALLOWED)


def leaves(a, b, path, out):
    """收集两棵树的不相等叶子路径（list 用下标 ⇒ 路径可读、可精确加白名单）。

    按结构递归而不是整体 `==`：整体比只能得到"这期不一样"，说不出**哪一格**不一样 ——
    而"哪一格"正是判断"是不是我登记的改动"的唯一依据。
    """
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            leaves(a.get(k, _MISS), b.get(k, _MISS), "%s.%s" % (path, k), out)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i in range(len(a)):
            leaves(a[i], b[i], "%s[%d]" % (path, i), out)
    elif a != b:
        out.add(path.lstrip("."))


seen, out_of_scope = set(), {}
with erp_db.get_db() as c:
    for p in MONTHS:
        new, old = la._compute(c, p), old_mod._compute(c, p)
        for k in DROP_TOP:
            new.pop(k, None)
            old.pop(k, None)
        got = set()
        leaves(new, old, "", got)
        seen |= got
        for pa in got:
            if not allowed(pa):
                out_of_scope["%s %s" % (p, pa)] = True

ok(not seen,
   "六期 `_compute` 数值与结构与 HEAD **逐字相同**（本轮只改显示标签 ⟹ 零差异）",
   ("差异 %d 处：%s" % (len(out_of_scope), sorted(out_of_scope))) if seen
   else "零差异：改标签没有碰到任何计算")

# ── ⑬-2 「统一」这个动作的**双向**封印 ────────────────────────────────
#   单向断言（"现在等于新词"）在"本来就对"的情况下也会通过 ⟹ 证明不了"我真的改了"。
#   所以每条都带 HEAD 版的反证：HEAD 版必须是旧词，且**不是**新词。
#   ⭐ 上一轮那条 `missing` 断言就是因为判据不对称才误报 —— 判据要**对称**，
#      "改了但没生效"与"没改却以为改了"是同一枚硬币的两面。
NOW = "临期销售"
OLD_VARIANTS = ("临期货销售额", "临期销售额", "临期销售抵扣")


def _col(mod, key):
    return next((x for x in mod.LOSS_COL_DEFS if x.get("key") == key), None)


for _k in ("op_loss_sale_amt", "direct_loss_sale_amt"):
    _a, _b = _col(la, _k), _col(old_mod, _k)
    ok(_a is not None and _a["label"] == NOW and _b is not None and _b["label"] != NOW,
       "列 `%s` 的 label 已统一成「%s」（HEAD 版 = 「%s」）"
       % (_k, NOW, (_b or {}).get("label", "?")),
       "现在 %s / HEAD %s" % ((_a or {}).get("label"), (_b or {}).get("label")))


def _slot(mod, key):
    return next(x for x in mod.LOSS_SLOTS if x["key"] == key)


# ⭐ 「统一成同一个词」的**直接**判据：三个粒度取出来必须同一个字符串。
#   逐个断言"等于新词"只保证各自对，保证不了**互相一致** —— 将来谁只改一处会漏检，
#   而这三个粒度说的是同一笔钱，必须同词。
_labels = ([_slot(la, "ded")["label"]]
           + [_col(la, _k)["label"] for _k in ("op_loss_sale_amt", "direct_loss_sale_amt")])
ok(len(set(_labels)) == 1, "三个粒度（列位表头 / ② 行 / ③ 行）的标签是**同一个词**", _labels)

_d2n = next(x for x in la.ROW_GROUPS if x["row_kind"] == "operator")["desc"]
_d2o = next(x for x in old_mod.ROW_GROUPS if x["row_kind"] == "operator")["desc"]
ok(NOW in _d2n and _d2n != _d2o,
   "② 行 desc 里的同一个词已跟着替换（HEAD 版仍是旧词）", _d2n)

_src = open(os.path.join(SERVER, "routers", "loss_accounting.py"), encoding="utf-8").read()
for _bad in OLD_VARIANTS:
    ok(_bad not in _src, "`loss_accounting.py` 全文无旧变体「%s」" % _bad, _src.count(_bad))
with erp_db.get_db() as c:
    sub_new = la._subtotal("operator", [{"values": {"op_to_loss_amt": 100, "op_loss_sale_amt": 30},
                                         "source": "manual"}])
    sub_old = old_mod._subtotal("operator", [{"values": {"op_to_loss_amt": 100,
                                                         "op_loss_sale_amt": 30},
                                               "source": "manual"}])
ok(sub_new == sub_old, "`_subtotal` 与 HEAD 逐字相同（本轮**未改它**）")
ok(sub_new.get("ded_sum") == 30, "ded_sum = 抵扣求和（跨期累计用它，避免用 gross−net 反推）")

# 🔴 ③ 进了 `_KIND_DED_COL` ⇒ `_subtotal` 对 direct 必须给出**真正的**抵扣（不是恒 0）。
#    这一条是「抵扣只此一份定义」的证据：改那一处，小计与跨期会同时生效。
sub_d = la._subtotal("direct", [{"values": {"direct_amt": 100, "direct_loss_sale_amt": 30},
                                 "source": "manual"}])
ok(sub_d["ded_sum"] == 30.0 and sub_d["net_amt"] == 70.0,
   "③ 直调组小计抵扣生效（ded_sum=30 / net=70）", "%s / %s" % (sub_d["ded_sum"], sub_d["net_amt"]))
ok(sub_d["has_rate"] is False, "③ 组仍不给率（没有分母）")

# ══════════════════════════════════════════════════════════════════════
head("⑭ 回归：既有端点未受本轮影响")
b = client.get("/api/loss/accounting/bootstrap", params={"period": "2026-05"}).json()["data"]
ok(b["company"]["net_amt"] == by["2026-05"]["net_amt"], "bootstrap 公司净额与 trend 一致")
ok(b["groups"][1]["subtotal"]["ded_sum"] == 3200.0,
   "②组小计的 ded_sum = 张三 3000 + 李四 200", b["groups"][1]["subtotal"]["ded_sum"])
hp = client.get("/api/loss/accounting/health", params={"period": "2026-09"}).json()["data"]
ok(len(hp["items"]) > 0, "体检端点仍正常（报损未录会被点出）", "%d 项" % len(hp["items"]))
pr = client.get("/api/loss/accounting/periods").json()["data"]["periods"]
ok({p for p in MONTHS if PLAN.get(p)}.issubset({x["period"] for x in pr}),
   "期次清单含全部**有录入**的月（空月 2026-06 不入清单：它本来就没有行）",
   ",".join(x["period"] for x in pr))

# ══════════════════════════════════════════════════════════════════════
FX = os.environ.get("LOSSFX")
if FX:
    head("⑮ 导出 fixture（给前端本地预检用**真实 payload** 渲染，全程不碰生产）")
    os.makedirs(FX, exist_ok=True)
    # 先结账两个月再导出：前端预检要验「只看已结账月」和「已隐藏」两类标记，
    # 若一个月都没结账，那个开关会把整屏筛空（只剩空态），占位形态就验不到。
    for p in ("2026-04", "2026-05"):
        cc = client.post("/api/loss/accounting/close", json={"period": p})
        assert cc.status_code == 200, cc.text
    for name, path in (("bootstrap", "/api/loss/accounting/bootstrap"),
                       ("trend", "/api/loss/accounting/trend")):
        rr = client.get(path, params={"period": "2026-09", "from": "2026-04", "to": "2026-09"})
        with open(os.path.join(FX, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(rr.json(), f, ensure_ascii=False)
    # 前端预检要按**期次**验「③ 行临期销售」的两种态（已填 / 未填），故按期多导两份：
    #   2026-07 = ③ 填了 900（行净额 −100，负数是合法信号）
    #   2026-08 = 直调额填了但临期销售未填 ⇒ 小计必须显示「—」而不是 0
    # 只导 2026-09（③ 两项都没填）的话，前端只能看到空输入框，
    # 「填了之后小计/净额怎么显示」就验不到。
    for p in ("2026-07", "2026-08"):
        rr = client.get("/api/loss/accounting/bootstrap", params={"period": p})
        with open(os.path.join(FX, "bootstrap-%s.json" % p), "w", encoding="utf-8") as f:
            json.dump(rr.json(), f, ensure_ascii=False)
    ok(True, "fixture 已导出（bootstrap.json 09 / bootstrap-07 / bootstrap-08 / trend.json）", FX)

# ══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 68)
print("通过 %d 项，失败 %d 项" % (PASSED[0], len(FAILED)))
if FAILED:
    for f in FAILED:
        print("  \u2717 " + f)
print("隔离目录：%s（可整目录删除）" % HARNESS)
print("=" * 68)
sys.exit(1 if FAILED else 0)
