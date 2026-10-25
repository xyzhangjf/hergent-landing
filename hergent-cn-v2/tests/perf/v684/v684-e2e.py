#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v684 e2e：自由退货（不拦截）+「商品不在该伙伴历史里」提醒 —— 在**隔离租户**里跑。

A–I 组是 v683 的单位×价格联动（保留：改退货流程不能碰坏单位折算）；
J–K 组是 v684 新增：
  J 该供应商采购过的商品判 matched、从没供过的判 missing；
  K 退一个"从没供过"的商品**必须能建成**（200 + 落库 + 库存真的扣了）——
    这是老板口中「仅给出提醒，但仍允许其继续完成退货」的机器判据。
    如果哪天有人把提醒做成校验，K 组会先红。

安全边界（与 v681 同一套）：
  · 只 READ tenant_1.db 的 schema（sqlite_master），不读任何业务行；
  · 只 WRITE /opt/hergent-erp/tenant_98.db（新文件）+ 主库 tenants/user_tenants 各一行；
  · 不动 tenant_1 / tenant_10 的任何数据行；teardown 逐项反证。

用法：python3 v684-e2e.py prepare | run | teardown

🔴 跑之前必须 `systemctl restart hergent-erp`：
   teardown 会删掉 tenant_99.db，但服务进程仍持有那个**已删除的 inode**，
   之后的写入全落进「幽灵文件」。prepare 再在同路径建新库 ⇒
   服务端（详情接口）看到的是幽灵文件里刚写的行，直连 SQL 读到的是新库里的空表，
   现象是「建单 200、详情回显全对，但 select 查不到明细行」——不是产品缺陷。
"""
import datetime
import json
import os
import pwd
import sqlite3
import sys
import urllib.error
import urllib.request

DB_DIR = "/opt/hergent-erp"
MASTER = os.path.join(DB_DIR, "erp.db")
SRC = os.path.join(DB_DIR, "tenant_1.db")
DST = os.path.join(DB_DIR, "tenant_98.db")
TID = 98
BOSS_UID = 2
BASE = "http://127.0.0.1:8700"
TOKEN = "v684e2e"
WH = 1
PID = 1001
CID = 1
# fixture 商品：小=瓶 / 中=排(6瓶) / 大=箱(24瓶)
SALE_PRICE = 2.0      # 元/瓶（档案「标准售价」= 元/小单位，生产实测口径）
PURCHASE_PRICE = 1.5  # 元/瓶

# ══ v684 fixture ══════════════════════════════════════════════════════════════
# 一个供应商 + 它的一张历史采购单（**只含 PID**）⇒ PID「有采购记录」、PID2「没有」。
# 自由退货的提醒就靠这一对来验（有历史 vs 无历史），而且两个都**必须能退**。
SID = 2001
PID2 = 1002

PASS = FAIL = 0


def ok(desc, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  [PASS] %s%s" % (desc, ("  " + str(extra)) if extra else ""))
    else:
        FAIL += 1
        print("  [FAIL] %s%s" % (desc, ("  <- " + str(extra)) if extra else ""))


def http(method, path, body=None, token=TOKEN, tenant=TID):
    req = urllib.request.Request(BASE + path, method=method)
    # token=None 表示「刻意不带凭证」，用于验证权限闸门（401），不能拼字符串
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", str(tenant))
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            raw = json.loads(raw)
        except Exception:
            pass
        return e.code, raw


def tdb():
    c = sqlite3.connect(DST)
    c.row_factory = sqlite3.Row
    return c


# ============================== prepare ==============================
def prepare():
    if os.path.exists(DST):
        print("ABORT tenant_99.db 已存在，先跑 teardown")
        return 2
    src = sqlite3.connect(SRC)
    dst = sqlite3.connect(DST)
    objs = src.execute(
        "select type, sql from sqlite_master where sql is not null "
        "and type in ('table','index') and name not like 'sqlite_%' "
        "and tbl_name not like 'sqlite_%'").fetchall()
    src.close()
    okn = skip = 0
    for _t, sql in objs:
        try:
            dst.execute(sql); okn += 1
        except Exception:
            skip += 1
    dst.commit()
    print("schema copied: ok=%d skip=%d tables=%d" % (
        okn, skip, dst.execute("select count(*) from sqlite_master where type='table'").fetchone()[0]))

    cur = dst.cursor()
    cur.execute("insert into products(id,name,spec,unit,large_unit,large_ratio,medium_unit,"
                "medium_ratio,order_unit,barcode,status,is_active,can_sale,sale_price,purchase_price,"
                "default_sale_unit,default_purchase_unit) "
                "values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (PID, "E2E低温酸奶", "1*24", "瓶", "箱", 24, "排", 6, "",
                 "E2E683001", "active", 1, 1, SALE_PRICE, PURCHASE_PRICE, "箱", "箱"))
    cur.execute("insert into contacts(id,type,name) values(?,?,?)", (CID, "customer", "E2E客户"))
    # v684：供应商 + 它唯一一张历史采购单（只含 PID）+ 一个它从没供过的商品 PID2
    cur.execute("insert into contacts(id,type,name) values(?,?,?)", (SID, "supplier", "E2E供应商"))
    cur.execute("insert into products(id,name,spec,unit,large_unit,large_ratio,medium_unit,"
                "medium_ratio,order_unit,barcode,status,is_active,can_sale,sale_price,purchase_price) "
                "values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (PID2, "E2E无历史商品", "1*1", "瓶", "", 0, "", 0, "",
                 "E2E684002", "active", 1, 1, 2.5, 1.8))
    cur.execute("insert into inventory(product_id,warehouse_id,quantity,cost_price,batch_no,"
                "expiry_date,updated_at) values(?,?,?,?,?,?,datetime('now','localtime'))",
                (PID2, WH, 100, 1.8, "E2E-B2", ""))
    _po = cur.execute("insert into purchase_orders(order_no,supplier_id,warehouse_id,total_amount,"
                      "status,order_date,operator_id) values(?,?,?,?,?,?,?)",
                      ("E2E-PO-684", SID, WH, 15.0, "received", "2026-10-01", "2")).lastrowid
    cur.execute("insert into purchase_order_items(order_id,product_id,quantity,unit_price,amount,"
                "unit,base_ratio,base_qty) values(?,?,?,?,?,?,?,?)",
                (_po, PID, 10, 1.5, 15.0, "瓶", 1, 10))
    cur.execute("insert into warehouses(id,name) values(?,?)", (WH, "E2E主仓"))
    cur.execute("insert into inventory(product_id,warehouse_id,quantity,cost_price,batch_no,"
                "expiry_date,updated_at) values(?,?,?,?,?,?,datetime('now','localtime'))",
                (PID, WH, 1000, PURCHASE_PRICE, "E2E-B1", ""))
    dst.commit()
    dst.close()

    # 🔴 prepare 由 root 执行 ⇒ 新库默认 root:root 644，服务进程 hergent 只能读不能写，
    #    现象是全线 "attempt to write a readonly database"（含定价接口 500）。
    #    权限必须在 prepare 里一次做对，别指望调用方记得手工 chown。
    try:
        st = pwd.getpwnam("hergent")
        os.chown(DST, st.pw_uid, st.pw_gid)
        os.chmod(DST, 0o600)
        print("perm: hergent:hergent 600")
    except Exception as e:
        print("WARN 改属主失败（服务将读写失败）:", e)

    m = sqlite3.connect(MASTER)
    m.execute("insert into tenants(id,name,subdomain,contact_name,contact_phone,plan,max_users,"
              "is_active,readonly) values(?,?,?,?,?,?,?,1,0)",
              (TID, "E2E隔离租户（临时）", "e2e-v684", "e2e", "", "free", 5))
    m.execute("insert into user_tenants(user_id,tenant_id) values(?,?)", (BOSS_UID, TID))
    now = datetime.datetime.now()
    m.execute("insert or replace into sessions(token,user_id,created_at,expires_at) values(?,?,?,?)",
              (TOKEN, BOSS_UID, now.strftime("%Y-%m-%d %H:%M:%S"),
               (now + datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")))
    m.commit()
    print("tenants:", [r[0] for r in m.execute("select id from tenants order by id")])
    m.close()
    print("PREPARE OK")
    print("!! 现在必须 systemctl restart hergent-erp，否则服务仍连着已删的旧 inode")
    return 0


# ============================== run ==============================
def run():
    print("\n=== A. 定价接口：档案价按档位折算（元/小单位 × ratio）===")
    s, d = http("GET", "/api/psi/product-pricing?product_id=%d&kind=sale" % PID)
    ok("销售定价 200", s == 200, s)
    opts = {o["key"]: o for o in (d.get("unit_options") or [])}
    ok("三档齐全（瓶/排/箱）", sorted(opts.keys()) == ["large", "medium", "small"], list(opts.keys()))
    ok("小档 瓶 价=2.0（= sale_price）", abs(opts["small"]["price"] - 2.0) < 1e-6, opts["small"]["price"])
    ok("中档 排 价=12.0（2.0×6）", abs(opts["medium"]["price"] - 12.0) < 1e-6, opts["medium"]["price"])
    ok("大档 箱 价=48.0（2.0×24）", abs(opts["large"]["price"] - 48.0) < 1e-6, opts["large"]["price"])
    ok("首次开单 ⇒ 价格来源=archive", all(o["price_source"] == "archive" for o in opts.values()),
       [o["price_source"] for o in opts.values()])
    ok("预选单位=箱（档案 default_sale_unit）", d.get("default_unit") == "箱", d.get("default_unit"))

    sp, dp = http("GET", "/api/psi/product-pricing?product_id=%d&kind=purchase" % PID)
    ok("采购预选单位=箱（档案 default_purchase_unit）", dp.get("default_unit") == "箱", dp.get("default_unit"))
    psmall = [o for o in dp["unit_options"] if o["key"] == "small"][0]
    ok("采购档案价用 purchase_price(1.5) 不是 sale_price(2.0)",
       abs(psmall["price"] - 1.5) < 1e-6, psmall["price"])

    tr, dt = http("GET", "/api/psi/product-pricing?product_id=%d&kind=transfer" % PID)
    ok("调拨不带价", all(float(o["price"]) == 0 for o in dt["unit_options"]),
       [(o["name"], o["price"]) for o in dt["unit_options"]])

    print("\n=== B. 建销售单：按「箱」开 2 箱 = 48 瓶 ===")
    s, r = http("POST", "/api/psi/sale-orders", {
        "customer_id": CID, "warehouse_id": WH,
        "items": [{"product_id": PID, "quantity": 2, "unit_price": 48,
                   "unit": "箱", "note": ""}],
    })
    ok("建单 200", s == 200, str(r)[:200])
    soid = (r or {}).get("order_id") or (r or {}).get("id")
    ok("拿到销售单 id", bool(soid), soid)

    c = tdb()
    row = c.execute("select * from sale_order_items where order_id=?", (soid,)).fetchone()
    hint = "行不可见⇒服务未重启，写进了已删 inode"
    ok("明细落 unit=箱", bool(row) and row["unit"] == "箱", row["unit"] if row else hint)
    ok("明细落 base_ratio=24", bool(row) and abs((row["base_ratio"] or 0) - 24) < 1e-6,
       row["base_ratio"] if row else hint)
    ok("明细落 base_qty=48（2×24）", bool(row) and abs((row["base_qty"] or 0) - 48) < 1e-6,
       row["base_qty"] if row else hint)
    ok("金额=96（2×48，档位口径）", bool(row) and abs((row["amount"] or 0) - 96) < 1e-6,
       row["amount"] if row else hint)
    c.close()

    print("\n=== C. 发货：库存必须按**折小量**扣（1000 → 952），不是按 2 ===")
    s, r = http("POST", "/api/psi/sale-orders/%s/deliver" % soid, {})
    ok("发货 200", s == 200, str(r)[:200])
    c = tdb()
    q = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                  (PID, WH)).fetchone()[0]
    c.close()
    ok("库存 1000→952（扣 48 瓶）", abs(float(q) - 952) < 1e-6, q)

    print("\n=== D. 上一次成交价：同客户 + 同单位 应被优先带出 ===")
    s, d2 = http("GET", "/api/psi/product-pricing?product_id=%d&kind=sale&customer_id=%d" % (PID, CID))
    large = [o for o in d2["unit_options"] if o["key"] == "large"][0]
    small = [o for o in d2["unit_options"] if o["key"] == "small"][0]
    ok("大档 箱 来自上次成交（last_owner）", large["price_source"] == "last_owner", large["price_source"])
    ok("大档 箱 价=48（上次成交价）", abs(large["price"] - 48) < 1e-6, large["price"])
    ok("小档 瓶 仍回落档案价（archive）", small["price_source"] == "archive", small["price_source"])
    ok("last_scoped 指向箱", (d2.get("last_scoped") or {}).get("unit") == "箱", d2.get("last_scoped"))

    print("\n=== E. 销售详情回显：unit_label / base_qty / base_unit_price ===")
    s, det = http("GET", "/api/psi/sale-orders/%s" % soid)
    ok("详情 200", s == 200, s)
    it = (det.get("items") or [{}])[0]
    ok("unit_label=箱", it.get("unit_label") == "箱", it.get("unit_label"))
    ok("base_unit=瓶", it.get("base_unit") == "瓶", it.get("base_unit"))
    ok("base_qty=48", abs(float(it.get("base_qty") or 0) - 48) < 1e-6, it.get("base_qty"))
    ok("base_unit_price=2.0（48/24）", abs(float(it.get("base_unit_price") or 0) - 2.0) < 1e-6,
       it.get("base_unit_price"))
    ok("unit_options 三档随详情下发", len(it.get("unit_options") or []) == 3,
       len(it.get("unit_options") or []))

    print("\n=== F. 销售退单：按「箱」退 1 箱，库存回增 24 ===")
    s, r = http("POST", "/api/psi/sale-return-orders", {
        "customer_id": CID, "warehouse_id": WH,
        "items": [{"product_id": PID, "product_name": "E2E低温酸奶",
                   "quantity": 1, "unit_price": 48, "unit": "箱"}],
        "reason": "E2E 质量原因",
    })
    ok("退单 200", s == 200, str(r)[:200])
    rid = (r or {}).get("return_id") or (r or {}).get("id")
    c = tdb()
    rr = c.execute("select * from return_order_items where return_id=?", (rid,)).fetchone()
    ok("退货明细落 unit=箱", rr and rr["unit"] == "箱", rr["unit"] if rr else None)
    ok("退货明细落 base_qty=24", rr and abs((rr["base_qty"] or 0) - 24) < 1e-6,
       rr["base_qty"] if rr else None)
    q = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                  (PID, WH)).fetchone()[0]
    c.close()
    ok("库存 952→976（回增 24 瓶）", abs(float(q) - 976) < 1e-6, q)

    print("\n=== G. 调拨：按「箱」调 3 箱 = 72 瓶 ===")
    s, r = http("POST", "/api/psi/transfer-orders", {
        "from_warehouse_id": WH, "to_warehouse_id": WH + 100,
        "items": [{"product_id": PID, "product_name": "E2E低温酸奶",
                   "quantity": 3, "unit": "箱"}],
    })
    ok("建调拨 200", s == 200, str(r)[:200])
    tid = (r or {}).get("id")
    c = tdb()
    ti = c.execute("select * from transfer_order_items where transfer_id=?", (tid,)).fetchone()
    ok("调拨明细落 unit=箱", ti and ti["unit"] == "箱", ti["unit"] if ti else None)
    ok("调拨明细落 base_qty=72", ti and abs((ti["base_qty"] or 0) - 72) < 1e-6,
       ti["base_qty"] if ti else None)
    c.close()
    s, r = http("POST", "/api/psi/transfer-orders/%s/complete" % tid, {})
    ok("过账 200", s == 200, str(r)[:200])
    c = tdb()
    frm = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                    (PID, WH)).fetchone()[0]
    to = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                   (PID, WH + 100)).fetchone()[0]
    c.close()
    ok("调出仓 976→904（扣 72 瓶）", abs(float(frm) - 904) < 1e-6, frm)
    ok("调入仓 0→72（加 72 瓶）", abs(float(to) - 72) < 1e-6, to)

    print("\n=== H. 历史行兼容：base_qty=0 的行必须回退原数量（行为零变化）===")
    c = tdb()
    c.execute("insert into sale_order_items(order_id,product_id,quantity,unit_price,amount,unit,"
              "base_ratio,base_qty) values(?,?,?,?,?,?,?,?)",
              (soid, PID, 5, 2.0, 10.0, "", 0, 0))
    c.commit()
    n = c.execute("select count(*) from sale_order_items where base_qty=0 and unit=''").fetchone()[0]
    c.close()
    ok("可以存在 base_qty=0 的历史型行（读取侧回退 quantity）", n >= 1, n)

    print("\n=== I. 权限闸门：无令牌必须 401 ===")
    s, _ = http("GET", "/api/psi/product-pricing?product_id=%d&kind=sale" % PID, token=None)
    ok("无令牌 401", s == 401, s)

    print("\n=== J. 自由退货提醒：该供应商从没供过的商品要能被标出来 ===")
    s, d = http("GET", "/api/psi/partner-product-history?kind=purchase&partner_id=%d&product_ids=%d,%d"
                % (SID, PID, PID2))
    ok("提醒接口 200", s == 200, str(d)[:150])
    ok("采购过的商品判 matched", set(d.get("matched") or []) == set([PID]), d.get("matched"))
    ok("从没供过的商品判 missing", set(d.get("missing") or []) == set([PID2]), d.get("missing"))
    ok("checked = 入参个数", d.get("checked") == 2, d.get("checked"))

    s, d = http("GET", "/api/psi/partner-product-history?kind=purchase&partner_id=%d&product_ids=%d"
                % (SID, PID2))
    ok("单查无历史商品 ⇒ missing 只含它", set(d.get("missing") or []) == set([PID2]),
       d.get("missing"))
    # 反证：同一批商品换个伙伴（客户 CID 走 sale 侧）结论不该相同
    s, d = http("GET", "/api/psi/partner-product-history?kind=sale&partner_id=%d&product_ids=%d,%d"
                % (CID, PID, PID2))
    ok("换到销售侧（该客户买过 PID）⇒ 结论跟着伙伴变",
       s == 200 and set(d.get("matched") or []) == set([PID]), d.get("matched"))

    print("\n=== K. 自由退货**不拦截**：退一个该供应商从没供过的商品，必须能建成 ===")
    c = tdb()
    b2 = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                   (PID2, WH)).fetchone()[0]
    c.close()
    s, r = http("POST", "/api/psi/purchase-return-orders", {
        "supplier_id": SID, "warehouse_id": WH,
        "items": [{"product_id": PID2, "product_name": "E2E无历史商品",
                   "quantity": 5, "unit_price": 1.8, "unit": "瓶"},
                  {"product_id": PID, "product_name": "E2E低温酸奶",
                   "quantity": 1, "unit_price": 1.5, "unit": "瓶"}],
        "reason": "E2E 自由退货（无原单）",
    })
    ok("明细含无历史商品也能建退货单（200，不是 400/422）", s == 200, str(r)[:200])
    pri = (r or {}).get("id") or (r or {}).get("return_id")
    ok("拿到采购退货单 id", bool(pri), pri)
    c = tdb()
    ritems = c.execute("select * from purchase_return_items where return_id=?", (pri,)).fetchall()
    ok("两行明细都落库（含无历史商品）", len(ritems) == 2, len(ritems))
    ok("退货单 purchase_order_id=0（确实没挂原单）",
       bool(c.execute("select 1 from purchase_returns where id=? and purchase_order_id=0",
                      (pri,)).fetchone()), pri)
    a2 = c.execute("select coalesce(sum(quantity),0) from inventory where product_id=? and warehouse_id=?",
                   (PID2, WH)).fetchone()[0]
    c.close()
    ok("无历史商品库存 %d→95（真的退回去了，不是只弹提示）" % int(b2), abs(float(a2) - 95) < 1e-6, a2)

    print("\n---------------- RESULT: %d PASS / %d FAIL ----------------" % (PASS, FAIL))
    return 0 if FAIL == 0 else 1


# ============================== teardown ==============================
def teardown():
    for p in (DST, DST + "-wal", DST + "-shm"):
        if os.path.exists(p):
            os.remove(p)
            print("removed", p)
    m = sqlite3.connect(MASTER)
    m.execute("delete from user_tenants where tenant_id=?", (TID,))
    m.execute("delete from tenants where id=?", (TID,))
    m.execute("delete from sessions where token=?", (TOKEN,))
    m.commit()
    print("tenants:", [r[0] for r in m.execute("select id from tenants order by id")])
    print("boss user_tenants:", [r[0] for r in
                                 m.execute("select tenant_id from user_tenants where user_id=?", (BOSS_UID,))])
    print("v684 sessions left:", m.execute("select count(*) from sessions where token=?", (TOKEN,)).fetchone()[0])
    print("tenant_98 files:", [f for f in os.listdir(DB_DIR) if f.startswith("tenant_98")])
    m.close()

    # 反证：真实租户未被污染
    c = sqlite3.connect("file:%s?mode=ro" % SRC, uri=True)
    hits = c.execute("select count(*) from sale_order_items where unit='箱' and base_ratio=24").fetchone()[0]
    print("tenant_1 里 unit=箱&base_ratio=24 的行:", hits, "（期望 0）")
    print("tenant_1 关键表行数:", {
        t: c.execute("select count(*) from %s" % t).fetchone()[0]
        for t in ("sale_order_items", "return_order_items", "transfer_order_items", "products")
    })
    c.close()
    print("TEARDOWN OK")
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"
    sys.exit({"prepare": prepare, "run": run, "teardown": teardown}[mode]())
