#!/usr/bin/env python3
"""v658 门店维度分摊 · 隔离租户(tenant_99) e2e —— Task#41 验收探针。

真机 HTTP 全链路：save-matrix 造门店报量 → setup(候选/成员) → preview(预演)
→ override(负例 + 写占比) → setup 复读 → save-matrix(落账) → 唯一键自证 → 清除。
只在 tenant_99 上跑，绝不触碰 tenant_1/tenant_10 数据。
"""
import json, os, secrets, sqlite3, subprocess, sys, datetime

BASE = "http://127.0.0.1:8700"
MASTER = "/opt/hergent-erp/erp.db"
TDB = "/opt/hergent-erp/tenant_99.db"
TID, PID, PRID = 99, 1, 1001
START, END = "2026-10-23", "2026-10-29"
ALIAS_DJ, ALIAS_WY, ALIAS_EXT, ALIAS_OFF = "E2E东津", "E2E吾悦", "E2E外部客户", "E2E停用店"

FAILS, PASSES = [], []


def ok(name, cond, got=""):
    if cond:
        PASSES.append(name)
        print("  PASS  %s" % name)
    else:
        FAILS.append("%s  got=%s" % (name, got))
        print("  FAIL  %s   got=%s" % (name, got))


def http(method, path, body=None, tok=None, tid=TID):
    cmd = ["curl", "-s", "-w", "\n__HTTP%{http_code}", "-X", method, BASE + path]
    if tok:
        cmd += ["-H", "Authorization: Bearer " + tok]
    if tid:
        cmd += ["-H", "X-Tenant-Id: " + str(tid)]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body, ensure_ascii=False)]
    raw = subprocess.run(cmd, capture_output=True, text=True).stdout
    code = raw.rsplit("__HTTP", 1)[-1].strip()
    text = raw.rsplit("\n__HTTP", 1)[0]
    try:
        return int(code), json.loads(text)
    except Exception:
        return int(code), {"_raw": text[:600]}


def mk_session(uid):
    tok = "e2e658" + secrets.token_hex(24)
    exp = (datetime.datetime.now() + datetime.timedelta(minutes=40)).strftime("%Y-%m-%d %H:%M:%S")
    c = sqlite3.connect(MASTER)
    c.execute("insert into sessions(token,user_id,expires_at) values(?,?,?)", (tok, uid, exp))
    c.commit()
    c.close()
    return tok


def q(sql, args=()):
    c = sqlite3.connect(TDB)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


tok = mk_session(2)
print("session ok (boss uid=2, tenant 99)\n")

# ════════ A. save-matrix 造门店报量（真实写路径） ════════
print("A. save-matrix 造报量")
mtx = {"start": START, "end": END, "period_id": PID,
       "customers": [ALIAS_DJ, ALIAS_WY, ALIAS_EXT, ALIAS_OFF],
       "rows": [{"product_id": PRID, "product_name": "E2E低温酸奶", "spec": "1*12", "unit": "包",
                 "price": 0,
                 "qty_by_unit": {ALIAS_DJ: 120, ALIAS_WY: 240, ALIAS_EXT: 60, ALIAS_OFF: 36}}]}
c, r = http("POST", "/api/forecast-submissions/save-matrix", mtx, tok)
ok("A1 save-matrix 200", c == 200, (c, str(r)[:220]))
subs = q("select store_name, status, role from forecast_submissions where period_id=?", (PID,))
ok("A2 生成 4 条门店报单", len([s for s in subs if s["store_name"] in
                              (ALIAS_DJ, ALIAS_WY, ALIAS_EXT, ALIAS_OFF)]) == 4,
   [s["store_name"] for s in subs])
items = q("select i.product_id, i.quantity, i.spec, i.unit, s.store_name "
          "from forecast_submission_items i join forecast_submissions s on s.id=i.submission_id "
          "where s.period_id=?", (PID,))
ok("A3 商品行 4 条且按门店分开", len(items) == 4, items)

# ════════ B. setup：候选池 / 成员 / unmapped ════════
print("\nB. extra-alloc/setup（门店维度成员）")
c, r = http("GET", "/api/product-targets/extra-alloc/setup?period_id=%d&product_id=%d" % (PID, PRID), None, tok)
ok("B0 setup 200", c == 200, (c, str(r)[:300]))
d = (r or {}).get("data") or {}
mem = d.get("members") or []
basis = d.get("basis")
unmapped = d.get("unmapped_box")
pool = d.get("candidates") or []
print("      basis=%r members=%s unmapped=%r" % (basis, [(m.get("store_name"), m.get("employee_id"),
      m.get("reported_box"), m.get("ratio")) for m in mem], unmapped))
ok("B1 basis=reported（无目标走 L2）", basis == "reported", basis)
ok("B2 成员 2 行（同一员工两门店拆开）", len(mem) == 2, len(mem))
ok("B3 两行 employee_id 都是 3", sorted([m.get("employee_id") for m in mem]) == [3, 3],
   [m.get("employee_id") for m in mem])
ok("B4 store_name = 东津/吾悦（★门店而非工号）",
   sorted([m.get("store_name") for m in mem]) == sorted([ALIAS_DJ, ALIAS_WY]),
   [m.get("store_name") for m in mem])
rb = {m.get("store_name"): m.get("reported_box") for m in mem}
ok("B5 报量按门店拆：东津 10 / 吾悦 20",
   rb.get(ALIAS_DJ) == 10 and rb.get(ALIAS_WY) == 20, rb)
ra = {m.get("store_name"): m.get("ratio") for m in mem}
ok("B6 占比 33.33 / 66.67", abs((ra.get(ALIAS_DJ) or 0) - 33.33) < 0.02
   and abs((ra.get(ALIAS_WY) or 0) - 66.67) < 0.02, ra)
ok("B7 unmapped=8（外部5 + 停用3，不参与内部分摊）", abs((unmapped or 0) - 8.0) < 1e-6, unmapped)
pool_names = sorted([p.get("store_name") for p in pool])
ok("B8 候选池只含启用内部别名", pool_names == sorted([ALIAS_DJ, ALIAS_WY]), pool_names)

# ════════ C. preview 预演 ════════
print("\nC. extra-alloc/preview")
c, r = http("POST", "/api/product-targets/extra-alloc/preview",
            {"period_id": PID, "product_id": PRID, "total_delta": 10}, tok)
ok("C0 preview 200", c == 200, (c, str(r)[:200]))
pd = (r or {}).get("data") or {}
rows = pd.get("rows") or []
print("      ratio_total=%r rows=%s" % (pd.get("ratio_total"),
      [(x.get("store_name"), x.get("ratio"), x.get("alloc_box")) for x in rows]))
ok("C1 预演 2 行", len(rows) == 2, len(rows))
ok("C2 占比合计 100", abs((pd.get("ratio_total") or 0) - 100) < 0.01, pd.get("ratio_total"))
al = {x.get("store_name"): x.get("alloc_box") for x in rows}
ok("C3 加单按占比分：3.33 / 6.67", abs((al.get(ALIAS_DJ) or 0) - 3.33) < 0.02
   and abs((al.get(ALIAS_WY) or 0) - 6.67) < 0.02, al)

# ════════ D. override 负例（先跑，避免脏写） ════════
print("\nD. override 负例（服务端三条校验）")
c, r = http("PUT", "/api/product-targets/extra-alloc/override",
            {"period_id": PID, "product_id": PRID,
             "ratios": [{"store_name": ALIAS_DJ, "ratio": 60}, {"store_name": ALIAS_WY, "ratio": 30}]}, tok)
ok("D1 Σ=90 被拒 422", c == 422 and "100" in json.dumps(r, ensure_ascii=False), (c, str(r)[:200]))
c, r = http("PUT", "/api/product-targets/extra-alloc/override",
            {"period_id": PID, "product_id": PRID,
             "ratios": [{"store_name": "E2E不存在店", "ratio": 50}, {"store_name": ALIAS_DJ, "ratio": 50}]}, tok)
ok("D2 凭空造人被拒 422", c == 422 and "可分摊名单" in json.dumps(r, ensure_ascii=False),
   (c, str(r)[:200]))
c, r = http("PUT", "/api/product-targets/extra-alloc/override",
            {"period_id": PID, "product_id": PRID,
             "ratios": [{"store_name": ALIAS_DJ, "ratio": -10}, {"store_name": ALIAS_WY, "ratio": 110}]}, tok)
ok("D3 负占比被拒 422", c == 422, (c, str(r)[:160]))
n_before = len(q("select id from forecast_alloc_ratio where period_id=?", (PID,)))
ok("D4 负例未写法（0 行）", n_before == 0, n_before)

# ════════ E. override 正常写入 ════════
print("\nE. override 写入门店占比 30/70")
c, r = http("PUT", "/api/product-targets/extra-alloc/override",
            {"period_id": PID, "product_id": PRID,
             "ratios": [{"store_name": ALIAS_DJ, "ratio": 30}, {"store_name": ALIAS_WY, "ratio": 70}]}, tok)
ok("E1 override 200 且 count=2", c == 200 and ((r.get("data") or {}).get("count") == 2),
   (c, str(r)[:240]))
far = q("select employee_id, employee_name, store_name, ratio, operator from forecast_alloc_ratio "
        "where period_id=? order by store_name", (PID,))
print("      far=%s" % far)
ok("E2 落库 2 行", len(far) == 2, len(far))
ok("E3 store_name 正确且非空", sorted([x["store_name"] for x in far]) == sorted([ALIAS_DJ, ALIAS_WY]),
   [x["store_name"] for x in far])
ok("E4 ratio=30/70", sorted([x["ratio"] for x in far]) == [30.0, 70.0], [x["ratio"] for x in far])
ok("E5 employee_id 都是 3", sorted([x["employee_id"] for x in far]) == [3, 3],
   [x["employee_id"] for x in far])
ok("E6 operator 非空（操作留痕）", all((x["operator"] or "").strip() for x in far),
   [x["operator"] for x in far])

# ════════ F. setup 复读：override 优先于 L2 ════════
print("\nF. setup 复读（override 生效）")
c, r = http("GET", "/api/product-targets/extra-alloc/setup?period_id=%d&product_id=%d" % (PID, PRID), None, tok)
d = (r or {}).get("data") or {}
mem = d.get("members") or []
print("      basis=%r override=%r members=%s" % (d.get("basis"), d.get("override"),
      [(m.get("store_name"), m.get("ratio")) for m in mem]))
ok("F1 basis=override", d.get("basis") == "override", d.get("basis"))
ok("F2 override 元信息 count=2 且 operator 非空",
   (d.get("override") or {}).get("count") == 2 and bool(((d.get("override") or {}).get("operator") or "").strip()),
   d.get("override"))
ok("F3 成员占比变为 30/70",
   sorted([m.get("ratio") for m in mem]) == [30.0, 70.0], [m.get("ratio") for m in mem])

# ════════ G. save-matrix 落账（13 列 INSERT） ════════
print("\nG. save-matrix 落账 forecast_extra_alloc")
mtx2 = dict(mtx)
mtx2["rows"] = [dict(mtx["rows"][0], extra_qty=10)]
c, r = http("POST", "/api/forecast-submissions/save-matrix", mtx2, tok)
ok("G1 save-matrix(extra_qty=10) 200", c == 200, (c, str(r)[:220]))
fea = q("select employee_id, employee_name, store_name, ratio, reported_box, alloc_box, "
        "final_box, basis, operator, period_id from forecast_extra_alloc where period_id=?", (PID,))
print("      fea=%s" % fea)
ok("G2 落账 2 行（同员工两门店各一行）", len(fea) == 2, len(fea))
ok("G3 store_name 正确且非空", sorted([x["store_name"] for x in fea]) == sorted([ALIAS_DJ, ALIAS_WY]),
   [x["store_name"] for x in fea])
ok("G4 basis=override", all(x["basis"] == "override" for x in fea), [x["basis"] for x in fea])
ok("G5 ratio=30/70", sorted([x["ratio"] for x in fea]) == [30.0, 70.0], [x["ratio"] for x in fea])
ab = {x["store_name"]: x["alloc_box"] for x in fea}
ok("G6 加单 10 箱按 30/70 分 = 3.0 / 7.0",
   abs((ab.get(ALIAS_DJ) or 0) - 3.0) < 1e-6 and abs((ab.get(ALIAS_WY) or 0) - 7.0) < 1e-6, ab)
fb = {x["store_name"]: (x["reported_box"], x["final_box"]) for x in fea}
ok("G7 定稿 = 原报量 + 加单（东津 10→13 / 吾悦 20→27）",
   len(fea) == 2 and abs(fb.get(ALIAS_DJ, (0, -1))[1] - 13.0) < 1e-6
   and abs(fb.get(ALIAS_WY, (0, -1))[1] - 27.0) < 1e-6, fb)
ok("G8 operator 非空", all((x["operator"] or "").strip() for x in fea), [x["operator"] for x in fea])

# ════════ H. 唯一键自证：去重键 = 门店（不是员工） ════════
print("\nH. 唯一索引自证")
qq = sqlite3.connect(TDB)
try:
    qq.execute("insert into forecast_extra_alloc(period_id,period_start,period_end,product_id,"
               "employee_id,employee_name,store_name,ratio,reported_box,alloc_box,final_box,basis,operator)"
               " values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (PID, START, END, PRID, 3, "柏万红(E2E)", ALIAS_DJ, 1, 0, 0, 0, "target", "probe"))
    qq.commit()
    ok("H1 同门店重复插入被唯一键拒绝", False, "inserted(no error)")
except sqlite3.IntegrityError as e:
    ok("H1 同门店重复插入被唯一键拒绝", "uq_fea_periodid_prod_store" in str(e) or "UNIQUE" in str(e), str(e))
finally:
    qq.rollback()
    idx = [r[0] for r in qq.execute(
        "select name from sqlite_master where type='index' and tbl_name='forecast_extra_alloc'")]
    ok("H2 唯一索引存在", "uq_fea_periodid_prod_store" in idx, idx)
    qq.close()

# ════════ I. 清除 override 回落 ════════
print("\nI. 清除 override 回落到自动判据")
c, r = http("PUT", "/api/product-targets/extra-alloc/override",
            {"period_id": PID, "product_id": PRID, "ratios": []}, tok)
ok("I1 清除 200 cleared=true", c == 200 and ((r.get("data") or {}).get("cleared") is True),
   (c, str(r)[:200]))
ok("I2 forecast_alloc_ratio 已空", len(q("select id from forecast_alloc_ratio where period_id=?", (PID,))) == 0)
c, r = http("GET", "/api/product-targets/extra-alloc/setup?period_id=%d&product_id=%d" % (PID, PRID), None, tok)
d = (r or {}).get("data") or {}
ok("I3 回落 basis=reported", d.get("basis") == "reported", d.get("basis"))

# ════════ 汇总 ════════
print("\n" + "=" * 60)
print("PASS %d / FAIL %d" % (len(PASSES), len(FAILS)))
for f in FAILS:
    print("  FAIL:", f)
sys.exit(1 if FAILS else 0)
