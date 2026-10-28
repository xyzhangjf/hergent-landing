#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717d 修「有凭证但无损益凭证」的月份被误回落成现金制

现象（v717 全月扫描实测）
------------------------
2026-10 只有 1 张采购单（PO202610259f1ddd，920.00，status=received），
它**有**凭证（借 1405 库存商品 / 贷 2202 应付账款），但都是资产负债类科目。
`get_pnl_gl` 的 `has_data = bool(bal)` 只统计 6 开头科目 ⇒ 判成「该月无损益凭证」
⇒ 路由回落到 `get_pnl(month)` 现金制，把**进货当成了费用**：

    2026-10  收入 0  成本 0  毛利 0  费用 920  净利 −920   basis=cash

进货是资产不是费用。老板打开利润表第一眼（默认当前月）就看到「净利 −920」，
是**明显的错数**，比「显示 0」严重得多。

修法
----
回落条件从「该月有没有**损益**凭证」放宽为「该月有没有**任何**凭证」：
  · 有凭证（哪怕只有资产负债类）⇒ 该月的账已经记了，权责口径就是权威，
    损益为 0 就如实报 0，不回落到业务单据估算；
  · 一点凭证都没有（历史月份压根没补过账）⇒ 才回落到现金制并标 basis=cash。

实现
----
`get_pnl_gl` 多返回一个 `month_vouchers`（该月全部凭证行数，不只损益科目），
`routers/reports.py::pnl` 的判据改成 `has_data or month_vouchers`。

连带效果：逐月「权责」净利加总重新等于 BS `unclosed_profit`（v714 的跨表勾稽），
改前因为混入了 2026-10 的 −920 现金制数字，差正好 920.00。

用法：--dry-run / --apply / --verify / --revert
"""
import argparse
import json
import os
import shutil
import time

P = "/opt/hergent-erp"
F_Q = os.path.join(P, "db/queries/finance.py")
F_R = os.path.join(P, "routers/reports.py")
BAK_DIR = "/opt/hergent-data/backup"
TS = time.strftime("%Y%m%d-%H%M%S")


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def sub_once(src, name, old, new, log, optional=False):
    if new in src:
        assert src.count(new) == 1, "%s: new 在位 %d 次" % (name, src.count(new))
        log.append({"edit": name, "action": "already_applied"})
        return src
    n = src.count(old)
    if n != 1:
        if optional and n == 0:
            log.append({"edit": name, "action": "skipped_optional"})
            return src
        raise AssertionError("%s: 锚点 %d 次（应 1）" % (name, n))
    out = src.replace(old, new)
    assert out.count(new) == 1, "%s: 替换后 new %d 次" % (name, out.count(new))
    log.append({"edit": name, "action": "replaced"})
    return out


OLD_BAL = '''        bal = {}
        for code, dsum, csum in db.execute(
                "SELECT account_code, COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
                "FROM journal_entries WHERE substr(date,1,7)=? AND account_code IN (" + ph + ") "
                "GROUP BY account_code", [month] + cl):
            bal[code] = (dsum or 0.0, csum or 0.0)'''

NEW_BAL = '''        bal = {}
        for code, dsum, csum in db.execute(
                "SELECT account_code, COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) "
                "FROM journal_entries WHERE substr(date,1,7)=? AND account_code IN (" + ph + ") "
                "GROUP BY account_code", [month] + cl):
            bal[code] = (dsum or 0.0, csum or 0.0)
        # v717d：该月**全部**凭证行数（不只损益科目）。用来回答「这个月到底记过账没有」——
        # `has_data` 只表示「有没有损益科目的发生额」，拿它当回落判据会把
        # 「只记了进货、没记损益」的月份误判成「没记账」⇒ 回落现金制 ⇒
        # 进货被当成费用（2026-10 实测净利 −920）。
        month_vouchers = db.execute(
            "SELECT COUNT(*) FROM journal_entries WHERE substr(date,1,7)=?",
            (month,)).fetchone()[0]'''

OLD_RET = '''        "raw_net": round(tick, 2),
        "has_data": bool(bal),
        "unclassified": unclassified,'''

NEW_RET = '''        "raw_net": round(tick, 2),
        "has_data": bool(bal),
        # v717d：该月全部凭证行数（含资产负债类）。0 = 这个月完全没记过账，
        # 才允许回落到现金制业务单据估算。
        "month_vouchers": month_vouchers,
        "unclassified": unclassified,'''

OLD_EARLY = '''                    "other_expense": 0, "other_revenue": 0,
                    "has_data": False, "unclassified": []}'''

NEW_EARLY = '''                    "other_expense": 0, "other_revenue": 0,
                    "has_data": False, "month_vouchers": 0, "unclassified": []}'''

OLD_ROUTE = '''        if gl.get("has_data"):
            return gl'''

NEW_ROUTE = '''        # v717d：回落判据从「该月有没有损益凭证」改成「该月有没有**任何**凭证」。
        # 只记了进货/付款（资产负债类）的月份，账其实已经记了，权责口径就是权威，
        # 损益为 0 就如实报 0；否则会把进货当费用（2026-10 实测净利 −920）。
        if gl.get("has_data") or gl.get("month_vouchers"):
            return gl'''


def do_apply(dry=True):
    rep = {"ts": TS, "dry_run": dry, "q": [], "r": [], "backups": []}
    q = _read(F_Q)
    q = sub_once(q, "get_pnl_gl 统计该月全部凭证数", OLD_BAL, NEW_BAL, rep["q"])
    q = sub_once(q, "get_pnl_gl 返回 month_vouchers", OLD_RET, NEW_RET, rep["q"])
    q = sub_once(q, "get_pnl_gl 空返回补 month_vouchers", OLD_EARLY, NEW_EARLY, rep["q"])
    r = _read(F_R)
    r = sub_once(r, "pnl 路由回落判据放宽", OLD_ROUTE, NEW_ROUTE, rep["r"])
    import ast
    ast.parse(q)
    ast.parse(r)
    if dry:
        return rep
    os.makedirs(BAK_DIR, exist_ok=True)
    for p in (F_Q, F_R):
        bak = "%s.bak-v717d-%s" % (p, TS)
        shutil.copy2(p, bak)
        rep["backups"].append(bak)
    _write(F_Q, q)
    _write(F_R, r)
    man = os.path.join(BAK_DIR, "v717d-manifest-%s.json" % TS)
    _write(man, json.dumps(rep, ensure_ascii=False, indent=1))
    rep["manifest"] = man
    return rep


def do_revert():
    import glob
    mans = sorted(glob.glob(os.path.join(BAK_DIR, "v717d-manifest-*.json")))
    if not mans:
        return {"error": "找不到 v717d manifest"}
    rep = json.loads(_read(mans[-1]))
    done = []
    for bak in rep.get("backups", []):
        orig = bak.split(".bak-v717d-")[0]
        if os.path.exists(bak):
            shutil.copy2(bak, orig)
            done.append(orig)
    return {"manifest": mans[-1], "restored": done}


def do_verify():
    q = _read(F_Q)
    r = _read(F_R)
    checks = [
        ("F_Q 统计 month_vouchers", "month_vouchers = db.execute(" in q),
        ("F_Q 返回 month_vouchers", '"month_vouchers": month_vouchers,' in q),
        ("F_Q 空返回含 month_vouchers", '"month_vouchers": 0' in q),
        ("F_R 回落判据含 month_vouchers",
         'if gl.get("has_data") or gl.get("month_vouchers"):' in r),
    ]
    out = {"checks": [{"name": n, "pass": bool(c)} for n, c in checks]}
    out["all_pass"] = all(c["pass"] for c in out["checks"])
    return out


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--revert", action="store_true")
    g.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.revert:
        print(json.dumps(do_revert(), ensure_ascii=False, indent=1)); return
    if a.verify:
        v = do_verify()
        print(json.dumps(v, ensure_ascii=False, indent=1))
        raise SystemExit(0 if v["all_pass"] else 1)
    print(json.dumps(do_apply(dry=not a.apply), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
