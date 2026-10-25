# -*- coding: utf-8 -*-
"""v684 端点验收：自由退货的「商品不在该伙伴历史记录中」提醒。

用法（服务器上）：python3 /root/v684/verify_history.py

判据不是「接口 200」，而是与**直连 SQL 算出的 ground truth 逐项对照**：
  · 该供应商确实采购过的商品 ⇒ 必须 matched
  · 该供应商从没采购过的商品 ⇒ 必须 missing
  · **同一批商品换一个伙伴查 ⇒ 结论必须变化**（否则等于"谁问都说有"）
临时会话插主库 erp.db 的 sessions，测完 DELETE 并自证残留 0。
"""
import datetime
import json
import sqlite3
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8700"
TOKEN = "v684probe-%d" % int(datetime.datetime.now().timestamp())
ERP = "/opt/hergent-erp/erp.db"
TENANT = "/opt/hergent-erp/tenant_1.db"

_ok = _bad = 0


def ok(name, cond, extra=""):
    global _ok, _bad
    if cond:
        _ok += 1
        print("  PASS  %s" % name)
    else:
        _bad += 1
        print("  FAIL  %s   -> %r" % (name, extra))


def http(path, token=TOKEN):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            body = json.loads(body)
        except Exception:
            pass
        return e.code, body


def seed_session():
    c = sqlite3.connect(ERP)
    u = c.execute("SELECT id, username FROM users WHERE role IN ('boss','admin') LIMIT 1").fetchone()
    if not u:
        raise SystemExit("没有 boss/admin 用户，放弃")
    now = datetime.datetime.now()
    c.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
              (TOKEN, u[0], now.strftime("%Y-%m-%d %H:%M:%S"),
               (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")))
    c.commit()
    c.close()
    print("临时会话: user_id=%s username=%s" % (u[0], u[1]))


def drop_session():
    c = sqlite3.connect(ERP)
    n = c.execute("DELETE FROM sessions WHERE token LIKE 'v684probe-%'").rowcount
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE 'v684probe-%'").fetchone()[0]
    total = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    c.close()
    print("清理临时会话: 删 %d 行，残留 %d，sessions 总数 %d" % (n, left, total))
    return left


SKIP = ("draft", "cancelled", "void", "rejected")


def truth_purchase(db, sup):
    q = ("SELECT DISTINCT i.product_id FROM purchase_order_items i "
         "JOIN purchase_orders o ON o.id=i.order_id "
         "WHERE o.supplier_id=? AND COALESCE(o.status,'') NOT IN (%s)"
         % ",".join("?" * len(SKIP)))
    return {r[0] for r in db.execute(q, [sup] + list(SKIP))}


def truth_sale(db, cust):
    q = ("SELECT DISTINCT i.product_id FROM sale_order_items i "
         "JOIN sale_orders o ON o.id=i.order_id "
         "WHERE o.customer_id=? AND COALESCE(o.status,'') NOT IN (%s)"
         % ",".join("?" * len(SKIP)))
    return {r[0] for r in db.execute(q, [cust] + list(SKIP))}


def main():
    seed_session()
    try:
        db = sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
        allp = [r[0] for r in db.execute("SELECT id FROM products ORDER BY id")]
        sups = [r[0] for r in db.execute(
            "SELECT supplier_id, COUNT(*) c FROM purchase_orders "
            "WHERE COALESCE(status,'') NOT IN ('draft','cancelled') "
            "GROUP BY supplier_id ORDER BY c DESC").fetchall()]
        if not sups:
            print("SKIP: 该租户没有有效采购单")
            return 0
        print("=== A. 采购侧：与直连 SQL 对照")
        sup_a = sups[0]
        hit_a = truth_purchase(db, sup_a)
        miss_a = [p for p in allp if p not in hit_a]
        # 反证伙伴：另一个供应商（其历史与 sup_a 必然不同）
        sup_b = sups[1] if len(sups) > 1 else 0
        print("  供应商 A=%s 历史商品 %d 个；全部商品 %d 个" % (sup_a, len(hit_a), len(allp)))
        ids = (sorted(hit_a)[:4] + miss_a[:4])
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=%s&product_ids=%s"
                     % (sup_a, ",".join(str(x) for x in ids)))
        ok("HTTP 200", st == 200, (st, r))
        matched = set(r.get("matched") or [])
        missing = set(r.get("missing") or [])
        ok("A 采购过的商品全部判 matched",
           set(sorted(hit_a)[:4]) <= matched, sorted(matched))
        ok("A 没采购过的商品全部判 missing",
           set(miss_a[:4]) <= missing, sorted(missing))
        ok("matched/missing 互斥且并集 = 入参",
           not (matched & missing) and (matched | missing) == set(ids),
           (sorted(matched), sorted(missing)))

        if sup_b:
            st2, r2 = http("/api/psi/partner-product-history?kind=purchase&partner_id=%s&product_ids=%s"
                           % (sup_b, ",".join(str(x) for x in ids)))
            # 同一批商品换伙伴 ⇒ 结论必须不同（否则等于"谁问都说有/都没有"）
            ok("换供应商后结论发生变化（不是恒真/恒假）",
               st2 == 200 and set(r2.get("matched") or []) != matched,
               (sorted(r2.get("matched") or []), sorted(matched)))

        print("=== B. 销售侧：与直连 SQL 对照")
        custs = [r[0] for r in db.execute(
            "SELECT customer_id, COUNT(*) c FROM sale_orders "
            "WHERE COALESCE(status,'') NOT IN ('draft','cancelled') "
            "GROUP BY customer_id ORDER BY c DESC LIMIT 1").fetchall()]
        if custs:
            cust = custs[0]
            hit_s = truth_sale(db, cust)
            miss_s = [p for p in allp if p not in hit_s]
            sids = sorted(hit_s)[:3] + miss_s[:3]
            st, r = http("/api/psi/partner-product-history?kind=sale&partner_id=%s&product_ids=%s"
                         % (cust, ",".join(str(x) for x in sids)))
            ok("销售侧 HTTP 200", st == 200, (st, r))
            ok("客户买过的商品判 matched", set(sorted(hit_s)[:3]) <= set(r.get("matched") or []),
               sorted(r.get("matched") or []))
            ok("客户没买过的商品判 missing", set(miss_s[:3]) <= set(r.get("missing") or []),
               sorted(r.get("missing") or []))
            ok("kind=sale 原样回传", r.get("kind") == "sale", r.get("kind"))
        else:
            print("  SKIP  该租户无有效销售单")

        print("=== C. 边界")
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=0&product_ids=1,2")
        ok("没选供应商 ⇒ skipped=True 且 missing 为空",
           st == 200 and r.get("skipped") is True and not (r.get("missing") or []), r)
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=%s&product_ids=" % sup_a)
        ok("没给商品 ⇒ checked=0 / skipped=True",
           st == 200 and r.get("checked") == 0 and r.get("skipped") is True, r)
        st, r = http("/api/psi/partner-product-history?kind=zzz&partner_id=%s&product_ids=1" % sup_a)
        ok("非法 kind ⇒ 归一到 purchase（不报错）", st == 200 and r.get("kind") == "purchase",
           (st, r.get("kind")))
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=999999&product_ids=1,2")
        ok("不存在的伙伴 ⇒ 全部 missing（不是 500）",
           st == 200 and set(r.get("missing") or []) == {1, 2}, (st, r))
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=%s&product_ids=abc,-3,0"
                     % sup_a)
        ok("非法商品 id 被丢弃 ⇒ checked=0", st == 200 and r.get("checked") == 0, (st, r))
        st, r = http("/api/psi/partner-product-history?kind=purchase&partner_id=%s&product_ids=1" % sup_a,
                     token=None)
        ok("无令牌 ⇒ 401", st == 401, st)
        db.close()
    finally:
        left = drop_session()
        ok("临时会话残留 0", left == 0, left)

    print("\n=== 结果: %d PASS / %d FAIL ===" % (_ok, _bad))
    return 1 if _bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
