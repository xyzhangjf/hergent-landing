#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v714 探针：利润表 GL 口径（分类覆盖 / 叶子去重 / 净额方向 / 按月回落）。

    python3 probe_v714.py              # A、B 两组
    python3 probe_v714.py --group a    # 只跑 A
    python3 probe_v714.py --group b    # 只跑 B

## A 组：隔离空库造边界（人造数据，能证伪）
改前的实现是「`category IN ('收入','成本','费用')` + 收入只取 credit + 成本只取 debit
+ 父子一起加」。这四项缺陷在**生产真实数据上无法区分**（只有 `6001` 一笔收入，
父子双算和方向错误都还是同一个数）。所以边界必须在隔离库上造：
  - 收入 1000 贷 + 200 借（红冲）⇒ 期望 800（只取 credit 会得 1000）
  - 成本 600 借 + 100 贷（红冲）⇒ 期望 500（只取 debit 会得 600）
  - 父 6051 贷 300 + 子 605101 贷 100 ⇒ 期望 100（父子双算会得 400）
  - 5001 生产成本 借 9999 ⇒ **不得**进成本（`category='成本'` 的老做法会算进来）
  - net_profit 必须 == 全集净额（自证勾稽）

## B 组：生产租户库**副本** + 真实数据
  - 逐月 net_profit 加总 == −资产负债表 `unclosed_profit`（跨表勾稽，强判据）
  - 全期 `get_pnl()` 与改前基线**逐分一致**（KPI 非回归）
  - 按月过滤真的生效（2026-10 的 signed 销售是 0，改前返回全期 878 万）
"""
import os
import shutil
import subprocess
import sys
import tempfile

ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
HERE = os.path.dirname(os.path.abspath(__file__))
PROD_TENANT = os.path.join(ERP, "tenant_1.db")

# 改前实测基线（2026-10-28，打补丁前用生产代码 + 库副本取得）
BASE_ALL = {"sales": 8786105.849999988, "purchases": 898932.7339999999,
            "other_income": 5752.0, "other_expense": 956.0,
            "net_profit": 7891969.115999988}

GROUP_A = r'''
import os, sys, sqlite3
sys.path.insert(0, "__ERP__")
p = os.environ["ERP_DB_PATH"]
con = sqlite3.connect(p)
con.executescript("""
CREATE TABLE IF NOT EXISTS chart_of_accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, category TEXT,
  is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS journal_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_code TEXT, debit REAL, credit REAL,
  date TEXT, ref_type TEXT);
CREATE TABLE IF NOT EXISTS sale_orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, total_amount REAL, order_date TEXT);
CREATE TABLE IF NOT EXISTS purchase_orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, total_amount REAL, order_date TEXT);
CREATE TABLE IF NOT EXISTS cash_flow(
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, amount REAL, created_at TEXT);
""")
coa = [
    ("6001", "主营业务收入", "损益"),
    ("6051", "其他业务收入", "损益"),
    ("605101", "代垫厂家费用返还", "损益"),
    ("6401", "主营业务成本", "损益"),
    ("6402", "其他业务成本", "损益"),
    ("640201", "客户费用", "损益"),
    ("6601", "销售费用", "损益"),
    ("5001", "生产成本", "成本"),     # 5 开头，资产性质，必须排除
]
for c, n, cat in coa:
    con.execute("INSERT INTO chart_of_accounts(code,name,category,is_active) VALUES(?,?,?,1)", (c, n, cat))

je = [
    # 2026-05
    ("6001", 0, 1000, "2026-05-10"),        # 收入
    ("6001", 200, 0, "2026-05-11"),         # 收入红冲
    ("6401", 600, 0, "2026-05-12"),         # 成本
    ("6401", 0, 100, "2026-05-13"),         # 成本红冲
    ("6402", 150, 0, "2026-05-14"),         # 费用（父，子全零）
    ("6601", 50, 0, "2026-05-15"),          # 费用
    ("6051", 0, 300, "2026-05-16"),         # 父科目
    ("605101", 0, 100, "2026-05-17"),       # 子科目有余额 ⇒ 叶子有效只算子
    ("5001", 9999, 0, "2026-05-18"),        # 生产成本：不得进损益
    # 2026-06：只有一笔费用，用来验按月隔离
    ("6601", 30, 0, "2026-06-10"),
]
for code, d, c, dt in je:
    con.execute("INSERT INTO journal_entries(account_code,debit,credit,date,ref_type) "
                "VALUES(?,?,?,?,'probe')", (code, d, c, dt))
# 按月过滤用的业务表
for st, amt, dt in (("signed", 1000.0, "2026-05-20"), ("signed", 500.0, "2026-06-20"),
                    ("draft", 7777.0, "2026-05-21")):
    con.execute("INSERT INTO sale_orders(status,total_amount,order_date) VALUES(?,?,?)", (st, amt, dt))
con.execute("INSERT INTO purchase_orders(status,total_amount,order_date) VALUES('received',300,'2026-05-22')")
con.execute("INSERT INTO purchase_orders(status,total_amount,order_date) VALUES('confirmed',888,'2026-05-23')")
con.execute("INSERT INTO cash_flow(type,amount,created_at) VALUES('income',70,'2026-05-24')")
con.execute("INSERT INTO cash_flow(type,amount,created_at) VALUES('expense',20,'2026-05-25')")
con.commit()
con.close()

from db.queries.finance import get_pnl_gl, get_pnl

R = []
def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)

def near(a, b, tol=0.005):
    return abs(float(a) - float(b)) < tol

g = get_pnl_gl("2026-05")
# --- 收入：1000 贷 - 200 借 + 100（子，父不重复）
ok("A1 收入净额 = 900（含红冲、叶子有效）", near(g["revenue"], 900), "实际 %.2f" % g["revenue"])
ok("A2 收入只取 credit 会得 1300 ⇒ 判据有区分力", not near(g["revenue"], 1300), "")
# --- 成本：600 借 - 100 贷
ok("A3 销货成本 = 500（含红冲）", near(g["cogs"], 500), "实际 %.2f" % g["cogs"])
# --- 费用：150 + 50（5001 生产成本 9999 必须排除）
ok("A4 费用 = 200（5 开头生产成本未混入）", near(g["total_expense"], 200), "实际 %.2f" % g["total_expense"])
# 🔴 第一版写成 `not near(cogs, 10499)` ⇒ 旧代码 cogs=9999 时**假通过**。
# 判据要卡上界，才能抓住「5 开头整笔混入成本」这个形态。
ok("A5 生产成本 9999 未进 cogs（旧代码会得 9999）", g["cogs"] < 9000, "实际 %.2f" % g["cogs"])
# --- 净利
ok("A6 毛利 = 400", near(g["gross_profit"], 400), "实际 %.2f" % g["gross_profit"])
ok("A7 净利 = 200", near(g["net_profit"], 200), "实际 %.2f" % g["net_profit"])
ok("A8 raw_net = 500（全集原始净额，不分父子）", near(g.get("raw_net", -1e9), 500),
   "实际 %.2f" % g.get("raw_net", float("nan")))
ok("A8b raw_net − net_profit = 300，正好是父科目 6051 ⇒ 叶子有效真在起作用",
   near(g.get("raw_net", 0) - g["net_profit"], 300),
   "raw %.2f - net %.2f = %.2f" % (g.get("raw_net", 0), g["net_profit"],
                                   g.get("raw_net", 0) - g["net_profit"]))
ok("A9 has_data = True", g.get("has_data") is True, str(g.get("has_data")))
ok("A10 无 5 开头冤案（unclassified 只看非 6 开头的补漏科目）",
   g.get("unclassified") == [], str(g.get("unclassified")))

# --- 按月隔离
g6 = get_pnl_gl("2026-06")
ok("A11 2026-06 只有费用 30", near(g6["total_expense"], 30) and near(g6["revenue"], 0),
   "rev %.2f exp %.2f" % (g6["revenue"], g6["total_expense"]))
ok("A12 2026-06 净利 = -30", near(g6["net_profit"], -30), "实际 %.2f" % g6["net_profit"])
g7 = get_pnl_gl("2026-07")
ok("A13 空月 has_data = False 且全 0",
   g7.get("has_data") is False and near(g7["revenue"], 0) and near(g7["net_profit"], 0), str(g7))

# --- get_pnl 按月过滤（改前不认月份）
a5 = get_pnl("2026-05")
ok("A14 get_pnl(2026-05) 销售 = 1000（draft 7777 不算）", near(a5["sales"], 1000), "实际 %.2f" % a5["sales"])
ok("A15 get_pnl(2026-05) 采购 = 300（confirmed 888 不算）", near(a5["purchases"], 300), "实际 %.2f" % a5["purchases"])
ok("A16 get_pnl(2026-05) 其他收入 70 / 支出 20",
   near(a5["other_income"], 70) and near(a5["other_expense"], 20),
   "inc %.2f exp %.2f" % (a5["other_income"], a5["other_expense"]))
a6 = get_pnl("2026-06")
ok("A17 get_pnl(2026-06) 销售 = 500（按月真的隔离）", near(a6["sales"], 500), "实际 %.2f" % a6["sales"])
ok("A18 两个月销售不同 ⇒ 证明不是全期累计", not near(a5["sales"], a6["sales"]))
a_all = get_pnl()
ok("A19 get_pnl() 全期 = 1500（两月之和）", near(a_all["sales"], 1500), "实际 %.2f" % a_all["sales"])
ok("A20 全期采购 = 300", near(a_all["purchases"], 300), "实际 %.2f" % a_all["purchases"])

bad = sum(1 for x, _, _ in R if not x)
print("RESULT %d/%d" % (len(R) - bad, len(R)))
sys.exit(1 if bad else 0)
'''

GROUP_B = r'''
import os, sys
sys.path.insert(0, "__ERP__")
from db.queries.finance import get_pnl_gl, get_pnl, get_balance_sheet_gl
from db.precision import money_eq

BASE = __BASE__

R = []
def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)

def near(a, b, tol=0.005):
    return abs(float(a) - float(b)) < tol

# --- 1. GL 分支终于走得到了（改前所有月份恒为 0）
g6 = get_pnl_gl("2026-06")
ok("B1 2026-06 收入 = 98325（改前恒 0）", near(g6["revenue"], 98325.00), "实际 %.2f" % g6["revenue"])
ok("B2 2026-06 has_data = True（改前无法判断，现在可判）", g6.get("has_data") is True, str(g6.get("has_data")))
ok("B3 2026-06 cogs/expense 均 0（该月无成本费用凭证）",
   near(g6["cogs"], 0) and near(g6["total_expense"], 0),
   "cogs %.2f exp %.2f" % (g6["cogs"], g6["total_expense"]))
ok("B4 2026-06 净利 = 98325", near(g6["net_profit"], 98325.00), "实际 %.2f" % g6["net_profit"])
ok("B5 生产无父子双记 ⇒ raw_net == net_profit == 98325",
   near(g6.get("raw_net", -1e9), 98325) and near(g6["net_profit"], g6.get("raw_net", -1e9)),
   "raw %.2f / net %.2f" % (g6.get("raw_net", float("nan")), g6["net_profit"]))
g10 = get_pnl_gl("2026-10")
ok("B6 2026-10 has_data = False（10 月无损益凭证）", g10.get("has_data") is False, str(g10.get("has_data")))

# --- 2. 跨表勾稽：逐月净利加总 == 资产负债表 unclosed_profit
# 符号约定用实测定的，不是猜的：`unclosed_profit = -sum(debit-credit)`，
# 而收入类 debit-credit 为负 ⇒ 两者**同号**（生产实测均为 +98,325）。
months = ["2026-%02d" % m for m in range(1, 13)]
tot = sum(get_pnl_gl(m)["net_profit"] for m in months)
bs = get_balance_sheet_gl("2026-12-31")
ok("B7 逐月净利加总 == unclosed_profit（跨表勾稽）",
   money_eq(tot, bs["unclosed_profit"]),
   "逐月 %.2f vs BS %.2f" % (tot, bs["unclosed_profit"]))
ok("B8 资产负债表仍平衡（未被本次改动影响）", bs["balanced"] is True,
   "资产 %.2f = 负债 %.2f + 权益 %.2f" % (bs["assets"]["total"],
                                          bs["liabilities"]["total"], bs["equity"]["total"]))

# --- 3. 非回归：全期 get_pnl() 与改前基线逐分一致
a = get_pnl()
for k, v in BASE.items():
    ok("B9 全期 %s 与基线逐分一致" % k, money_eq(a[k], v), "改后 %.2f vs 基线 %.2f" % (a[k], v))

# --- 4. 按月过滤真的生效（改前三次同一组数）
ok("B10 get_pnl(2026-10).sales = 0（10 月无签收销售）", near(get_pnl("2026-10")["sales"], 0),
   "实际 %.2f" % get_pnl("2026-10")["sales"])
ok("B11 get_pnl(2026-06).sales = 1084822.69", near(get_pnl("2026-06")["sales"], 1084822.69),
   "实际 %.2f" % get_pnl("2026-06")["sales"])
ok("B12 按月 ≠ 全期（改前两者相同）", not near(get_pnl("2026-10")["sales"], a["sales"]),
   "10月 %.2f vs 全期 %.2f" % (get_pnl("2026-10")["sales"], a["sales"]))
ok("B13 get_pnl(2026-10).purchases = 920.004", near(get_pnl("2026-10")["purchases"], 920.004),
   "实际 %.3f" % get_pnl("2026-10")["purchases"])
# --- 5. 各月销售加总 == 全期（结构性判据，不依赖具体数）
ssum = sum(get_pnl(m)["sales"] for m in months)
ok("B14 各月销售加总 == 全期销售", money_eq(ssum, a["sales"]),
   "逐月 %.2f vs 全期 %.2f" % (ssum, a["sales"]))
psum = sum(get_pnl(m)["purchases"] for m in months)
ok("B15 各月采购加总 == 全期采购", money_eq(psum, a["purchases"]),
   "逐月 %.2f vs 全期 %.2f" % (psum, a["purchases"]))
isum = sum(get_pnl(m)["other_income"] for m in months)
ok("B16 各月其他收入加总 == 全期", money_eq(isum, a["other_income"]),
   "逐月 %.2f vs 全期 %.2f" % (isum, a["other_income"]))

bad = sum(1 for x, _, _ in R if not x)
print("RESULT %d/%d" % (len(R) - bad, len(R)))
sys.exit(1 if bad else 0)
'''


def run(group):
    if group == "a":
        tmp = tempfile.mkdtemp(prefix="v714a-")
        dbp = os.path.join(tmp, "erp.db")
        src = GROUP_A.replace("__ERP__", ERP)
        env = dict(os.environ, ERP_DB_PATH=dbp, ERP_DIR=ERP)
        print("=== A 组（隔离空库：%s）" % dbp)
    else:
        if not os.path.exists(PROD_TENANT):
            print("🔴 找不到生产租户库 %s" % PROD_TENANT)
            return 2
        tmp = tempfile.mkdtemp(prefix="v714b-")
        dbp = os.path.join(tmp, "tenant_1.db")
        shutil.copy2(PROD_TENANT, dbp)
        src = GROUP_B.replace("__ERP__", ERP).replace("__BASE__", repr(BASE_ALL))
        env = dict(os.environ, ERP_DB_PATH=dbp, ERP_DIR=ERP)
        print("=== B 组（生产租户库副本：%s）" % dbp)
    r = subprocess.run([sys.executable, "-c", src], env=env,
                       capture_output=True, text=True)
    out = [l for l in r.stdout.splitlines()
           if not l.startswith("[schema-sync]") and not l.startswith("[DB]")]
    print("\n".join(out))
    if r.returncode != 0 and "RESULT" not in r.stdout:
        print("---- stderr ----")
        print(r.stderr[-3000:])
    shutil.rmtree(tmp, ignore_errors=True)
    return r.returncode


def main():
    g = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--group" else "both"
    rc = 0
    if g in ("a", "both"):
        rc |= run("a")
    if g in ("b", "both"):
        rc |= run("b")
    return rc


if __name__ == "__main__":
    sys.exit(main())
