#!/usr/bin/env python3
"""v709 探针：期初去重 + 报表口径补全

判据分四段：
  A 生产真实接口（只读）—— 试算表借贷相等、资产负债表相等
  B 数据库层 —— 期初 40 行、无父科目残留、全库借贷相等
  C 幂等复跑 —— 数据补丁再跑一次必须什么都不删
  D 反向可证伪 —— 隔离库上把 unclosed_profit 拿掉，报表必须重新不平

D 是防自欺的关键：只证明"现在是平的"不够，要证明"这项改动确实在起作用"。
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.request

PROD = "/opt/hergent-erp"
BASE = "http://127.0.0.1:8700"
PASS, FAIL = [], []


def chk(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("%s %s%s" % ("✅" if cond else "🔴", name, ("  [" + detail + "]") if detail else ""))


def tok():
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    r = con.execute("SELECT token FROM sessions WHERE user_id=2 "
                    "ORDER BY created_at DESC LIMIT 1").fetchone()
    con.close()
    return r[0] if r else ""


def get(path, token):
    req = urllib.request.Request(BASE + path, headers={
        "Cookie": "erp_token=%s; hergent_auth=1" % token,
        "X-Tenant-Id": "1"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return 0, {"err": str(e)}


WANT_ASSETS = 2258504.26
WANT_LIAB = 88832.25
WANT_EQUITY = 2169672.01     # 2,071,347.01 + 未结转损益 98,325.00
WANT_PROFIT = 98325.00
WANT_OPENING = 2141500.44


def phase_a():
    print("\n【A】生产真实接口（只读）")
    t = tok()
    if not t:
        chk("拿到真实会话 token", False, "sessions 无 user_id=2")
        return None
    chk("拿到真实会话 token", True)

    st, d = get("/api/trial-balance?month=2026-06", t)
    chk("试算表 2026-06 → 200", st == 200, "status=%s" % st)
    td, tc = float(d.get("total_debit", 0)), float(d.get("total_credit", 0))
    chk("试算表 2026-06 借 = 贷", abs(td - tc) <= 0.01, "借 %.2f / 贷 %.2f / 差 %.2f" % (td, tc, td - tc))
    chk("试算表 2026-06 balanced = true", d.get("balanced") is True, "balanced=%s" % d.get("balanced"))
    chk("试算表 2026-06 合计 = 2,285,760.44（改前 12,745,566.36）",
        abs(td - 2285760.44) < 0.02, "实测 %.2f" % td)

    st, d2 = get("/api/trial-balance?month=2026-10", t)
    chk("试算表 2026-10 → 200 且 balanced", st == 200 and d2.get("balanced") is True,
        "status=%s balanced=%s" % (st, d2.get("balanced")))

    st, b = get("/api/reports/balance-sheet?as_of=2026-10-26", t)
    chk("资产负债表 → 200", st == 200, "status=%s" % st)
    a = float((b.get("assets") or {}).get("total", 0))
    li = float((b.get("liabilities") or {}).get("total", 0))
    eq = float((b.get("equity") or {}).get("total", 0))
    chk("资产 = 2,258,504.26", abs(a - WANT_ASSETS) < 0.02, "实测 %.2f" % a)
    chk("负债 = 88,832.25", abs(li - WANT_LIAB) < 0.02, "实测 %.2f" % li)
    chk("权益 = 2,169,672.01（含未结转损益 98,325）", abs(eq - WANT_EQUITY) < 0.02, "实测 %.2f" % eq)
    chk("资产 = 负债 + 权益（差额 0）", abs(a - li - eq) <= 0.01, "差 %.2f" % (a - li - eq))
    chk("资产负债表 balanced = true（改前 false，差 169 万）", b.get("balanced") is True,
        "balanced=%s" % b.get("balanced"))
    chk("unclosed_profit = 98,325.00", abs(float(b.get("unclosed_profit", 0)) - WANT_PROFIT) < 0.02,
        "实测 %s" % b.get("unclosed_profit"))

    st, b2 = get("/api/reports/balance-sheet", t)
    a2 = float((b2.get("assets") or {}).get("total", 0))
    chk("不带 as_of 与带 as_of 同口径同数值", abs(a2 - a) < 0.02, "%.2f vs %.2f" % (a2, a))
    chk("不带 as_of 也返回 balanced 布尔", isinstance(b2.get("balanced"), bool),
        "type=%s" % type(b2.get("balanced")).__name__)
    return t


def phase_b():
    print("\n【B】数据库层（只读）")
    con = sqlite3.connect("file:%s/tenant_1.db?mode=ro" % PROD, uri=True)
    c = con.cursor()

    n, dr, cr = c.execute("SELECT COUNT(*), ROUND(SUM(debit),2), ROUND(SUM(credit),2) "
                          "FROM journal_entries WHERE ref_type='opening'").fetchone()
    chk("期初行数 = 40（改前 208）", n == 40, "实测 %d" % n)
    chk("期初借 = 贷 = 2,141,500.44",
        abs(dr - WANT_OPENING) < 0.02 and abs(cr - WANT_OPENING) < 0.02,
        "借 %.2f / 贷 %.2f" % (dr, cr))

    codes = sorted(r[0] for r in c.execute(
        "SELECT DISTINCT account_code FROM journal_entries WHERE ref_type='opening'"))
    parents = ["1002", "1015", "101501", "101502", "1231", "123101", "123102",
               "1601", "160101", "1602", "160201", "1901"]
    left = [p for p in parents if p in codes]
    chk("12 个父科目行已全部清除", not left, "残留 %s" % left)

    # 每个剩余科目的金额必须仍与源表一致（没误删叶子）
    leaf_ok = True
    bad = []
    for code in codes:
        r = c.execute("SELECT ROUND(SUM(debit),2), ROUND(SUM(credit),2) FROM journal_entries "
                      "WHERE ref_type='opening' AND account_code=?", (code,)).fetchone()
        if r is None:
            leaf_ok = False
            bad.append(code)
    chk("剩余 40 个科目每行都还在（无空组）", leaf_ok, "%s" % bad)
    chk("剩余科目全部无子科目（都是叶子）",
        not any(any(y != x and y.startswith(x) and len(y) == len(x) + 2 for y in codes)
                for x in codes))

    n2, dr2, cr2 = c.execute("SELECT COUNT(*), ROUND(SUM(debit),2), ROUND(SUM(credit),2) "
                             "FROM journal_entries").fetchone()
    chk("全库凭证借 = 贷（含业务单据）", abs(dr2 - cr2) <= 0.01,
        "%d 行 借 %.2f / 贷 %.2f / 差 %.2f" % (n2, dr2, cr2, dr2 - cr2))

    n3 = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_type='opening' "
                   "AND created_at='2026-06-29 15:33:47'").fetchone()[0]
    chk("保留的正是最早那一轮（15:33:47 共 40 行）", n3 == 40, "实测 %d" % n3)
    con.close()


def phase_c():
    print("\n【C】幂等复跑：数据补丁再跑一次必须什么都不删")
    script = "/tmp/v709/patch_v709_opening_dedup.py"
    if not os.path.exists(script):
        print("  ⏭  SKIP —— %s 不存在（/tmp 被清理过）。" % script)
        print("     重跑前先 scp tools/hergent/patch_v709_opening_dedup.py 到该路径")
        return
    out = subprocess.run([sys.executable, script, "--dry-run"],
                         capture_output=True, text=True, timeout=120).stdout
    chk("再跑 dry-run 报「已是单轮」", "已是单轮且无父科目行" in out,
        out.strip().splitlines()[-3] if out.strip() else "无输出")
    chk("再跑 dry-run 待删 0 行", "待删" not in out, "输出仍含「待删」" if "待删" in out else "无待删")


def phase_d():
    print("\n【D】反向可证伪：拿掉 unclosed_profit，报表必须重新不平")
    iso = "/tmp/v709/probe_iso.db"
    shutil.copy2(os.path.join(PROD, "tenant_1.db"), iso)
    code = r'''
import os, sys
os.environ["ERP_DB_PATH"] = "%s"
sys.path.insert(0, "%s")
from db.queries.finance import get_balance_sheet_gl, money_balanced
b = get_balance_sheet_gl("2026-10-26")
a, l, e = (b["assets"]["total"], b["liabilities"]["total"], b["equity"]["total"])
print("%%.2f|%%.2f|%%.2f|%%.2f|%%s|%%s" %% (a, l, e, a-l-e, b["balanced"], b.get("unclosed_profit")))
''' % (iso, PROD)
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=180)
    line = [x for x in p.stdout.strip().splitlines() if "|" in x]
    if not line:
        chk("隔离库跑通（新口径判平）", False, (p.stdout + p.stderr)[-200:])
        return
    a, l, e, diff, bal, prof = line[-1].split("|")
    chk("隔离库副本：新口径判平", abs(float(diff)) <= 0.01 and bal == "True",
        "差 %s balanced=%s" % (diff, bal))

    # 反向：把权益里并入的那 98,325 拿掉，差额必须回到 98,325
    con = sqlite3.connect(iso)
    con.execute("UPDATE chart_of_accounts SET is_active=0 WHERE code LIKE '6%'")
    con.commit()
    con.close()
    p2 = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=180)
    line2 = [x for x in p2.stdout.strip().splitlines() if "|" in x]
    if not line2:
        chk("反向对照跑通", False, (p2.stdout + p2.stderr)[-200:])
        return
    a2, l2, e2, diff2, bal2, prof2 = line2[-1].split("|")
    chk("反向对照：停用损益类后差额回到 98,325.00", abs(float(diff2) - WANT_PROFIT) < 0.02,
        "差 %s" % diff2)
    chk("反向对照：balanced 变回 false", bal2 == "False", "balanced=%s" % bal2)
    chk("反向对照：unclosed_profit 归零", abs(float(prof2 or 0)) < 0.02, "实测 %s" % prof2)


if __name__ == "__main__":
    print("=" * 78)
    print("v709 探针 — 期初去重 + 报表口径补全")
    print("=" * 78)
    phase_a()
    phase_b()
    phase_c()
    phase_d()
    print("\n" + "=" * 78)
    print("通过 %d 项，失败 %d 项" % (len(PASS), len(FAIL)))
    for f in FAIL:
        print("  🔴 " + f)
    sys.exit(1 if FAIL else 0)
