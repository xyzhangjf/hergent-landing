#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v196 品牌归并的「补票」：① product_change_logs 留痕 ② updated_at（对齐 batch_update_category 既有约定）

背景与为什么必须补：
  · 归并本身已用 v196-brand-merge.py 完成（25 行 brand: 福宝/恒滋 → 蒙牛低温）。
  · 但那个脚本只 UPDATE 了 products.brand 一列，**漏了两处既有约定**：
      ① 后端唯一的「批量改品牌」入口 `db/queries/sales.py:460 batch_update_category()`
         除改列外还会 `updated_at=datetime('now','localtime')`；
      ② 商品档案的字段级改动要落 `product_change_logs`（v107.41，商品档案「修改记录」弹窗的数据源）。
    直改库绕过了 ②，「修改记录」里就看不到这次归并 —— 用户回头查"品牌怎么变了"会查无此事。
  · 注：该函数**没有 API 路由**（全仓 grep 只在 sales.py 定义处命中），页面也没有批量改品牌入口
    ⇒ 走不了真实 API，补写是唯一可行路径。

诚实性：user_name 写「AI运维」而不是「张俊峰」—— 这次不是他在页面上点的，是授意后的批量代操作，
        留痕要能反映真实执行者（既有记录全是他本人页面操作）。

用法: --dry / --apply
"""
import sqlite3
import sys
import time

DB = "/opt/hergent-erp/tenant_1.db"
TARGET = "蒙牛低温"
SRC = ["蒙牛低温（福宝）", "蒙牛低温（恒滋）"]
USER_NAME = "AI运维"

# 这 25 行归并前的原值（来自 v196-brand-merge.py 的产物，逐行核实过）
ORIG = {
    1535: "蒙牛低温（恒滋）", 1537: "蒙牛低温（福宝）", 1538: "蒙牛低温（福宝）",
    1539: "蒙牛低温（福宝）", 1540: "蒙牛低温（福宝）", 1541: "蒙牛低温（福宝）",
    1542: "蒙牛低温（福宝）", 1543: "蒙牛低温（福宝）", 1546: "蒙牛低温（福宝）",
    1547: "蒙牛低温（福宝）", 1549: "蒙牛低温（福宝）", 1550: "蒙牛低温（福宝）",
    1551: "蒙牛低温（福宝）", 1552: "蒙牛低温（福宝）", 1555: "蒙牛低温（福宝）",
    1556: "蒙牛低温（福宝）", 1557: "蒙牛低温（福宝）", 1558: "蒙牛低温（福宝）",
    1559: "蒙牛低温（福宝）", 1560: "蒙牛低温（福宝）", 1561: "蒙牛低温（福宝）",
    1563: "蒙牛低温（福宝）", 1587: "蒙牛低温（福宝）", 1588: "蒙牛低温（福宝）",
    1593: "蒙牛低温（福宝）",
}


def main():
    apply_it = "--apply" in sys.argv
    today = time.strftime("%Y-%m-%d")
    c = sqlite3.connect(DB, timeout=30)
    c.execute("PRAGMA busy_timeout=30000")
    cur = c.cursor()

    print("模式:", "APPLY" if apply_it else "DRY")

    # 校验前置：这 25 行现在必须都已是「蒙牛低温」（否则说明状态与预期不符，停手）
    qmarks = ",".join("?" for _ in ORIG)
    got = cur.execute(
        "SELECT id, brand FROM products WHERE id IN (%s)" % qmarks, tuple(ORIG.keys())).fetchall()
    bad = [(i, b) for i, b in got if b != TARGET]
    print("前置校验: 命中 %d/%d 行，非目标品牌 %d 行" % (len(got), len(ORIG), len(bad)))
    if bad:
        print("   ⚠️ 状态不符，停止:", bad[:5])
        return
    if len(got) != len(ORIG):
        print("   ⚠️ 行数不足（有行被删除？），停止")
        return

    has_updated_at = any(r[1] == "updated_at" for r in cur.execute("PRAGMA table_info(products)"))
    print("products.updated_at 列存在:", has_updated_at)

    # 幂等：今天是否已补过票？
    n_log = cur.execute(
        "SELECT COUNT(*) FROM product_change_logs WHERE field_name='brand' AND new_value=? "
        "AND created_at LIKE ?", (TARGET, today + "%")).fetchone()[0]
    print("今天已存在的同批留痕 =", n_log, "（应为 0；>0 说明补过了）")
    if n_log:
        print("   ⇒ 幂等命中，跳过（如需重做请手工处理）")
        c.close()
        return

    if not apply_it:
        print("\n[DRY] 将插入 %d 条 product_change_logs：" % len(ORIG))
        for pid, old in list(ORIG.items())[:4]:
            print("   product_id=%-5s field=brand  %s → %s  user=%s" % (pid, old, TARGET, USER_NAME))
        print("   ...（共 %d 条）" % len(ORIG))
        print("将更新 updated_at 的行数:", len(ORIG) if has_updated_at else 0)
        c.close()
        return

    try:
        cur.execute("BEGIN IMMEDIATE")
        rows = [(pid, USER_NAME, "update", "brand", old, TARGET) for pid, old in ORIG.items()]
        cur.executemany(
            "INSERT INTO product_change_logs (product_id,user_name,action,field_name,old_value,new_value) "
            "VALUES (?,?,?,?,?,?)", rows)
        ins = cur.rowcount
        assert ins == len(ORIG), "插入 %d 期望 %d" % (ins, len(ORIG))
        upd = 0
        if has_updated_at:
            cur.execute(
                "UPDATE products SET updated_at=datetime('now','localtime') WHERE id IN (%s)" % qmarks,
                tuple(ORIG.keys()))
            upd = cur.rowcount
            assert upd == len(ORIG), "updated_at 更新 %d 期望 %d" % (upd, len(ORIG))
        c.commit()
        print("\n① 已插入留痕 =", ins, "条")
        print("② 已更新 updated_at =", upd, "行")
    except Exception as e:
        c.rollback()
        print("!! 回滚:", e)
        c.close()
        raise

    # 业务层复核
    v = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    vc = v.cursor()
    n = vc.execute(
        "SELECT COUNT(*) FROM product_change_logs WHERE field_name='brand' AND new_value=? "
        "AND created_at LIKE ?", (TARGET, today + "%")).fetchone()[0]
    print("\n复核: 今日 brand→蒙牛低温 留痕 =", n, "（期望", len(ORIG), "）")
    tot = vc.execute("SELECT COUNT(*) FROM product_change_logs").fetchone()[0]
    print("      product_change_logs 总行数 =", tot, "（归并前 415）")
    sample = vc.execute(
        "SELECT id,product_id,user_name,action,field_name,old_value,new_value,created_at "
        "FROM product_change_logs ORDER BY id DESC LIMIT 3").fetchall()
    for s in sample:
        print("      ", s)
    v.close()
    c.close()
    print("\n[APPLY] done.")


if __name__ == "__main__":
    main()
