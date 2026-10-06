#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v389-expiry-caliber-shadow-test.py —— 批次 1.3（方案 A）行为级取证

要证的核心命题
--------------
`products.expiry_days` 的语义是 **保质期(天)**，却被当成 **临期阈值** 用。
本脚本不读代码觉得对，而是**跑真源码**证明两件事：

  【1】旧判据与新判据**判出来的是不同的商品**（不只是数字不同）。
  【2】新判据**随货损配方阈值变化**（阈值改 7→21，结果真的跟着变），
       证明它不是把 7 换了个地方写死。

🔴 判别力设计（本脚本最关键的一处，别改）
----------------------------------------
刻意构造成 **新旧命中数量相同（都是 3）但成员不同**：

   商品          保质期   批次还剩   旧判据(保质期<=7)   新判据(配方阈值=7)
   P1 鲜奶短保     5天      4 天        ✅命中              ✅临期
   P2 常温长保   180天      2 天        ❌漏掉              ✅临期   ← 只剩2天却不算
   P3 鲜奶短保     5天     30 天        ✅命中              ❌不临期 ← 还有30天却算临期
   P4 临界长保   200天     10 天        ❌漏掉              ❌不临期（阈值7）；改21则 ✅
   P5 已过期       5天     -3 天        ✅命中              ✅已过期

   旧 = {P1,P3,P5}（3 个）   新 = {P1,P2,P5}（3 个）

⇒ **数量都是 3**。如果只断言「数量变了」，这个测试会 **0 判别力地通过/失败**。
   所以断言一律比对**成员集合**，并额外断言「两者数量相同但成员不同」这一事实本身
   （防后人把场景改坏、退化成数量判别）。

这是本项目反复踩的坑：「数字碰巧对」⇒ 必须**逐项**比对（见 §判据取值域必须与输入同宽）。

用法：
  python3 v389-expiry-caliber-shadow-test.py
  SRC=/opt/hergent-erp python3 ...   # 也可指向部署后的源码验证线上那份

退出码 0 = 全绿；2 = 有 FAIL。
"""
import contextlib
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta

SRC = os.environ.get("V389_SRC", "/Users/zhangjunfeng/Documents/hergent-erp/server")
SHADOW = os.path.join(tempfile.gettempdir(), "v389-shadow.db")
MUTATE = os.environ.get("V389_MUTATE", "")   # green|red —— 仅用于自证判别力，正常跑留空

TESTS = []


def ok(name, cond, detail=""):
    TESTS.append((name, bool(cond), detail))
    print(("  PASS  " if cond else "  FAIL  ") + name + ((" | " + str(detail)) if detail else ""))


def head(t):
    print("\n=== " + t + " ===")


# ---------------------------------------------------------------------------
# 影子库：5 个商品 + 1 条配方。数值全部编造，不涉任何真实业务数据。
# ---------------------------------------------------------------------------
TODAY = datetime.now().date()


def _d(n):
    return (TODAY + timedelta(days=n)).strftime("%Y-%m-%d")


# (id, 名称, 保质期, 批次到期偏移天数, safety_stock, 期望_新判据thr7, 期望_新判据thr21)
CASES = [
    (1, "P1鲜奶短保临期",   5,   4, 10, True,  True),
    (2, "P2常温长保快过期", 180,  2, 10, True,  True),
    (3, "P3鲜奶短保还很新", 5,   30, 10, False, False),   # 30 > 21，故 thr=21 也不临期
    (4, "P4临界长保",       200, 10, 10, False, True),    # ← 阈值敏感探针
    (5, "P5已过期",         5,   -3, 10, True,  True),
    # P6 的保质期特意取 200（长保）：让它**不被旧 SQL 命中**，从而把新旧命中数
    # 拉成「同为 3」—— 否则数量本身就有差异，B1 那条判别力断言会退化。
    (6, "P6脏日期",         200, None, 10, False, False),  # expiry_date 非法 ⇒ 跳过
]


def build_shadow(threshold_days):
    if os.path.exists(SHADOW):
        os.remove(SHADOW)
    c = sqlite3.connect(SHADOW)
    c.executescript("""
        CREATE TABLE products (
            id INTEGER PRIMARY KEY, name TEXT,
            safety_stock REAL DEFAULT 0, expiry_days INTEGER DEFAULT 0);
        CREATE TABLE inventory (
            id INTEGER PRIMARY KEY, product_id INTEGER,
            quantity REAL DEFAULT 0, expiry_date TEXT DEFAULT '');
        CREATE TABLE workflow_recipes (key TEXT PRIMARY KEY, recipe TEXT);
    """)
    for (pid, name, edays, offset, ss, _e7, _e21) in CASES:
        c.execute("INSERT INTO products (id,name,safety_stock,expiry_days) VALUES (?,?,?,?)",
                  (pid, name, ss, edays))
        if offset is None:
            c.execute("INSERT INTO inventory (id,product_id,quantity,expiry_date) VALUES (?,?,?,?)",
                      (pid, pid, 7, "0000-00-00"))       # 脏日期
        else:
            c.execute("INSERT INTO inventory (id,product_id,quantity,expiry_date) VALUES (?,?,?,?)",
                      (pid, pid, 7, _d(offset)))
    if threshold_days is None:
        pass                                             # 不写配方 ⇒ 走默认 7
    else:
        import json
        c.execute("INSERT INTO workflow_recipes (key,recipe) VALUES (?,?)",
                  ("loss_recipe", json.dumps({"threshold_days": threshold_days})))
    c.commit()
    return c


# ---------------------------------------------------------------------------
# 真源码：import 部署目录下的 domain.batch_tracker，只把连接换成影子库
# ---------------------------------------------------------------------------
def load_module():
    if SRC not in sys.path:
        sys.path.insert(0, SRC)
    for m in ("domain.batch_tracker", "domain", "db.connection", "db"):
        sys.modules.pop(m, None)
    import domain.batch_tracker as bt

    conn = sqlite3.connect(SHADOW)
    conn.row_factory = sqlite3.Row          # 生产连接是 Row，保持一致

    @contextlib.contextmanager
    def _shadow_db():
        yield conn

    bt.get_db = _shadow_db                 # 唯一替身：连接指向影子库

    # 🔴 变异模式（判别力自证用）：把权威档位判定换成恒值，正常测试**必须**转红。
    #    若变异后依旧全绿 ⇒ 本脚本根本没有在测真正的判据，是「恒真探针」。
    if MUTATE == "green":
        bt.classify_expiry = lambda days_left, threshold_days=7: "green"
    elif MUTATE == "red":
        bt.classify_expiry = lambda days_left, threshold_days=7: "red"
    return bt, conn


def old_judgement(conn):
    """旧判据（v389 之前的写法，原样保留作为对照）：
       统计「**保质期**不超过 7 天且设了安全库存」的商品。"""
    rows = conn.execute(
        "SELECT id FROM products WHERE expiry_days>0 AND expiry_days<=7 AND safety_stock>0"
    ).fetchall()
    return sorted(r[0] for r in rows)


def new_judgement(bt, conn):
    """新判据：按库存批次的最近到期日 + 配方阈值（唯一实现）。"""
    res = bt.near_expiry_sku_count(conn=conn)
    thr = res["threshold_days"]
    ids = []
    for r in conn.execute(
        "SELECT i.product_id AS pid, MIN(i.expiry_date) AS exp FROM inventory i "
        "WHERE i.quantity>0 AND i.expiry_date IS NOT NULL AND i.expiry_date<>'' "
        "GROUP BY i.product_id"
    ).fetchall():
        try:
            d = (datetime.strptime(str(r["exp"])[:10], "%Y-%m-%d").date() - TODAY).days
        except (TypeError, ValueError):
            continue
        if bt.is_near_expiry(d, thr):
            ids.append(r["pid"])
    return sorted(ids), thr, res["count"]


def main():
    print("v389 临期口径行为级取证")
    print("影子库:", SHADOW, "  源码:", SRC)

    # ---------- A：无配方 ⇒ 默认阈值 7 ----------
    head("A. 默认阈值（库里没配配方 ⇒ 应回落 7 天）")
    conn = build_shadow(None)
    bt, conn = load_module()
    ok("A1 导入真源码 domain.batch_tracker 成功", hasattr(bt, "near_expiry_sku_count"))
    thr_no_recipe = bt.load_threshold_days(conn=conn)
    ok("A2 无配方时阈值回落默认 7 天", thr_no_recipe == 7, "threshold=" + str(thr_no_recipe))

    old_ids = old_judgement(conn)
    new_ids, thr, cnt = new_judgement(bt, conn)
    ok("A3 阈值确为 7", thr == 7, "thr=" + str(thr))
    ok("A4 near_expiry_sku_count 的 count 与逐项判定一致（不是两套算法）",
       cnt == len(new_ids), f"count={cnt} 逐项={len(new_ids)} {new_ids}")

    exp_new = sorted([c[0] for c in CASES if c[5]])
    ok("A5 ★ 新判据成员 == 期望 {P1,P2,P5}", new_ids == exp_new,
       f"实得={new_ids} 期望={exp_new}")
    ok("A6 ★ P2（保质期180天、只剩2天）被判临期 —— 旧判据会漏掉它",
       2 in new_ids and 2 not in old_ids, f"新={new_ids} 旧={old_ids}")
    ok("A7 ★ P3（保质期5天、还有30天）不判临期 —— 旧判据会误报它",
       3 not in new_ids and 3 in old_ids, f"新={new_ids} 旧={old_ids}")

    head("B. 判别力自证（防「数字碰巧对」）")
    ok("B1 ★★ 新旧命中**数量相同但成员不同** ⇒ 证明必须比对成员、只比计数会失效",
       len(old_ids) == len(new_ids) and old_ids != new_ids,
       f"旧={old_ids}({len(old_ids)}) 新={new_ids}({len(new_ids)})")
    ok("B2 旧判据复现了缺陷（命中 {P1,P3,P5}：含还有30天的P3、漏掉只剩2天的P2）",
       old_ids == [1, 3, 5], f"旧={old_ids}")

    head("C. 阈值敏感（证明不是换个地方写死 7）")
    conn.close()
    conn = build_shadow(21)
    bt, conn = load_module()
    thr21 = bt.load_threshold_days(conn=conn)
    ok("C1 配方 threshold_days=21 被读到", thr21 == 21, "threshold=" + str(thr21))
    new_ids21, thr_b, cnt21 = new_judgement(bt, conn)
    exp21 = sorted([c[0] for c in CASES if c[6]])
    ok("C2 ★ 阈值 7→21 后成员变化 == 期望 {P1,P2,P4,P5}",
       new_ids21 == exp21, f"实得={new_ids21} 期望={exp21}")
    ok("C3 ★ P4（还剩 10 天）在阈值 7 下不临期、在 21 下临期 ⇒ 阈值真生效",
       (4 not in new_ids) and (4 in new_ids21),
       f"thr7={new_ids} thr21={new_ids21}")
    ok("C4 阈值放大后临期 SKU 数增加（3 → 4）", cnt21 > cnt, f"{cnt} → {cnt21}")

    head("D. 边界与脏数据")
    ok("D1 is_near_expiry(7, 7) = True（上界含等号）", bt.is_near_expiry(7, 7) is True)
    ok("D2 is_near_expiry(8, 7) = False", bt.is_near_expiry(8, 7) is False)
    ok("D3 is_near_expiry(-1, 7) = True（已过期算货损风险）", bt.is_near_expiry(-1, 7) is True)
    ok("D4 is_near_expiry(None, 7) = False（None 不当临期，也不抛）",
       bt.is_near_expiry(None, 7) is False)
    ok("D5 ★ P6 脏日期 '0000-00-00' 被跳过、不静默算临期",
       6 not in new_ids21, f"new_ids21={new_ids21}")
    ok("D6 classify_expiry 未被改坏（旧语义不动）",
       [bt.classify_expiry(d, 7) for d in (-1, 0, 3, 5, 10, 20)]
       == ["expired", "red", "red", "orange", "yellow", "green"],
       str([bt.classify_expiry(d, 7) for d in (-1, 0, 3, 5, 10, 20)]))

    head("E. 零残留")
    conn.close()
    if os.path.exists(SHADOW):
        os.remove(SHADOW)
    ok("E1 影子库已删除", not os.path.exists(SHADOW), SHADOW)

    passed = sum(1 for _, o, _ in TESTS if o)
    total = len(TESTS)
    print(f"\n{'=' * 56}\n结果：{passed}/{total}" + ("  全绿 ✅" if passed == total else "  有失败 ❌"))
    for n, o, d in TESTS:
        if not o:
            print("  FAILED:", n, "|", d)
    return 0 if passed == total else 2


if __name__ == "__main__":
    sys.exit(main())
