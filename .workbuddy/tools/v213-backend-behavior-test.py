#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v213-A2 后端行为验证 —— 两个写入口是否真的接了同一份判据。

范式：**一次性临时副本 + 直调真实路由函数**（同技能 hergent-tenant-isolation-audit §2.5）。
不碰生产、不碰 `server/*.db` 原件 —— 开头记原件 sha256，结尾复核没变。

为什么不用 HTTP/TestClient：RBAC 中间件要先过令牌校验，而这里要验的是**业务判据**，
不是鉴权链路。直调路由拿到的是同一个函数、同一份判据；`_violations_400` 返回真
`JSONResponse`，`HTTPException` 则按 `core.error_envelope` 补出同一层信封 —— 两种出口
都被还原成真实回执形状。

判据（每条都反向可证伪）：
  Z 特征化：新库缺 period_id 时 create_submission 会 no such column（记录，不改本入口）
  A 规则读写：默认值 / 落库 / 非法值抛错且**不静默截断** / 逐字段回落
  B 路由表：GET /validation-spec 真的注册上了；summary / save-matrix / 小程序入口都还在
  C validation-spec 端点载荷与 get_rules() 同源
  D 小程序入口 create_submission：好载荷写库；坏数量 400 + violations；
    **且 400 时旧单不被动**（v158「要么完整覆盖、要么原样不动」）
  E Web 入口 save_matrix：好载荷写库；坏数量 400 + violations 且 **DB 指纹一字不变**
    （门禁在事务之前 ⇒ 结构上排除「半写」）；旧代码会 500 的脏 product_id 现在不 500
  F 两端对账：同一份脏载荷 → 同一组 kind + 同一句文案 + 同一套 row/col 口径
  I v213-B1 乐观锁：/summary 下发指纹（只加键）· 过期指纹 409 且零写入 · force 覆盖 ·
    回执回传新指纹且可继续用 · **同一内容重复保存指纹不变** · 单价/删列名册单独变也敏感 ·
    作用域只覆盖本函数管得着的行（不传 base_rev 的旧前端完全不受影响）
  Z3 特征化：period_id=0 时作用域退化为「全部 period_id=0」（记录，留用户拍板）
  H 灵敏度：摘掉门禁/摘下锁，同一载荷的行为必须跟着变（否则「全绿」可能来自别的守卫）
  G 源库原件 sha256 未变
"""
import asyncio
import glob
import hashlib
import json
import os
import shutil
import sqlite3
import sys

SERVER = "/Users/zhangjunfeng/Documents/hergent-erp/server"
WORK = "/tmp/v213-sandbox"
TODAY = "2026-09-20"
TABLES = ("forecast_submissions", "forecast_submission_items")
FAILS = []
CHECKS = [0]


def ok(cond, label):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(label)
    return bool(cond)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


class FakeReq:
    """只被 `_auth`（已打桩，忽略参数）与 `await request.json()` 使用。"""

    def __init__(self, body, bad_json=False):
        self._b, self._bad = body, bad_json

    async def json(self):
        if self._bad:
            raise ValueError("invalid json")
        return self._b


def fingerprint(db_path):
    """业务表指纹：数量 + 有序行的 sha256。用来证明「被拒 ⇒ 一字未动」。"""
    c = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    parts = []
    for tb in TABLES:
        try:
            rows = c.execute("SELECT * FROM %s ORDER BY id" % tb).fetchall()
            parts.append("%s=%d" % (tb, len(rows)))
            for r in rows:
                parts.append(",".join("" if v is None else str(v) for v in r))
        except Exception as e:
            parts.append("%s=ERR:%s" % (tb, e))
    c.close()
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def seed(db_path):
    """最小前置数据：一个**今天在窗口内**的开放期次 + 商品厂价。

    本地快照是 schema-only（forecast_submissions=0 / forecast_periods=0），所以要自己播种 ——
    本脚本验的是**校验判据**，不依赖任何既有业务数据。
    """
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    cols = [r[1] for r in c.execute("PRAGMA table_info(forecast_periods)")]
    assert cols == ["id", "name", "order_start", "order_end", "arrival_date", "status", "created_at"], \
        "forecast_periods 结构变了：%r" % cols
    if not c.execute("SELECT COUNT(*) FROM forecast_periods").fetchone()[0]:
        c.execute(
            "INSERT INTO forecast_periods(id,name,order_start,order_end,arrival_date,status,created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (1, "v213沙箱期次", "2026-09-15", "2026-09-30", "2026-10-02", "open", "2026-09-15 00:00:00"))
        c.commit()
    row = c.execute("SELECT * FROM forecast_periods WHERE status='open'").fetchone()
    assert row, "播种失败：没有开放期次"
    assert row["order_start"] <= TODAY <= row["order_end"], \
        "播种失败：开放期次窗口不含今天（%s~%s vs %s）" % (row["order_start"], row["order_end"], TODAY)
    pcols = [x[1] for x in c.execute("PRAGMA table_info(products)")]
    pid = c.execute("SELECT id FROM products ORDER BY id LIMIT 1").fetchone()[0]
    for col, val in (("factory_price", 10.0), ("purchase_price", 10.0), ("sale_price", 12.0)):
        if col in pcols:
            c.execute("UPDATE products SET %s=? WHERE id=?" % col, (val, pid))
    c.commit()
    c.close()
    return pid, dict(row)


def main():
    import logging
    logging.disable(logging.WARNING)

    originals = {p: sha(p) for p in glob.glob(os.path.join(SERVER, "tenant_*.db"))
                 + [os.path.join(SERVER, "erp.db")]}

    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    for name in ("erp.db", "tenant_1.db"):
        shutil.copy2(os.path.join(SERVER, name), os.path.join(WORK, name))
        for ext in ("-wal", "-shm"):
            src = os.path.join(SERVER, name + ext)
            if os.path.exists(src) and os.path.getsize(src):
                shutil.copy2(src, os.path.join(WORK, name + ext))

    os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
    os.environ.setdefault("ERP_SECRET", "v213-sandbox-secret-not-a-real-key")
    # 只为让 `server` 装配起来（hermes_core 在 import 期就硬要这个键）。本脚本不发 LLM 请求。
    os.environ.setdefault("DEEPSEEK_API_KEY", "v213-sandbox-dummy")
    sys.path.insert(0, SERVER)

    TDB = os.path.join(WORK, "tenant_1.db")
    pid, period = seed(TDB)
    print("沙箱 %s ← 克隆 server/tenant_1.db · 期次 id=%s %s~%s · 商品 id=%s"
          % (WORK, period["id"], period["order_start"], period["order_end"], pid))

    from fastapi import HTTPException
    from db.connection import tenant_scope, get_db
    import db.queries.forecast_rules as fr
    import routers.forecast_submissions as fs
    import erp_db

    # 打桩鉴权：本脚本验业务判据，不验鉴权链路。
    fs._auth = lambda request: {"id": 1, "username": "admin",
                                "display_name": "沙箱管理员", "role": "boss"}

    GOOD_STORE = {"id": 1, "name": "沙箱门店"}
    GOOD_ITEMS = [{"product_id": pid, "product_name": "沙箱商品", "spec": "200g",
                   "unit": "件", "quantity": 5}]

    async def _create(body, bad_json):
        return await fs.create_submission(FakeReq(body, bad_json))

    async def _matrix(body, bad_json):
        return await fs.save_matrix(FakeReq(body, bad_json))

    class Resp:
        def __init__(self, status, body):
            self.status_code, self._b = status, body

        @property
        def body(self):
            return json.dumps(self._b, ensure_ascii=False).encode()

    def _envelope(e):
        """补出 `core.register_exception_handler::http_exception_handler` 的信封 ——
        直调路由时没有 FastAPI 处理器，`HTTPException` 会原样抛出，生产中它会被转成
        `error_envelope`。补上同一层，才谈得上「验的是真实回执形状」。"""
        d = e.detail
        msg = (d.get("error") or d.get("detail") or str(d)) if isinstance(d, dict) else str(d)
        return {"ok": False, "success": False, "data": None,
                "detail": msg, "message": msg, "error": msg, "code": e.status_code}

    def call(func, body, bad_json=False, raise_through=False):
        with tenant_scope(1):
            try:
                r = asyncio.run(func(body, bad_json))
            except HTTPException as e:
                if raise_through:
                    raise
                return Resp(e.status_code, _envelope(e))
        if hasattr(r, "status_code"):
            return Resp(r.status_code, json.loads(r.body))
        return Resp(200, r)

    def call_create(body, bad_json=False, raise_through=False):
        return call(_create, body, bad_json, raise_through)

    def call_matrix(body, bad_json=False, raise_through=False):
        return call(_matrix, body, bad_json, raise_through)

    def status_of(r):
        return r.status_code

    def body_of(r):
        return json.loads(r.body)

    def kinds_of(r):
        return [v["kind"] for v in (body_of(r).get("violations") or [])]

    def matrix_body(rows, customers=None):
        return {"start": period["order_start"], "end": period["order_end"],
                "period_id": period["id"], "customers": customers or ["沙箱A店"], "rows": rows}

    # ══════════════ Z 特征化：新库缺 period_id（记录，不改本入口）══════════════
    # 现场事实（本脚本顺手查证，非本轮改动引入）：`forecast_submissions.period_id`
    # **既不在主库 DDL 里、也不在 tenant_db_init 拷贝出来的 schema 里** —— 它是
    # `erp_db._ensure_forecast_tables()` 运行时 `ALTER TABLE ADD COLUMN` 补的
    # （erp_db.py:16560-16566）。而 `create_submission` 的幂等查询读 `period_id`
    # **却不管建表**，上游的 `forecast_period_get` / `forecast_open_periods` 也都不建表。
    # ⇒ 理论风险：全新租户 + 已建期次 + 从未走过任一建表路径 ⇒ 报单 500。
    # 生产实测**不可达**（期次必须先在 Web 端建，而 Web 侧建期次/付款都会建表）。
    # 因此只做特征化记录、不改本入口 —— 是否加固留用户拍板（见交付说明「需确认事项」）。
    fp_z = fingerprint(TDB)
    z_err = None
    try:
        call_create({"store": GOOD_STORE, "items": GOOD_ITEMS}, raise_through=True)
    except Exception as e:
        z_err = "%s: %s" % (type(e).__name__, e)
    ok(z_err is not None and "no such column" in z_err,
       "Z1 特征化：未建表的新库上报单确实抛 no such column（实得 %r）" % z_err)
    ok(fingerprint(TDB) == fp_z, "Z1b 该失败没有写入任何业务行")

    # 模拟「Web 端已建过期次 / 走过保存」——即生产上的真实前置。此后所有用例都在
    # **正确 schema** 上跑（这也是 `save_matrix` 自己会做的那一步）。
    with tenant_scope(1):
        with get_db() as _c:
            erp_db._ensure_forecast_tables(_c)
    cols = [r[1] for r in sqlite3.connect("file:%s?mode=ro" % TDB, uri=True)
            .execute("PRAGMA table_info(forecast_submissions)")]
    ok("period_id" in cols, "Z2 建表后 period_id 到位（%d 列）" % len(cols))

    # ══════════════════════════ A 规则读写 ══════════════════════════
    ok(fr.get_rules() == fr.RULES_DEFAULTS, "A1 未配时 get_rules = 默认 %r" % fr.get_rules())
    ok(fr.get_rules()["qty_max"] == 99999, "A1b 默认上限 = 99999")
    with tenant_scope(1):
        r1 = fr.set_rules(qty_max=360)
        ok(r1["qty_max"] == 360 and fr.get_rules()["qty_max"] == 360, "A2 落库后读到 360")
        leaks = []
        for bad in (0, -1, 10 ** 10, "abc", None, True, ""):
            try:
                fr.set_rules(qty_max=bad)
                leaks.append(bad)
            except ValueError:
                pass
        ok(not leaks, "A3 非法 qty_max 全部抛 ValueError（漏放行的：%r）" % leaks)
        ok(fr.get_rules()["qty_max"] == 360, "A4 非法写入被拒后**原值仍 360**（不静默截断成默认）")
        # 逐字段回落：把 name_required 写坏，qty_max 仍要生效
        with sqlite3.connect(TDB) as c:
            c.execute("INSERT OR REPLACE INTO forecast_config(kind,payload,updated_at) VALUES(?,?,?)",
                      (fr.RULES_KIND, json.dumps({"qty_max": 777, "name_required": "???"}), "x"))
        rr = fr.get_rules()
        ok(rr["qty_max"] == 777 and rr["name_required"] is True,
           "A5 逐字段回落（脏 name_required 不连累 qty_max）：%r" % rr)
        fr.set_rules(qty_max=360, name_required=True)
        spec = fr.validation_spec()
        ok(spec["qty_max"] == 360 and spec["name_required"] is True, "A6 validation_spec 与规则同源")
        ok([k["k"] for k in spec["kinds"]] == ["over", "neg", "int", "num", "name"],
           "A7 kinds 命名/顺序与前端 ERR_KINDS 前五项一致：%r" % [k["k"] for k in spec["kinds"]])
        ok("{max}" in spec["kinds"][0]["msg"], "A8 over 文案带 {max} 占位符（前端据此填当前上限）")
        # 复位默认规则：后面 D/E 段要的是**默认口径**（99999），
        # 「360 上限」只在 E 段显式设一次（否则 D8 的 50000 会被 360 拒，看起来像代码错）
        fr.set_rules(qty_max=99999, name_required=True)
        ok(fr.get_rules()["qty_max"] == 99999, "A9 规则已复位默认 99999（供后续段复现生产口径）")

    # ══════════════════════════ B 路由表 ══════════════════════════
    own = {(r.path, tuple(sorted(getattr(r, "methods", []) or []))) for r in fs.router.routes}
    ok(("/api/forecast-submissions/validation-spec", ("GET",)) in own,
       "B1 路由器上有 GET /validation-spec")
    from server import app as _app
    # ⚠️ 不要用 `app.routes` 找子路由：FastAPI 0.139 把 `include_router` 记成
    #    `_IncludedRouter` 节点、**不摊平**子路由（本机实测 460 项里 92 个是这种节点）
    #    ⇒ 拿 `app.routes` 过滤会得到空集，看起来像「路由没注册」。走 OpenAPI 路径表。
    paths = set(_app.openapi().get("paths", {}).keys())
    ok("/api/forecast-submissions/validation-spec" in paths,
       "B2 整站 OpenAPI 里有 GET /validation-spec（顺带证明服务还能装配起来，共 %d 条路径）"
       % len(paths))
    ok("/api/forecast-submissions/save-matrix" in paths, "B3 save-matrix 仍在")
    ok("/api/forecast-submissions" in paths, "B4 小程序提交入口仍在")
    ok("/api/forecast-submissions/summary" in paths, "B5 summary 仍在（小程序共用，不能动）")
    ok("/api/forecast-submissions/stores" in paths, "B6 小程序 /stores 仍在")

    # ══════════════════════════ C validation-spec 端点 ══════════════════════════
    with tenant_scope(1):
        r = fs.validation_spec(FakeReq(None))
    ok(r.get("ok") is True and r["spec"]["qty_max"] == 99999 and len(r["spec"]["kinds"]) == 5,
       "C1 端点载荷 = 默认规则（qty_max=%r · %d 类）"
       % (r.get("spec", {}).get("qty_max"), len(r.get("spec", {}).get("kinds") or [])))

    # ══════════════════════════ D 小程序入口 ══════════════════════════
    fp0 = fingerprint(TDB)
    r = call_create({"store": GOOD_STORE, "items": GOOD_ITEMS})
    ok(status_of(r) == 200 and body_of(r).get("ok") is True, "D1 好载荷通过：%r" % (body_of(r),))
    ok(fingerprint(TDB) != fp0, "D1b 好载荷**真的写了库**（否则后续「没变」的断言全是空的）")
    fp_good = fingerprint(TDB)

    for body, want, why in (
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity="12箱")]}, "num", "前缀数字串"),
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=-3)]}, "neg", "负数"),
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=100000)]}, "over", "超默认上限 99999"),
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity="1.5")]}, "int", "非整数"),
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity="abc")]}, "num", "非数字"),
        ({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=True)]}, "num", "bool"),
    ):
        r = call_create(body)
        ok(status_of(r) == 400 and kinds_of(r) == [want],
           "D2 小程序 %s → 400 [%s]（实得 %s %r）" % (why, want, status_of(r), kinds_of(r)))

    ok(fingerprint(TDB) == fp_good,
       "D3 🔴 被拒的提交**没删掉上一次的好单**（v158「要么完整覆盖、要么原样不动」仍成立）")

    r = call_create({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=0)]})
    ok("所有明细数量都为 0" in str(body_of(r).get("detail")),
       "D4 回归：qty=0 是「未填」，走既有整单空判据而非 violations：%r"
       % (body_of(r).get("detail"),))
    ok(body_of(r).get("violations") is None, "D4b qty=0 **不产生 violations**（0 不是错误）")

    r = call_create({"store": {"id": 0}, "items": [dict(GOOD_ITEMS[0], quantity="12箱")]})
    ok(status_of(r) == 400 and "门店" in str(body_of(r).get("detail")),
       "D5 顺序：门店授权在数量判据**之前**（先答门店，不先答数量）：%r"
       % (body_of(r).get("detail"),))

    r = call_create({"store": GOOD_STORE, "items": []})
    ok(status_of(r) == 400 and "不能为空" in str(body_of(r).get("detail")), "D6 空明细 → 400")
    r = call_create(None, bad_json=True)
    ok(status_of(r) == 400 and "格式错误" in str(body_of(r).get("detail")), "D7 JSON 坏 → 400")

    r = call_create({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=50000)]})
    ok(status_of(r) != 400, "D8 回归：50000 不再被 10000 老上限拒（实得 %s）" % status_of(r))
    src_router = open(os.path.join(SERVER, "routers/forecast_submissions.py"), encoding="utf-8").read()
    ok("qty > 10000" not in src_router and "最大 10000" not in src_router,
       "D9 源码里不再存在「10000 上限」的**代码**（注释里提到历史口径不算）")

    # ══════════════════════════ E Web 入口 ══════════════════════════
    fp1 = fingerprint(TDB)
    r = call_matrix(matrix_body([{"product_id": pid, "product_name": "沙箱商品", "unit": "件",
                                  "qty_by_unit": {"沙箱A店": 7}}]))
    ok(status_of(r) == 200 and body_of(r).get("success") is True, "E1 好载荷通过：%r" % (body_of(r),))
    ok(fingerprint(TDB) != fp1, "E1b 好载荷真的写了库")
    fp_good2 = fingerprint(TDB)

    # 把上限调到 360（生产实测真实最大量），验「租户可配的上限真的生效」——
    # 这也是「口径单源」的落地形态：改一处（规则表）⇒ 两个入口同时改判。
    with tenant_scope(1):
        fr.set_rules(qty_max=360)
    r = call_create({"store": GOOD_STORE, "items": [dict(GOOD_ITEMS[0], quantity=400)]})
    ok(status_of(r) == 400 and kinds_of(r) == ["over"] and "360" in body_of(r)["violations"][0]["msg"],
       "E1c 上限改 360 后小程序入口立刻按 360 判，且文案带 360：%r"
       % (body_of(r).get("violations"),))

    for rows, want, why in (
        ([{"product_id": pid, "product_name": "沙箱商品", "qty_by_unit": {"沙箱A店": "12箱"}}], "num", "前缀数字串"),
        ([{"product_id": pid, "product_name": "沙箱商品", "qty_by_unit": {"沙箱A店": -1}}], "neg", "负数"),
        ([{"product_id": pid, "product_name": "沙箱商品", "qty_by_unit": {"沙箱A店": 400}}], "over", "超上限 360"),
        ([{"product_id": pid, "product_name": "沙箱商品", "qty_by_unit": {"沙箱A店": "2.5"}}], "int", "非整数"),
        ([{"product_id": pid, "product_name": "", "qty_by_unit": {"沙箱A店": 3}}], "name", "有量却无名"),
        ([{"product_id": pid, "product_name": "沙箱商品", "qty_by_unit": {"沙箱A店": True}}], "num", "bool"),
    ):
        r = call_matrix(matrix_body(rows))
        ok(status_of(r) == 400 and kinds_of(r) == [want],
           "E2 Web %s → 400 [%s]（实得 %s %r）" % (why, want, status_of(r), kinds_of(r)))

    ok(fingerprint(TDB) == fp_good2,
       "E3 🔴 被拒的保存 **DB 指纹一字不变** —— 门禁在事务之前，结构上排除「半写」")
    with tenant_scope(1):
        fr.set_rules(qty_max=99999)

    r = call_matrix(matrix_body([{"product_id": "abc", "product_name": "自建行",
                                  "qty_by_unit": {"沙箱A店": 2}}]))
    ok(status_of(r) != 500, "E4 v211b 同类修复：脏 product_id 不再 500（实得 %s）" % status_of(r))

    r = call_matrix(matrix_body([{"product_id": pid, "product_name": "甲",
                                  "qty_by_unit": {"沙箱A店": "12箱", "没这一列": "也脏"}}],
                                customers=["沙箱A店"]))
    ok(status_of(r) == 400 and kinds_of(r) == ["num"],
       "E5 作用域：不在 customers 的键不判（与保存逻辑的读取范围逐字一致）：%r" % kinds_of(r))

    r = call_matrix(None, bad_json=True)
    ok(status_of(r) == 400 and "缺少" in str(body_of(r).get("detail")), "E6 JSON 坏 → 400 缺少…")

    with tenant_scope(1):
        fr.set_rules(name_required=False)
    r = call_matrix(matrix_body([{"product_id": pid, "product_name": "",
                                  "qty_by_unit": {"沙箱A店": 4}}]))
    ok(status_of(r) == 200, "E7 name_required=False 时空名放行（实得 %s）" % status_of(r))
    with sqlite3.connect("file:%s?mode=ro" % TDB, uri=True) as c:
        nm = c.execute("SELECT product_name FROM forecast_submission_items WHERE product_id=? "
                       "ORDER BY id DESC LIMIT 1", (pid,)).fetchone()
    ok(nm and nm[0] == "商品#%d" % pid, "E7b 占位名兜底生效：%r" % (nm and nm[0],))
    with tenant_scope(1):
        fr.set_rules(name_required=True)

    # ══════════════════════ F 两端对账（同源的证据）══════════════════════
    r1 = call_create({"store": GOOD_STORE, "items": [
        {"product_id": pid, "product_name": "甲", "quantity": "12箱"}]})
    r2 = call_matrix(matrix_body([{"product_id": pid, "product_name": "甲",
                                   "qty_by_unit": {"沙箱A店": "12箱"}}]))
    ok(kinds_of(r1) == kinds_of(r2) == ["num"],
       "F1 🔴 同一份脏载荷，两个写入口报出**同一组 kind**：小程序 %r vs Web %r" % (kinds_of(r1), kinds_of(r2)))
    m1 = body_of(r1)["violations"][0]["msg"]
    m2 = body_of(r2)["violations"][0]["msg"]
    ok(m1 == m2 == fr.MSG_NUM, "F2 两端**同一句文案**：%r" % m1)
    ok(body_of(r1)["violations"][0]["row"] == 1 and body_of(r2)["violations"][0]["row"] == 1,
       "F3 两端 row 口径一致（1-based）")
    ok(body_of(r2)["violations"][0]["col"] == "沙箱A店",
       "F4 Web 端 col = 客户名（前端据此定位到那一**格**）：%r" % body_of(r2)["violations"][0]["col"])
    ok(body_of(r1)["violations"][0]["col"] == "报单数量",
       "F5 小程序端 col = 「报单数量」（无客户列维度）")
    ok(body_of(r1)["ok"] is False and body_of(r1)["code"] == 400 and "violations" in body_of(r1),
       "F6 信封字段齐（ok/success/detail/message/error/code + violations）")

    # ══════════ I v213-B1 乐观锁（内容指纹 · 409 冲突 · force 覆盖）══════════
    # 指纹必须**只由内容决定**：同一内容重复保存指纹不变（否则乐观锁立刻变成「每保存必冲突」）。
    PER = dict(period_id=period["id"], start_date=period["order_start"], end_date=period["order_end"])

    def revq(**over):
        kw = dict(PER)
        kw.update(over)
        with tenant_scope(1):
            return erp_db.forecast_matrix_rev(**kw)

    def revhex(**over):
        return revq(**over).get("rev") or ""

    r0 = revq()
    ok(len(r0.get("rev") or "") == 16 and all(c in "0123456789abcdef" for c in r0["rev"]),
       "I1 指纹形状 = 16 位十六进制（实得 %r）" % (r0.get("rev"),))
    ok(int(r0.get("items") or 0) >= 1,
       "I1b 覆盖三段：明细 %d 条 / 附加值 %d 条 / 删列名册 %d 条"
       % (r0.get("items", -1), r0.get("extra", -1), r0.get("hidden", -1)))
    _at = r0.get("at") or ""
    ok(len(_at) >= 16 and _at[4] == "-" and _at[10] == " ",
       "I1c 带最后写入时刻（YYYY-MM-DD HH:MM:SS）：%r" % _at)
    # I1c2 **时区**：指纹时刻必须是**本地时间**（它会显示给用户 —— 冲突对话框「谁在几点改过」）。
    #   实据：`forecast_submissions.created_at` 在**生产**库里存的是 **UTC**
    #     （真机取证 v213-prod-verify R3d/R4d：库里 10:41 而实际 18:41），而本项目其它时间戳
    #     一律 localtime（含**同一事务**里的 `forecast_period_confirm.confirmed_at`）。
    #     直发 UTC ⇒ 经销商看到一个早 8 小时的时间，把那件事误判成「上午的、与我无关」。
    #   🔴 判据必须用**显式构造**，不能盖「表 DEFAULT」——本机快照库的 DEFAULT 是 localtime
    #     （旧快照），生产是 CURRENT_TIMESTAMP（UTC）⇒ 环境相关的判据在本机会给出**方向相反**的
    #     结论（实测本机 delta 恰好也是 28800，差点被误读成「转换没生效」）。
    #   做法：插一行 created_at 已知为 UTC 的行，断言读出来正好加上本地偏移。
    import datetime as _dt
    # ⚠️ 时间戳取**未来**：该函数取的是「created_at 最大的那行」（最后写入）——
    #    用过去的时间戳根本不会被取到，断言就变成在测别的行（实测踩过：给出的仍是当前行）。
    # ⚠️ 断言后**必须删掉**探针行：它会成为 MAX(created_at) ⇒ 之后所有 `matrix_at` 都是它，
    #    I2b（/summary 与指纹同源）会因此误红。插入→断言→清理，不留痕、可逆。
    _utc = "2099-01-02 03:04:05"
    _probe_sid = 0
    with sqlite3.connect(TDB) as _c:
        _cur = _c.execute(
            "INSERT INTO forecast_submissions(user_id,role,store_id,store_name,order_date,status,"
            "total_qty,total_amount,note,period_id,created_at) VALUES(1,'导入',0,'时区探针',?,"
            "'pending',1,0,'tz',?,?)", (period["order_start"], 0, _utc))
        _probe_sid = _cur.lastrowid
        _c.execute("INSERT INTO forecast_submission_items(submission_id,product_id,product_name,spec,"
                   "unit,quantity,price,amount) VALUES(?,?,?,?,?,?,?,?)",
                   (_probe_sid, pid, "时区探针商品", "", "件", 1, 0.0, 0.0))
        _c.commit()
    _off = _dt.datetime.now().astimezone().utcoffset() or _dt.timedelta(0)
    _exp = (_dt.datetime.strptime(_utc, "%Y-%m-%d %H:%M:%S") + _off).strftime("%Y-%m-%d %H:%M:%S")
    _at2 = revq().get("at") or ""
    with sqlite3.connect(TDB) as _c:      # cleanup：不留探针
        _c.execute("DELETE FROM forecast_submission_items WHERE submission_id=?", (_probe_sid,))
        _c.execute("DELETE FROM forecast_submissions WHERE id=?", (_probe_sid,))
        _c.commit()
    ok(_at2 == _exp,
       "I1c2 指纹时刻把库里的 UTC 转成本地（%s UTC + 偏移 %s = %s，实得 %r）"
       % (_utc, _off, _exp, _at2))
    ok(int(r0.get("by_uid") or 0) == 1, "I1d 最后写入人 = 播种时用的 user_id（实得 %r）" % r0.get("by_uid"))

    with tenant_scope(1):
        s = fs.submission_summary(FakeReq(None), start=period["order_start"],
                                  end=period["order_end"], period_id=period["id"])
    ok(s.get("matrix_rev") == r0["rev"],
       "I2  /summary 的 matrix_rev 与指纹**同源**：%r vs %r" % (s.get("matrix_rev"), r0["rev"]))
    ok(s.get("matrix_at") == _at, "I2b matrix_at 同源：%r" % s.get("matrix_at"))
    ok(s.get("matrix_by") == "管理员",
       "I2c matrix_by 解析成显示名（主库 users.id=1）：%r" % s.get("matrix_by"))
    _miss = [k for k in ("date", "rows", "all_units", "confirmed", "imported_products") if k not in s]
    ok(not _miss, "I2d 既有键一个没动（小程序共用该接口）：缺 %r" % _miss)

    # ---- 冲突：用「过期指纹」保存 ⇒ 409 且**一个字节都不写** ----
    fp_i = fingerprint(TDB)
    r = call_matrix(dict(matrix_body([{"product_id": pid, "product_name": "甲", "unit": "件",
                                       "qty_by_unit": {"沙箱A店": 9}}]),
                         base_rev="deadbeefdeadbeef"))
    ok(status_of(r) == 409, "I3 过期指纹 → 409（实得 %s）" % status_of(r))
    ok((body_of(r).get("conflict") or {}).get("current_rev") == r0["rev"],
       "I3b 冲突回执带**当前**指纹（前端据此判断「确实变了」）：%r"
       % (body_of(r).get("conflict") or {}).get("current_rev"))
    ok((body_of(r).get("conflict") or {}).get("by") == "管理员",
       "I3c 冲突回执带「谁改的」显示名：%r" % (body_of(r).get("conflict") or {}).get("by"))
    ok(fingerprint(TDB) == fp_i, "I3d 🔴 409 时 DB 指纹一字不变（门禁在任何写之前）")

    # ---- force：用户明确选「用我这份覆盖」⇒ 放行并写库 ----
    fp_i = fingerprint(TDB)
    r = call_matrix(dict(matrix_body([{"product_id": pid, "product_name": "甲", "unit": "件",
                                       "qty_by_unit": {"沙箱A店": 11}}]),
                         base_rev="deadbeefdeadbeef", force=True))
    ok(status_of(r) == 200 and fingerprint(TDB) != fp_i, "I4 force=true 显式覆盖 → 200 且真的写了库")
    revA = body_of(r).get("matrix_rev") or ""
    ok(bool(revA) and revA != "deadbeefdeadbeef",
       "I4b 回执回传**保存后**的新指纹（前端不用重新载入）：%r" % revA)
    ok(revA == revhex(), "I4c 回执的新指纹 = 保存后重算的指纹（不是凭空生成）：%r" % revhex())

    # ---- 自洽：拿回执指纹继续保存，不会「自己和自己冲突」 ----
    BODY6 = matrix_body([{"product_id": pid, "product_name": "甲", "unit": "件",
                          "qty_by_unit": {"沙箱A店": 11}}])
    r = call_matrix(dict(BODY6, base_rev=revA))
    ok(status_of(r) == 200, "I5 拿回执指纹再保存 → 200（实得 %s %r）"
       % (status_of(r), body_of(r).get("detail")))
    ok((body_of(r).get("matrix_rev") or "") == revA,
       "I6  🔴 同一内容重复保存 ⇒ 指纹**不变**（一次证明两件事：① 指纹按内容、不按自增 id；"
       "② `forecast_period_confirm` 每次保存都被刷新但不计入指纹 ⇒ 重复保存不会误报冲突）：%r vs %r"
       % (body_of(r).get("matrix_rev"), revA))

    # ---- 覆盖面：② 单价 / ③ 删列名册 单独变动也必须让指纹变 ----
    with sqlite3.connect(TDB) as c:
        c.execute("INSERT INTO forecast_extra_qty(period_start,period_end,product_id,product_name,unit,"
                  "extra_qty,case_price) VALUES(?,?,?,?,?,?,?) "
                  "ON CONFLICT(period_start,period_end,product_id) DO UPDATE SET case_price=excluded.case_price",
                  (period["order_start"], period["order_end"], pid, "甲", "件", 0, 88.5))
        c.commit()
    revB = revhex()
    ok(revB != revA, "I7 只改「本期手工单价」⇒ 指纹变（覆盖面含 forecast_extra_qty，保存会覆盖它）")
    with sqlite3.connect(TDB) as c:
        c.execute("INSERT OR IGNORE INTO forecast_hidden_units(store_name, hidden_by) VALUES('沙箱Z店','x')")
        c.commit()
    revC = revhex()
    ok(revC != revB, "I8 只改「删列名册」⇒ 指纹变（列集合变了 = 矩阵变了）")
    with sqlite3.connect(TDB) as c:
        c.execute("DELETE FROM forecast_hidden_units WHERE store_name='沙箱Z店'")
        c.commit()
    ok(revhex() == revB, "I8b 名册复原后指纹回到 revB（可逆、无残留）")

    # ---- 回归：不传 base_rev = 旧前端 ⇒ 完全不判冲突（行为与 v212 逐字相同）----
    r = call_matrix(matrix_body([{"product_id": pid, "product_name": "甲", "unit": "件",
                                  "qty_by_unit": {"沙箱A店": 12}}]))
    ok(status_of(r) == 200, "I9 不传 base_rev（旧前端）→ 200，不做冲突判定（实得 %s）" % status_of(r))

    # ---- 作用域口径：只对本函数管得着的行敏感（与清理条件同源，不是「全库任何改动都报警」）----
    rev_before = revhex()
    with sqlite3.connect(TDB) as c:
        for od in (period["order_start"], "2020-01-01"):
            cur = c.execute(
                "INSERT INTO forecast_submissions(user_id,role,store_id,store_name,order_date,status,"
                "total_qty,total_amount,note,period_id) VALUES(1,'导入',0,'沙箱P0店',?,'pending',1,0,'i10',0)",
                (od,))
            c.execute("INSERT INTO forecast_submission_items(submission_id,product_id,product_name,spec,"
                      "unit,quantity,price,amount) VALUES(?,?,?,?,?,?,?,?)",
                      (cur.lastrowid, pid, "P0商品", "", "件", 1, 0.0, 0.0))
        c.commit()
    rev_win = revhex()
    ok(rev_win != rev_before, "I10  新增 period_id=0 导入行（含窗口内一条）⇒ 指纹变")
    with sqlite3.connect(TDB) as c:
        c.execute("UPDATE forecast_submission_items SET quantity=99 WHERE submission_id IN "
                  "(SELECT id FROM forecast_submissions WHERE store_name='沙箱P0店' AND order_date='2020-01-01')")
        c.commit()
    ok(revhex() == rev_win,
       "I10b 窗口外的 period_id=0 历史行**不计入**本期（双口径 `period_id=? OR (period_id=0 AND between)` 生效）")
    with sqlite3.connect(TDB) as c:
        c.execute("UPDATE forecast_submission_items SET quantity=88 WHERE submission_id IN "
                  "(SELECT id FROM forecast_submissions WHERE store_name='沙箱P0店' AND order_date=?)",
                  (period["order_start"],))
        c.commit()
    ok(revhex() != rev_win, "I10c 窗口内的 period_id=0 行**计入**（回退口径生效 ⇒ 保存确实会清理它）")

    # ---- Z3 特征化（记录，不在本轮改）：period_id=0 时作用域**退化** ----
    # `FORECAST_IMPORT_SCOPE_SQL` 在 pid=0 时等价于 `role='导入' AND period_id=0` —— **不带日期
    # 限定**。即：保存一个「解析不到期次」的窗口时会连**其它日期**的 period_id=0 导入行一起清掉
    # 重建。指纹忠实镜像了该口径（这正是「同源」的表现）。是否收窄属**口径决定**，留用户拍板；
    # 若决定收窄，改动点只有一个常量（见 erp_db.FORECAST_IMPORT_SCOPE_SQL 处注释）。
    rev_p0a = revhex(period_id=0)
    with sqlite3.connect(TDB) as c:
        c.execute("UPDATE forecast_submission_items SET quantity=777 WHERE submission_id IN "
                  "(SELECT id FROM forecast_submissions WHERE store_name='沙箱P0店' AND order_date='2020-01-01')")
        c.commit()
    rev_p0b = revhex(period_id=0)
    ok(rev_p0a != rev_p0b,
       "Z3 特征化：pid=0 时窗口外的 period_id=0 行也参与指纹（作用域退化为「全部 period_id=0」）")

    # ---- 结构性护栏：期次归属条件**只有一处定义**（防「同一规则多处实现」再分叉）----
    # 本轮发现：同一条归属规则在 4 个文件里被手抄了 8 份 ⇒ 改一处忘一处的必然分叉。
    # 已收敛 erp_db 内的 4 处（看板聚合 / 期次级联删除 / 汇总总表 / 导入登记行底）。
    # ⚠️ 构造器用 `%s` 拼别名 ⇒ 源码里**不该再出现**那个字面串（非注释行 0 处）。
    ok(erp_db.forecast_period_scope_sql("s") ==
       "(s.period_id=? OR (s.period_id=0 AND s.order_date BETWEEN ? AND ?))",
       "I11 归属构造器产出的 SQL 与既有语句**逐字一致**（否则改的是口径、不是写法）：%r"
       % erp_db.forecast_period_scope_sql("s"))
    ok(erp_db.forecast_period_scope_sql("") == "(period_id=? OR (period_id=0 AND order_date BETWEEN ? AND ?))",
       "I11b 不带别名形态逐字一致")
    ok(erp_db.FORECAST_IMPORT_SCOPE_SQL == "role='导入' AND " + erp_db.FORECAST_PERIOD_SCOPE_SQL,
       "I11c 导入作用域 = 角色前缀 + 归属条件（同一来源拼出，无第二份）")
    _src_router = open(os.path.join(SERVER, "routers/forecast_submissions.py"), encoding="utf-8").read()
    ok("db.FORECAST_IMPORT_SCOPE_SQL" in _src_router,
       "I11d 路由里的清理条件取自 erp_db 的唯一常量（不是手抄字符串）")
    ok("period_id=0 AND order_date BETWEEN" not in _src_router,
       "I11e 路由源码里不再出现手抄的作用域条件")
    _src_erp = open(os.path.join(SERVER, "erp_db.py"), encoding="utf-8").read()
    _n_copy = sum(1 for ln in _src_erp.splitlines()
                  if "period_id=0 AND order_date BETWEEN" in ln and not ln.lstrip().startswith("#"))
    ok(_n_copy == 0, "I11f erp_db 里该条件不再有手抄副本（实得非注释行 %d 处）" % _n_copy)
    _rest = []
    for _f in ("erp_db.py", "datasource_adapter.py", "scheduler.py",
               "routers/forecast_submissions.py", "routers/forecast_config.py"):
        _t = open(os.path.join(SERVER, _f), encoding="utf-8").read()
        _c = sum(1 for ln in _t.splitlines()
                 if "period_id=0 AND" in ln and not ln.lstrip().startswith("#")
                 and "%speriod_id=0" not in ln)   # 排除构造器自身
        if _c:
            _rest.append("%s×%d" % (_f, _c))
    print("  · 归属规则剩余「形状不同」的副本（本轮未动，留后续统一）：%s" % ("，".join(_rest) or "无"))

    # ══════ H 灵敏度自检（给 E2/E3 做反证）══════
    # 「全绿」只说明没红，不说明**绿是由本判据造成的**。这里把门禁摘掉跑同一份脏载荷：
    # 若仍然是 400，说明挡住它的是别的守卫、E2/E3 的结论就不成立；变成 200 且真的写库，
    # 才证明那 400 + 「DB 一字未动」确实源于本轮的判据门禁。
    saved_vfm = fr.violations_for_matrix
    fr.violations_for_matrix = lambda rows, customers, rules=None: []
    fpH = fingerprint(TDB)
    rH = call_matrix(matrix_body([{"product_id": pid, "product_name": "甲",
                                   "qty_by_unit": {"沙箱A店": "12箱"}}]))
    fr.violations_for_matrix = saved_vfm
    ok(status_of(rH) == 200 and fingerprint(TDB) != fpH,
       "H1 摘掉门禁后同一脏载荷变 200 且写了库 ⇒ E2/E3 的 400+未动确实来自本判据（实得 %s）"
       % status_of(rH))
    rH2 = call_matrix(matrix_body([{"product_id": pid, "product_name": "甲",
                                    "qty_by_unit": {"沙箱A店": "12箱"}}]))
    ok(status_of(rH2) == 400 and kinds_of(rH2) == ["num"],
       "H2 恢复门禁后同一载荷又回 400[num]（证明 H1 只是摘了门禁，没动别的东西）")

    # 给 I3 的反证：把指纹函数固定成「恒等于客户端带来的 base_rev」⇒ 同一过期载荷必须变 200 并写库。
    # 只固定数值、不动别处，才能证明 I3 的 409 确实来自乐观锁本身。
    _saved_revf = erp_db.forecast_matrix_rev
    erp_db.forecast_matrix_rev = lambda **kw: {"rev": "deadbeefdeadbeef", "at": "",
                                               "by_uid": 0, "items": 0, "extra": 0, "hidden": 0}
    fpX = fingerprint(TDB)
    rX = call_matrix(dict(matrix_body([{"product_id": pid, "product_name": "甲",
                                        "qty_by_unit": {"沙箱A店": 31}}]),
                          base_rev="deadbeefdeadbeef"))
    erp_db.forecast_matrix_rev = _saved_revf
    ok(status_of(rX) == 200 and fingerprint(TDB) != fpX,
       "H3 摘下乐观锁后同一「过期指纹」载荷变 200 且写了库 ⇒ I3/I3d 的 409+未动来自本判据（实得 %s）"
       % status_of(rX))
    rX2 = call_matrix(dict(matrix_body([{"product_id": pid, "product_name": "甲",
                                         "qty_by_unit": {"沙箱A店": 32}}]),
                           base_rev="deadbeefdeadbeef"))
    ok(status_of(rX2) == 409, "H4 恢复乐观锁后同一载荷又回 409（证明 H3 只摘了锁，没动别的东西）")

    # ══════════════════════════ G 原件未动 ══════════════════════════
    moved = [p for p, h in originals.items() if sha(p) != h]
    ok(not moved, "G1 🔴 源库原件 sha256 未变（共 %d 个）：%r" % (len(originals), moved))

    print("\n" + "=" * 78)
    if FAILS:
        print("VERDICT: FAIL（%d/%d 条红）" % (len(FAILS), CHECKS[0]))
        for x in FAILS:
            print("   - " + x)
    else:
        print("VERDICT: PASS —— %d 条判据全绿" % CHECKS[0])
    print("=" * 78)
    shutil.rmtree(WORK, ignore_errors=True)
    sys.exit(2 if FAILS else 0)


if __name__ == "__main__":
    main()
