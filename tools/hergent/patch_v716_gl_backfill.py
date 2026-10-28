#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v716：① 修退货成本判据 ② 清孤儿凭证 ③ 历史单据批量补过账

三个动作绑在一版里，因为它们是同一个病：**业务单据和总账从来没对上过**。

## 为什么必须做

生产 `tenant_1.db` 实况（2026-10-28 只读体检）：
  - `sale_orders` 22,505 张已签收单（2026-01~09，878.61 万）—— **一张分录都没有**
  - `journal_entries` 84 行 = 期初 40 行 + 孤儿 36 行 + 有效 2 行 + 确认收入 6 行
  - 孤儿从哪来：业务单据早被删了（`sale_orders` 里 id 18/19/25/28… 全不存在、
    `contacts` 里没有「测试客户-老王」），**但凭证没跟着删** ⇒ 悬空记录

## 三个动作

① **代码修复**（`erp_db.py:6886`）：
   `if total_cost <= 0: return` → `if to_cents(total_cost) == 0: return`
   退货单金额为负 ⇒ 成本也为负，`<= 0` 会整单跳过 ⇒ 只冲收入不冲成本，
   成本虚增、毛利被低估。副本试算实测：3,943 张负额单（-29.27 万）被吞，
   毛利率从 8.79% 修正到 11.58% —— **差 2.79 个百分点**。

② **清孤儿**：只删 `ref_id` 指向不存在业务单据的分录。
   判据用 `NOT EXISTS`，不按类型整批删 —— 因为同样 `ref_type='purchase'`
   里还混着 2 行**有效**分录（采购单 179 是 received）。整批删会误伤。

③ **补过账**：从 `sale_orders` / `purchase_orders` 生成分录。
   口径照抄 `erp_db.auto_journal_for_cogs` 的**回退分支**：
   `SUM(soi.quantity * IFNULL(p.purchase_price,0))`。
   （`batch_trace` 全库只有 1 行且是 purchase_order ⇒ 批次分支永不命中，
    系统实际走的就是这条回退分支，所以两边口径天然一致。）

## 纪律

- **绝不 import erp_db**（导入期就跑 389 条迁移 = 会写生产）。本脚本纯 sqlite3 + 纯 SQL。
- 幂等：已有 `(ref_type, ref_id)` 分录的单跳过，重跑不重复（v709 血案）。
- 改代码前断两件事：`OLD` 唯一（`count==1`）、`NEW` 未在位；改 import 与改判据**要么都成功、要么都不写**。
- 备份放 `/opt/hergent-data/backup/`（部署目录之外，防 `rsync --delete`）。

用法：
    python3 patch_v716_gl_backfill.py --dry-run   # 只报告，不写任何东西
    python3 patch_v716_gl_backfill.py --apply     # 备份 → 改代码 → 清孤儿 → 过账
    python3 patch_v716_gl_backfill.py --verify    # 事后体检
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB = "/opt/hergent-erp/tenant_1.db"
CODE = "/opt/hergent-erp/erp_db.py"
BAK_DIR = "/opt/hergent-data/backup"
TS = datetime.now().strftime("%Y%m%d-%H%M%S")

# ---------------------------------------------------------------- 代码补丁定义
OLD_IMPORT = "from db.precision import round_money, money_balanced\n"
NEW_IMPORT = "from db.precision import round_money, money_balanced, to_cents\n"

OLD_COGS = (
    "        if total_cost <= 0: return\n"
    '        date_str = o["order_date"][:10]\n'
    "        # v711：凭证模板优先（默认模板取 `cost_amount`），否则回落硬编码。"
)
NEW_COGS = (
    "        # v716：判据必须是「成本恰为 0」（按整数分，v705 精度口径）。\n"
    "        # 退货单金额为负 ⇒ 成本也为负；原判据 `<= 0` 会把退货成本整单跳过 ⇒\n"
    "        # 只冲收入、不冲成本，成本虚增、毛利被低估（副本试算实测差 2.79 个百分点）。\n"
    "        if to_cents(total_cost) == 0: return\n"
    '        date_str = o["order_date"][:10]\n'
    "        # v711：凭证模板优先（默认模板取 `cost_amount`），否则回落硬编码。"
)

# 孤儿清理：只碰有业务主表可核对的四类，opening / revenue_recognition 一律不动
ORPHAN_MAP = (
    ("sale", "sale_orders"),
    ("cogs", "sale_orders"),
    ("purchase", "purchase_orders"),
    ("payment", "cash_flow"),
)

REV_PREFIX = ("60", "61", "63")
COGS_CODE = "6401"
INS = (
    "INSERT INTO journal_entries "
    "(voucher_no,date,account_code,account_name,debit,credit,ref_type,ref_id,summary,operator_id) "
    "VALUES (?,?,?,?,?,?,?,?,?,?)"
)


def cents(x):
    return int(round((x or 0) * 100))


def ro(path):
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def tables(c):
    return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def count_orphans(c):
    out = {}
    tbls = tables(c)
    for rt, tbl in ORPHAN_MAP:
        if tbl not in tbls:
            out[rt] = {"total": 0, "orphan": 0, "note": "主表不存在"}
            continue
        tot = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_type=?", (rt,)).fetchone()[0]
        orp = c.execute(
            'SELECT COUNT(*) FROM journal_entries je WHERE je.ref_type=? '
            'AND NOT EXISTS (SELECT 1 FROM "%s" t WHERE t.id=je.ref_id)' % tbl,
            (rt,),
        ).fetchone()[0]
        out[rt] = {"total": tot, "orphan": orp}
    return out


def pending(c):
    """待过账：业务单据有、分录没有。

    🔴 必须排除 `order_type='transfer'`（调拨单，251 张、55.16 万成本）：
       调拨是仓库之间的转移，不是销售，不该生成收入、更不该结转销售成本。
       若跟着过账，主营业务成本凭空多 55.16 万 ⇒ 毛利率被压掉 6.3 个百分点。
       （这些单调拨前后总库不变，对总账无影响，本就不需要分录。）
    """
    out = {}
    # 口径要和 backfill 的生成条件对齐，否则「按设计不生成」的会永远挂在待办里：
    #   金额 0 的单不出收入分录；成本 0 的单不出成本分录。
    out["sale"] = c.execute(
        "SELECT COUNT(*) FROM sale_orders so WHERE so.status='signed' "
        "AND IFNULL(so.order_type,'')<>'transfer' AND IFNULL(so.total_amount,0)<>0 "
        "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='sale' AND je.ref_id=so.id)"
    ).fetchone()[0]
    out["cogs"] = c.execute(
        "SELECT COUNT(*) FROM sale_orders so WHERE so.status='signed' "
        "AND IFNULL(so.order_type,'')<>'transfer' "
        "AND EXISTS (SELECT 1 FROM sale_order_items soi JOIN products p ON p.id=soi.product_id "
        "            WHERE soi.order_id=so.id AND IFNULL(p.purchase_price,0)<>0) "
        "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='cogs' AND je.ref_id=so.id)"
    ).fetchone()[0]
    out["purchase"] = c.execute(
        "SELECT COUNT(*) FROM purchase_orders po WHERE po.status='received' "
        "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='purchase' AND je.ref_id=po.id)"
    ).fetchone()[0]
    out["excluded_transfer"] = c.execute(
        "SELECT COUNT(*) FROM sale_orders WHERE status='signed' AND IFNULL(order_type,'')='transfer'"
    ).fetchone()[0]
    return out


# ---------------------------------------------------------------- ① 改代码
def patch_code(dry_run=True):
    with open(CODE, "r", encoding="utf-8") as f:
        src = f.read()
    n_old_imp, n_new_imp = src.count(OLD_IMPORT), src.count(NEW_IMPORT)
    n_old_cogs, n_new_cogs = src.count(OLD_COGS), src.count(NEW_COGS)
    st = {
        "file": CODE,
        "import_old": n_old_imp, "import_new": n_new_imp,
        "cogs_old": n_old_cogs, "cogs_new": n_new_cogs,
    }

    already_import = n_new_imp >= 1 and n_old_imp == 0
    already_cogs = n_new_cogs >= 1 and n_old_cogs == 0
    if already_import and already_cogs:
        st["state"] = "already_applied"
        return st
    if already_import != already_cogs:
        st["state"] = "half_applied"
        st["error"] = "import 与判据只改了一处 —— 半应用状态，必须先人工核对"
        return st
    if n_old_imp != 1:
        st["state"] = "anchor_error"
        st["error"] = "import 锚点不唯一（count=%d）" % n_old_imp
        return st
    if n_old_cogs != 1:
        st["state"] = "anchor_error"
        st["error"] = "cogs 判据锚点不唯一（count=%d）" % n_old_cogs
        return st

    st["state"] = "will_apply"
    if dry_run:
        return st

    # 先在内存里算完，两个替换都成功才落盘（避免半应用）
    new_src = src.replace(OLD_IMPORT, NEW_IMPORT, 1).replace(OLD_COGS, NEW_COGS, 1)
    assert new_src != src
    assert new_src.count(NEW_IMPORT) == 1 and new_src.count(NEW_COGS) == 1
    assert new_src.count(OLD_IMPORT) == 0 and new_src.count(OLD_COGS) == 0

    os.makedirs(BAK_DIR, exist_ok=True)
    bak = os.path.join(BAK_DIR, "erp_db.py.pre-v716-%s" % TS)
    shutil.copy2(CODE, bak)
    tmp = CODE + ".v716tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(new_src)
    os.replace(tmp, CODE)  # 原子替换
    st["backup"] = bak
    st["state"] = "applied"
    return st


# ---------------------------------------------------------------- ② 清孤儿
def delete_orphans(c, dry_run=True):
    detail = {}
    total = 0
    tbls = tables(c)
    for rt, tbl in ORPHAN_MAP:
        if tbl not in tbls:
            continue
        n = c.execute(
            'SELECT COUNT(*) FROM journal_entries je WHERE je.ref_type=? '
            'AND NOT EXISTS (SELECT 1 FROM "%s" t WHERE t.id=je.ref_id)' % tbl,
            (rt,),
        ).fetchone()[0]
        detail[rt] = n
        total += n
        if n and not dry_run:
            c.execute(
                'DELETE FROM journal_entries WHERE ref_type=? '
                'AND NOT EXISTS (SELECT 1 FROM "%s" t WHERE t.id=journal_entries.ref_id)' % tbl,
                (rt,),
            )
    return {"deleted_by_type": detail, "deleted_total": total}


# ---------------------------------------------------------------- ③ 补过账
def _voucher_base(c, ref_type):
    """某 ref_type 在每个日期上已有多少张凭证 —— 新生成凭证号的起点。

    不这样接号的话，第二次补录会从 0001 重新数，与上次的凭证号重号
    （`voucher_no` 无唯一约束，不报错、只是对不上号，属于静默劣化）。
    """
    return {
        r[0]: r[1]
        for r in c.execute(
            "SELECT substr(date,1,10) d, COUNT(DISTINCT voucher_no) n "
            "FROM journal_entries WHERE ref_type=? AND date IS NOT NULL AND date<>'' GROUP BY d",
            (ref_type,),
        )
    }


def backfill(c, dry_run=True):
    res = {}

    # --- 收入分录：只挑「缺 sale 分录」且金额非 0 的单 ---
    # 金额 0 的单（赠品）不出收入分录，否则会生成一对 0 元凭证污染账。
    rev_orders = c.execute(
        """
        SELECT so.id, so.order_no, substr(IFNULL(so.order_date, so.created_at),1,10) d,
               IFNULL(so.total_amount,0) amt, IFNULL(ct.name,'') cname
          FROM sale_orders so LEFT JOIN contacts ct ON ct.id=so.customer_id
         WHERE so.status='signed' AND IFNULL(so.order_type,'')<>'transfer'
           AND IFNULL(so.total_amount,0)<>0
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='sale' AND je.ref_id=so.id)
         ORDER BY d, so.id
        """
    ).fetchall()
    sale_rows = []
    seq = _voucher_base(c, "sale")
    for o in rev_orders:
        d = o["d"] or "2026-01-01"
        seq[d] = seq.get(d, 0) + 1
        tag = "%s%04d" % (d.replace("-", ""), seq[d])
        amt = round(o["amt"], 2)
        summ = "销售:" + (o["cname"] or "")
        # 前缀 JB = backfill，避开既有 J/JC 号段
        sale_rows.append(("JB" + tag, d, "1122", "应收账款", amt, 0.0, "sale", o["id"], summ, ""))
        sale_rows.append(("JB" + tag, d, "6001", "主营业务收入", 0.0, amt, "sale", o["id"], summ, ""))

    # --- 成本分录：**独立判「缺 cogs 分录」** ---
    # 🔴 不能复用上面那个 NOT EXISTS(sale)：0 元赠品单永远缺 sale 分录 ⇒ 每次重跑都被选中
    #    ⇒ 已有的 cogs 分录被重复插入（v709「重复写入」同族）。本补丁首版就踩了这个。
    cogs_orders = c.execute(
        """
        SELECT so.id, so.order_no, substr(IFNULL(so.order_date, so.created_at),1,10) d,
               IFNULL(so.total_amount,0) amt,
               (SELECT ROUND(SUM(soi.quantity * IFNULL(p.purchase_price,0)),2)
                  FROM sale_order_items soi LEFT JOIN products p ON p.id=soi.product_id
                 WHERE soi.order_id=so.id) cost
          FROM sale_orders so
         WHERE so.status='signed' AND IFNULL(so.order_type,'')<>'transfer'
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='cogs' AND je.ref_id=so.id)
         ORDER BY d, so.id
        """
    ).fetchall()
    cogs_rows = []
    cseq = _voucher_base(c, "cogs")
    zero_cost = 0
    negative_cogs = 0
    gift_orders = 0  # 金额 0 但成本 > 0（赠品单）：不出收入、只结转成本
    for o in cogs_orders:
        cost = round(o["cost"] or 0, 2)
        # 🔴 恰为 0 才跳过 —— 与 v716 修好后的 erp_db 判据一致
        if cost == 0:
            zero_cost += 1
            continue
        d = o["d"] or "2026-01-01"
        cseq[d] = cseq.get(d, 0) + 1
        tag = "%s%04d" % (d.replace("-", ""), cseq[d])
        if round(o["amt"], 2) == 0:
            gift_orders += 1
        if cost < 0:
            negative_cogs += 1
        cs = "结转销售成本 订单#%s" % (o["order_no"] or o["id"])
        cogs_rows.append(("JBC" + tag, d, COGS_CODE, "主营业务成本", cost, 0.0, "cogs", o["id"], cs, ""))
        cogs_rows.append(("JBC" + tag, d, "1405", "库存商品", 0.0, cost, "cogs", o["id"], cs, ""))

    # --- 采购 ---
    pos = c.execute(
        "SELECT po.id, po.order_no, substr(IFNULL(po.order_date, po.created_at),1,10) d, "
        "IFNULL(po.total_amount,0) amt FROM purchase_orders po WHERE po.status='received' "
        "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='purchase' AND je.ref_id=po.id) "
        "ORDER BY d, po.id"
    ).fetchall()
    pur_rows = []
    pseq = {}
    for p in pos:
        d = p["d"] or "2026-01-01"
        pseq[d] = pseq.get(d, 0) + 1
        tag = "%s%04d" % (d.replace("-", ""), pseq[d])
        amt = round(p["amt"], 2)
        if amt == 0:
            continue
        pur_rows.append(("JBP" + tag, d, "1405", "库存商品", amt, 0.0, "purchase", p["id"], "采购入库", ""))
        pur_rows.append(("JBP" + tag, d, "2202", "应付账款", 0.0, amt, "purchase", p["id"], "采购入库", ""))

    res["plan"] = {
        "revenue_orders": len(rev_orders),
        "sale_rows": len(sale_rows),
        "cogs_orders": len(cogs_orders),
        "cogs_rows": len(cogs_rows),
        "cogs_zero_cost_orders": zero_cost,
        "cogs_negative_orders": negative_cogs,
        "gift_orders_zero_amount": gift_orders,
        "purchase_orders_to_post": len(pos),
        "purchase_rows": len(pur_rows),
    }
    if dry_run:
        return res

    c.executemany(INS, sale_rows)
    c.executemany(INS, cogs_rows)
    c.executemany(INS, pur_rows)
    res["inserted"] = {
        "sale": len(sale_rows), "cogs": len(cogs_rows), "purchase": len(pur_rows),
        "total": len(sale_rows) + len(cogs_rows) + len(pur_rows),
    }
    return res


# ---------------------------------------------------------------- 体检
def verify(c):
    out = {}
    out["orphans"] = count_orphans(c)
    out["pending"] = pending(c)
    out["journal_rows"] = c.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]

    # 退货单成本红冲检查（v716 核心修复的硬证据）
    r = c.execute(
        """
        SELECT COUNT(*) n, ROUND(SUM(je.debit),2) amt FROM sale_orders so
          JOIN journal_entries je ON je.ref_type='cogs' AND je.ref_id=so.id AND je.account_code='6401'
         WHERE so.status='signed' AND so.total_amount<0 AND IFNULL(so.order_type,'')<>'transfer'
        """
    ).fetchone()
    out["return_orders_with_cogs"] = {"orders": r[0], "cogs_debit_sum": r[1]}
    out["excluded_transfer_orders"] = c.execute(
        "SELECT COUNT(*) FROM sale_orders WHERE status='signed' AND IFNULL(order_type,'')='transfer'"
    ).fetchone()[0]

    # 逐月利润表（v714 口径）
    rev_in = " OR ".join(["account_code LIKE '%s%%'" % p for p in REV_PREFIX])
    monthly = []
    for x in c.execute(
        """
        SELECT substr(date,1,7) m,
               ROUND(SUM(CASE WHEN (%s) THEN credit-debit ELSE 0 END),2) revenue,
               ROUND(SUM(CASE WHEN account_code=? THEN debit-credit ELSE 0 END),2) cogs,
               ROUND(SUM(CASE WHEN account_code LIKE '6%%' AND NOT (%s) AND account_code<>?
                              THEN debit-credit ELSE 0 END),2) expense
          FROM journal_entries WHERE date IS NOT NULL AND date<>'' GROUP BY m ORDER BY m
        """
        % (rev_in, rev_in),
        (COGS_CODE, COGS_CODE),
    ):
        gp = round((x["revenue"] or 0) - (x["cogs"] or 0), 2)
        monthly.append({
            "month": x["m"], "revenue": x["revenue"], "cogs": x["cogs"],
            "gross_profit": gp,
            "gross_margin_pct": round(gp / x["revenue"] * 100, 2) if x["revenue"] else None,
            "expense": x["expense"], "net_profit": round(gp - (x["expense"] or 0), 2),
        })
    out["monthly_pnl"] = monthly

    tr = sum(cents(m["revenue"]) for m in monthly)
    tc = sum(cents(m["cogs"]) for m in monthly)
    te = sum(cents(m["expense"]) for m in monthly)
    out["total"] = {
        "revenue": tr / 100.0, "cogs": tc / 100.0,
        "gross_profit": (tr - tc) / 100.0,
        "gross_margin_pct": round((tr - tc) / tr * 100, 2) if tr else None,
        "expense": te / 100.0, "net_profit": (tr - tc - te) / 100.0,
    }

    # 借贷平衡 + 关键科目
    bal = {}
    for row in c.execute(
        "SELECT account_code, ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c "
        "FROM journal_entries GROUP BY account_code"
    ):
        bal[row[0]] = (row[1] or 0, row[2] or 0)
    td = sum(cents(v[0]) for v in bal.values())
    tcr = sum(cents(v[1]) for v in bal.values())
    out["ledger"] = {
        "total_debit": td / 100.0, "total_credit": tcr / 100.0,
        "diff_cents": td - tcr, "balanced": td == tcr,
    }
    for code, label in (("1405", "inventory"), ("1122", "ar"), ("2202", "ap"),
                        ("6001", "revenue"), ("6401", "cogs")):
        v = bal.get(code)
        out["ledger"][label] = None if v is None else round(v[0] - v[1], 2)

    # 代码补丁状态
    with open(CODE, "r", encoding="utf-8") as f:
        src = f.read()
    out["code_patch"] = {
        "import_new": src.count(NEW_IMPORT), "import_old": src.count(OLD_IMPORT),
        "cogs_new": src.count(NEW_COGS), "cogs_old": src.count(OLD_COGS),
    }
    return out


def clean_orphan_revenue(c, dry_run=True):
    """删除「确认收入(revenue_recognition)」分录，当它挂的合同指向的客户已不存在。

    生产实测：6 行、合计 9 万，来自合同「年度冰红茶供应」(id=1, customer_id=1)，
    而 `contacts` 里 id=1 **不存在**、该客户**一张销售单都没有**、分录还记在
    一级科目 `1121 应收票据`（正牌销售走 `1122 应收账款`）。
    ⇒ 早期功能演示的残留，不删会让收入凭空多 9 万（878.61 → 887.61 万）。

    判据是「合同还在、但合同指向的客户没了」，可证伪；不按 ref_id 硬编码。
    """
    # 判据：合同不存在 **或** 合同指向的客户不存在 ⇒ 都是孤儿。
    # 只判后者会漏：生产 6 行里 4 行的 ref_id 连 revenue_contracts 都没有（合同也早被删了）。
    sel = (
        "SELECT je.id FROM journal_entries je "
        "WHERE je.ref_type='revenue_recognition' "
        "AND NOT EXISTS (SELECT 1 FROM revenue_contracts rc "
        "                JOIN contacts ct ON ct.id = rc.customer_id "
        "                WHERE rc.id = je.ref_id)"
    )
    ids = [r[0] for r in c.execute(sel)]
    out = {"rows": len(ids)}
    if not ids:
        out["amount"] = 0.0
        return out
    # 只算损益腿（6 开头）：一借一贷相抵会让 SUM(credit-debit) 恒为 0，那是个假数
    # 🔴 这里用字符串拼接而不是 `%` 格式化：SQL 里有 `LIKE '6%'`，
    #    走 `%` 会把那个 `%` 当格式符（ValueError: unsupported format character）
    ph = ",".join("?" * len(ids))
    out["amount"] = c.execute(
        "SELECT ROUND(SUM(CASE WHEN account_code LIKE '6%' THEN credit-debit ELSE 0 END),2) "
        "FROM journal_entries WHERE id IN (" + ph + ")",
        ids,
    ).fetchone()[0]
    if not dry_run:
        c.execute("DELETE FROM journal_entries WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)
        # 顺带清掉客户已不存在的孤儿合同（不删合同只删分录会留悬空合同）
        orphan_rc = [
            r[0] for r in c.execute(
                "SELECT rc.id FROM revenue_contracts rc "
                "WHERE NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = rc.customer_id)"
            )
        ]
        if orphan_rc:
            c.execute(
                "DELETE FROM revenue_contracts WHERE id IN (%s)" % ",".join("?" * len(orphan_rc)),
                orphan_rc,
            )
        out["contracts_deleted"] = len(orphan_rc)
    return out


def ensure_indexes(c, dry_run=True):
    """`journal_entries` 必须有 `(ref_type, ref_id)` 索引。

    所有 `auto_journal_*` 的幂等检查都是 `WHERE ref_type=? AND ref_id=?`，
    而该表原本只有 `(date, account_code)` 索引 ⇒ 每次全表扫。
    过账前 84 行时看不出来（84 × 22,505 ≈ 190 万次），过账后 88,782 行
    ⇒ 22,505 × 88,782 ≈ 20 亿次比较，查询直接卡死（本补丁首跑 dry-run 被 SIGTERM）。
    实测：建索引后同一查询 0.02 秒。

    这也解释了 `gl_compensation_sweep` 为什么在生产上从来跑不动。
    """
    if c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_journal_ref'"
    ).fetchone():
        return {"index": "idx_journal_ref", "state": "exists"}
    if not dry_run:
        c.execute("CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(ref_type, ref_id)")
        return {"index": "idx_journal_ref", "state": "created"}
    return {"index": "idx_journal_ref", "state": "missing"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if not (a.dry_run or a.apply or a.verify):
        ap.error("必须指定 --dry-run / --apply / --verify 之一")

    report = {"ts": TS, "mode": "apply" if a.apply else ("verify" if a.verify else "dry-run")}

    # ① 代码补丁（先做：改失败就停，别让后面写库白干）
    report["code_patch"] = patch_code(dry_run=not a.apply)
    if a.apply and report["code_patch"].get("state") not in ("applied", "already_applied"):
        print(json.dumps(report, ensure_ascii=False, indent=2))
        sys.exit("代码补丁未应用，已中止（库未做任何改动）")

    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=30000")  # 服务在跑，等锁别立刻报 database is locked
    try:
        if a.apply:
            os.makedirs(BAK_DIR, exist_ok=True)
            bak = os.path.join(BAK_DIR, "tenant_1.pre-v716-%s.db" % TS)
            c.close()
            shutil.copy2(DB, bak)
            c = sqlite3.connect(DB)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA busy_timeout=30000")
            report["db_backup"] = bak

        report["before"] = {"orphans": count_orphans(c), "pending": pending(c)}
        report["indexes"] = ensure_indexes(c, dry_run=not a.apply)

        if a.verify:
            report["after"] = verify(c)
        else:
            report["delete"] = delete_orphans(c, dry_run=not a.apply)
            report["delete_orphan_revenue"] = clean_orphan_revenue(c, dry_run=not a.apply)
            report["backfill"] = backfill(c, dry_run=not a.apply)
            if a.apply:
                c.commit()
                report["after"] = verify(c)
            else:
                c.rollback()
    except Exception as e:
        c.rollback()
        report["error"] = repr(e)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise
    finally:
        c.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
