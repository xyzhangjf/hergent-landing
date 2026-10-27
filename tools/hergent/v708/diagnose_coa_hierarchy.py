#!/usr/bin/env python3
"""v708 立项诊断：科目层级重复计入 + 期初单边差 —— **只读，不动任何数据**。

## 要回答的三个问题

1. **资产到底是多少？** 现在报表说 12,383,452.20，但它是把父科目和子科目
   重复累加得到的。只算末级科目是多少？差多少？
2. **哪些科目被重复计入了？** 逐对列出来（父 code、子 code 合计、金额）。
3. **期初凭证的 379 万差额，缺在贷方还是虚在借方？** 按末级重算后还差多少？

## 为什么不能用 `parent_code` / `level` 判断父子

生产实测（`tenant_1.db`）：`parent_code` **全是空串**（124 个资产科目无一例外），
`level` **不可信**（`101201 微信商户货款` 标 level=1，但它的父 `1012` 也是 level=1）。
⇒ 只能用**编码前缀**：某 code 是父 ⇔ 存在另一个更长的 code 以它开头。

代价：依赖科目编码规范（生产是标准 4/6/8 位，`1001` / `100201` / `10150101`）。
脚本会把「疑似不规范编码」（长度为单数、或前缀匹配但长度差 >2）单独列出来，
避免拿一个假前提算出一堆漂亮数字。

## 用法

    python3 diagnose_coa_hierarchy.py                     # 三个库
    python3 diagnose_coa_hierarchy.py --db /path/x.db
    python3 diagnose_coa_hierarchy.py --json
"""
import argparse
import json
import os
import sqlite3
import sys

DEFAULT_DBS = ["/opt/hergent-erp/erp.db",
               "/opt/hergent-erp/tenant_1.db",
               "/opt/hergent-erp/tenant_10.db"]


def _ro(p):
    if not os.path.exists(p):
        raise SystemExit("库不存在：%s" % p)
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)


def classify_codes(con):
    """按编码前缀把 code 分成「父」/「末级」，附不规范告警。"""
    rows = con.execute("SELECT code, name, category FROM chart_of_accounts "
                       "WHERE is_active=1 ORDER BY code").fetchall()
    codes = [r[0] for r in rows]
    codeset = set(codes)
    parents, leaves, odd = [], [], []
    for c, name, cat in rows:
        children = [x for x in codes if x != c and x.startswith(c)]
        if children:
            parents.append({"code": c, "name": name, "category": cat, "children": len(children)})
            # 长度差 >2 或单数长度 ⇒ 编码不规范，前缀判断可能误伤
            for ch in children:
                if (len(ch) - len(c)) > 2 or len(ch) % 2:
                    odd.append({"parent": c, "child": ch, "delta": len(ch) - len(c)})
        else:
            leaves.append(c)
    return rows, parents, leaves, odd, codeset


def cat_sum(con, codes, as_of=None, month=None):
    """SUM(debit)-SUM(credit)。一次 SQL，与源码 get_balance_sheet_gl 同形。"""
    if not codes:
        return 0.0
    ph = ",".join("?" * len(codes))
    if month:
        sql = ("SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_entries "
               "WHERE account_code IN (%s) AND substr(date,1,7)=?" % ph)
        args = list(codes) + [month]
    else:
        sql = ("SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM journal_entries "
               "WHERE account_code IN (%s) AND date<=?" % ph)
        args = list(codes) + [as_of]
    r = con.execute(sql, args).fetchone()
    return r[0] if r else 0.0


def effective_balance(con, code, codes, as_of, _depth=0):
    """**叶子有效口径**：只保留"真正记账的那一层"，父级余额视为派生。

    规则（递归）：某科目若有非零余额的子科目 ⇒ 丢弃它自己的余额、只累加子科目；
    若子科目全为零（或没有子科目）⇒ 它的余额就是真实记账余额。

    为什么不能简单地"只算末级"：本账套 1122 应收账款 **527 万记在父科目上、
    子科目 112201~112203 全是 0**。只算末级会把这 527 万直接砍掉 ⇒ 资产假的变小。
    反之 1002 银行存款是"父余额 = 子科目合计"的真重复，必须丢父。
    两种形态混在同一个账套里，只能靠递归逐层判，不能一刀切。
    """
    if _depth > 8:                     # 防编码前缀意外成环
        return cat_sum(con, [code], as_of=as_of)
    children = [c for c in codes if c != code and c.startswith(code)]
    if not children:
        return cat_sum(con, [code], as_of=as_of)
    nonzero = [c for c in children if abs(cat_sum(con, [c], as_of=as_of)) > 0.005]
    if not nonzero:
        # 子科目全零 ⇒ 钱记在父科目上（1122 那种），父余额才是真账
        return cat_sum(con, [code], as_of=as_of)
    return sum(effective_balance(con, c, codes, as_of, _depth + 1) for c in nonzero)


def dup_detail(con, parents, as_of):
    """逐对列出「父科目金额 = 其子科目合计」，证明重复计入真实存在。"""
    out = []
    for p in parents:
        if p["category"] not in ("资产", "负债", "权益"):
            continue
        child_codes = [r[0] for r in con.execute(
            "SELECT code FROM chart_of_accounts WHERE is_active=1 AND code LIKE ? AND code != ?",
            (p["code"] + "%", p["code"])) ]
        pv = cat_sum(con, [p["code"]], as_of=as_of)
        cv = cat_sum(con, child_codes, as_of=as_of)
        if abs(pv) < 0.005 and abs(cv) < 0.005:
            continue
        out.append({
            "parent": p["code"], "parent_name": p["name"], "category": p["category"],
            "parent_value": round(pv, 2), "children": len(child_codes),
            "children_value": round(cv, 2),
            "duplicated": round(abs(pv) if abs(pv - cv) < 0.005 else 0, 2),
        })
    out.sort(key=lambda x: -x["duplicated"])
    return out


def diagnose(path):
    con = _ro(path)
    try:
        has = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
                          "AND name IN ('journal_entries','chart_of_accounts')").fetchone()[0]
        if has < 2:
            return {"db": path, "skip": "缺 journal_entries / chart_of_accounts"}
        rows, parents, leaves, odd, _ = classify_codes(con)
        codes_all = [c for c, _n, _cat in rows]
        cats = {}
        for c, _n, cat in rows:
            cats.setdefault(cat, []).append(c)

        latest = con.execute("SELECT MAX(date) FROM journal_entries").fetchone()[0] or "2026-12-31"

        # 全科目 vs 仅末级
        summary = {}
        for cat in ("资产", "负债", "权益"):
            all_codes = cats.get(cat, [])
            leaf_codes = [c for c in all_codes if c in leaves]
            summary[cat] = {
                "all_codes": len(all_codes), "leaf_codes": len(leaf_codes),
                "all_sum": round(cat_sum(con, all_codes, as_of=latest), 2),
                "leaf_sum": round(cat_sum(con, leaf_codes, as_of=latest), 2),
            }

        a_all = summary["资产"]["all_sum"]
        l_all = -summary["负债"]["all_sum"]
        e_all = -summary["权益"]["all_sum"]
        a_leaf = summary["资产"]["leaf_sum"]
        l_leaf = -summary["负债"]["leaf_sum"]
        e_leaf = -summary["权益"]["leaf_sum"]

        # 叶子有效口径：只取顶层科目（无父的），递归到真正记账那一层
        top = {cat: [] for cat in ("资产", "负债", "权益")}
        for c, _n, cat in rows:
            if cat not in top:
                continue
            if not any(c != x and c.startswith(x) for x, _n2, _c2 in rows):
                top[cat].append(c)
        eff = {}
        for cat in ("资产", "负债", "权益"):
            eff[cat] = round(sum(effective_balance(con, c, codes_all, latest)
                                 for c in top[cat]), 2)

        return {
            "db": path,
            "as_of": latest,
            "entries": con.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0],
            "parents": len(parents), "leaves": len(leaves), "odd_codes": odd[:10],
            "summary": summary,
            "as_is": {"assets": round(a_all, 2), "liabilities": round(l_all, 2),
                      "equity": round(e_all, 2),
                      "diff": round(a_all - (l_all + e_all), 2)},
            "leaf_only": {"assets": round(a_leaf, 2), "liabilities": round(l_leaf, 2),
                          "equity": round(e_leaf, 2),
                          "diff": round(a_leaf - (l_leaf + e_leaf), 2)},
            "effective": {"assets": eff["资产"], "liabilities": -eff["负债"],
                          "equity": -eff["权益"],
                          "diff": round(eff["资产"] - (-eff["负债"] + -eff["权益"]), 2),
                          "top_accounts": {c: len(v) for c, v in top.items()}},
            "dups": dup_detail(con, parents, latest),
            "opening": _opening_check(con, rows),
        }
    finally:
        con.close()


def _opening_check(con, rows):
    """期初凭证：按末级科目重算，看单边差有没有变化。"""
    r = con.execute(
        "SELECT COUNT(*), ROUND(SUM(debit),2), ROUND(SUM(credit),2) "
        "FROM journal_entries WHERE ref_type='opening'").fetchone()
    if not r or not r[0]:
        return None
    # 找出所有父科目 code，排除它们后的合计
    codes = [x[0] for x in rows]
    parents = set(c for c in codes if any(y != c and y.startswith(c) for y in codes))
    parent_ph = ",".join("?" * len(parents)) if parents else "''"
    leaf = con.execute(
        "SELECT COUNT(*), ROUND(SUM(debit),2), ROUND(SUM(credit),2) "
        "FROM journal_entries WHERE ref_type='opening' AND account_code NOT IN (%s)" % parent_ph,
        list(parents)).fetchone()
    return {
        "rows": r[0], "debit": r[1], "credit": r[2], "diff": round(r[1] - r[2], 2),
        "excl_parent_rows": leaf[0], "excl_parent_debit": leaf[1],
        "excl_parent_credit": leaf[2], "excl_parent_diff": round(leaf[1] - leaf[2], 2),
        "parent_codes_touched": len(parents),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", action="append")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    res = [diagnose(p) for p in (a.db or DEFAULT_DBS)]

    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    for d in res:
        print("=" * 92)
        print("【%s】凭证 %s 条 · as_of %s" % (d["db"], d.get("entries", "-"), d.get("as_of", "-")))
        if "skip" in d:
            print("  跳过：" + d["skip"]); continue
        print("  科目：父 %d / 末级 %d" % (d["parents"], d["leaves"]))
        if d["odd_codes"]:
            print("  ⚠️ 编码不规范（前缀判断可能误伤）：")
            for o in d["odd_codes"][:5]:
                print("       %s → %s（长度差 %d）" % (o["parent"], o["child"], o["delta"]))
        print()
        print("  %-4s %-8s %-8s %16s %16s %14s" % ("类别", "全科目", "末级", "全科目合计", "仅末级合计", "虚增"))
        for cat in ("资产", "负债", "权益"):
            s = d["summary"][cat]
            print("  %-4s %-10d %-10d %16.2f %16.2f %14.2f"
                  % (cat, s["all_codes"], s["leaf_codes"], s["all_sum"], s["leaf_sum"],
                     abs(s["all_sum"]) - abs(s["leaf_sum"])))
        print()
        x, y, z = d["as_is"], d["leaf_only"], d["effective"]
        print("  ① 现报表（全科目累加）  ：资产 %14.2f  负债 %12.2f  权益 %13.2f  差 %14.2f"
              % (x["assets"], x["liabilities"], x["equity"], x["diff"]))
        print("  ② 仅末级（会丢父记余额）：资产 %14.2f  负债 %12.2f  权益 %13.2f  差 %14.2f"
              % (y["assets"], y["liabilities"], y["equity"], y["diff"]))
        print("  ③ 叶子有效（推荐口径）  ：资产 %14.2f  负债 %12.2f  权益 %13.2f  差 %14.2f"
              % (z["assets"], z["liabilities"], z["equity"], z["diff"]))
        print("     ⇒ 相对现报表，资产 %+.2f，负债 %+.2f"
              % (z["assets"] - x["assets"], z["liabilities"] - x["liabilities"]))
        if d["dups"]:
            print("\n  重复计入明细（父科目金额 = 其子科目合计 ⇒ 被算两次）：")
            for u in d["dups"][:12]:
                flag = "✅重复" if u["duplicated"] else "·不等"
                print("     %-3s %-10s %-24s 父 %12.2f  子合计(%d) %12.2f  %s"
                      % (flag, u["parent"], u["parent_name"][:12], u["parent_value"],
                         u["children"], u["children_value"], u["category"]))
        o = d["opening"]
        if o:
            print("\n  期初凭证（ref_type=opening）：")
            print("     全科目  %d 行  借 %14.2f  贷 %14.2f  差 %12.2f"
                  % (o["rows"], o["debit"], o["credit"], o["diff"]))
            print("     排父科目 %d 行  借 %14.2f  贷 %14.2f  差 %12.2f"
                  % (o["excl_parent_rows"], o["excl_parent_debit"],
                     o["excl_parent_credit"], o["excl_parent_diff"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
