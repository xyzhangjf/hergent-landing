"""v171 修改日志 · 生产侧 E2E（隔离租户 9998，跑完即销）

验证三件事：
  A. 三条写路径（填报 upsert / 清除 delete / Excel 导入 import）都留痕
  B. 每条记录含「修改人 · 时间 · 对象 · 字段 · 原值 → 新值」，且只记真实变化
  C. 读取端点 /audit 的期次筛选精确（2026 不串进 2026-09）
外加：存量租户库 entity_change_logs 缺 ref 列时能被懒补上（本轮真正的迁移风险点）。
"""
import json
import urllib.request
import urllib.error
import urllib.parse

TOK = "__TOKEN__"
BASE = "http://127.0.0.1:8700"
H = {"Authorization": "Bearer " + TOK, "X-Tenant-Id": "9998",
     "Content-Type": "application/json"}
# 无条件禁代理：本机 HTTP_PROXY 会劫持回环请求 → 502 假象（技能已载明）
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PASS, FAIL = [], []


def ok(cond, msg):
    (PASS if cond else FAIL).append(msg)
    print(("  PASS " if cond else "  FAIL ") + msg)


def call(method, path, body=None, data=None, ctype=None):
    h = dict(H)
    if ctype:
        h["Content-Type"] = ctype
    payload = data if data is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=payload, headers=h, method=method)
    try:
        with OP.open(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"raw": raw[:200]}


def audit(month="", keyword=""):
    q = "limit=200"
    if month:
        q += "&month=" + urllib.parse.quote(month)
    if keyword:
        q += "&keyword=" + urllib.parse.quote(keyword)
    st, j = call("GET", "/api/rebate-achievements/audit?" + q)
    assert st == 200, "audit HTTP %s: %s" % (st, j)
    return j.get("data", {}).get("items", []), j.get("data", {}).get("total", 0)


def entries_for(target):
    return [x for x in audit()[0] if x["target"] == target]


def fields_of(items):
    return sorted((x["field"], x["old_value"], x["new_value"]) for x in items)


SK = "v171probe"
SN = "v171探针品牌"
REF = "2026-09 · 品牌 · " + SN
BODY = {"period_month": "2026-09", "dimension": "brand", "scope_key": SK,
        "scope_name": SN, "actual_amount": 100000, "actual_rebate": 8000, "source": "manual"}
# 导入的对象名逐轮唯一：同一份 CSV 重导是"值没变"→按设计**不留痕**，
# 若写死名字，第二次跑就会把"正确行为"读成"导入没留痕"（本轮真实踩到）。
import time
IMP_SN = "v171导入品牌" + str(int(time.time()))[-5:]

print("=" * 74)
print("A. 新增填报（POST upsert，首次=create）")
print("=" * 74)
# 先清场：删掉上一轮的全部探针行（含导入行）
st, j = call("GET", "/api/rebate-achievements?month=2026-09")
for r in (j.get("data") or []):
    if str(r.get("scope_key") or "").startswith("v171"):
        call("DELETE", "/api/rebate-achievements/%s" % r["id"])
st, j = call("POST", "/api/rebate-achievements", BODY)
ok(st == 200 and j.get("success"), "新增填报返回 200/success（HTTP %s）" % st)
rid = j.get("id")
ok(bool(rid), "拿到记录 id=%s" % rid)

items = entries_for(REF)
ok(len(items) == 3, "留痕 3 条（对象名 + 金额 + 返利），实际 %d 条：%s"
   % (len(items), fields_of(items)))
ok(fields_of(items) == sorted([("scope_name", "", SN),
                               ("actual_amount", "", "100000"),
                               ("actual_rebate", "", "8000")]),
   "字段 / 原值 / 新值逐条正确 → %s" % fields_of(items))
ok(all(x["action"] == "create" and x["action_label"] == "新增填报" for x in items),
   "动作 = 新增填报（create）")
ok(all(x["user_name"] and x["user_name"] != "system" for x in items),
   "修改人取自登录态 = %r（不是 system）" % (items[0]["user_name"] if items else None))
ok(all(x["field_label"] in ("作用对象名称", "实际达成金额", "实际返利") for x in items),
   "字段中文标签已映射 → %s" % [x["field_label"] for x in items])
ok(all(x["at"] for x in items), "修改时间已记录 → %s" % (items[0]["at"] if items else None))
ok(all(x["target"] == REF for x in items), "对象标识 = %r" % REF)

print()
print("=" * 74)
print("B. 修改已有值（部分更新：只传 actual_rebate）")
print("=" * 74)
before_total = audit()[1]
st, j = call("POST", "/api/rebate-achievements",
             {"period_month": "2026-09", "dimension": "brand", "scope_key": SK,
              "scope_name": SN, "actual_rebate": 9000, "source": "manual"})
ok(st == 200, "修改返回 200（HTTP %s）" % st)
items = entries_for(REF)
ok(len(items) == 4, "新增 1 条留痕（共 4 条）")
latest = items[0]
ok(latest["field"] == "actual_rebate" and latest["old_value"] == "8000"
   and latest["new_value"] == "9000",
   "只记变化的那个字段，且原值/新值正确 → %s → %s" % (latest["old_value"], latest["new_value"]))
ok(latest["action"] == "update" and latest["action_label"] == "修改填报", "动作 = 修改填报")
ok(not any(x["field"] == "actual_amount" and x["action"] == "update" for x in items),
   "**没被动过的 actual_amount 不产生留痕**（部分更新语义）")
ok(audit()[1] == before_total + 1, "总数 +1")

print()
print("=" * 74)
print("C. 点一下但值没变 → 不留痕（日志要能直接当凭据，掺噪音=不可用）")
print("=" * 74)
before_total = audit()[1]
st, j = call("POST", "/api/rebate-achievements",
             {"period_month": "2026-09", "dimension": "brand", "scope_key": SK,
              "scope_name": SN, "actual_rebate": 9000, "actual_amount": 100000,
              "source": "manual"})
ok(st == 200, "同值重提返回 200")
ok(audit()[1] == before_total, "总数不变（%d → %d）：未变化不留痕" % (before_total, audit()[1]))

print()
print("=" * 74)
print("D. 再改一个字段（actual_amount 100000 → 150000）")
print("=" * 74)
st, j = call("POST", "/api/rebate-achievements",
             {"period_month": "2026-09", "dimension": "brand", "scope_key": SK,
              "actual_amount": 150000, "source": "manual"})
items = entries_for(REF)
ok(items[0]["field"] == "actual_amount" and items[0]["old_value"] == "100000"
   and items[0]["new_value"] == "150000",
   "金额 100000 → 150000 已留痕 → %s" % items[0]["new_value"])

print()
print("=" * 74)
print("E. 期次筛选精确性")
print("=" * 74)
m9, t9 = audit("2026-09")
m10, t10 = audit("2026-10")
my, ty = audit("2026")
ok(t9 >= 5, "按期次 2026-09 筛出 %d 条" % t9)
ok(all(x["target"].startswith("2026-09 ·") for x in m9), "筛出的都属于 2026-09")
ok(t10 == 0, "2026-10 无数据 → %d 条" % t10)
# 年口径不能串进月口径：此时 2026-09 的探针行属于月口径，年口径应查不到它们
ok(not any(x["target"].startswith("2026-09 ·") for x in my),
   "年口径 2026 不会串进月口径 2026-09（命中 %d 条，均为真年口径行）" % ty)

print()
print("=" * 74)
print("F. 关键词搜索")
print("=" * 74)
kw, kt = audit("", SN)
ok(kt >= 5 and all(x["target"] == REF for x in kw), "按对象名搜到 %d 条" % kt)
kw2, kt2 = audit("", "9999")   # 一个不存在的值
ok(kt2 == 0, "搜不存在的值 → 0 条")

print()
print("=" * 74)
print("G. Excel 导入（POST /import 多部分表单）")
print("=" * 74)
csv_body = ("月份,维度,作用对象,实际达成金额,实际达成数量,实际返利,备注\n"
            "2026-09,品牌,%s,88888,,6666,导入留痕必测\n" % IMP_SN)
boundary = "----v171Boundary"
parts = []
parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"v171.csv\"\r\n"
              "Content-Type: text/csv\r\n\r\n" % boundary).encode() + csv_body.encode() + b"\r\n")
parts.append(("--%s\r\nContent-Disposition: form-data; name=\"month\"\r\n\r\n2026-09\r\n"
              % boundary).encode())
parts.append(("--%s--\r\n" % boundary).encode())
body_bytes = b"".join(parts)
st, j = call("POST", "/api/rebate-achievements/import", data=body_bytes,
             ctype="multipart/form-data; boundary=" + boundary)
ok(st == 200 and j.get("imported") == 1, "导入 1 行成功（HTTP %s, %s）" % (st, j.get("imported")))
IMP_REF = "2026-09 · 品牌 · " + IMP_SN
imp = entries_for(IMP_REF)
# 4 条 = 对象名 + 金额 + 返利 + **备注**（CSV 里带了「备注」列，导入确实写了它 → 必须留痕）
ok(len(imp) == 4, "导入留痕 4 条（对象名 + 金额 + 返利 + 备注），实际 %d：%s"
   % (len(imp), fields_of(imp)))
ok(all(x["action"] == "import" and x["action_label"] == "Excel 导入" for x in imp),
   "动作 = Excel 导入")
ok(("actual_amount", "", "88888") in fields_of(imp), "金额 88888 已留痕")
ok(("note", "", "导入留痕必测") in fields_of(imp),
   "备注列被导入覆盖也如实留痕（这类顺手抹掉正是日志应该暴露出来的）")

print()
print("=" * 74)
print("H. 清除整行（DELETE）")
print("=" * 74)
st, j = call("GET", "/api/rebate-achievements?month=2026-09")
target = None
for r in (j.get("data") or []):
    if r.get("scope_key") == SK:
        target = r
ok(bool(target), "定位到探针行 id=%s" % (target or {}).get("id"))
st, j = call("DELETE", "/api/rebate-achievements/%s" % (target or {}).get("id", 0))
ok(st == 200, "清除返回 200（HTTP %s）" % st)
items = entries_for(REF)
dels = [x for x in items if x["action"] == "delete"]
ok(len(dels) == 3, "清除留痕 3 条（对象名 + 150000 + 9000），实际 %d：%s"
   % (len(dels), fields_of(dels)))
ok(("actual_amount", "150000", "") in fields_of(dels),
   "清除记录了**原值**（150000）且新值为空 → 前端渲染「已清除」")
ok(("actual_rebate", "9000", "") in fields_of(dels), "返利 9000 也被记下（行没了就查不回来了）")
ok(all(x["action_label"] == "清除" for x in dels), "动作标签 = 清除")

print()
print("=" * 74)
print("I. 清除后审计仍可追溯（对象名固化在 ref 里，行已删除）")
print("=" * 74)
st, j = call("GET", "/api/rebate-achievements?month=2026-09")
still = [r for r in (j.get("data") or []) if r.get("scope_key") == SK]
ok(not still, "探针行确实已从表中消失")
ok(len(entries_for(REF)) >= 6, "但它的留痕仍在（%d 条），且对象名可读「%s」"
   % (len(entries_for(REF)), REF))

print()
print("=" * 74)
print("J. 排序与总量")
print("=" * 74)
items, total = audit()
ids = [x["id"] for x in items]
ok(ids == sorted(ids, reverse=True), "按时间倒序（最新在前），前 3 个 id=%s" % ids[:3])
ok(total == len(items) or total > len(items), "total=%d 与返回条数=%d 自洽" % (total, len(items)))

print()
print("=" * 74)
print("K. 原始 SQL 复核：entity_change_logs 的 ref 列（存量库懒补列是否生效）")
print("=" * 74)
import sqlite3
c = sqlite3.connect("file:/opt/hergent-erp/tenant_9998.db?mode=ro", uri=True)
cols = [r[1] for r in c.execute("PRAGMA table_info(entity_change_logs)").fetchall()]
ok("ref" in cols, "沙箱库 entity_change_logs 已自动补上 ref 列 → %s" % cols)
n = c.execute("SELECT COUNT(*) FROM entity_change_logs WHERE entity_type='rebate_achievement'").fetchone()[0]
ok(n >= 6, "库中 rebate_achievement 留痕 %d 行" % n)
hashes = c.execute("SELECT DISTINCT user_name FROM entity_change_logs").fetchall()
ok(all(h[0] not in ("", None) for h in hashes), "每条都有修改人 → %s" % [h[0] for h in hashes])
print("  样例原始行：")
for r in c.execute("SELECT user_name, action, field_name, old_value, new_value, ref FROM "
                   "entity_change_logs ORDER BY id LIMIT 3").fetchall():
    print("   ", r)

print()
print("=" * 74)
print("结果：PASS %d / FAIL %d" % (len(PASS), len(FAIL)))
print("=" * 74)
if FAIL:
    for f in FAIL:
        print("  FAIL:", f)
    raise SystemExit(1)
print("ALL_PASS")
