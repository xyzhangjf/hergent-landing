#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v197 生产数据写入（用户已显式授权「1.要 2.要 3.做」）。

三件事，一个事务：
  A. 品牌归并：products.brand='蒙牛' → '蒙牛低温'（用户答「要」）
  B. 重复建档退休：停用 1199 / 1198 / 1219 + 清空条码；pair3 另把
     1219.factory_price 搬到 1451、forecast_import_products 的 3 行改指 1451（用户答「要」）
  C. 品牌待审回填：把「当年被忽略」的 brand_pending 行从 'resolved' 改成 'dismissed'
     （配合代码侧 P2-3：忽略要能管住"不再反复提示"）

⚠️ 判别 C 的关键（表里没有记录决策动作的列，只能用可核查的替身判据）：
   dismiss **不改任何商品的品牌字段**（弹窗明文承诺）⇒ 忽略后仍有一批商品用着这个名字；
   merge   **会把商品品牌改写走**（UPDATE products SET brand=canonical WHERE brand=raw）
           ⇒ 合并后没有任何商品还用旧名。
   故判据 = `status='resolved'` 且 `raw_name` 不在 brands 表 且 **仍有商品用着 raw_name**。
   仅凭前两条会把「被合并到别的规范名」的行也误判成忽略 —— 那正是本轮 P2-3 要避免的口径混淆。

伴生写操作（照抄业务函数，来自本仓 grep 结果，见技能 §5.1）：
  · 改品牌 → db/queries/sales.py:460 batch_update_category：改列 + updated_at
  · 停用   → db/queries/sales.py:472 batch_set_active：改列 + updated_at
  两者都**不写** product_change_logs（与技能里的记述不符，已订正）；
  但商品档案「修改记录」弹窗读的正是该表 ⇒ 按 v196 先例补留痕（user_name='AI运维'，幂等）。

用法：python3 v197-prod-write.py --dry     只打印将要执行的一切（零写入）
      python3 v197-prod-write.py --apply   备份 → 事务内执行 → 复核 → 打印回滚 SQL
"""
import os, sqlite3, sys, time

DB = "/opt/hergent-erp/tenant_1.db"
BKPDIR = "/opt/hergent-erp/backups"
TOPIC = "v197-dup-retire"
OPERATOR = "AI运维"          # 批量代操作：不冒充用户本人（技能 §5.1）
TARGET_BRAND = "蒙牛低温"
MERGE_FROM = "蒙牛"

RETIRE = {1199: "6934665096594", 1198: "6934665096587", 1219: "6934665093555"}
KEEP = {1438: "6934665096594", 1439: "6934665096587", 1451: "6934665093555"}
MOVE_FP = (1219, 1451)        # (source, target) factory_price 搬运

APPLY = "--apply" in sys.argv
MODE = "APPLY" if APPLY else "DRY-RUN"

plan = []          # 打印用
rollback = []      # 回滚 SQL


def say(s=""):
    print(s, flush=True)


def P(s):
    plan.append(s)
    say(s)


def R(s):
    rollback.append(s)


def now_ts():
    return time.strftime("%Y%m%d-%H%M%S")


def backup():
    bkp = os.path.join(BKPDIR, "tenant_1.db.before-%s-%s.bak" % (TOPIC, now_ts()))
    src = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)   # WAL 安全
    dst = sqlite3.connect(bkp)
    src.backup(dst)
    dst.close()
    src.close()
    assert os.path.getsize(bkp) > 100000, "备份文件过小：%s" % bkp
    n = sqlite3.connect(bkp).execute("SELECT COUNT(*) FROM products").fetchone()[0]
    assert n > 0, "备份库 products 为空"
    say("  [备份] %s  (%d bytes, products=%d)" % (bkp, os.path.getsize(bkp), n))
    return bkp


# ---------------------------------------------------------------- 读（决策依据）
def collect():
    ro = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    ro.row_factory = sqlite3.Row
    one = lambda s, p=(): (lambda r: dict(r) if r else None)(ro.execute(s, p).fetchone())
    all_ = lambda s, p=(): [dict(r) for r in ro.execute(s, p).fetchall()]

    say("=" * 76)
    say("第 0 步  读取并断言当前状态（写之前必须全部成立）")
    say("=" * 76)

    # A
    a_rows = all_("SELECT id,brand,is_active,name FROM products WHERE brand=?", (MERGE_FROM,))
    assert len(a_rows) == 1, "brand=%s 的行数=%d，预期 1 —— 中止" % (MERGE_FROM, len(a_rows))
    a_id = a_rows[0]["id"]
    say("  A  归并目标: id=%d name=%s is_active=%d" % (a_id, a_rows[0]["name"], a_rows[0]["is_active"]))
    assert not all_("SELECT id FROM products WHERE brand=? AND name=?", (TARGET_BRAND, a_rows[0]["name"])), \
        "「%s」里已有同名商品，归并会产生新重复 —— 中止" % TARGET_BRAND
    assert all_("SELECT id FROM brands WHERE name=?", (TARGET_BRAND,)), "brands 表缺 %s" % TARGET_BRAND

    # B
    for pid, bc in RETIRE.items():
        r = one("SELECT * FROM products WHERE id=?", (pid,))
        assert r, "id=%d 不存在 —— 中止" % pid
        assert r["is_active"] == 1, "id=%d 已停用（is_active=%s）—— 中止" % (pid, r["is_active"])
        assert r["barcode"] == bc, "id=%d 条码=%s 与预期 %s 不符 —— 中止" % (pid, r["barcode"], bc)
    for pid, bc in KEEP.items():
        r = one("SELECT * FROM products WHERE id=?", (pid,))
        assert r and r["is_active"] == 1 and r["barcode"] == bc, \
            "保留行 id=%d 状态不符 —— 中止" % pid
    say("  B  退休行 %s / 保留行 %s 状态全部符合预期" % (sorted(RETIRE), sorted(KEEP)))

    src_id, dst_id = MOVE_FP
    s_row = one("SELECT factory_price,product_code FROM products WHERE id=?", (src_id,))
    d_row = one("SELECT factory_price,product_code FROM products WHERE id=?", (dst_id,))
    do_move_fp = (d_row["factory_price"] or 0) == 0 and (s_row["factory_price"] or 0) != 0
    assert (s_row["product_code"] or "") == (d_row["product_code"] or ""), \
        "product_code 两侧不同，需要人工判断搬哪个 —— 中止"
    say("  B  厂价搬运: %d(%.2f) -> %d(%.2f)  需要搬=%s"
        % (src_id, s_row["factory_price"] or 0, dst_id, d_row["factory_price"] or 0, do_move_fp))

    f19 = all_("SELECT id,period_id FROM forecast_import_products WHERE product_id=?", (src_id,))
    f51_pids = set(x["period_id"] for x in all_("SELECT period_id FROM forecast_import_products WHERE product_id=?", (dst_id,)))
    assert f19, "id=%d 在 forecast_import_products 里没有登记行" % src_id
    assert not (set(x["period_id"] for x in f19) & f51_pids), \
        "改指后会与 %d 现有登记撞 period_id —— 中止" % dst_id
    say("  B  导入登记改指: %d 行 %s -> product_id=%d（1451 已占 period=%s）"
        % (len(f19), [x["id"] for x in f19], dst_id, sorted(f51_pids)))

    # C
    cands = all_(
        "SELECT p.id,p.raw_name,p.ref_count,"
        " (SELECT COUNT(*) FROM products x WHERE x.brand=p.raw_name) AS prod_use "
        "FROM brand_pending p "
        "WHERE p.status='resolved' "
        "  AND NOT EXISTS(SELECT 1 FROM brands b WHERE b.name=p.raw_name) "
        "ORDER BY p.id")
    c_rows = [c for c in cands if c["prod_use"] > 0]
    c_skip = [c for c in cands if c["prod_use"] == 0]
    say("  C  待审候选 %d 条；判为「已忽略」%d 条（仍有商品用着该名）；"
        "判为「已合并」%d 条（商品品牌已被改写走，无需抑制）"
        % (len(cands), len(c_rows), len(c_skip)))
    for c in c_rows:
        say("       dismiss -> id=%d %r ref_count=%d 在用商品=%d"
            % (c["id"], c["raw_name"], c["ref_count"], c["prod_use"]))
    for c in c_skip:
        say("       跳过(合并) -> id=%d %r ref_count=%d" % (c["id"], c["raw_name"], c["ref_count"]))

    ro.close()
    return dict(a_id=a_id, do_move_fp=do_move_fp, f19=f19, c_rows=c_rows,
                src_id=src_id, dst_id=dst_id,
                a_name=a_rows[0]["name"])


# ---------------------------------------------------------------- 计划打印
def print_plan(s):
    say()
    say("=" * 76)
    say("第 1 步  将要执行的语句（%s）" % MODE)
    say("=" * 76)
    P("  -- A 品牌归并 %s -> %s" % (MERGE_FROM, TARGET_BRAND))
    P("  UPDATE products SET brand='%s', updated_at=datetime('now','localtime') WHERE id=%d;"
      % (TARGET_BRAND, s["a_id"]))
    P("  -- B 重复建档退休（停用 + 清条码）")
    for pid in sorted(RETIRE):
        P("  UPDATE products SET is_active=0, barcode='', updated_at=datetime('now','localtime') WHERE id=%d;" % pid)
    if s["do_move_fp"]:
        P("  UPDATE products SET factory_price=39.6, updated_at=datetime('now','localtime') WHERE id=%d;" % s["dst_id"])
    P("  UPDATE forecast_import_products SET product_id=%d WHERE product_id=%d;   -- %d 行"
      % (s["dst_id"], s["src_id"], len(s["f19"])))
    P("  -- C 品牌待审回填 resolved -> dismissed（%d 行：%s）"
      % (len(s["c_rows"]), [c["id"] for c in s["c_rows"]]))
    P("  -- 附：product_change_logs 补留痕（每个字段一行，user_name='%s'，幂等）" % OPERATOR)


# ---------------------------------------------------------------- 写
def apply_all(s):
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA busy_timeout=8000")
    conn.execute("BEGIN IMMEDIATE")
    log_rows = []

    # A
    cur = conn.execute("UPDATE products SET brand=?, updated_at=datetime('now','localtime') WHERE id=?",
                       (TARGET_BRAND, s["a_id"]))
    assert cur.rowcount == 1, "A 影响行数=%d" % cur.rowcount
    log_rows.append((s["a_id"], "brand", MERGE_FROM, TARGET_BRAND))
    R("UPDATE products SET brand='%s' WHERE id=%d;" % (MERGE_FROM, s["a_id"]))

    # B
    if s["do_move_fp"]:
        cur = conn.execute("UPDATE products SET factory_price=?, updated_at=datetime('now','localtime') WHERE id=?",
                           (39.6, s["dst_id"]))
        assert cur.rowcount == 1, "B-厂价 影响行数=%d" % cur.rowcount
        log_rows.append((s["dst_id"], "factory_price", "0.0", "39.6"))
        R("UPDATE products SET factory_price=0.0 WHERE id=%d;" % s["dst_id"])

    cur = conn.execute("UPDATE forecast_import_products SET product_id=? WHERE product_id=?",
                       (s["dst_id"], s["src_id"]))
    assert cur.rowcount == len(s["f19"]), "B-改指 影响行数=%d 预期=%d" % (cur.rowcount, len(s["f19"]))
    R("UPDATE forecast_import_products SET product_id=%d WHERE id IN (%s);"
      % (s["src_id"], ",".join(str(x["id"]) for x in s["f19"])))

    for pid, bc in sorted(RETIRE.items()):
        keep_id = [x for x in KEEP if KEEP[x] == bc][0]
        cur = conn.execute("UPDATE products SET is_active=0, barcode='', updated_at=datetime('now','localtime') WHERE id=?", (pid,))
        assert cur.rowcount == 1, "B-停用 id=%d 影响行数=%d" % (pid, cur.rowcount)
        log_rows.append((pid, "is_active", "1", "0"))
        log_rows.append((pid, "barcode", bc, ""))
        R("UPDATE products SET is_active=1, barcode='%s', updated_at=datetime('now','localtime') WHERE id=%d;   -- 同条码的保留行 id=%d"
          % (bc, pid, keep_id))

    # C
    for c in s["c_rows"]:
        cur = conn.execute("UPDATE brand_pending SET status='dismissed' WHERE id=? AND status='resolved'", (c["id"],))
        assert cur.rowcount == 1, "C id=%d 影响行数=%d" % (c["id"], cur.rowcount)
        R("UPDATE brand_pending SET status='resolved' WHERE id=%d;" % c["id"])

    # 留痕（幂等：同一天同一商品同一字段已记过就不再插）
    ins = 0
    for pid, field, ov, nv in log_rows:
        dup = conn.execute(
            "SELECT COUNT(*) FROM product_change_logs WHERE product_id=? AND field_name=? "
            "AND old_value=? AND new_value=? AND user_name=? AND date(created_at)=date('now','localtime')",
            (pid, field, ov, nv, OPERATOR)).fetchone()[0]
        if dup:
            continue
        conn.execute(
            "INSERT INTO product_change_logs (product_id,user_name,action,field_name,old_value,new_value) "
            "VALUES (?,?,?,?,?,?)", (pid, OPERATOR, "update", field, ov, nv))
        ins += 1
    say("  [事务内] 补留痕 %d 行（跳过已存在 %d 行）" % (ins, len(log_rows) - ins))
    R("DELETE FROM product_change_logs WHERE user_name='%s' AND date(created_at)=date('now','localtime');" % OPERATOR)

    conn.commit()
    conn.close()


# ---------------------------------------------------------------- 复核
def verify():
    ro = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    one = lambda s, p=(): ro.execute(s, p).fetchone()
    fails = []

    def chk(name, got, want):
        ok = got == want
        say("  %s %-46s got=%s want=%s" % ("PASS" if ok else "FAIL", name, got, want))
        if not ok:
            fails.append(name)

    say()
    say("=" * 76)
    say("第 2 步  复核（新连接读，不用任何应用层缓存）")
    say("=" * 76)
    chk("A brand='蒙牛' 剩余行数", one("SELECT COUNT(*) FROM products WHERE brand='蒙牛'")[0], 0)
    chk("A 归并后 brand", one("SELECT brand FROM products WHERE id=?", (1591,))[0], TARGET_BRAND)
    for pid in sorted(RETIRE):
        chk("B id=%d is_active" % pid, one("SELECT is_active FROM products WHERE id=?", (pid,))[0], 0)
        chk("B id=%d barcode" % pid, one("SELECT IFNULL(barcode,'') FROM products WHERE id=?", (pid,))[0], "")
    for pid, bc in sorted(KEEP.items()):
        chk("B 保留 id=%d is_active" % pid, one("SELECT is_active FROM products WHERE id=?", (pid,))[0], 1)
        chk("B 保留 id=%d barcode" % pid, one("SELECT barcode FROM products WHERE id=?", (pid,))[0], bc)
    chk("B 1451 factory_price", one("SELECT factory_price FROM products WHERE id=1451")[0], 39.6)
    chk("B 导入登记 1219 残留", one("SELECT COUNT(*) FROM forecast_import_products WHERE product_id=1219")[0], 0)
    chk("B 导入登记 1451 行数", one("SELECT COUNT(*) FROM forecast_import_products WHERE product_id=1451")[0], 3)
    for bc in RETIRE.values():
        chk("B 条码 %s 在售行数" % bc,
            one("SELECT COUNT(*) FROM products WHERE barcode=? AND is_active=1", (bc,))[0], 1)
    chk("A 蒙牛低温 行数", one("SELECT COUNT(*) FROM products WHERE brand=?", (TARGET_BRAND,))[0], 158)
    st = [tuple(r) for r in ro.execute("SELECT status,COUNT(*) FROM brand_pending GROUP BY status").fetchall()]
    say("  C brand_pending 状态分布: %s" % (st,))
    # 留痕期望：A 改品牌 1 行 + pair3 搬厂价 1 行 + 3 个退休行各 2 字段(is_active/barcode) = 8
    # ⚠️ 判据必须**限定在本轮 pid**：`user_name='AI运维' AND 今天` 会连当天更早的批次一起吃进来
    #    （实测：v196 品牌归并补票 25 行也是 AI运维 + 同一天 ⇒ 那种写法恒为 33，看着像失败其实全对）。
    #    教训：「核对我这次写了什么」的条件要能唯一指回本次写入，不能只按"执行者+日期"筛。
    batch_pids = [s["a_id"], s["dst_id"]] + sorted(RETIRE)
    ph = ",".join("?" for _ in batch_pids)
    chk("C 本轮补留痕行数(%s)" % batch_pids, one(
        "SELECT COUNT(*) FROM product_change_logs WHERE user_name=? AND date(created_at)=date('now','localtime') "
        "AND product_id IN (%s)" % ph, tuple([OPERATOR] + batch_pids))[0], 8)
    chk("C 同日重复留痕数(应 0)",
        one("SELECT COUNT(*) FROM (SELECT product_id,field_name,old_value,new_value,COUNT(*) n FROM product_change_logs "
            "WHERE user_name=? AND date(created_at)=date('now','localtime') AND product_id IN (%s) "
            "GROUP BY 1,2,3,4 HAVING n>1)" % ph, tuple([OPERATOR] + batch_pids))[0], 0)
    ro.close()
    return fails


# ---------------------------------------------------------------- main
def main():
    say("v197 生产数据写入  模式=%s  DB=%s" % (MODE, DB))
    say()
    s = collect()
    print_plan(s)
    if not APPLY:
        say()
        say("  （DRY-RUN：以上均未执行。复核 --apply 前的全部断言已通过。）")
        say("DRY_RUN_OK")
        return
    say()
    say("=" * 76)
    say("第 1 步  备份 + 事务执行")
    say("=" * 76)
    bkp = backup()
    apply_all(s)
    fails = verify()
    say()
    say("=" * 76)
    say("回滚 SQL（如需回滚，在同一个 BEGIN IMMEDIATE 里执行）")
    say("=" * 76)
    for r in rollback:
        say("  " + r)
    say()
    say("备份文件: %s（不要主动删）" % bkp)
    say()
    if fails:
        say("RESULT_FAIL: %s" % fails)
        sys.exit(2)
    say("WRITE_OK")


main()
