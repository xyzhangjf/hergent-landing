#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v689 后端探针：验证「新增商品」走 POST /api/products 时**字段真的落库**。

为什么必须真打接口查库（不能只看白名单）：
  `product_create` 的白名单里写着 30 个键，但白名单只是「允许」——
  能不能真进 INSERT、值有没有被归一化吃掉、barcode/category 这类列有没有被静默跳过，
  只有写进去再读出来才知道。而这类缺陷的表现是：接口 200、商品建出来了、
  界面上新填的别名/单位档位/业务范围**全是空**，没有任何报错。

探针做的事（全部可回滚）：
  1. 建一条带**全部 30 个字段**的商品（值全部用可识别的前缀）
  2. 逐列把库里的值与提交值比对
  3. 写一次价格矩阵（PUT /unit-prices）再读回
  4. 精确删除这条商品 + 它的价格矩阵行，自证残留 0

🔴 纪律：只动**自己建的那一条**（按 id 精确删），删后计数回到跑之前的数。
"""
import json
import secrets
import sqlite3
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8700"
DB_MAIN = "/opt/hergent-erp/erp.db"
DB_TENANT = "/opt/hergent-erp/tenant_1.db"
TENANT = "1"
MARK = "v689probe"

ok_n = 0
bad_n = 0


def ok(cond, label, extra=""):
    global ok_n, bad_n
    if cond:
        ok_n += 1
        print("  ✅ %s" % label)
    else:
        bad_n += 1
        print("  ❌ %s  %s" % (label, extra))


def make_session():
    token = MARK + "-" + secrets.token_hex(12)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    exp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() + 3600))
    c = sqlite3.connect(DB_MAIN)
    c.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at, ip_address, user_agent_hash, last_activity)"
        " VALUES (?,?,?,?,?,?,?)", (token, 2, now, exp, "127.0.0.1", "", now))
    c.commit()
    c.close()
    return token


def drop_session(token):
    c = sqlite3.connect(DB_MAIN)
    c.execute("DELETE FROM sessions WHERE token=?", (token,))
    c.commit()
    c.close()


def call(path, method="GET", body=None, token="", csrf=""):
    headers = {
        "Cookie": "erp_token=%s; hergent_auth=1; csrf_token=%s" % (token, csrf),
        "X-Tenant-Id": TENANT,
        "Accept": "application/json",
    }
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


# 提交值 —— 每一项都能在库里被认出（带前缀/非默认值），默认值一律不用
PAYLOAD = {
    "name": MARK + "-整箱纯甄200g",
    "barcode": "V6890001PROBE",
    "product_code": "PCODE-V689",
    "spec": "200g×12",
    "unit": "瓶",
    "medium_unit": "条",
    "medium_ratio": 6,
    "medium_barcode": "MB-V689",
    "large_unit": "箱",
    "large_ratio": 24,
    "large_barcode": "LB-V689",
    "brand": "蒙牛",
    "category": "液态奶",
    "alias": "纯甄,老纯甄",
    "sale_price": 4.5,
    "purchase_price": 3.2,
    "factory_price": 3.1,
    "dist_price": 3.8,
    "safety_stock": 12,
    "expiry_days": 21,
    "arrival_lead_days": 3,
    "description": MARK + "-探针备注",
    "order_seq": 7,
    "min_order_qty": 3,
    "can_sale": 1,
    "can_return": 0,          # ⚠️ 故意给 0：验证「0 不会被当成空值丢掉」
    "can_purchase": 1,
    "mobile_order_units": 5,   # bit0+bit2
    "default_purchase_unit": "箱",
    "default_sale_unit": "瓶",
    "default_gift_unit": "条",
    "order_unit": "箱",
}

NUM_INT = {"medium_ratio", "large_ratio", "safety_stock", "expiry_days", "arrival_lead_days",
           "order_seq", "min_order_qty", "can_sale", "can_return", "can_purchase", "mobile_order_units"}
NUM_FLOAT = {"sale_price", "purchase_price", "factory_price", "dist_price"}
TEXT = set(PAYLOAD) - NUM_INT - NUM_FLOAT


def main():
    ct = sqlite3.connect(DB_TENANT)
    n_before = ct.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    ct.close()
    cm = sqlite3.connect(DB_MAIN)
    s_before = cm.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    cm.close()

    token = make_session()
    csrf = secrets.token_hex(8)
    pid = 0
    try:
        print("\n1) POST /api/products 建一条全字段商品")
        st, d = call("/api/products", "POST", PAYLOAD, token, csrf)
        ok(st == 200, "接口 200（实际 %s）" % st, str(d)[:300])
        pid = int((d or {}).get("id") or 0)
        ok(pid > 0, "返回了新商品 id（实际 %s）" % pid, str(d)[:200])
        if not pid:
            raise SystemExit("拿不到 id，后续无法验证")

        print("\n2) 逐列比对：提交值 vs 库里值")
        ct = sqlite3.connect(DB_TENANT)
        ct.row_factory = sqlite3.Row
        row = ct.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        ct.close()
        ok(row is not None, "库里能查到这条商品")
        if row is None:
            raise SystemExit("查不到刚建的商品")
        r = dict(row)
        cols = set(r.keys())
        miss_col = []
        for k, want in PAYLOAD.items():
            if k not in cols:
                miss_col.append(k)
                continue
            got = r.get(k)
            if k in NUM_INT:
                good = (int(got or 0) == int(want))
            elif k in NUM_FLOAT:
                good = abs(float(got or 0) - float(want)) < 0.005
            else:
                good = (str(got or "") == str(want))
            ok(good, "%-22s 落库 = %r" % (k, got) if not good else "%-22s 落库正确" % k,
               "期望 %r 实际 %r" % (want, got))
        if miss_col:
            ok(False, "以下字段在 products 表里根本不存在：%s" % miss_col)

        print("\n3) 价格矩阵：PUT /unit-prices 再读回")
        items = [
            {"unit_level": 0, "unit_name": "瓶", "wholesale_price": 3.9, "retail_price": 4.5,
             "min_price": 3.5, "purchase_price": 3.1, "allow_reprice": 1, "allow_view_cost": 1},
            {"unit_level": 2, "unit_name": "箱", "wholesale_price": 90.0, "retail_price": 108.0,
             "min_price": 88.0, "purchase_price": 74.4, "allow_reprice": 0, "allow_view_cost": 1},
        ]
        st2, d2 = call("/api/products/%d/unit-prices" % pid, "PUT", {"items": items}, token, csrf)
        ok(st2 == 200, "写价格矩阵 200（实际 %s）" % st2, str(d2)[:200])
        st3, d3 = call("/api/products/%d/unit-prices" % pid, "GET", token=token, csrf=csrf)
        got_items = (d3 or {}).get("items") if isinstance(d3, dict) else None
        ok(st3 == 200 and isinstance(got_items, list), "读回价格矩阵（实际 %s）" % st3, str(d3)[:200])
        if isinstance(got_items, list):
            ok(len(got_items) == 2, "价格矩阵 2 行都写进去了（实际 %d）" % len(got_items))
            box = [x for x in got_items if int(x.get("unit_level") or 0) == 2]
            ok(bool(box) and abs(float(box[0].get("wholesale_price") or 0) - 90.0) < 0.005,
               "箱价 90 落库正确", str(box)[:200])
            ok(bool(box) and int(box[0].get("allow_reprice") or 0) == 0,
               "allow_reprice=0 不会被当成空值丢掉", str(box)[:160])

        print("\n4) 新增字段必须能出现在列表接口（否则建档了看不见）")
        st4, d4 = call("/api/products?keyword=%s&limit=5" % MARK, token=token, csrf=csrf)
        items4 = (d4 or {}).get("items") if isinstance(d4, dict) else []
        ok(st4 == 200 and any(int(x.get("id") or 0) == pid for x in (items4 or [])),
           "列表能按名称搜到这条商品", str(d4)[:200])

    finally:
        print("\n5) 清理（只删自己建的那一条）")
        if pid:
            ct = sqlite3.connect(DB_TENANT)
            # 先看有没有被别处引用（新商品不该有）
            for t in ("unit_prices", "product_unit_prices"):
                try:
                    ct.execute("DELETE FROM %s WHERE product_id=?" % t, (pid,))
                except Exception:
                    pass
            ct.execute("DELETE FROM products WHERE id=? AND name LIKE ?", (pid, MARK + "%"))
            ct.commit()
            left = ct.execute("SELECT COUNT(*) FROM products WHERE name LIKE ?", (MARK + "%",)).fetchone()[0]
            n_after = ct.execute("SELECT COUNT(*) FROM products").fetchone()[0]
            ct.close()
            ok(left == 0, "探针商品残留 0（实际 %d）" % left)
            ok(n_after == n_before, "products 行数回到跑之前（%d → %d）" % (n_before, n_after))
        drop_session(token)
        cm = sqlite3.connect(DB_MAIN)
        s_after = cm.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        resid = cm.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", (MARK + "%",)).fetchone()[0]
        cm.close()
        ok(resid == 0, "探针 session 残留 0（实际 %d）" % resid)
        ok(s_after == s_before, "sessions 行数回到跑之前（%d → %d）" % (s_before, s_after))

    print("\nv689 后端探针结果：%d 通过 / %d 失败" % (ok_n, bad_n))
    raise SystemExit(1 if bad_n else 0)


if __name__ == "__main__":
    main()
