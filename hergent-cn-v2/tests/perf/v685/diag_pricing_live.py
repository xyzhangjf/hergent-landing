# -*- coding: utf-8 -*-
"""v685 诊断：真实 tenant_1 商品的定价接口返回什么（用户反馈「单位还是不能选」）。

只读 + 一条临时会话（跑完删）。不写任何业务表。
"""
import datetime
import json
import sqlite3
import urllib.request

BASE = "http://127.0.0.1:8700"
TOKEN = "v685diag-%d" % int(datetime.datetime.now().timestamp())
ERP = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"


def http(path, token=TOKEN):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    req.add_header("X-Tenant-Id", "1")
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


def main():
    c = sqlite3.connect(ERP)
    u = c.execute("select id, username, role from users where role in ('boss','admin') limit 1").fetchone()
    now = datetime.datetime.now()
    c.execute("insert into sessions (token,user_id,created_at,expires_at) values (?,?,?,?)",
              (TOKEN, u[0], now.strftime("%Y-%m-%d %H:%M:%S"),
               (now + datetime.timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")))
    c.commit()
    c.close()
    print("临时会话 user_id=%s username=%s" % (u[0], u[1]))

    t = sqlite3.connect("file:%s?mode=ro" % T1, uri=True)
    t.row_factory = sqlite3.Row
    cols = [r[1] for r in t.execute("pragma table_info(products)")]
    has_def = "default_purchase_unit" in cols
    rows = t.execute("select * from products limit 5000").fetchall()

    multi = []
    for r in rows:
        names = set()
        for k in ("unit", "medium_unit", "large_unit"):
            v = str(r[k] or "").strip() if k in cols else ""
            if v:
                names.add(v)
        if len(names) >= 2:
            multi.append(r)
    print("tenant_1 商品总数 %d，其中 >=2 种不同单位名 %d 个" % (len(rows), len(multi)))

    if not multi:
        print("!! 没有多档商品 -> 前端下拉只会有一档")
        t.close()
        return

    for r in multi[:5]:
        pid = r["id"]
        print("\n-- 商品 %s %s | unit=%r medium=%r/%r large=%r/%r order_unit=%r default_purchase=%r"
              % (pid, r["name"], r["unit"] if "unit" in cols else "",
                 r["medium_unit"] if "medium_unit" in cols else "",
                 r["medium_ratio"] if "medium_ratio" in cols else "",
                 r["large_unit"] if "large_unit" in cols else "",
                 r["large_ratio"] if "large_ratio" in cols else "",
                 r["order_unit"] if "order_unit" in cols else "",
                 r["default_purchase_unit"] if has_def else "N/A"))
        for kind in ("purchase", "sale"):
            s, d = http("/api/psi/product-pricing?product_id=%s&kind=%s" % (pid, kind))
            if s != 200:
                print("   %-8s HTTP %s %s" % (kind, s, str(d)[:180]))
                continue
            opts = d.get("unit_options") or []
            print("   %-8s default_unit=%r price_source=%r" % (kind, d.get("default_unit"), d.get("price_source")))
            for o in opts:
                print("            %-8r price=%-8s source=%s ratio=%s" %
                      (o.get("name"), o.get("price"), o.get("price_source"), o.get("ratio")))
            if not opts:
                print("            !! unit_options 为空 -> 前端下拉出不来")

    # refs 接口里 unit_options 长什么样（前端兜底分支会用这个）
    s, d = http("/api/psi/refs?kind=products&limit=5")
    lst = (d or {}).get("products") or []
    print("\n-- refs products 样本（前端 catch 兜底用）")
    for p in lst[:3]:
        print("   ", p.get("name"), "| unit_options =", json.dumps(p.get("unit_options"), ensure_ascii=False)[:160])
    t.close()

    c = sqlite3.connect(ERP)
    c.execute("delete from sessions where token=?", (TOKEN,))
    c.commit()
    c.close()
    print("\n临时会话已删")


main()
