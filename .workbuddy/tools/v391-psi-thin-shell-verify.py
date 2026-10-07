"""v391 · 批次 4「进销存薄壳」验收 —— 真实源码 + 真实租户库快照，零生产写入。

范式（照 hergent-realdata-ab-proof）：**不 import 应用**（`server.py` 310KB，import 会带起
app/中间件/scheduler，且沙箱里没有 ERP_SECRET），只 import **目标路由模块本身**，
把「租户库 + 主库」都指向**生产快照的副本**，再直接调端点函数。

为什么用生产快照而不是本地 demo 库：
  生产 `inventory` 54 行的 batch_no/expiry_date **100% 为空** —— 这正是要覆盖的边界
  （「效期全空」时 `/stock` 的排序、`/summary` 的 missing_expiry 指标、全空提示）。
  本地 demo 库没有这个形状。

🔴 判别力设计（每条判据都要能「反过来红」）：
  · A/B 成对：**带**批次字段建采购 = 400 / **不带** = 成功 → 两侧必须相反
  · 交叉验证：`/stock/summary` 的 missing_expiry_rows 必须等于**另一条独立 SQL** 数出来的值
  · 真 RBAC：调 `core._check_perm(user, 'inventory', 'create', tenant_id=1)`（读租户库真实权限表），
    而不是自己写一个「角色白名单」再自证 —— 那样只能证明我写的白名单等于我写的白名单
  · 闸门成立性：`/api/psi/...` 与 `/api/purchase-orders` 必须映射到**不同**模块

用法：
  ERP_DIR=/tmp/xxx 由脚本自己建影子目录（复制生产快照）后运行：
    python3 v391-psi-thin-shell-verify.py --snapshot-dir <含 erp.db + tenant_1.db 的目录>
"""
import argparse
import asyncio
import ast
import os
import shutil
import sys
import tempfile
import traceback

RESULTS = []


def ok(name, cond, detail=""):
    RESULTS.append((bool(cond), name, detail))
    print(f"{'✅' if cond else '❌'} {name}" + (f"  ← {detail}" if detail else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot-dir", required=True,
                    help="含 erp.db 与 tenant_1.db 的目录（生产快照副本）")
    ap.add_argument("--server-dir", default=os.path.expanduser("~/Documents/hergent-erp/server"))
    args = ap.parse_args()

    snap = os.path.abspath(args.snapshot_dir)
    srv = os.path.abspath(args.server_dir)
    for f in ("erp.db", "tenant_1.db"):
        if not os.path.exists(os.path.join(snap, f)):
            print(f"❌ 快照缺 {f}：{snap}")
            return 2

    shadow = tempfile.mkdtemp(prefix="v391-shadow-")
    for f in ("erp.db", "tenant_1.db"):
        shutil.copy2(os.path.join(snap, f), os.path.join(shadow, f))
    print(f"影子目录 = {shadow}")

    os.environ["ERP_SECRET"] = "shadow-only-not-a-secret"
    os.environ["ERP_DB_PATH"] = os.path.join(shadow, "erp.db")
    sys.path.insert(0, srv)

    import db.connection as conn
    from db import connection as _c2
    # DB_PATH「两份」都要 patch（本仓踩过：影子库只 patch 一处 ⇒ 写入仍落真库）
    assert os.path.abspath(conn.DB_PATH) == os.path.abspath(os.path.join(shadow, "erp.db")), \
        f"DB_PATH 未指向影子库：{conn.DB_PATH}"
    conn.DB_DIR = shadow
    _c2.DB_PATH = conn.DB_PATH
    _c2.DB_DIR = shadow
    conn.set_tenant_context(1)

    import core
    import routers.psi as psi
    import routers.purchase as rp
    import routers.sales as rs
    import erp_db as db

    BOSS = {"id": 1, "role": "boss", "display_name": "张俊峰", "username": "boss"}

    class FakeReq:
        def __init__(self, body=None):
            self._body = body or {}

        async def json(self):
            return self._body

    # 把三个模块里 `from core import _auth` 的绑定一起换掉（各自持一份名字）
    for m in (core, psi, rp, rs):
        if hasattr(m, "_auth"):
            m._auth = lambda req, _u=BOSS: dict(_u)

    # ── P0 安全护栏：确认写操作只会落到影子库 ──────────────────────
    ok("影子库就位：写操作不会碰真库",
       os.path.abspath(conn.DB_PATH).startswith(shadow) and conn.DB_DIR == shadow,
       conn.DB_PATH)

    # ── P7 复现既有缺陷（供上报用）：erp_db 命名空间缺 partial_receive ──
    src = open(os.path.join(srv, "erp_db.py"), encoding="utf-8").read()
    ns = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                ns.add(a.asname or a.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            ns.add(node.name)
    ok("复现既有缺陷：erp_db 顶层**没有** purchase_order_partial_receive",
       "purchase_order_partial_receive" not in ns,
       "⇒ 老前端 /api/purchase-orders/{id}/partial-receive 会 AttributeError(500)")
    from db.queries.purchases import purchase_order_partial_receive as real_pr
    ok("薄壳走的是真函数：db.queries.purchases.purchase_order_partial_receive 可导入",
       callable(real_pr))

    # ── P6 闸门成立性：psi 前缀必须映射到 inventory，且与既有端点**不同模块** ──
    ssrc = open(os.path.join(srv, "server.py"), encoding="utf-8").read()
    map_node = None
    for node in ast.walk(ast.parse(ssrc)):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_PATH_MODULE_MAP" for t in node.targets):
            map_node = node.value
    assert map_node is not None, "找不到 _PATH_MODULE_MAP"
    path_map = [(k.value, v.value) for k, v in zip(map_node.keys, map_node.values)]

    def module_for(path):
        for prefix, mod in path_map:      # 与 server.py::rbac_middleware 同一段「首个 startswith 即停」
            if path.startswith(prefix):
                return mod
        return None

    ok("_PATH_MODULE_MAP 首键 = /api/psi → inventory",
       path_map[0] == ("/api/psi", "inventory"), str(path_map[0]))
    psi_paths = [
        "/api/psi/meta", "/api/psi/refs", "/api/psi/stock", "/api/psi/stock/summary",
        "/api/psi/stock/expiring", "/api/psi/purchase-orders", "/api/psi/purchase-orders/1",
        "/api/psi/purchase-orders/1/confirm", "/api/psi/purchase-orders/1/receive",
        "/api/psi/sale-orders", "/api/psi/sale-orders/1", "/api/psi/sale-orders/1/deliver",
        "/api/psi/sale-orders/1/sign",
    ]
    got = {p: module_for(p) for p in psi_paths}
    ok("13 条 psi 路径全部命中 inventory（无一条漏到别的模块）",
       all(v == "inventory" for v in got.values()), str({k: v for k, v in got.items() if v != "inventory"}))
    legacy = {p: module_for(p) for p in ("/api/purchase-orders", "/api/sale-orders", "/api/inventory")}
    ok("判别力自证：既有端点走的是**别的**模块（复用它们 = 闸门作废）",
       all(v != "inventory" for v in legacy.values()), str(legacy))

    # ── P5 真 RBAC：读租户库真实权限表，判各角色 ──────────────────
    # 🔴 期望值订正（第一版断言写错，不是代码错）：计划口径是「仅 boss / admin」，
    #    因为 `_DEFAULT_PERMS['admin'] = ['*']` ⇒ admin 命中通配即通过。
    #    把 admin 一并写进 True 侧，才有判别力（否则这条断言其实在测「admin 是不是 admin」）。
    perm = {}
    for role in ("boss", "admin", "accountant", "sales", "guide", "driver", "staff",
                 "supervisor", "distributor"):
        u = {"role": role, "roles": [role]}
        perm[role] = core._check_perm(u, "inventory", "read", tenant_id=1)
    ALLOWED = {"boss", "admin"}
    ok("真 RBAC：inventory 只给 boss/admin（其余 7 个角色全 False）",
       all(perm[r] is True for r in ALLOWED)
       and not any(v for k, v in perm.items() if k not in ALLOWED),
       str(perm))
    # 判别力自证：把一条**别的**模块拿来对照 —— 若它也全 True，说明这条判据根本没在读权限表
    other = core._check_perm({"role": "sales", "roles": ["sales"]}, "payroll", "read", tenant_id=1)
    ok("判别力自证：同一账号对 `payroll` 判 False（证 `_check_perm` 确实在读权限表）",
       other is False, f"sales×payroll={other}")

    # ── 基线读数（从影子库另算，供交叉验证） ──────────────────────
    with conn.get_db() as d:
        sql_rows = d.execute("SELECT COUNT(*) FROM inventory WHERE quantity>0").fetchone()[0]
        sql_no_exp = d.execute(
            "SELECT COUNT(*) FROM inventory WHERE quantity>0 AND COALESCE(expiry_date,'')=''"
        ).fetchone()[0]
        cust = d.execute("SELECT id FROM contacts WHERE type='customer' ORDER BY id LIMIT 1").fetchone()
        sup = d.execute("SELECT id FROM contacts WHERE type='supplier' ORDER BY id LIMIT 1").fetchone()
        prod = d.execute("SELECT id, order_unit, large_ratio FROM products WHERE is_active=1 "
                         "ORDER BY id LIMIT 1").fetchone()
        whs = [r[0] for r in d.execute("SELECT id FROM warehouses").fetchall()]
    print(f"   基线：有货行={sql_rows} 无到期日={sql_no_exp} 客户={cust and cust[0]} "
          f"供应商={sup and sup[0]} 商品={prod and prod[0]} 仓={whs}")

    # ── P1 15 个端点全部可调用 ────────────────────────────────────
    R = FakeReq()
    calls = []

    def call(name, fn, *a, **kw):
        try:
            r = fn(*a, **kw)
            if asyncio.iscoroutine(r):
                r = asyncio.run(r)
            calls.append((name, "ok", r))
            return r
        except Exception as e:
            calls.append((name, "exc", e))
            return e

    m = call("meta", psi.psi_meta, R)
    ok("端点 01 meta", isinstance(m, dict) and m.get("module") == "inventory")

    rf = call("refs", psi.psi_refs, R)
    ok("端点 02 refs（四类资料齐、商品带 order_unit、客户不带 PII）",
       isinstance(rf, dict) and {"warehouses", "suppliers", "customers", "products"} <= set(rf)
       and isinstance(rf["products"], list) and len(rf["products"]) > 0
       and "order_unit" in rf["products"][0]
       and not ({"phone", "id_card", "bank_account"} & set(rf["customers"][0]) if rf["customers"] else False),
       f"warehouses={len(rf.get('warehouses', []))} suppliers={len(rf.get('suppliers', []))} "
       f"customers={len(rf.get('customers', []))} products={len(rf.get('products', []))}")

    pl = call("purchase list", psi.psi_list_purchase_orders)
    ok("端点 06 purchase-orders(list)", isinstance(pl, dict) and "orders" in pl and "total" in pl,
       f"total={pl.get('total')}")

    # ══════════════════════════════════════════════════════════════
    # 注入 3 个合成批次 —— 把「排序 / 可售 / 临期筛选」这三条判据的**取值域撑开**
    # ══════════════════════════════════════════════════════════════
    # 🔴 为什么必须注入：生产 54 行的 expiry_date **全是空**，此时
    #    「ORDER BY 到期日升序」「过期批次不可售」「30 天内临期」三条判据**恒真**
    #    ⇒ 不注入就是「判据取值域比输入窄」，写了等于没写（本仓已有此纪律）。
    #    注入只发生在**影子库副本**上（前面已断言 DB_PATH 指向影子目录）。
    from datetime import date, timedelta
    with conn.get_db() as d:
        today_iso = d.execute("SELECT date('now','localtime')").fetchone()[0]
        y, m, dd = (int(x) for x in today_iso.split("-"))
        t0 = date(y, m, dd)
        synth = [
            ("V391-EXPIRED", (t0 - timedelta(days=40)).isoformat(), 5),   # 已过期
            ("V391-CRITICAL", (t0 + timedelta(days=13)).isoformat(), 5),  # 临期（<=30d）
            ("V391-OK", (t0 + timedelta(days=400)).isoformat(), 5),       # 正常
        ]
        for bn, exp, qty in synth:
            d.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,"
                      "batch_no,expiry_date,production_date) VALUES (?,?,?,?,?,?,'')",
                      (prod[0], whs[0], qty, 1.0, bn, exp))
        d.commit()
    n_synth = len(synth)
    print(f"   注入 {n_synth} 个合成批次（today={today_iso}）：" +
          ", ".join(f"{b}={e}" for b, e, _ in synth))

    st = call("stock", psi.psi_stock, R)
    rows = (st or {}).get("rows") or []
    ok("端点 03 stock（全量行数 = 原 54 + 注入 3）",
       st.get("total") == sql_rows + n_synth and len(rows) == sql_rows + n_synth,
       f"/stock={st.get('total')} 期望={sql_rows + n_synth}")

    if len(rows) == sql_rows + n_synth:
        ok("🔴 排序判据（强）：最早的批次排第一 = 已过期那条",
           rows[0]["expiry_status"] == "expired" and rows[0]["batch_no"] == "V391-EXPIRED",
           f"首行={rows[0]['batch_no']}/{rows[0]['expiry_status']}")
        ok("🔴 排序判据（强）：无到期日的 {} 行**全部**排在末尾".format(sql_no_exp),
           all(r["expiry_status"] == "none" for r in rows[-sql_no_exp:]),
           f"末 {min(3, sql_no_exp)} 行状态={[r['expiry_status'] for r in rows[-sql_no_exp:][-3:]]}")
        ok("🔴 可售判据（强）：过期批次 saleable=False，临期/正常=True",
           next(r for r in rows if r["batch_no"] == "V391-EXPIRED")["saleable"] is False
           and next(r for r in rows if r["batch_no"] == "V391-CRITICAL")["saleable"] is True
           and next(r for r in rows if r["batch_no"] == "V391-OK")["saleable"] is True)
        ok("效期档位词表与既有 inventory_query 同源（expired/critical/ok/none）",
           {r["expiry_status"] for r in rows} == {"expired", "critical", "ok", "none"},
           str(sorted({r["expiry_status"] for r in rows})))

    st2 = call("stock only_saleable", psi.psi_stock, R, only_saleable=True)
    ok("🔴 only_saleable=True 排除过期批次（57 → 56）",
       st2.get("total") == sql_rows + n_synth - 1
       and not any(r["expiry_status"] == "expired" for r in st2.get("rows", [])),
       f"total={st2.get('total')}")

    st3 = call("stock expiring<=30d", psi.psi_stock, R, expiring_within_days=30)
    ok("🔴 expiring_within_days=30 只留「已过期 + 13 天后到期」两条",
       st3.get("total") == 2
       and {r["batch_no"] for r in st3.get("rows", [])} == {"V391-EXPIRED", "V391-CRITICAL"},
       f"total={st3.get('total')} 批次={[r['batch_no'] for r in st3.get('rows', [])]}")

    sm = call("stock/summary", psi.psi_stock_summary, R)
    ok("端点 04 stock/summary（missing_expiry_rows / batch_rows 与独立 SQL 交叉验证）",
       isinstance(sm, dict) and sm.get("missing_expiry_rows") == sql_no_exp
       and sm.get("batch_rows") == sql_rows + n_synth,
       f"summary=({sm.get('batch_rows')},{sm.get('missing_expiry_rows')}) "
       f"vs SQL=({sql_rows + n_synth},{sql_no_exp})")
    ok("🔴 summary 的过期桶 = 注入的 1 条（判据有判别力）",
       sm.get("expiring", {}).get("expired", {}).get("rows") == 1,
       str(sm.get("expiring", {}).get("expired")))
    ok("summary 给出 empty_hint（批次 5「全 0 显示引导」的数据源）",
       isinstance(sm.get("empty_hint"), str) and sm["empty_hint"] != "",
       (sm or {}).get("empty_hint", "")[:46])
    by_wh_total = sum(w["rows_"] for w in sm.get("by_warehouse", []))
    ok("summary by_warehouse 合计 == batch_rows（内部自洽）",
       by_wh_total == sm.get("batch_rows"), f"{by_wh_total} vs {sm.get('batch_rows')}")

    ex = call("stock/expiring", psi.psi_stock_expiring, R)
    ok("端点 05 stock/expiring（复用 get_expiry_alerts，含已过期）",
       isinstance(ex, dict) and ex.get("count") == 2,
       f"count={ex.get('count')}")

    # ── P4 A/B：批次字段拦截（正反两侧结果必须相反） ─────────────
    from fastapi import HTTPException
    with_batch = FakeReq({"supplier_id": sup[0], "warehouse_id": whs[0],
                          "items": [{"product_id": prod[0], "quantity": 1, "unit_price": 1,
                                     "batch_no": "B20261007", "expiry_date": "2026-11-01"}]})
    r_with = call("purchase create +batch", psi.psi_create_purchase_order, with_batch)
    ok("A 侧：带批次号/到期日 ⇒ 显式 400（不静默丢字段）",
       isinstance(r_with, HTTPException) and r_with.status_code == 400,
       f"type={type(r_with).__name__}")

    without_batch = FakeReq({"supplier_id": sup[0], "warehouse_id": whs[0],
                             "items": [{"product_id": prod[0], "quantity": 1, "unit_price": 1}]})
    r_without = call("purchase create -batch", psi.psi_create_purchase_order, without_batch)
    ok("B 侧：不带批次字段 ⇒ 建单成功（证 A 侧的 400 是批次字段造成的，不是别的错）",
       isinstance(r_without, dict) and r_without.get("success") is True
       and r_without.get("order_id"),
       str(r_without)[:90] if isinstance(r_without, dict) else repr(r_without)[:90])

    if isinstance(r_without, dict) and r_without.get("order_id"):
        oid_new = r_without["order_id"]
        g = call("purchase get", psi.psi_get_purchase_order, oid_new, R)
        ok("端点 07 purchase-orders/{id}(get)", isinstance(g, dict) and g.get("order", {}).get("id") == oid_new,
           f"items={len((g or {}).get('items', []))}")
        ok("回读判据：明细行 batch_no/expiry_date 确实为空（证 create 不落这两列）",
           all(not (it.get("batch_no") or it.get("expiry_date")) for it in (g or {}).get("items", [])),
           str([(it.get("batch_no"), it.get("expiry_date")) for it in (g or {}).get("items", [])]))
        cf = call("purchase confirm", psi.psi_confirm_purchase_order, oid_new, R)
        ok("端点 08 purchase-orders/{id}/confirm（确认→入库）",
           isinstance(cf, dict) and cf.get("status") in ("received", "partial"),
           str(cf)[:90])

    # 分批到货走**新建的 draft 单**（上一张已 received，状态门会拒）
    r2 = call("purchase create #2", psi.psi_create_purchase_order, FakeReq(
        {"supplier_id": sup[0], "warehouse_id": whs[0],
         "items": [{"product_id": prod[0], "quantity": 2, "unit_price": 1}]}))
    oid2 = r2.get("order_id") if isinstance(r2, dict) else None
    if oid2:
        rec = call("purchase receive", psi.psi_receive_purchase_order, oid2,
                   FakeReq({"items": [{"product_id": prod[0], "quantity": 1}]}))
        ok("端点 09 purchase-orders/{id}/receive（**happy path**：走真函数，不再 AttributeError）",
           isinstance(rec, dict) and rec.get("status") in ("partial", "received"),
           str(rec)[:110])
        # 反例：空 items 必须被 pydantic 拦成 422（证委派链真的走到了校验层，不是静默通过）
        rec_bad = call("purchase receive(空)", psi.psi_receive_purchase_order, oid2,
                       FakeReq({"items": []}))
        ok("判别力自证：receive 传空 items ⇒ 422 参数校验（证链路走到了真函数的校验层）",
           isinstance(rec_bad, HTTPException) and rec_bad.status_code == 422,
           f"status={getattr(rec_bad, 'status_code', None)}")
    else:
        ok("端点 09 purchase-orders/{id}/receive（happy path）", False, "第 2 张采购单未建成")

    sl = call("sale list", psi.psi_list_sale_orders, R)
    ok("端点 10 sale-orders(list)", isinstance(sl, dict), f"keys={sorted(sl)[:5] if isinstance(sl, dict) else sl}")

    sale_body = {"customer_id": cust[0], "warehouse_id": whs[0],
                 "items": [{"product_id": prod[0], "quantity": 1, "unit_price": 1}],
                 "note": "v391 薄壳验收（影子库）"}
    sc = call("sale create", psi.psi_create_sale_order, FakeReq(sale_body))
    ok("端点 11 sale-orders(create) —— 走**既有 handler** ⇒ 信用校验/促销/审计都在",
       isinstance(sc, dict) and sc.get("success") is True and sc.get("order_id"),
       str(sc)[:110] if isinstance(sc, dict) else repr(sc)[:110])
    if isinstance(sc, dict) and sc.get("order_id"):
        sid = sc["order_id"]
        gs = call("sale get", psi.psi_get_sale_order, sid, R)
        ok("端点 12 sale-orders/{id}(get)", isinstance(gs, dict) and gs.get("order", {}).get("id") == sid)
        dv = call("sale deliver", psi.psi_deliver_sale_order, sid, R)
        ok("端点 13 sale-orders/{id}/deliver（含 FEFO 扣减；应拿到 fefo_batches）",
           isinstance(dv, dict) and dv.get("success") and isinstance(dv.get("fefo_batches"), list),
           str(dv)[:120])
        sg = call("sale sign", psi.psi_sign_sale_order, sid, R)
        ok("端点 14 sale-orders/{id}/sign（含 AR 生成）",
           isinstance(sg, dict) and sg.get("success") and "receivable" in sg,
           str(sg)[:110])
    # 反例：不存在的单 → 404（证委派链的错误语义没被薄壳吃掉）
    miss = call("purchase get 不存在", psi.psi_get_purchase_order, 99999999, R)
    ok("判别力自证：取不存在的采购单 ⇒ 404（错误语义未被 `_raise_if_exc` 吞掉）",
       isinstance(miss, HTTPException) and miss.status_code == 404,
       f"status={getattr(miss, 'status_code', None)}")

    print("\n--- 端点调用一览（异常要能看到原因）---")
    for name, kind, v in calls:
        if kind == "exc":
            print(f"   ⚠️  {name}: {type(v).__name__}: {str(v)[:70]}")
        else:
            print(f"   ✅ {name}")
    # 🔴 只把**非 HTTPException** 的异常算失败：HTTPException 是 FastAPI 的正常 4xx 通道
    #    （本例里 A 侧的 400、空 items 的 422、不存在单的 404 都是**有意**触发的）。
    #    第一版把 HTTPException 也当「500」统计 ⇒ 判据与事实不同宽，是假红。
    bad_exc = [c for c in calls if c[1] == "exc" and not isinstance(c[2], HTTPException)]
    ok("无未捕获的非 HTTP 异常（真正的 500 计数 = 0）", not bad_exc,
       "; ".join(f"{c[0]}={type(c[2]).__name__}" for c in bad_exc))

    # ── 收尾：影子库改动量（证明只动了副本） ──────────────────────
    n_po = None
    with conn.get_db() as d:
        n_po = d.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0]
    print(f"\n影子库 purchase_orders 现有 {n_po} 行（原 81 + 本次新建）")

    bad = [r for r in RESULTS if not r[0]]
    print(f"\n{'=' * 62}\n合计 {len(RESULTS)} 条，通过 {len(RESULTS) - len(bad)}，失败 {len(bad)}\n{'=' * 62}")
    for _, n, d_ in bad:
        print(f"  ❌ {n}  {d_}")
    shutil.rmtree(shadow, ignore_errors=True)
    return 1 if bad else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(3)
