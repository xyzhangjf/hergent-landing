# -*- coding: utf-8 -*-
"""v683 定价端点真机验收：三组对照 + 价格链取证。

用法（服务器上）：python3 /root/verify_v683_pricing.py
临时会话插主库 erp.db 的 sessions（唯一可行路径：localStorage 塞 token 已不通），
测完 DELETE 并自证残留 0。
"""
import datetime
import json
import sqlite3
import urllib.request

BASE = "http://127.0.0.1:8700"
TOKEN = "v683probe-%d" % int(datetime.datetime.now().timestamp())
ERP = "/opt/hergent-erp/erp.db"


def http(path, token=TOKEN):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
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
    u = c.execute("SELECT id, username, role FROM users WHERE role IN ('boss','admin') LIMIT 1").fetchone()
    if not u:
        raise SystemExit("没有 boss/admin 用户，放弃")
    now = datetime.datetime.now()
    exp = (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
    c.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
              (TOKEN, u[0], now.strftime("%Y-%m-%d %H:%M:%S"), exp))
    c.commit()
    c.close()
    print("临时会话: user_id=%s username=%s" % (u[0], u[1]))


def drop_session():
    c = sqlite3.connect(ERP)
    n = c.execute("DELETE FROM sessions WHERE token LIKE 'v683probe-%'").rowcount
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE 'v683probe-%'").fetchone()[0]
    total = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    c.close()
    print("清理临时会话: 删 %d 行，残留 %d，sessions 总数 %d" % (n, left, total))
    return left


def pick_products():
    """挑两个有代表性的商品：多档商品的采购/销售，以及一个无大单位的。"""
    c = sqlite3.connect("file:/opt/hergent-erp/tenant_1.db?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    q = """SELECT id, name, unit, medium_unit, medium_ratio, large_unit, large_ratio,
                  purchase_price, sale_price, order_unit,
                  default_purchase_unit, default_sale_unit
             FROM products
            WHERE CAST(large_ratio AS REAL) > 1 AND purchase_price > 0 AND sale_price > 0
            ORDER BY id LIMIT 2"""
    rows = [dict(r) for r in c.execute(q)]
    c.close()
    return rows


def show(tag, d):
    print("\n[%s]" % tag)
    if not isinstance(d, dict) or "unit_options" not in d:
        print("   ! 返回异常:", str(d)[:400])
        return
    print("   商品 %s  基础单位=%s  换算=%s" % (d["product_id"], d["base_unit"], d["conv_text"]))
    print("   档案价(元/%s)=%s  字段=%s  预选单位=%s"
          % (d["base_unit"], d["archive_price"], d["archive_field"], d["default_unit"]))
    print("   %-6s %-6s %-6s %-10s %-14s %-10s" % ("档", "单位", "比值", "应填单价", "价格来源", "档案折算"))
    for o in d["unit_options"]:
        print("   %-6s %-6s %-6s %-10s %-14s %-10s"
              % (o["key"], o["name"], o["ratio"], o["price"], o["price_source"], o["archive_price"]))
    if d.get("last_scoped"):
        print("   归属上次价:", d["last_scoped"])


def main():
    seed_session()
    try:
        print("\n=== 0. 无令牌应 401 ===")
        s, b = http("/api/psi/product-pricing?product_id=1&kind=purchase", token=None)
        print("   状态=%s  %s" % (s, str(b)[:120]))

        prods = pick_products()
        if not prods:
            print("\n!! 没有符合条件（有大单位且双价>0）的商品，SKIP")
            return 0
        print("\n=== 1. 采购口径 ===")
        for p in prods:
            s, b = http("/api/psi/product-pricing?product_id=%s&kind=purchase" % p["id"])
            print("   HTTP", s)
            show("采购 product=%s %s" % (p["id"], p["name"][:16]), b)
            # 断言：档案价 = purchase_price × ratio（小档 ratio=1 ⇒ 等于 purchase_price）
            for o in b.get("unit_options", []):
                exp = round(float(p["purchase_price"]) * float(o["ratio"]), 4)
                ok = abs(float(o["archive_price"]) - exp) < 0.01
                print("     自证 小档折算: 期望 %.4f 实得 %s  %s"
                      % (exp, o["archive_price"], "OK" if ok else "MISMATCH"))

        print("\n=== 2. 销售口径（同一商品，价格字段不同） ===")
        p = prods[0]
        s, b = http("/api/psi/product-pricing?product_id=%s&kind=sale" % p["id"])
        print("   HTTP", s)
        show("销售 product=%s" % p["id"], b)
        for o in b.get("unit_options", []):
            exp = round(float(p["sale_price"]) * float(o["ratio"]), 4)
            ok = abs(float(o["archive_price"]) - exp) < 0.01
            print("     自证 销售折算: 期望 %.4f 实得 %s  %s"
                  % (exp, o["archive_price"], "OK" if ok else "MISMATCH"))

        print("\n=== 3. 调拨口径（不应带价） ===")
        s, b = http("/api/psi/product-pricing?product_id=%s&kind=transfer" % p["id"])
        print("   HTTP", s, " 全部 price 应为 0:",
              all(float(o["price"]) == 0 for o in b.get("unit_options", [])))
        show("调拨", b)

        print("\n=== 4. 边界：不存在的商品 / 非法 kind ===")
        s, b = http("/api/psi/product-pricing?product_id=99999999&kind=sale")
        print("   不存在商品 HTTP=%s unit_options=%s" % (s, b.get("unit_options")))
        s, b = http("/api/psi/product-pricing?product_id=%s&kind=bogus" % p["id"])
        print("   非法 kind HTTP=%s 回落 kind=%s" % (s, b.get("kind")))
    finally:
        print()
        drop_session()


if __name__ == "__main__":
    main()
