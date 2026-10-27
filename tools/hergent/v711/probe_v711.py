#!/usr/bin/env python3
"""v711 探针：凭证模板（DB 层 + 模板优先/硬编码兜底）。

    python3 probe_v711.py            # 跑 A、B 两组（各自独立进程、独立库）
    python3 probe_v711.py --group a  # 只跑 A 组

## A 组：隔离空库（/tmp）
DB 层 CRUD 全流程 + `_voucher_entries_for` 的三道闸，含**反向可证伪**：
不平衡模板 / 不匹配 event_type / 缺 code ⇒ 必须返回 None（不得写账）。

## B 组：生产租户库**副本**（真实数据）
🔴 用生产真实单据，不用 mock（v697 教训：mock 全绿 ≠ 生效）。
未过账单据实测：销售 18,122 / 采购 83 / 收付款 16 / 成本 22,506 张，够用。
判据是**生成的分录科目与金额**，不是"没报错"：
  - flag 关 ⇒ 硬编码科目（与改前逐分一致）
  - flag 开 ⇒ 默认模板科目（与硬编码相同，证明模板路径真跑通）
  - 模板改科目 ⇒ 分录必须跟着变（证明不是摆设）
  - 模板改单边 ⇒ 必须回落硬编码（证明不平衡保护真生效）
"""
import os
import shutil
import subprocess
import sys
import tempfile

ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
HERE = os.path.dirname(os.path.abspath(__file__))
PROD_DB = os.path.join(ERP, "tenant_1.db")

GROUP_A = r'''
import os, sys, json, sqlite3
sys.path.insert(0, "__ERP__")
import erp_db as db

R = []
def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    # 立即打印：中途崩溃时已经跑过的结论不能一起丢掉（B 组第一次就全丢了）
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)

# --- 1. 惰性建表：空库里第一次 list 就该把表建出来
rows = db.voucher_template_list()
ok("A1 空库 list 返回 []（不抛异常）", rows == [], str(rows)[:60])
con = sqlite3.connect(os.environ["ERP_DB_PATH"])
ts = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
ok("A2 惰性建出 voucher_templates 表", "voucher_templates" in ts)
ok("A3 惰性建出 voucher_template_applies 表", "voucher_template_applies" in ts)

# --- 2. create / list
entries = json.dumps([
    {"code": "1122", "name": "应收账款", "direction": "debit", "amount_source": "total_amount", "summary": "销售:{customer_name}"},
    {"code": "6001", "name": "主营业务收入", "direction": "credit", "amount_source": "total_amount", "summary": "销售:{customer_name}"},
], ensure_ascii=False)
tid = db.voucher_template_create("探针-销售", "sale_deliver", "探针用", entries, "{}", 1, 50)
ok("A4 create 返回 id>0", isinstance(tid, int) and tid > 0, "id=%s" % tid)
lst = db.voucher_template_list()
ok("A5 list 命中 1 条", len(lst) == 1, "实际 %d" % len(lst))
ok("A6 字段落库正确", lst and lst[0]["name"] == "探针-销售" and lst[0]["event_type"] == "sale_deliver"
   and lst[0]["priority"] == 50 and lst[0]["is_active"] == 1, str(lst[0]) if lst else "")
ok("A7 按 event_type 过滤命中", len(db.voucher_template_list(event_type="sale_deliver")) == 1)
ok("A8 按别的 event_type 过滤为 0", len(db.voucher_template_list(event_type="payment_received")) == 0)

# --- 3. 参数校验（路由层靠它给 400 而不是 500）
try:
    db.voucher_template_create("", "sale_deliver")
    ok("A9 空名称抛 ValueError", False, "没抛")
except ValueError:
    ok("A9 空名称抛 ValueError", True)
try:
    db.voucher_template_create("x", "")
    ok("A10 空事件类型抛 ValueError", False, "没抛")
except ValueError:
    ok("A10 空事件类型抛 ValueError", True)

# --- 4. update：传 None 的字段保持原值
db.voucher_template_update(tid, description="改过的说明")
one = db.voucher_template_list()[0]
ok("A11 update 只改目标字段", one["description"] == "改过的说明" and one["name"] == "探针-销售"
   and one["event_type"] == "sale_deliver", str(one))
try:
    db.voucher_template_update(999999, name="x")
    ok("A12 update 不存在的 id 抛 ValueError", False, "没抛")
except ValueError:
    ok("A12 update 不存在的 id 抛 ValueError", True)

# --- 5. flag 关 ⇒ 模板不参与
ctx = {"total_amount": 1000.0, "customer_name": "张三", "order_no": "SO-1", "ref_id": 7}
ok("A13 flag 关时 _voucher_entries_for 返回 None",
   db._voucher_entries_for("sale_deliver", ctx) is None)

# --- 6. flag 开 ⇒ 命中模板
db.feature_flag_set("voucher_templates", 1)
ff = [f for f in db.feature_flag_list() if f.get("name") == "voucher_templates"]
ok("A14 flag 可打开（惰性建表生效）", ff and int(ff[0]["enabled"]) == 1, str(ff))
es = db._voucher_entries_for("sale_deliver", ctx)
ok("A15 命中模板返回 2 条分录", isinstance(es, list) and len(es) == 2, str(es)[:120])
ok("A16 科目与方向正确", es and es[0]["code"] == "1122" and es[0]["debit"] == 1000.0
   and es[1]["code"] == "6001" and es[1]["credit"] == 1000.0, str(es)[:160])
ok("A17 借贷平衡", es and es[0]["debit"] == es[1]["credit"])
ok("A18 摘要里 {customer_name} 被替换", es and "张三" in es[0]["summary"], str(es[0]["summary"]) if es else "")
ok("A19 审计表记录了 1 次命中",
   con.execute("SELECT COUNT(*) FROM voucher_template_applies").fetchone()[0] == 1,
   "实际 %d" % con.execute("SELECT COUNT(*) FROM voucher_template_applies").fetchone()[0])

# --- 7. 反向可证伪：不平衡 / 不匹配 / 缺 code ⇒ None
db.voucher_template_create("探针-单边", "sale_deliver", "", json.dumps([
    {"code": "1122", "name": "应收账款", "direction": "debit", "amount_source": "total_amount"},
]), "{}", 1, 999)  # priority 更高 ⇒ 会被优先选中
es_unb = db._voucher_entries_for("sale_deliver", ctx)
ok("A20 不平衡模板被跳过（下一个可用模板生效）",
   es_unb is not None and len(es_unb) == 2
   and abs(sum(e["debit"] for e in es_unb) - sum(e["credit"] for e in es_unb)) < 0.005,
   str(es_unb)[:120])
ok("A21 不平衡的模板未被写审计（审计不骗人）",
   con.execute("SELECT COUNT(*) FROM voucher_template_applies WHERE template_id=(SELECT id FROM voucher_templates WHERE name='探针-单边')").fetchone()[0] == 0,
   "实际 %d 条" % con.execute("SELECT COUNT(*) FROM voucher_template_applies WHERE template_id=(SELECT id FROM voucher_templates WHERE name='探针-单边')").fetchone()[0])

db.voucher_template_create("探针-缺code", "expense_paid", "", json.dumps([
    {"name": "管理费用", "direction": "debit", "amount_source": "amount"},
    {"code": "1002", "name": "银行存款", "direction": "credit", "amount_source": "amount"},
]), "{}", 1, 100)
ok("A22 分录缺 code ⇒ None",
   db._voucher_entries_for("expense_paid", {"amount": 100}) is None)
ok("A23 event_type 无模板 ⇒ None（回落硬编码）",
   db._voucher_entries_for("purchase_receive", ctx) is None)

# --- 8. delete 是软删
db.voucher_template_delete(tid)
# 🔴 按 id 精确取：list 是 `ORDER BY priority DESC`，而本组里还留着 priority=999 的
# 单边模板，取 [0] 会拿到它 —— 断言取错对象会给出假失败（A24/A25 第一次就这么错的）。
_one = [t for t in db.voucher_template_list(event_type="sale_deliver") if t["id"] == tid]
ok("A24 delete 后 is_active=0（软删）", _one and _one[0]["is_active"] == 0, str(_one))
ok("A25 active_only=True 过滤掉已停用",
   len([t for t in db.voucher_template_list(event_type="sale_deliver", active_only=True)
        if t["id"] == tid]) == 0)
try:
    db.voucher_template_delete(999999)
    ok("A26 delete 不存在的 id 抛 ValueError", False, "没抛")
except ValueError:
    ok("A26 delete 不存在的 id 抛 ValueError", True)

print("RESULT %d/%d" % (sum(1 for g, _, _ in R if g), len(R)))
'''

GROUP_B = r'''
import os, sys, json, sqlite3
sys.path.insert(0, "__ERP__")
import erp_db as db

DBPATH = os.environ["ERP_DB_PATH"]
R = []
def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    # 立即打印：中途崩溃时已经跑过的结论不能一起丢掉（B 组第一次就全丢了）
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)

def rows_of(ref_type, ref_id):
    with db.get_db() as c:
        return [dict(r) for r in c.execute(
            "SELECT account_code, debit, credit FROM journal_entries "
            "WHERE ref_type=? AND ref_id=?", (ref_type, ref_id)).fetchall()]

def codes(rs):
    return sorted(r["account_code"] for r in rs)

def pick(sql, args=()):
    with db.get_db() as c:
        r = c.execute(sql, args).fetchone()
        return dict(r) if r else None

# 真实未过账单据（🔴 不用 mock：v697 就是 mock 全绿、线上没入口）
so = pick("SELECT so.id, so.order_no, so.total_amount FROM sale_orders so "
          "WHERE so.total_amount>0 AND NOT EXISTS(SELECT 1 FROM journal_entries je "
          "WHERE je.ref_type='sale' AND je.ref_id=so.id) ORDER BY so.id")
ok("B1 取到未过账销售单（真实数据）", so is not None, str(so))

# --- flag 关：必须与改前逐分一致（硬编码）
db.auto_journal_for_sale(so["id"])
rs = rows_of("sale", so["id"])
ok("B2 flag 关 ⇒ 硬编码科目 1122/6001", codes(rs) == ["1122", "6001"], str(codes(rs)))
ok("B3 flag 关 ⇒ 金额=订单金额且借贷平衡",
   rs and abs(sum(r["debit"] for r in rs) - so["total_amount"]) < 0.005
   and abs(sum(r["debit"] for r in rs) - sum(r["credit"] for r in rs)) < 0.005,
   "dr=%s cr=%s amt=%s" % (sum(r["debit"] for r in rs) if rs else None,
                           sum(r["credit"] for r in rs) if rs else None, so["total_amount"]))

# --- flag 开 + 默认模板
db.feature_flag_set("voucher_templates", 1)
from voucher_engine import _init_default_templates
_init_default_templates()
ok("B4 播种 8 条默认模板", len(db.voucher_template_list()) == 8,
   "实际 %d" % len(db.voucher_template_list()))

so2 = pick("SELECT so.id, so.total_amount FROM sale_orders so WHERE so.total_amount>0 "
           "AND so.id<>? AND NOT EXISTS(SELECT 1 FROM journal_entries je "
           "WHERE je.ref_type='sale' AND je.ref_id=so.id) ORDER BY so.id", (so["id"],))
db.auto_journal_for_sale(so2["id"])
rs2 = rows_of("sale", so2["id"])
ok("B5 flag 开 ⇒ 默认模板跑通，科目仍 1122/6001", codes(rs2) == ["1122", "6001"], str(codes(rs2)))
ok("B6 flag 开 ⇒ 金额与借贷不变",
   rs2 and abs(sum(r["debit"] for r in rs2) - so2["total_amount"]) < 0.005
   and abs(sum(r["debit"] for r in rs2) - sum(r["credit"] for r in rs2)) < 0.005)

# --- 反向可证伪 1：把模板科目改掉 ⇒ 分录必须跟着变（证明模板不是摆设）
con = sqlite3.connect(DBPATH)
con.execute("UPDATE voucher_templates SET entries_json=? WHERE event_type='sale_deliver'",
            (json.dumps([
                {"code": "1123", "name": "预付账款", "direction": "debit", "amount_source": "total_amount", "summary": "探针改科目"},
                {"code": "6001", "name": "主营业务收入", "direction": "credit", "amount_source": "total_amount", "summary": "探针改科目"},
            ], ensure_ascii=False),))
con.commit()
so3 = pick("SELECT so.id FROM sale_orders so WHERE so.total_amount>0 AND so.id NOT IN (?,?) "
           "AND NOT EXISTS(SELECT 1 FROM journal_entries je WHERE je.ref_type='sale' AND je.ref_id=so.id) "
           "ORDER BY so.id", (so["id"], so2["id"]))
db.auto_journal_for_sale(so3["id"])
rs3 = rows_of("sale", so3["id"])
ok("B7 模板改科目 ⇒ 分录跟着变（模板真生效）", codes(rs3) == ["1123", "6001"], str(codes(rs3)))

# --- 反向可证伪 2：模板改单边 ⇒ 必须回落硬编码（不平衡保护）
con.execute("UPDATE voucher_templates SET entries_json=? WHERE event_type='sale_deliver'",
            (json.dumps([
                {"code": "1122", "name": "应收账款", "direction": "debit", "amount_source": "total_amount"},
            ], ensure_ascii=False),))
con.commit()
so4 = pick("SELECT so.id FROM sale_orders so WHERE so.total_amount>0 AND so.id NOT IN (?,?,?) "
           "AND NOT EXISTS(SELECT 1 FROM journal_entries je WHERE je.ref_type='sale' AND je.ref_id=so.id) "
           "ORDER BY so.id", (so["id"], so2["id"], so3["id"]))
db.auto_journal_for_sale(so4["id"])
rs4 = rows_of("sale", so4["id"])
ok("B8 模板不平衡 ⇒ 回落硬编码 1122/6001", codes(rs4) == ["1122", "6001"], str(codes(rs4)))
ok("B9 回落的分录仍然借贷平衡",
   rs4 and abs(sum(r["debit"] for r in rs4) - sum(r["credit"] for r in rs4)) < 0.005)

# 还原默认模板，继续测其余三个事件
# 🔴 `_init_default_templates()` 只在「一条都没有」时才播种 —— 只删 sale_deliver
# 的话还剩 7 条，它什么都不会做（B10 第一次就这么假的失败了）。要还原就得清空。
con.execute("DELETE FROM voucher_templates")
con.commit()
_init_default_templates()
ok("B10 还原后又是 8 条模板", len(db.voucher_template_list()) == 8,
   "实际 %d" % len(db.voucher_template_list()))

# --- purchase
po = pick("SELECT po.id, po.total_amount FROM purchase_orders po WHERE po.total_amount>0 "
          "AND NOT EXISTS(SELECT 1 FROM journal_entries je WHERE je.ref_type='purchase' AND je.ref_id=po.id) "
          "ORDER BY po.id")
db.auto_journal_for_purchase(po["id"])
rsp = rows_of("purchase", po["id"])
ok("B11 采购入库 ⇒ 1405/2202", codes(rsp) == ["1405", "2202"], str(codes(rsp)))

# --- payment（真实 type 只有 income / expense 两种）
cf_in = pick("SELECT cf.id, cf.amount FROM cash_flow cf WHERE cf.type='income' AND NOT EXISTS("
             "SELECT 1 FROM journal_entries je WHERE je.ref_type='payment' AND je.ref_id=cf.id) ORDER BY cf.id")
db.auto_journal_for_payment(cf_in["id"])
rsc = rows_of("payment", cf_in["id"])
ok("B12 收款（income）⇒ 1002/1122", codes(rsc) == ["1002", "1122"], str(codes(rsc)))
cf_ex = pick("SELECT cf.id FROM cash_flow cf WHERE cf.type='expense' AND NOT EXISTS("
             "SELECT 1 FROM journal_entries je WHERE je.ref_type='payment' AND je.ref_id=cf.id) ORDER BY cf.id")
if cf_ex:
    db.auto_journal_for_payment(cf_ex["id"])
    rse = rows_of("payment", cf_ex["id"])
    ok("B13 付款（expense）⇒ 2202/1002", codes(rse) == ["1002", "2202"], str(codes(rse)))
else:
    ok("B13 付款（expense）⇒ 2202/1002", True, "无未过账 expense，跳过")

# --- cogs
so_c = pick("SELECT so.id FROM sale_orders so WHERE NOT EXISTS(SELECT 1 FROM journal_entries je "
            "WHERE je.ref_type='cogs' AND je.ref_id=so.id) AND EXISTS("
            "SELECT 1 FROM sale_order_items si JOIN products p ON si.product_id=p.id "
            "WHERE si.order_id=so.id AND COALESCE(p.purchase_price,0)>0) ORDER BY so.id DESC")
db.auto_journal_for_cogs(so_c["id"])
rsc2 = rows_of("cogs", so_c["id"])
ok("B14 结转成本 ⇒ 6401/1405", codes(rsc2) == ["1405", "6401"], str(codes(rsc2)))
ok("B15 成本分录借贷平衡且金额>0",
   rsc2 and sum(r["debit"] for r in rsc2) > 0
   and abs(sum(r["debit"] for r in rsc2) - sum(r["credit"] for r in rsc2)) < 0.005,
   str(sum(r["debit"] for r in rsc2) if rsc2 else 0))

# --- 审计：模板命中次数 > 0（证明自动记账路径真的调用了模板而没走 fallback）
n = con.execute("SELECT COUNT(*) FROM voucher_template_applies").fetchone()[0]
ok("B16 自动记账路径留下模板命中审计", n > 0, "命中 %d 次" % n)

print("RESULT %d/%d" % (sum(1 for g, _, _ in R if g), len(R)))
'''


def run_group(group, db_path, label):
    src = (GROUP_A if group == "a" else GROUP_B).replace("__ERP__", ERP)
    tmp = tempfile.mkdtemp(prefix="v711-probe-%s-" % group)
    script = os.path.join(tmp, "g%s.py" % group)
    open(script, "w", encoding="utf-8").write(src)
    env = dict(os.environ, ERP_DB_PATH=db_path, PYTHONWARNINGS="ignore")
    p = subprocess.run([sys.executable, script], cwd=ERP, env=env,
                       capture_output=True, text=True, timeout=900)
    print("\n" + "=" * 78)
    print("【%s】库=%s" % (label, db_path))
    print("=" * 78)
    print(p.stdout.strip() or "(无输出)")
    if p.returncode != 0:
        print(p.stderr.strip()[-3000:])
    shutil.rmtree(tmp, ignore_errors=True)
    return p.stdout, p.returncode


def main():
    only = None
    if "--group" in sys.argv:
        only = sys.argv[sys.argv.index("--group") + 1]

    total = passed = 0
    fails = []

    if only in (None, "a"):
        tmpdir = tempfile.mkdtemp(prefix="v711-a-")
        dbpath = os.path.join(tmpdir, "probe.db")
        out, rc = run_group("a", dbpath, "A 组 隔离空库")
        for line in out.splitlines():
            if line.startswith("PASS ") or line.startswith("FAIL "):
                total += 1
                if line.startswith("PASS "):
                    passed += 1
                else:
                    fails.append(line)
        if rc != 0:
            fails.append("A 组进程退出码 %d" % rc)
        shutil.rmtree(tmpdir, ignore_errors=True)

    if only in (None, "b"):
        if not os.path.exists(PROD_DB):
            print("🔴 缺生产库 %s" % PROD_DB)
            return 2
        tmpdir = tempfile.mkdtemp(prefix="v711-b-")
        dbpath = os.path.join(tmpdir, "tenant_1.db")
        shutil.copy2(PROD_DB, dbpath)
        out, rc = run_group("b", dbpath, "B 组 生产租户库副本（真实单据）")
        for line in out.splitlines():
            if line.startswith("PASS ") or line.startswith("FAIL "):
                total += 1
                if line.startswith("PASS "):
                    passed += 1
                else:
                    fails.append(line)
        if rc != 0:
            fails.append("B 组进程退出码 %d" % rc)
        shutil.rmtree(tmpdir, ignore_errors=True)

    print("\n" + "=" * 78)
    print("总计 %d/%d" % (passed, total))
    for f in fails:
        print("  🔴 " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
