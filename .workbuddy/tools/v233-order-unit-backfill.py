# -*- coding: utf-8 -*-
"""v233 P2-3：把「**报单单位**」回填进 `products.order_unit`。

**默认 dry-run（只报告、不写）**；加 `--apply` 才真正写。

为什么要有这一步：`order_unit` 是新增列，**空 = 未指定 ⇒ 回退档案 `unit`**。
对本轮要修的那批商品（`unit='件'` 而档案没录过小单位），空着就等于没修 ——
而「正确的报单单位」这个信息**系统里已经有两处人工痕迹**，不需要用户重新录：

  A. `forecast_barcode_units`（条码 → 单位，生产 115 条，用户此前在模板侧人工维护的覆盖层）
     —— **最权威**：那是用户为了「模板写对单位」专门做的。
  B. 报单明细里**该商品实际用过的单位**（`forecast_submission_items.unit`）
     —— 历史事实。**只在档案不可信时**采信（下条的收紧条件）。

B 的收紧条件（`large_ratio <= 0 且 large_unit = ''`，即**档案里没有任何换算信息**）：
  舟谱的校验规则是「填了大单位就必须填大单位换算」⇒ **有换算 = 单位是认真录过的**。
  反例实测：`id=1316`（档案=盒、`large_unit=件`、`large_ratio=12`、明细填「件」）——
  档案是对的、明细是随手填的，若不加这条就会**把对的改错**。

A 优先于 B（人工明确指定的 > 历史推断的）。其余商品**一律不动**。

`--apply` 时的安全流程：**在线备份 → 事务内逐行主键定位 → 写后逐列断言 → 输出回滚 SQL**。
"""
import argparse
import datetime
import os
import sqlite3
import sys

SRV = os.environ.get('HERGENT_SRV') or (
    '/Users/zhangjunfeng/Documents/hergent-erp/server'
    if os.path.isdir('/Users/zhangjunfeng/Documents/hergent-erp/server')
    else '/opt/hergent-erp')          # 生产是 FLAT 布局（`/opt/hergent-erp/routers/...`）
sys.path.insert(0, SRV)


def fmt_bc(v):
    if v is None or str(v).strip() == '':
        return ''
    try:
        return str(int(float(str(v).strip())))
    except Exception:
        return str(v).strip()


def plan(conn):
    """算出回填计划 → (rows, stats)。rows = [(pid, name, old, new, why, bc)]"""
    prods = {}
    for r in conn.execute(
            "SELECT id, name, barcode, unit, large_unit, large_ratio, "
            "       COALESCE(order_unit,'') ou "
            "FROM products WHERE COALESCE(is_active,1)=1"):
        prods[int(r[0])] = {"id": int(r[0]), "name": r[1] or "", "bc": fmt_bc(r[2]),
                            "unit": (r[3] or "").strip(), "lu": (r[4] or "").strip(),
                            "lr": r[5] or 0, "ou": (r[6] or "").strip()}
    by_bc = {}
    for pid, p in prods.items():
        if p["bc"]:
            by_bc.setdefault(p["bc"], []).append(pid)

    manual = {}
    for r in conn.execute("SELECT barcode, unit FROM forecast_barcode_units"):
        u = (r[1] or "").strip()
        if u:
            manual[fmt_bc(r[0])] = u

    detail = {}
    for r in conn.execute("SELECT product_id, TRIM(COALESCE(unit,'')) u, COUNT(*) n "
                          "FROM forecast_submission_items GROUP BY 1,2"):
        detail.setdefault(int(r[0] or 0), {})[r[1]] = r[2]

    rows, st = [], {"A": 0, "B": 0, "skip_same": 0, "skip_mixed": 0, "skip_trusted": 0,
                    "skip_nodetail": 0, "A_bc_nohit": 0, "skip_manual_kept": 0}
    done = set()

    def _skip(p, u, st):
        """该商品是否**不需要写**。返回 `(skip?, 计数键)`。

        🔴 三条跳过理由里，**「人工已指定了别的值」排在最前** —— 本脚本是**一次性回填**，
        绝不覆盖用户在「商品档案 → 报单单位」里手工改过的值（那是他的最新意图）。
        其次是幂等：值已经是目标值 ⇒ 不写（重复跑不产生无意义写入）。
        """
        if p["ou"]:
            return (p["ou"] == u), ("skip_same" if p["ou"] == u else "skip_manual_kept")
        return (p["unit"] == u), "skip_same"

    # ---- A：条码人工层（最权威） ----
    for bc, u in manual.items():
        pids = by_bc.get(bc) or []
        if not pids:
            st["A_bc_nohit"] += 1
            continue
        for pid in pids:
            p = prods[pid]
            done.add(pid)
            skip, key = _skip(p, u, st)
            if skip or key == "skip_manual_kept":
                st[key] += 1
                continue
            st["A"] += 1
            rows.append((pid, p["name"], p["unit"], u, "A:条码人工层", bc))
    # ---- B：明细唯一单位（收紧：档案无换算 + A 未覆盖） ----
    for pid, us in detail.items():
        if pid not in prods or pid in done:
            continue
        p = prods[pid]
        real = [k for k in us if k]
        if not real:
            st["skip_nodetail"] += 1
            continue
        if len(real) > 1:
            st["skip_mixed"] += 1
            continue
        u = real[0]
        skip, key = _skip(p, u, st)
        if skip or key == "skip_manual_kept":
            st[key] += 1
            continue
        # 档案信任闸门
        try:
            lr = float(p["lr"] or 0)
        except Exception:
            lr = 0
        if lr > 0 or p["lu"]:
            st["skip_trusted"] += 1
            continue
        st["B"] += 1
        rows.append((pid, p["name"], p["unit"], u, "B:明细唯一+档案无换算", p["bc"]))
    rows.sort(key=lambda t: t[0])
    return rows, st


def master_unit_diff(conn):
    """**主表「单位」列**在新旧口径下会变的行 —— 用**真身的 SQL 片段**算，不手抄口径。

    主表口径（`erp_db.py::forecast_submission_summary`）= `order_unit_master_sql("i")`；
    旧口径 = 档案 `unit` 优先、明细兜底（v233 之前）。

    ⚠️ 刻意 import 真身 `db.queries.products` 来取这个片段 —— 手抄一份就成了「第二份实现」，
    改一处不生效（本项目同类事故的固定剧本）。
    ⚠️ **不过滤商品集**（全表比）：这样报告与「本次计划写了哪几条」解耦 —— 既覆盖已回填的，
    也覆盖将来人工指定的，读数不会因为「今天跑的是第几遍」而变。
    """
    try:
        from db.queries.products import order_unit_master_sql
    except Exception as e:
        print('  （跳过主表影响：无法载入真身 SQL 片段 %s）' % e)
        return []
    old = "COALESCE(NULLIF((SELECT unit FROM products WHERE id=i.product_id),''), i.unit)"
    new = order_unit_master_sql("i")
    return conn.execute(
        "SELECT DISTINCT i.product_id, " + old + " AS o, " + new + " AS n, "
        "(SELECT name FROM products WHERE id=i.product_id) AS nm "
        "FROM forecast_submission_items i "
        "WHERE (" + old + ") != (" + new + ") ORDER BY i.product_id").fetchall()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='租户库路径，如 /opt/hergent-erp/tenant_1.db')
    ap.add_argument('--apply', action='store_true', help='真正写入（默认只报告）')
    a = ap.parse_args()

    if not os.path.exists(a.db):
        print('BAD 库不存在:', a.db)
        return 2

    conn = sqlite3.connect(a.db)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(products)")]
    if 'order_unit' not in cols:
        print('BAD `products.order_unit` 列不存在 —— 先让服务启动一次（租户库列对账会自动补列）')
        conn.close()
        return 2

    rows, st = plan(conn)
    print('=' * 96)
    print('库: %s' % a.db)
    print('=' * 96)
    print('  将回填 order_unit 的商品 : %d  （A 条码人工层 %d + B 明细推断 %d）' % (len(rows), st["A"], st["B"]))
    print('  跳过·已相同              : %d' % st["skip_same"])
    print('  跳过·**人工已指定**      : %d  （不覆盖用户手工改过的值）' % st["skip_manual_kept"])
    print('  跳过·明细混用            : %d' % st["skip_mixed"])
    print('  跳过·档案有换算(可信)    : %d' % st["skip_trusted"])
    print('  跳过·无明细              : %d' % st["skip_nodetail"])
    print('  条码人工层里对不上商品   : %d' % st["A_bc_nohit"])
    print()
    for pid, name, old, new, why, bc in rows:
        print('   id=%-6s %-30s  %s → %s   [%s]' % (pid, name[:30], old or '(空)', new, why))

    mdiff = master_unit_diff(conn)
    print()
    print('  ── 回填后**主表「单位」列**会变的行（本项目要修的就是这个）──')
    if mdiff:
        for r in mdiff:
            print('     id=%-6s %-28s  %s → %s' % (r[0], str(r[3] or '')[:28], r[1] or '(空)', r[2] or '(空)'))
    else:
        print('     （无）')
    print('     ⇒ %d 行' % len(mdiff))

    conn2 = sqlite3.connect(a.db)
    have = sum(1 for r in conn2.execute(
        "SELECT 1 FROM products WHERE TRIM(COALESCE(order_unit,''))!=''"))
    conn2.close()
    print()
    print('  当前已有 order_unit 的商品 = %d' % have)

    if not a.apply:
        print()
        print('  （dry-run：未写入任何数据。加 --apply 执行）')
        conn.close()
        return 0

    # ---------------- 备份 ----------------
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = a.db + '.bak-v233-' + ts
    bconn = sqlite3.connect(bak)
    conn.backup(bconn)
    bconn.close()
    print()
    print('  ✅ 备份 → %s (%d bytes)' % (bak, os.path.getsize(bak)))

    # ---------------- 事务写入 + 断言 ----------------
    rollback = []
    n = 0
    try:
        conn.execute('BEGIN IMMEDIATE')
        for pid, name, old, new, why, bc in rows:
            conn.execute("UPDATE products SET order_unit=? WHERE id=?", (new, pid))
            r = conn.execute("SELECT order_unit FROM products WHERE id=?", (pid,)).fetchone()
            assert (r and (r[0] or '') == new), 'pat=%d 写入后复核不一致: %r' % (pid, r)
            rollback.append((pid, old))
            n += 1
        conn.commit()
    except Exception as e:
        conn.rollback()
        print('  BAD 已回滚：%s' % e)
        conn.close()
        return 1

    print('  ✅ 已写入 %d 行，逐行复核通过' % n)
    rb = os.path.join('/tmp', 'v233-order-unit-rollback-%s.sql' % ts)
    with open(rb, 'w', encoding='utf-8') as f:
        for pid, old in rollback:
            f.write("UPDATE products SET order_unit='%s' WHERE id=%d;\n" % (old.replace("'", "''"), pid))
    print('  ✅ 回滚 SQL → %s（%d 条）' % (rb, len(rollback)))
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
