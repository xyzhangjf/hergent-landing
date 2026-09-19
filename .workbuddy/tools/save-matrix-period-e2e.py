# -*- coding: utf-8 -*-
"""save-matrix 期次落点 E2E（隔离租户 9996，跑完彻底销毁）

核心场景：**两个期次窗口完全相同**（902 与 903 都是 9/8~9/14）。
  · 前端显式传 period_id=902 → 必须落 902（旧实现 ORDER BY id DESC 会落 903）
  · 不传 period_id        → 兜底落 id 最大者 903（保持原兜底行为）
  · 传窗口不同的一期      → 落该期

在 prod 上以 runuser -u hergent -- python3 运行。
"""
import os, sys, glob, json, sqlite3, secrets, urllib.request, urllib.error

sys.path.insert(0, "/opt/hergent-erp")
os.chdir("/opt/hergent-erp")
import erp_db as edb
from db import connection as dbc

TID, UN = 9996, "pavuser"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁代理（回环也会被代理劫持）
N = OK = 0


def chk(name, got, want):
    global N, OK
    N += 1
    good = str(got) == str(want)
    OK += good
    print("  %s %-50s 得到=%-6s 期望=%s" % ("OK " if good else "FAIL", name, got, want))


def post(path, body):
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOK, "X-Tenant-Id": str(TID),
                 "Content-Type": "application/json"})
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


uid = 0
TOK = "pav" + secrets.token_hex(20)
try:
    edb.tenant_db_init(TID)
    m = sqlite3.connect(edb.DB_PATH)
    m.execute("INSERT OR IGNORE INTO tenants(id,name,subdomain,plan,is_active) VALUES(?,?,?,?,1)",
              (TID, "期次落点验证", "pav-%d" % TID, "free"))
    m.execute("INSERT INTO users(username,password_hash,display_name,role,is_active) VALUES(?,?,?,?,1)",
              (UN, "!disabled!", "期次验证", "boss"))
    uid = m.execute("SELECT id FROM users WHERE username=?", (UN,)).fetchone()[0]
    m.execute("INSERT OR IGNORE INTO user_tenants(user_id,tenant_id) VALUES(?,?)", (uid, TID))
    m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES("
              "?,?,datetime('now','localtime'),datetime('now','localtime','+2 hours'))", (TOK, uid))
    m.commit()
    m.close()

    # 造 3 个期次：901 宽窗；902 与 903 **窗口完全相同**
    dbc.set_tenant_context(TID)
    with edb.get_db() as c:
        edb._ensure_forecast_tables(c)
        c.execute("INSERT INTO forecast_periods (id,name,order_start,order_end,status,created_at) "
                  "VALUES (901,'宽窗','2026-09-01','2026-09-14','open','2026-09-01')")
        c.execute("INSERT INTO forecast_periods (id,name,order_start,order_end,status,created_at) "
                  "VALUES (902,'同窗A','2026-09-08','2026-09-14','open','2026-09-02')")
        c.execute("INSERT INTO forecast_periods (id,name,order_start,order_end,status,created_at) "
                  "VALUES (903,'同窗B','2026-09-08','2026-09-14','open','2026-09-03')")
        c.commit()
    dbc.set_tenant_context(None)

    def rows_for(cust):
        return [{"product_id": 0, "product_name": "验证品" + cust, "spec": "1*1", "unit": "件",
                 "price": 10, "qty_by_unit": {cust: 3}}]

    print("=" * 62)
    print("save-matrix 期次落点 E2E（隔离租户 %d）" % TID)
    print("=" * 62)

    def landed():
        dbc.set_tenant_context(TID)
        with edb.get_db() as c:
            r = c.execute("SELECT period_id, COUNT(*) FROM forecast_submissions "
                          "WHERE role='导入' GROUP BY period_id").fetchall()
        dbc.set_tenant_context(None)
        return dict((int(x[0]), int(x[1])) for x in r)

    # T1：显式传 902（窗口与 903 相同）→ 必须落 902
    st, j = post("/api/forecast-submissions/save-matrix",
                 {"start": "2026-09-08", "end": "2026-09-14", "period_id": 902,
                  "customers": ["甲户"], "rows": rows_for("甲户")})
    chk("T1 显式传 period_id=902 → 落 902（旧实现会落 903）", landed().get(902), 1)
    chk("T1b 不该落 903", landed().get(903, 0), 0)

    # T2：显式传 901（窗口不同）
    post("/api/forecast-submissions/save-matrix",
         {"start": "2026-09-01", "end": "2026-09-14", "period_id": 901,
          "customers": ["乙户"], "rows": rows_for("乙户")})
    chk("T2 显式传 901（宽窗）→ 落 901", landed().get(901), 1)

    # T3：不传 period_id，同窗口 → 兜底取 id 最大者 903
    post("/api/forecast-submissions/save-matrix",
         {"start": "2026-09-08", "end": "2026-09-14",
          "customers": ["丙户"], "rows": rows_for("丙户")})
    chk("T3 不传 period_id（同窗口）→ 兜底落 id 最大者 903", landed().get(903), 1)

    # T4：期次隔离 —— 保存 902 绝不能动 903 的数据（旧实现按窗口清理，会清空 903）
    post("/api/forecast-submissions/save-matrix",
         {"start": "2026-09-08", "end": "2026-09-14", "period_id": 902,
          "customers": ["甲户"], "rows": rows_for("甲户")})
    chk("T4 保存 902 后 903 的数据仍在（期次隔离）", landed().get(903, 0), 1)
    chk("T4b 902 自身已落库", landed().get(902, 0), 1)

    # T5：幂等 —— 同期次再存一次覆盖不叠加
    before = landed().get(902, 0)
    post("/api/forecast-submissions/save-matrix",
         {"start": "2026-09-08", "end": "2026-09-14", "period_id": 902,
          "customers": ["甲户"], "rows": rows_for("甲户")})
    chk("T5 同期次重复保存 → 行数不变（覆盖不叠加）", landed().get(902, 0), before)
finally:
    dbc.set_tenant_context(None)
    try:
        for f in glob.glob(os.path.join(edb.DB_DIR, "tenant_%d.db*" % TID)):
            os.remove(f)
        m = sqlite3.connect(edb.DB_PATH)
        m.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        m.execute("DELETE FROM user_tenants WHERE user_id=?", (uid,))
        m.execute("DELETE FROM users WHERE id=?", (uid,))
        m.execute("DELETE FROM tenants WHERE id=?", (TID,))
        m.commit()
        m.close()
        print("\n清理：租户库文件 + tenants/users/user_tenants/sessions 行已删")
    except Exception as e:
        print("\n[清理异常] %s" % e)

print("\n结果：%d/%d %s" % (OK, N, "ALL PASS" if OK == N else "FAIL"))
