#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 写链路探针：**建单带业务员（handler）真的落库**，然后**精确删除**。

为什么值得单独跑一次：`handler` 走的是「有值才进 INSERT」的动态列拼装
（`sale_order_create` / `return_order_create` / `purchase_return_create` 三处），
这类写法**列名拼错、参数没接上、或者在 db 层被丢掉**，表现全都是
「接口 200、单据建成功、只是那个字段恒为空」—— 零报错，肉眼几乎发现不了。
所以必须建一张真单、回读库、再删掉。

🔴 安全性：三张单都用**草稿**语义，不动库存、不动应收、不影响任何账：
   · 销售退货 `draft=true` ⇒ 只落单
   · 销售订单 `create_sale` 建的是 draft 状态（发货才扣库存）
   · 采购退货 `draft=true` ⇒ 只落单
   建完立刻按 id + note 标记精确删除，并自证「标记行 = 0」。
"""
import json
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8700"
TDB = "/opt/hergent-erp/tenant_1.db"
DB = "/opt/hergent-erp/erp.db"
MARK = "E2E-v686-probe"
UID_TEST = 999903
UNAME_TEST = "微信审核-销售"
TENANT = "1"

ok_n = 0
bad_n = 0


def ok(cond, label, extra=""):
    global ok_n, bad_n
    if cond:
        ok_n += 1
        print(f"  ✅ {label}")
    else:
        bad_n += 1
        print(f"  ❌ {label}  {extra}")


def make_session():
    token = "v686probe-" + secrets.token_hex(12)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 3600))
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO sessions (token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity)"
              " VALUES (?,?,?,?,?,?,?)", (token, 2, now, exp, "127.0.0.1", "", now))
    c.commit()
    c.close()
    return token


def call(path, method="GET", body=None, token="", csrf=""):
    headers = {"Cookie": f"erp_token={token}; hergent_auth=1; csrf_token={csrf}",
               "X-Tenant-Id": TENANT, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw[:1] in "[{" else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def main():
    token = make_session()
    csrf = secrets.token_hex(8)
    made = []          # [(表, id, 子表, 子表外键列)]
    try:
        # 取一个商品 + 仓库 + 客户
        st, d = call("/api/psi/refs?kind=warehouses,customers,products", token=token, csrf=csrf)
        whs = (d or {}).get("warehouses") or []
        custs = (d or {}).get("customers") or []
        prods = (d or {}).get("products") or []
        ok(bool(whs and custs and prods), f"基础资料可用（仓 {len(whs)} / 客户 {len(custs)} / 商品 {len(prods)}）")
        if not (whs and custs and prods):
            return 1
        wid = int(whs[0]["id"])
        cid = int(custs[0]["id"])
        pid = int(prods[0]["id"])
        pname = prods[0].get("name") or ""

        # ── 1) 销售退货（草稿）带业务员 ─────────────────────────────
        print("\n1) 销售退货草稿 handler 落库")
        body = {"customer_id": cid, "warehouse_id": wid, "reason": MARK,
                "note": MARK, "order_date": time.strftime("%Y-%m-%d"),
                "handler": str(UID_TEST), "draft": True,
                "items": [{"product_id": pid, "product_name": pname, "quantity": 1, "unit_price": 1}]}
        st, r = call("/api/psi/sale-return-orders", "POST", body, token, csrf)
        rid = int((r or {}).get("return_id") or (r or {}).get("id") or 0) if isinstance(r, dict) else 0
        ok(st == 200 and rid > 0, f"建退货草稿成功（{st}，id={rid}）", str(r)[:220])
        if rid:
            made.append(("return_orders", rid, "return_order_items", "return_id"))
            c = sqlite3.connect(TDB)
            row = c.execute("SELECT handler, status FROM return_orders WHERE id=?", (rid,)).fetchone()
            c.close()
            ok(row is not None and str(row[0] or "") == str(UID_TEST),
               f"库里 handler = {UID_TEST}（实际 {row[0] if row else 'None'}）")
            ok(row is not None and row[1] == "draft", f"状态是草稿（实际 {row[1] if row else '?'}）")

        # ── 2) 销售订单 带业务员 ───────────────────────────────────
        print("\n2) 销售订单 handler 落库")
        body = {"customer_id": cid, "warehouse_id": wid, "note": MARK,
                "order_type": "self_pickup", "handler": str(UID_TEST),
                "idempotency_key": "v686-" + secrets.token_hex(6),
                "items": [{"product_id": pid, "quantity": 1, "unit_price": 1, "unit": ""}]}
        st, r = call("/api/psi/sale-orders", "POST", body, token, csrf)
        oid = int((r or {}).get("order_id") or (r or {}).get("id") or 0) if isinstance(r, dict) else 0
        ok(st == 200 and oid > 0, f"建销售订单成功（{st}，id={oid}）", str(r)[:220])
        if oid:
            made.append(("sale_orders", oid, "sale_order_items", "order_id"))
            c = sqlite3.connect(TDB)
            row = c.execute("SELECT handler FROM sale_orders WHERE id=?", (oid,)).fetchone()
            c.close()
            ok(row is not None and str(row[0] or "") == str(UID_TEST),
               f"库里 handler = {UID_TEST}（实际 {row[0] if row else 'None'}）")

        # ── 3) 采购退货（草稿）带业务员 ─────────────────────────────
        print("\n3) 采购退货草稿 handler 落库")
        st, d = call("/api/psi/refs?kind=suppliers", token=token, csrf=csrf)
        sups = (d or {}).get("suppliers") or []
        ok(bool(sups), f"供应商可用（{len(sups)}）")
        if sups:
            body = {"supplier_id": int(sups[0]["id"]), "warehouse_id": wid, "reason": MARK,
                    "note": MARK, "order_date": time.strftime("%Y-%m-%d"),
                    "handler": str(UID_TEST), "draft": True,
                    "items": [{"product_id": pid, "product_name": pname, "quantity": 1, "unit_price": 1}]}
            st, r = call("/api/psi/purchase-return-orders", "POST", body, token, csrf)
            prid = int((r or {}).get("id") or (r or {}).get("return_id") or 0) if isinstance(r, dict) else 0
            ok(st == 200 and prid > 0, f"建采购退货草稿成功（{st}，id={prid}）", str(r)[:220])
            if prid:
                made.append(("purchase_returns", prid, "purchase_return_items", "return_id"))
                c = sqlite3.connect(TDB)
                row = c.execute("SELECT handler FROM purchase_returns WHERE id=?", (prid,)).fetchone()
                c.close()
                ok(row is not None and str(row[0] or "") == str(UID_TEST),
                   f"库里 handler = {UID_TEST}（实际 {row[0] if row else 'None'}）")

        # ── 4) 列表显示姓名（不是 id） ─────────────────────────────
        print("\n4) 列表把 id 翻成姓名")
        st, d = call("/api/psi/sale-orders?limit=20", token=token, csrf=csrf)
        rows = (d or {}).get("orders") or (d or {}).get("rows") or (d if isinstance(d, list) else [])
        hit = [x for x in rows if str(x.get("note") or "") == MARK] if isinstance(rows, list) else []
        if not hit:
            st, d = call("/api/psi/sale-return-orders?limit=20", token=token, csrf=csrf)
            rows = (d or {}).get("rows") or []
            hit = [x for x in rows if str(x.get("note") or "") == MARK]
        ok(len(hit) > 0, f"列表里找到探针单（{len(hit)} 张）")
        if hit:
            ok(hit[0].get("handler_name") == UNAME_TEST,
               f"handler_name 解析成姓名「{UNAME_TEST}」（实际 {hit[0].get('handler_name')!r}）")
    finally:
        # ── 精确删除，并自证删干净 ─────────────────────────────────
        c = sqlite3.connect(TDB)
        for tbl, rid, child, fk in made:
            c.execute(f"DELETE FROM {child} WHERE {fk}=?", (rid,))
            c.execute(f"DELETE FROM {tbl} WHERE id=?", (rid,))
        c.commit()
        left = {}
        for tbl, rid, child, fk in made:
            left[tbl] = c.execute(f"SELECT count(*) FROM {tbl} WHERE id=?", (rid,)).fetchone()[0]
        mark_left = 0
        for t, col in (("sale_orders", "note"), ("return_orders", "note"), ("purchase_returns", "note")):
            try:
                mark_left += c.execute(f"SELECT count(*) FROM {t} WHERE {col}=?", (MARK,)).fetchone()[0]
            except Exception:
                pass
        c.close()
        d = sqlite3.connect(DB)
        d.execute("DELETE FROM sessions WHERE token=?", (token,))
        d.commit()
        sess = d.execute("SELECT count(*) FROM sessions WHERE token LIKE 'v686probe-%'").fetchone()[0]
        d.close()
        print(f"\n清理：删除 {len(made)} 张探针单，残留 id {left}，标记行 {mark_left}，探针 session {sess}")
        ok(all(v == 0 for v in left.values()) and mark_left == 0 and sess == 0, "探针数据已清理干净")

    print(f"\n结果：{ok_n} 通过 / {bad_n} 失败")
    return 1 if bad_n else 0


if __name__ == "__main__":
    sys.exit(main())
