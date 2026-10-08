#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v285 授权生产写：重建微信提审账号（2 员工 + 2 报单配置 + 2 账号）

授权："要提审" + 三项确认（沿用 mptest/mptestsp；美联（保康店）+ 永辉东津店；2 个账号）

用法：
  DRY=1 python3 setup.py    # 只读预检（不写任何东西）
  DRY=0 python3 setup.py    # 真写

三条纪律：
  · 三步全走真实 HTTP：/api/employees → /api/report-mappings → /api/forecast-submissions/staff-accounts
  · 绝不手工改 users.employee_id（那是堵脏值的闸）；改由 staff_account_create 自己写
  · password_changed：mptest 走正规自助改密(同密码)；mptestsp 因密码 7 位<8 被策略拒 ⇒ 退化单行单列写
"""
import os, sys, json, sqlite3, datetime, urllib.request, urllib.error

DRY = os.environ.get("DRY", "1") == "1"

with open("/opt/hergent-erp/.env", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"
BAK = "/opt/hergent-erp/backups"
BASE = "http://127.0.0.1:8700"
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
TOK = "v285-review-" + TS
UID_BOSS = 2
TID = 1
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁代理

# ---- 目标参数（用户已确认）----
STORE_A = {"counterparty_id": 2225, "system_name": "美联（保康店）", "report_alias": "美联（保康店）"}
STORE_B = {"counterparty_id": 2868, "system_name": "永辉东津店", "report_alias": "永辉东津店"}
EMP_A = {"name": "微信审核-销售", "employee_no": "WXTEST01", "position": "微信审核专用（提审临时）"}
EMP_B = {"name": "微信审核-主管", "employee_no": "WXTEST02", "position": "微信审核专用（提审临时）"}
ACC_A = {"username": "mptest", "password": "Mptest@1", "display_name": "微信审核-销售", "role": "sales"}
ACC_B = {"username": "mptestsp", "password": "Mpsup@1", "display_name": "微信审核-主管", "role": "supervisor"}

RESULTS = []


def ck(name, cond, detail=""):
    ok = bool(cond)
    RESULTS.append((name, ok))
    print("  [%s] %s%s" % ("PASS" if ok else "FAIL", name,
                           "" if ok else "   <<< 实际: %s" % detail))
    return ok


def ro(p):
    # 活库只读：mode=ro，绝不加 immutable
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    c.row_factory = sqlite3.Row
    return c


def http(method, path, body=None, token=TOK, tenant=TID):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if tenant:
        req.add_header("X-Tenant-Id", str(tenant))
    try:
        with OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "EXC: %s" % e


def jl(s):
    try:
        return json.loads(s)
    except Exception:
        return {}


def token_add(tok, uid):
    m = sqlite3.connect(MAIN)
    m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,"
              "datetime('now','localtime'),datetime('now','localtime','+2 hours'))", (tok, uid))
    m.commit()
    m.close()


def token_del(tok):
    m = sqlite3.connect(MAIN)
    m.execute("DELETE FROM sessions WHERE token=?", (tok,))
    m.commit()
    m.close()


def backup(path, tag):
    b = os.path.join(BAK, "%s.before-v285-%s-%s.bak" % (os.path.basename(path), tag, TS))
    s = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    d = sqlite3.connect(b)
    s.backup(d)
    d.close()
    s.close()
    assert os.path.getsize(b) > 100000, "备份太小"
    return b


SNAP_T1 = ("hr_employees", "report_mapping", "forecast_submissions", "forecast_periods",
           "contacts", "employee_stores", "forecast_period_confirm")


def snap():
    o = {}
    c = ro(MAIN)
    for t in ("users", "user_tenants", "sessions", "tenants"):
        o["main." + t] = c.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
    d = ro(T1)
    for t in SNAP_T1:
        o["t1." + t] = d.execute("SELECT COUNT(*) FROM " + t).fetchone()[0]
    return o


print("=" * 74)
print("v285 重建微信提审账号   DRY=%s   TS=%s" % (DRY, TS))
print("=" * 74)

# ============ 0. 预检（只读）============
print("\n【0】预检")
c = ro(T1)
print("  -- 现有 report_mapping（看 order_template 合法值 + alias 占用）")
for r in c.execute("SELECT id,employee_id,report_alias,order_template,is_active FROM report_mapping ORDER BY id"):
    print("     id=%s emp=%s alias=%r tpl=%r active=%s" % (
        r["id"], r["employee_id"], r["report_alias"], r["order_template"], r["is_active"]))
tpls = [r[0] for r in c.execute("SELECT DISTINCT order_template FROM report_mapping WHERE order_template<>''")]
print("  order_template 实测既有值 = %r" % tpls)

m = ro(MAIN)
rows = m.execute("SELECT id,username,employee_id,role,is_active,password_changed FROM users "
                 "WHERE username IN ('mptest','mptestsp')").fetchall()
print("  -- 目标账号是否已存在：%s" % ("无（可建）" if not rows else [dict(r) for r in rows]))
seq = m.execute("SELECT seq FROM sqlite_sequence WHERE name='users'").fetchone()
print("  -- users 水位 = %s ⇒ 新号预计 %s / %s" % (seq[0], seq[0] + 1, seq[0] + 2))
dup = c.execute("SELECT id,name FROM hr_employees WHERE name LIKE '微信审核%'").fetchall()
print("  -- 是否已有同名员工：%s" % ("无" if not dup else [dict(r) for r in dup]))
for nm, sid in (("美联（保康店）", 2225), ("永辉东津店", 2868)):
    rr = c.execute("SELECT id,name,type,is_active FROM contacts WHERE id=?", (sid,)).fetchone()
    print("  -- 目标门店 %s: %s" % (sid, dict(rr) if rr else "!! 不存在"))

if DRY:
    print("\n[DRY] 预检结束，未做任何写入。")
    sys.exit(0)

# ============ 1. 备份 ============
print("\n【1】在线备份")
b1 = backup(MAIN, "erp.db")
b2 = backup(T1, "tenant_1.db")
print("  erp.db      → %s (%d B)" % (b1, os.path.getsize(b1)))
print("  tenant_1.db → %s (%d B)" % (b2, os.path.getsize(b2)))

before = snap()
print("  写前快照: %s" % json.dumps(before, ensure_ascii=False))

# ============ 2. 注入临时令牌（绑 boss=2）============
print("\n【2】注入临时令牌（绑 boss uid=%d）" % UID_BOSS)
token_add(TOK, UID_BOSS)
st, bd = http("GET", "/api/auth/me")
ck("令牌可用（/api/auth/me 200）", st == 200, "%s %s" % (st, bd[:120]))
st, bd = http("GET", "/api/report-mappings", token=None)
ck("阴性对照：无令牌 401", st == 401, "%s %s" % (st, bd[:80]))

try:
    # ============ 3. 建员工（真实 HTTP）============
    print("\n【3】POST /api/employees ×2")
    emp_ids = {}
    for tag, e in (("A", EMP_A), ("B", EMP_B)):
        st, bd = http("POST", "/api/employees", e)
        j = jl(bd)
        eid = j.get("employee_id")
        ck("建员工 %s（%s）200+employee_id" % (tag, e["name"]), st == 200 and eid, "%s %s" % (st, bd[:200]))
        emp_ids[tag] = eid
    print("  员工 id: %s" % emp_ids)

    # ============ 4. 配报单门店（真实 HTTP）============
    print("\n【4】POST /api/report-mappings ×2")
    for tag, eid, s in (("A", emp_ids.get("A"), STORE_A), ("B", emp_ids.get("B"), STORE_B)):
        body = {"employee_id": eid, "counterparty_type": "store",
                "counterparty_id": s["counterparty_id"], "system_name": s["system_name"],
                "report_alias": s["report_alias"], "order_template": "自提订单"}
        st, bd = http("POST", "/api/report-mappings", body)
        j = jl(bd)
        ck("配门店 %s（%s → emp %s）" % (tag, s["report_alias"], eid),
           st == 200 and j.get("success"), "%s %s" % (st, bd[:200]))

    # ============ 5. 建账号（真实 HTTP）============
    print("\n【5】POST /api/forecast-submissions/staff-accounts ×2")
    acc_uid = {}
    for tag, eid, a in (("A", emp_ids.get("A"), ACC_A), ("B", emp_ids.get("B"), ACC_B)):
        body = {"employee_id": eid, "username": a["username"], "password": a["password"],
                "display_name": a["display_name"], "role": a["role"]}
        st, bd = http("POST", "/api/forecast-submissions/staff-accounts", body)
        j = jl(bd)
        uid = j.get("user_id")
        ck("建账号 %s（%s/%s）" % (tag, a["username"], a["role"]),
           st == 200 and j.get("success"), "%s %s" % (st, bd[:250]))
        acc_uid[tag] = uid
    print("  账号 uid: %s" % acc_uid)

    # ============ 6. password_changed ============
    # 纪律（技能 §6.7 点 3）：**先正规、后 SQL，并记录退化理由**。
    #   正规路径 = `POST /api/auth/password`（自助改密，同密码重设即可把标志置 1；
    #   `_validate_password` 只校验「≥8 位 + 含字母与数字」，不禁止同值）。
    #   ⇒ mptest(Mptest@1, 8 位) 能过；mptestsp(Mpsup@1, **7 位**) 必被策略拒 ⇒ 那一个退化。
    print("\n【6】补 password_changed=1（否则审核员首登被强制改密 = 卡死）")
    uid_a, uid_b = acc_uid.get("A"), acc_uid.get("B")

    def _ensure_flag(tag, uid, acc):
        if not uid:
            return
        mm = sqlite3.connect(MAIN)
        mm.row_factory = sqlite3.Row
        tb = TOK + "-P" + tag
        token_add(tb, uid)
        try:
            st, bd = http("POST", "/api/auth/password",
                          {"old_password": acc["password"], "new_password": acc["password"]}, token=tb)
            _ok = (st == 200)
            print("   [%s] 正规自助改密（同密码）→ HTTP %s %s%s" % (
                acc["username"], st, bd[:130], "" if _ok else "   ← 预期内（密码 %d 位<策略 8）" % len(acc["password"])))
        finally:
            token_del(tb)
        flag = mm.execute("SELECT COALESCE(password_changed,0) AS f FROM users WHERE id=?", (uid,)).fetchone()["f"]
        if flag != 1:
            mm.execute("PRAGMA busy_timeout=8000")
            cur = mm.execute("UPDATE users SET password_changed=1 WHERE id=?", (uid,))
            mm.commit()
            flag = mm.execute("SELECT COALESCE(password_changed,0) AS f FROM users WHERE id=?", (uid,)).fetchone()["f"]
            print("   [%s] ⇒ 走**退化路径**（正规不可达：密码 %d 位 < 策略 8 位），"
                  "单行单列 UPDATE，rowcount=%s" % (acc["username"], len(acc["password"]), cur.rowcount))
        else:
            print("   [%s] 正规路径已置 1（零 SQL）" % acc["username"])
        ck("%s 终态 password_changed=1" % acc["username"], flag == 1, "flag=%s" % flag)
        mm.close()

    _ensure_flag("A", uid_a, ACC_A)
    _ensure_flag("B", uid_b, ACC_B)

    # ============ 7. 验收 ============
    print("\n【7】验收")
    m2 = sqlite3.connect(MAIN)
    for tag, uid, a in (("A", uid_a, ACC_A), ("B", uid_b, ACC_B)):
        r = m2.execute("SELECT id,username,display_name,role,is_active,employee_id,password_changed "
                       "FROM users WHERE id=?", (uid,)).fetchone()
        print("   %s → %s" % (tag, r))
    m2.close()

    # 真实登录（这是提审成败的判据）
    print("\n  -- 真实登录测试（提审员视角）")
    for tag, a in (("A", ACC_A), ("B", ACC_B)):
        st, bd = http("POST", "/api/auth/login",
                      {"username": a["username"], "password": a["password"]}, token=None)
        j = jl(bd)
        ck("登录 %s" % a["username"], st == 200 and j.get("success"), "%s %s" % (st, bd[:200]))
        ck("   %s 不再强制改密（require_password_change 非真）" % a["username"],
           not j.get("require_password_change"), "require_password_change=%r" % j.get("require_password_change"))

    # 门店可见性（提审账号场景的核心判据）
    print("\n  -- 门店可见性（提审账号场景红线：不得为空）")
    for tag, uid, want in (("A", uid_a, 2225), ("B", uid_b, 2868)):
        if not uid:
            continue
        tb = TOK + "-V" + tag
        token_add(tb, uid)
        try:
            st, bd = http("GET", "/api/forecast-submissions/stores", token=tb)
            j = jl(bd)
            stores = j.get("stores") or []
            ck("%s 的 /stores 200 且非空" % tag, st == 200 and len(stores) > 0, "%s %s" % (st, bd[:200]))
            ck("   含目标门店 id=%s" % want, any(s.get("id") == want for s in stores),
               str([s.get("id") for s in stores]))
        finally:
            token_del(tb)

    # 干净收尾：确认临时令牌全删
    # ⚠️ 必须**排除主令牌自己** —— 此刻 try/finally 还没跑，主令牌仍在表里。
    #    第一版没排除 ⇒ 报「残留 1」的假 FAIL（数到的就是主令牌）。
    print("\n【8】收尾")
    mm = sqlite3.connect(MAIN)
    left = mm.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ? AND token != ?",
                      (TOK + "%", TOK)).fetchone()[0]
    ck("子令牌残留 = 0（不含主令牌，主令牌由 finally 删）", left == 0, "残留 %d" % left)
    mm.close()

finally:
    token_del(TOK)
    print("\n  [finally] 主临时令牌已删除")

# 主令牌删除后**再复扫一次**（含主令牌在内全 0 才算真干净）—— 这是第一版缺的那一条
_mmm = sqlite3.connect(MAIN)
_allleft = _mmm.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", (TOK + "%",)).fetchone()[0]
_mmm.close()
ck("★ 全部临时令牌残留 = 0（含主令牌，finally 之后复扫）", _allleft == 0, "残留 %d" % _allleft)

# ---- 快照差集 ----
after = snap()
changed = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
# 期望集**写前就定**（技能 §12.2：不能事后把断言改宽）
EXPECTED = {"main.users", "main.user_tenants", "main.sessions",
            "t1.hr_employees", "t1.report_mapping"}
print("\n【9】快照差集（写前 → 写后）")
unexpected = []
for k in sorted(changed):
    okk = k in EXPECTED
    if not okk:
        unexpected.append(k)
    print("   %-28s %-10s %s → %s" % (k, "应有变化" if okk else "!!非预期", before.get(k), after.get(k)))
print("   未变的表：%d 个" % (len(set(before) | set(after)) - len(changed)))
ck("无「非预期变化」的表", not unexpected, "非预期=%r" % unexpected)
print("   注① main.sessions 含登录测试新建的会话（应有）")
print("   注② 登录测试会在 login_attempts 留 2 条成功记录（应有，台账按技能 §14.1 不清理）")

print("\n" + "=" * 74)
bad = [n for n, ok in RESULTS if not ok]
print("结果: %d/%d PASS" % (len(RESULTS) - len(bad), len(RESULTS)))
if bad:
    print("FAIL 项:")
    for n in bad:
        print("   - " + n)
print("备份: %s" % b1)
print("      %s" % b2)
print("=" * 74)
sys.exit(1 if bad else 0)
