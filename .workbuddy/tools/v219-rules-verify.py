"""v219 打磨⑥「数量上限可配」—— 影子库离线护栏（**不碰任何真实库**）。

跑法：/usr/bin/python3 .workbuddy/tools/v219-rules-verify.py

原理：`db/connection.py` 的 DB_PATH 取自环境变量 `ERP_DB_PATH`，指向临时目录即可
（同一性由 v219-shadow-verify.py 建立，照用）。

覆盖：
  A. 落库 → 读回 → `validation_spec()` 下发，三处**同一个值**（单源不成立则前端白改）
  B. 值域与类型的**反向边界**（1 / 上限 / 0 / 超界 / 非数字 / bool / 小数 / 空串）
     —— 反向一条都不能少：只断言「合法值能存」是恒真的绿
  C. 只写传进来的字段（改 qty_max 不许把 name_required 打回默认）
  D. 留痕：改完能查到「谁把多少改成了多少」
  E. **「可配」真的生效**：改 qty_max 后 `collect_violations` 的判定随新上限变
     —— 这是本轮交付的核心，前四条只证明「存进去了」，这条证明「判据真的跟着走」
  F. 路由层静态断言：`_admin` 判据 + ValueError→400 + PUT 方法（离线跑不了 Request，
     但可以把这三条写死的事实钉在源码上，改坏了立刻红）
  G. 与前端同源：下发的 kinds[].k 与 Forecast.vue 的 ERR_KINDS 前五项**逐字同名**
"""
import json
import os
import re
import sys
import tempfile

SERVER = "/Users/zhangjunfeng/Documents/hergent-erp/server"
VUE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue"
ROUTER = SERVER + "/routers/forecast_submissions.py"

TMP = tempfile.mkdtemp(prefix="v219rules_")
os.environ["ERP_DB_PATH"] = os.path.join(TMP, "shadow.db")
os.environ["ERP_SECRET"] = "test"
sys.path.insert(0, SERVER)

from db.queries import forecast_rules as fr  # noqa: E402

FAILS = []


def ck(name, cond, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + (("  | " + str(extra)) if extra else ""))
    if not cond:
        FAILS.append(name)


def raises(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except ValueError as e:
        return str(e)
    except Exception as e:  # noqa: BLE001
        return "WRONG-TYPE:" + type(e).__name__ + ":" + str(e)
    return None


print("=== A. 落库 / 读回 / 下发 三处同源 ===")
r0 = fr.get_rules()
ck("A1 初始 = 出厂默认 99999", r0.get("qty_max") == fr.RULES_DEFAULTS["qty_max"], r0)
saved = fr.set_rules(qty_max=5000)
ck("A2 set_rules 返回值 = 5000", saved.get("qty_max") == 5000, saved)
ck("A3 get_rules 读回 = 5000", fr.get_rules().get("qty_max") == 5000, fr.get_rules())
spec = fr.validation_spec()
ck("A4 validation_spec 下发 = 5000（前端拿到的就是它）", spec.get("qty_max") == 5000, spec.get("qty_max"))
ck("A5 spec 仍带 kinds 文案模板", isinstance(spec.get("kinds"), list) and len(spec["kinds"]) == 5,
   len(spec.get("kinds") or []))
ck("A6 overwrite 后再读仍是新值（不是只在返回值里）",
   fr.set_rules(qty_max=7777).get("qty_max") == 7777 and fr.get_rules().get("qty_max") == 7777)

print()
print("=== B. 值域 / 类型边界（反向为主）===")
ck("B01 下界 1 合法", fr.set_rules(qty_max=1).get("qty_max") == 1)
ck("B02 上界 999999999 合法", fr.set_rules(qty_max=999999999).get("qty_max") == 999999999)
ck("B03 0 被拒（0 会让整表全红）", bool(raises(fr.set_rules, qty_max=0)))
ck("B04 -1 被拒", bool(raises(fr.set_rules, qty_max=-1)))
ck("B05 1000000000 被拒（超上界）", bool(raises(fr.set_rules, qty_max=1000000000)))
ck("B06 非数字 '某' 被拒", bool(raises(fr.set_rules, qty_max="某")))
ck("B07 空串被拒", bool(raises(fr.set_rules, qty_max="")))
ck("B08 None 被拒", bool(raises(fr.set_rules, qty_max=None)))
ck("B09 bool True 被拒（bool 是 int 子类，不挡会静默变 1）", bool(raises(fr.set_rules, qty_max=True)))
ck("B10 小数 12.5 被拒（int(str) 决定，不做四舍五入）", bool(raises(fr.set_rules, qty_max=12.5)))
ck("B11 白名单外的字段被忽略（不许顺手写库）",
   fr.set_rules(qty_max=3000, whatever=1).get("qty_max") == 3000)
ck("B12 一个字段都没传 ⇒ ValueError（不是静默成功）", bool(raises(fr.set_rules)))
ck("B13 非法值**不改动**已存值（拒了之后读回还是 3000）",
   bool(raises(fr.set_rules, qty_max=0)) and fr.get_rules().get("qty_max") == 3000,
   fr.get_rules().get("qty_max"))

print()
print("=== C. 只写传入字段 ===")
fr.set_rules(name_required=False)
r = fr.set_rules(qty_max=8888)
ck("C1 改 qty_max 不动 name_required", r.get("name_required") is False, r)
ck("C2 改 name_required 不动 qty_max",
   fr.set_rules(name_required=True).get("qty_max") == 8888)
ck("C3 name_required 乱值被拒", bool(raises(fr.set_rules, name_required="大概吧")))

print()
print("=== D. 留痕 ===")
from db.queries.entity_logs import log_entity_changes, get_entity_changes  # noqa: E402

before = fr.get_rules()
fr.set_rules(qty_max=4321)
after = fr.get_rules()
n = log_entity_changes("forecast_rules", 0, "测试老板",
                       [("qty_max", before.get("qty_max"), after.get("qty_max"))],
                       action="update", ref="预报 · 数量录入规则")
ck("D1 留痕写入成功", n == 1, n)
rows = get_entity_changes("forecast_rules", 0)
hit = [x for x in rows if x.get("field_name") == "qty_max"]
ck("D2 能查回该条", len(hit) >= 1, len(rows))
if hit:
    h = hit[0]
    ck("D3 旧值/新值都对", str(h.get("old_value")) == str(before.get("qty_max"))
       and str(h.get("new_value")) == "4321", (h.get("old_value"), h.get("new_value")))
    ck("D4 记录了修改人", str(h.get("user_name")) == "测试老板", h.get("user_name"))
    ck("D5 记录了业务标识 ref", "数量录入规则" in str(h.get("ref") or ""), h.get("ref"))
else:
    ck("D3/D4/D5", False, "没有 qty_max 的留痕行")

print()
print("=== E. 「可配」真的生效：判据随上限走 ===")
ENTRIES = [{"row": 1, "col": "客户A", "name": "某商品", "qty": 8000}]
fr.set_rules(qty_max=9999)
v_hi = fr.collect_violations(ENTRIES, rules=fr.get_rules())
ck("E1 上限 9999 时 8000 放行", len(v_hi) == 0, v_hi)
fr.set_rules(qty_max=1000)
v_lo = fr.collect_violations(ENTRIES, rules=fr.get_rules())
ck("E2 上限收到 1000 后同一格被判 over", len(v_lo) == 1 and v_lo[0].get("kind") == "over", v_lo)
ck("E3 报错文案里带上**新**上限值（不是写死的 99999）",
   "1000" in str(v_lo[0].get("msg") if v_lo else ""), v_lo[0].get("msg") if v_lo else None)
ck("E4 validation_spec 也同步（前端拿到的文案与后端同一份）",
   "1000" in str([k for k in fr.validation_spec()["kinds"] if k["k"] == "over"][0]["msg"])
   or fr.validation_spec()["qty_max"] == 1000)
fr.set_rules(qty_max=999999999)
v_max = fr.collect_violations(ENTRIES, rules=fr.get_rules())
ck("E5 上限放到 999999999 后 8000 又放行（改得回来）", len(v_max) == 0, v_max)

print()
print("=== F. 路由层静态断言 ===")
rsrc = open(ROUTER, encoding="utf-8").read()
m = re.search(r"@router\.put\(\"/validation-rules\"\)(.*?)(?=\n@router\.|\Z)", rsrc, re.S)
ck("F1 路由存在且是 PUT", bool(m))
if m:
    blk = m.group(1)
    ck("F2 用了 _admin（role ∈ admin/boss），不是 _auth", "_admin(request)" in blk)
    ck("F3 不用 _auth 放行（写入口不能人人可写）", "_auth(request)\n" not in blk)
    ck("F4 ValueError → HTTPException(400)（不静默吞掉）",
       "except ValueError" in blk and "HTTPException(400" in blk)
    ck("F5 无字段时 400", "没有可保存的字段" in blk)
    ck("F6 走 fr.set_rules（唯一实现，不另写一份）", "fr.set_rules(" in blk)
    ck("F7 写留痕", "log_entity_changes" in blk)
    ck("F8 留痕异常不阻塞主流程", "except Exception" in blk)
else:
    ck("F2~F8", False, "路由块没截到")

print()
print("=== G. 与前端同源 ===")
vsrc = open(VUE, encoding="utf-8").read()
mk = re.search(r"const ERR_KINDS = \[(.*?)\n\]", vsrc, re.S)
ck("G1 能截到前端 ERR_KINDS", bool(mk))
if mk:
    fe = re.findall(r"\{ k: '([a-z]+)'", mk.group(1))
    be = [k["k"] for k in fr.validation_spec()["kinds"]]
    ck("G2 后端 kinds 顺序与前端 ERR_KINDS 前五项逐字同名", fe[:5] == be, (fe[:5], be))
    ck("G3 前端认得出所有后端下发的 k（否则分组筛选漏项）",
       all(k in fe for k in be), (be, fe))
ck("G4 前端 API 层有 setValidationRules",
   "setValidationRules" in open("/Users/zhangjunfeng/Documents/laozhangai-product/"
                                "hergent-cn-v2/src/api/modules.js", encoding="utf-8").read())

print()
print("RESULT: %s (%d FAIL)" % ("ALL PASS" if not FAILS else "HAS FAILURE", len(FAILS)))
for f in FAILS:
    print("  x " + f)
print("shadow db:", os.environ["ERP_DB_PATH"])
sys.exit(1 if FAILS else 0)
