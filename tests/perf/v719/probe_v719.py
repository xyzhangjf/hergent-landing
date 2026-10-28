#!/usr/bin/env python3
"""v719 探针：负库存生效 + 库存台账补记 —— 库级 / 代码级 / 接口级三层验证

跑法（在生产机上）：
    python3 tests/perf/v719/probe_v719.py

退出码 0 = 全过；1 = 有 FAIL。
"""
import json
import secrets
import sqlite3
import sys
import datetime
import urllib.request

BASE = "/opt/hergent-erp"
TENANT = BASE + "/tenant_1.db"
MAIN = BASE + "/erp.db"

ok = fail = 0


def chk(cond, label, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print("  PASS  %-48s %s" % (label, detail))
    else:
        fail += 1
        print("  FAIL  %-48s %s" % (label, detail))


def sec(t):
    print("\n" + "-" * 74)
    print(t)
    print("-" * 74)


# ==================================================================== 库级
def db_checks():
    sec("一、库级：库存台账 vs 流水，以及 GL 是否被影响")
    c = sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
    c.row_factory = sqlite3.Row

    inv = c.execute("SELECT COALESCE(SUM(quantity),0) FROM inventory").fetchone()[0]
    lg = c.execute("SELECT COALESCE(SUM(change_qty),0) FROM inventory_logs").fetchone()[0]
    print("  inventory 合计 %.2f" % inv)
    print("  logs      合计 %.2f" % lg)
    # 已知：商品 2435 在仓1 有一行 10 的 opening 孤儿流水（商品已不存在）
    chk(abs(inv - lg) <= 10.01, "台账-流水 差 <= 10（已知孤儿流水）", "差 %.2f" % (inv - lg))

    per = c.execute("""
        SELECT i.product_id pid, i.warehouse_id wid, SUM(i.quantity) qi,
               COALESCE((SELECT SUM(l.change_qty) FROM inventory_logs l
                          WHERE l.product_id=i.product_id
                            AND l.warehouse_id=i.warehouse_id),0) ql
          FROM inventory i GROUP BY i.product_id, i.warehouse_id
        HAVING ABS(SUM(i.quantity) - COALESCE((SELECT SUM(l.change_qty) FROM inventory_logs l
                          WHERE l.product_id=i.product_id
                            AND l.warehouse_id=i.warehouse_id),0)) > 0.01
    """).fetchall()
    chk(len(per) == 0, "逐商品-仓 余额==流水", "不符 %d 组" % len(per))

    neg = c.execute("SELECT COUNT(*) FROM inventory WHERE quantity < 0").fetchone()[0]
    print("  负库存行 %d" % neg)
    chk(neg > 0, "负库存已产生（= 进货缺口的量化）", "%d 行" % neg)

    comp = {r["ref_type"]: r for r in c.execute(
        "SELECT ref_type, COUNT(*) n, ROUND(SUM(change_qty),0) q FROM inventory_logs GROUP BY 1")}
    for k in ("opening", "v718_backfill", "sale_history"):
        chk(k in comp, "流水含 %s" % k,
            ("%d 行 / %s" % (comp[k]["n"], comp[k]["q"])) if k in comp else "缺失")

    # GL 一行都没动。88,874 = 88,776（v717）+ 98（v718 补的 49 张采购单 × 2 行凭证）。
    # 🔴 这里**不能**再写 88,776 —— 那是 v717 时的值，写死旧值会让「本补丁没动 GL」
    #    这条判据在 v718 之后永久 FAIL，而 FAIL 的原因其实是判据自己过期了
    #    （v717 那次 --verify 两个假 FAIL 同一族：把说明文字当代码）。
    jt = c.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
    print("  journal_entries 行数 %d（88,776 @v717 + 98 @v718）" % jt)
    chk(jt == 88874, "GL 未被本补丁改动", "%d 行" % jt)

    bad = c.execute("""SELECT COUNT(*) FROM (SELECT voucher_no,
        ROUND(SUM(debit)-SUM(credit),2) d FROM journal_entries
        GROUP BY voucher_no HAVING ABS(d)>0.005)""").fetchone()[0]
    chk(bad == 0, "不平凭证 0（按 voucher_no 汇总）", "%d" % bad)
    c.close()


# ==================================================================== 代码级
def code_checks():
    sec("二、代码级：allow_neg_inv 是否真的被读")
    sys.path.insert(0, BASE)
    from db.connection import set_tenant_context, get_db
    set_tenant_context(1)
    from db.queries.inventory import _allow_neg_inv
    import db.queries.sales as SAL
    import inspect

    with get_db() as db:
        for wid, name in ((1, "临期仓"), (3, "总仓"), (7, "刘小顶仓"), (9, "刘善涛仓")):
            chk(_allow_neg_inv(db, wid) is True, "仓%d %s 读成「允许」" % (wid, name))
        chk(_allow_neg_inv(db, 999) is False, "仓999 不存在 ⇒ fail-closed")

    chk(hasattr(SAL, "_allow_neg_inv"), "sales.py 已引入 _allow_neg_inv")
    src = inspect.getsource(SAL.sale_order_deliver)
    chk("shortage_warnings" in src, "sale_order_deliver 返回 shortage_warnings")
    chk("_allow_neg_inv(db, o[" in src, "缺货按仓配置判定（不再一刀切拦截）")

    import db.queries.inventory as INV
    isrc = inspect.getsource(INV.fefo_deduct)
    chk("allow_neg = _allow_neg_inv" in isrc, "fefo_deduct 读 allow_neg")
    chk("if remaining > 0:" in isrc, "fefo_deduct 有负库存补扣分支")
    asrc = inspect.getsource(INV.inventory_adjust)
    chk("_allow_neg_inv(db, warehouse_id)" in asrc, "inventory_adjust 读 allow_neg")


# ==================================================================== 接口级
def api_checks():
    sec("三、接口级：三表没被破坏 + 库存接口可用")
    tok = "v719probe" + secrets.token_hex(8)
    now = datetime.datetime.now()
    exp = (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
    m = sqlite3.connect(MAIN)
    m.execute("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
              (tok, 1, now.strftime("%Y-%m-%d %H:%M:%S"), exp))
    m.commit()
    m.close()

    def get(p):
        req = urllib.request.Request(
            "http://127.0.0.1:8700" + p,
            headers={"Authorization": "Bearer " + tok, "X-Tenant-Id": "1"})
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode())

    try:
        bs = get("/api/reports/balance-sheet")
        chk(bs.get("balanced") is True, "资产负债表 balanced=true", str(bs.get("balanced")))
        up = float(bs.get("unclosed_profit") or 0)
        tot = 0.0
        for mm in range(1, 11):
            tot += float(get("/api/reports/pnl?month=2026-%02d" % mm).get("net_profit") or 0)
        chk(abs(tot - up) < 0.02, "逐月净利合计 == unclosed_profit",
            "%.2f / %.2f" % (tot, up))

        for path, label in (("/api/inventory?limit=5&offset=0", "库存列表"),
                            ("/api/inventory/low-stock", "低库存")):
            try:
                get(path)
                chk(True, "%s 200" % label)
            except Exception as e:
                chk(False, "%s 200" % label, str(e)[:40])
    finally:
        m = sqlite3.connect(MAIN)
        m.execute("DELETE FROM sessions WHERE token=?", (tok,))
        m.commit()
        left = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (tok,)).fetchone()[0]
        m.close()
        chk(left == 0, "临时会话已清理，残留 0", "%d" % left)


def main():
    print("=" * 74)
    print("v719 探针    %s" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print("=" * 74)
    db_checks()
    code_checks()
    api_checks()
    print("\n" + "=" * 74)
    print("结果: PASS %d / FAIL %d" % (ok, fail))
    print("=" * 74)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
