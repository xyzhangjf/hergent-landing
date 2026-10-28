#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717b 补 v717 的两处漏项（都由 v717 探针抓出，不是推断）

① `GET /api/income-orders` 仍 500：
   v717 已把路由改成传 8 个实参，但 `income_order_list` 只收 3 个
   ⇒ `TypeError` 照旧。这里把函数签名补到与路由一致，并同样返回
   `{'items','total'}`（与 expense 侧口径统一）。

② `GET /api/expense-categories` 只返回 type='customer' 的 3 条：
   而「营销 → + 新增费用」弹窗是「类型（客户/供应商/内部）+ 类别」两个下拉，
   类别只有 3 条 ⇒ 选「内部」时**挑不到办公费/差旅费/工资/房租**，
   选「供应商」时挑不到运费/装卸费。分类被静默裁掉，建单只能建客户的。
   ⇒ 改为返回全部 9 条。

用法同 v717：--dry-run / --apply / --verify / --revert
"""
import argparse
import json
import os
import shutil
import time

P = "/opt/hergent-erp"
F_Q = os.path.join(P, "db/queries/finance.py")
F_R = os.path.join(P, "routers/finance.py")
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


OLD_IOL = '''def income_order_list(itype='', contact_id=0, limit=100):
    with get_db() as db:
        where, params = [], []
        if itype: where.append("i.type=?"); params.append(itype)
        if contact_id: where.append("i.contact_id=?"); params.append(contact_id)
        w = " WHERE " + " AND ".join(where) if where else ""
        return [dict(r) for r in db.execute(
            f"SELECT i.*,c.name as contact_name,ic.name as category_name FROM income_orders i "
            f"LEFT JOIN contacts c ON i.contact_id=c.id "
            f"LEFT JOIN income_categories ic ON i.category_id=ic.id{w} "
            f"ORDER BY i.id DESC LIMIT ?", params + [limit]).fetchall()]'''

NEW_IOL = '''def income_order_list(itype='', contact_id=0, limit=100, offset=0,
                      date_from='', date_to='', status='', search=''):
    """收入单列表。**返回 `{'items': [...], 'total': N}`**（v717b）。

    改前只收 3 个形参，而路由传 8 个 ⇒ `GET /api/income-orders` 100% `TypeError` 500。
    expense 侧同一缺陷 v717 已修，这里补齐，并同样加 `offset` + `total`
    （前端分页传 limit+offset，没有 offset 就永远返回同一批）。
    """
    where, params = [], []
    if itype:
        where.append("i.type=?"); params.append(itype)
    if contact_id:
        where.append("i.contact_id=?"); params.append(contact_id)
    if status:
        where.append("i.status=?"); params.append(status)
    if date_from:
        where.append("date(IFNULL(i.order_date,i.created_at))>=date(?)"); params.append(date_from)
    if date_to:
        where.append("date(IFNULL(i.order_date,i.created_at))<=date(?)"); params.append(date_to)
    if search:
        where.append("(IFNULL(i.order_no,'') LIKE ? OR IFNULL(i.note,'') LIKE ? "
                     "OR IFNULL(c.name,'') LIKE ?)")
        _like = "%" + str(search) + "%"
        params.extend([_like, _like, _like])
    w = " WHERE " + " AND ".join(where) if where else ""
    try:
        limit = max(1, min(int(limit or 200), 1000))
    except Exception:
        limit = 200
    try:
        offset = max(0, int(offset or 0))
    except Exception:
        offset = 0
    with get_db() as db:
        total = db.execute(
            "SELECT COUNT(*) FROM income_orders i "
            "LEFT JOIN contacts c ON i.contact_id=c.id" + w, params).fetchone()[0]
        items = [dict(r) for r in db.execute(
            "SELECT i.*,c.name as contact_name,ic.name as category_name FROM income_orders i "
            "LEFT JOIN contacts c ON i.contact_id=c.id "
            "LEFT JOIN income_categories ic ON i.category_id=ic.id" + w +
            " ORDER BY i.id DESC LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()]
    return {'items': items, 'total': total}'''

OLD_CAT = '    return db.expense_category_list("customer")'
NEW_CAT = ('    # v717b：改前写死 `expense_category_list("customer")` ⇒ 只返回 3 条客户分类。\n'
           '    # 而「+ 新增费用」弹窗有「类型（客户/供应商/内部）+ 类别」两个下拉，\n'
           '    # 类别只剩 3 条 ⇒ 选「内部」挑不到办公费/差旅费/工资/房租，\n'
           '    # 选「供应商」挑不到运费/装卸费（分类被静默裁掉，只能建客户费用单）。\n'
           '    return db.expense_category_list()')


def do_apply(dry=True):
    rep = {"ts": TS, "dry_run": dry, "q": [], "r": [], "backups": []}
    q = sub_once(_read(F_Q), "收入单列表补 offset+total", OLD_IOL, NEW_IOL, rep["q"])
    r = sub_once(_read(F_R), "费用分类返回全部 9 条", OLD_CAT, NEW_CAT, rep["r"])
    import ast
    ast.parse(q)
    ast.parse(r)
    if dry:
        return rep
    os.makedirs(BAK_DIR, exist_ok=True)
    for p in (F_Q, F_R):
        bak = "%s.bak-v717b-%s" % (p, TS)
        shutil.copy2(p, bak)
        rep["backups"].append(bak)
    _write(F_Q, q)
    _write(F_R, r)
    man = os.path.join(BAK_DIR, "v717b-manifest-%s.json" % TS)
    _write(man, json.dumps(rep, ensure_ascii=False, indent=1))
    rep["manifest"] = man
    return rep


def do_revert():
    import glob
    mans = sorted(glob.glob(os.path.join(BAK_DIR, "v717b-manifest-*.json")))
    if not mans:
        return {"error": "找不到 v717b manifest"}
    rep = json.loads(_read(mans[-1]))
    done = []
    for bak in rep.get("backups", []):
        orig = bak.split(".bak-v717b-")[0]
        if os.path.exists(bak):
            shutil.copy2(bak, orig)
            done.append(orig)
    return {"manifest": mans[-1], "restored": done}


def do_verify():
    q = _read(F_Q)
    r = _read(F_R)
    checks = [
        ("F_Q income_order_list 有 offset", "def income_order_list(itype='', contact_id=0, limit=100, offset=0," in q),
        ("F_Q income_order_list 返回 items/total", "'total': total}" in q),
        ("F_R 分类返回全部", 'db.expense_category_list()' in r),
        ("F_R 不再写死 customer", 'expense_category_list("customer")' not in r),
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
