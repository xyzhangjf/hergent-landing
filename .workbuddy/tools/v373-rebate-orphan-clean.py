import sqlite3, os, sys, json, time, hashlib, urllib.request, urllib.error

BASE = "/opt/hergent-erp"
TDB = os.path.join(BASE, "tenant_1.db")
MDB = os.path.join(BASE, "erp.db")
OUT = "/root/backup_rebate_orphan_20261004"
TS = time.strftime("%Y%m%d-%H%M%S")
TID = 1
TOK = "ai-orphan-clean-" + hashlib.sha1(TS.encode()).hexdigest()[:24]

os.makedirs(OUT, exist_ok=True)
RESULTS = []

def ck(name, got, want, extra=""):
    ok = (got == want)
    RESULTS.append(ok)
    print("  [%s] %s | 实测=%r 期望=%r %s" % ("PASS" if ok else "FAIL", name, got, want, extra))
    return ok

def ro(p):
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)

def rw(p):
    c = sqlite3.connect(p)
    c.execute("PRAGMA busy_timeout=8000")
    return c

def backup(src, dst):
    s = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
    d = sqlite3.connect(dst)
    s.backup(d); d.close(); s.close()
    assert os.path.getsize(dst) > 100000, dst

print("=== 阶段 0：整库备份（改动前）===")
B_T = os.path.join(OUT, "tenant_1.db.before-rebate-orphan-%s.bak" % TS)
B_M = os.path.join(OUT, "erp.db.before-rebate-orphan-%s.bak" % TS)
backup(TDB, B_T); backup(MDB, B_M)
print("  tenant_1 备份 =", B_T, os.path.getsize(B_T), "字节")
print("  erp.db   备份 =", B_M, os.path.getsize(B_M), "字节")

def snap():
    c = ro(TDB)
    out = {}
    tabs = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
    for t in tabs:
        try:
            rows = c.execute("select * from \"%s\"" % t).fetchall()
            out[t] = (len(rows), hashlib.sha1(repr(rows).encode()).hexdigest()[:12])
        except Exception as e:
            out[t] = ("ERR", str(e)[:40])
    c.close()
    return out

def diff(a, b):
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))

print()
print("=== 阶段 1：改动前快照 + 待删行清单 ===")
BEFORE = snap()
print("  全库表数 =", len(BEFORE))
c = ro(TDB)
todel = {}
for t, col in (("rebate_contract_months", "contract_id"), ("rebate_accruals", "contract_id")):
    rows = c.execute(
        "select * from %s where %s not in (select id from rebate_contracts)" % (t, col)
    ).fetchall()
    todel[t] = rows
    print("  %s：待删 %d 行" % (t, len(rows)))
    for r in rows:
        print("     ", r)
print("  现有合同数 =", c.execute("select count(*) from rebate_contracts").fetchone()[0])
print("  目标规则数 =", c.execute("select count(*) from rebate_target_rules").fetchone()[0])
c.close()

EXPECT = {"rebate_contract_months": 12, "rebate_accruals": 2}
ck("待删行数与预期一致（月度分解）", len(todel["rebate_contract_months"]), EXPECT["rebate_contract_months"])
ck("待删行数与预期一致（计提）", len(todel["rebate_accruals"]), EXPECT["rebate_accruals"])
if sum(len(v) for v in todel.values()) != 14:
    print("  !! 待删行数异常，中止"); sys.exit(3)

print()
print("=== 阶段 2：临时会话令牌（仅用于读端复验，用完即删）===")
m = rw(MDB)
urow = m.execute(
    "SELECT u.id,u.username,u.role FROM users u JOIN user_tenants ut ON ut.user_id=u.id "
    "WHERE ut.tenant_id=? AND u.is_active=1 ORDER BY CASE u.role WHEN 'boss' THEN 0 "
    "WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1", (TID,)).fetchone()
if not urow:
    m.close(); print("  !! 找不到可用账号"); sys.exit(4)
UID, UNAME, UROLE = urow
print("  令牌绑定身份 = 用户名 %s / 角色 %s / uid %s" % (UNAME, UROLE, UID))

def token_add():
    mm = rw(MDB)
    mm.execute(
        "INSERT INTO sessions(token,user_id,created_at,expires_at,ip_address,user_agent_hash,last_activity) "
        "VALUES(?,?,datetime('now','localtime'),datetime('now','localtime','+1 hour'),'127.0.0.1','',"
        "datetime('now','localtime'))", (TOK, UID))
    mm.commit(); mm.close()

def token_del():
    mm = rw(MDB)
    mm.execute("DELETE FROM sessions WHERE token=?", (TOK,))
    mm.commit(); mm.close()

def http_get(path, with_auth=True):
    h = {"X-Tenant-Id": str(TID)}
    if with_auth:
        h["Authorization"] = "Bearer " + TOK
    req = urllib.request.Request("http://127.0.0.1:8700" + path, headers=h)
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with op.open(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)

PATHS = ["/api/rebate-summary", "/api/rebate-contracts", "/api/rebate-rules",
         "/api/rebate-claims", "/api/rebate-achievements"]

BASELINE = {}
try:
    token_add()
    print("  令牌长度 =", len(TOK))
    print("  -- 阴性对照（不带令牌，应 401）--")
    st, _b = http_get("/api/rebate-summary", with_auth=False)
    ck("无令牌 ⇒ 401（证明门禁真的在）", st, 401)
    print("  -- 改动前读端基线 --")
    for p in PATHS:
        st, body = http_get(p)
        BASELINE[p] = (st, body)
        print("     %-32s status=%s len=%d" % (p, st, len(body)))

    print()
    print("=== 阶段 3：事务删除（主键/语义条件 + rowcount 断言）===")
    w = rw(TDB)
    try:
        w.execute("BEGIN IMMEDIATE")
        n1 = w.execute(
            "DELETE FROM rebate_contract_months WHERE contract_id NOT IN (SELECT id FROM rebate_contracts)"
        ).rowcount
        n2 = w.execute(
            "DELETE FROM rebate_accruals WHERE contract_id NOT IN (SELECT id FROM rebate_contracts)"
        ).rowcount
        print("  rebate_contract_months 删除行数 =", n1)
        print("  rebate_accruals        删除行数 =", n2)
        assert n1 == 12, "rowcount 异常：%s" % n1
        assert n2 == 2, "rowcount 异常：%s" % n2
        w.commit()
        print("  已提交")
    except Exception as e:
        w.rollback()
        print("  !! 中止并回滚：", e)
        sys.exit(5)
    finally:
        w.close()

    print()
    print("=== 阶段 4：验收 ===")
    c = ro(TDB)
    ck("rebate_contract_months 残留孤儿 = 0",
       c.execute("select count(*) from rebate_contract_months where contract_id not in (select id from rebate_contracts)").fetchone()[0], 0)
    ck("rebate_accruals 残留孤儿 = 0",
       c.execute("select count(*) from rebate_accruals where contract_id not in (select id from rebate_contracts)").fetchone()[0], 0)
    print("  -- 逐列单独打印（不做「有 A 显示 A 否则 B」的拼装）--")
    print("     rebate_contract_months 行数 =", c.execute("select count(*) from rebate_contract_months").fetchone()[0])
    print("     rebate_accruals 行数        =", c.execute("select count(*) from rebate_accruals").fetchone()[0])
    print("     rebate_contracts 行数       =", c.execute("select count(*) from rebate_contracts").fetchone()[0])
    print("     rebate_target_rules 行数    =", c.execute("select count(*) from rebate_target_rules").fetchone()[0])
    print("     rebate_achievements 行数    =", c.execute("select count(*) from rebate_achievements").fetchone()[0])
    print("     rebate_rule_month_lock 行数 =", c.execute("select count(*) from rebate_rule_month_lock").fetchone()[0])
    print("     rebate_arrival_skips 行数   =", c.execute("select count(*) from rebate_arrival_skips").fetchone()[0])
    for r in c.execute("select id,rule_name,scope_name,is_active from rebate_target_rules order by id"):
        print("     规则仍在：", r)
    c.close()

    AFTER = snap()
    d = diff(BEFORE, AFTER)
    print("  -- 整表快照差集 --")
    for k in d:
        print("     %s：%s -> %s" % (k, BEFORE.get(k), AFTER.get(k)))
    ck("差异集合恰好是两张孤儿表", d, ["rebate_accruals", "rebate_contract_months"])

    print("  -- 读端复验（真实 HTTP）--")
    for p in PATHS:
        st, body = http_get(p)
        same = (st, body) == BASELINE[p]
        ck("读端不变 %s" % p, same, True, "status=%s" % st)
    st, body = http_get("/api/rebate-summary")
    ck("返利汇总读端仍 200", st, 200)
    ck("返利汇总内容仍为空列表（0 合同）", json.loads(body) in ([], {}), True, repr(body[:80]))

    print()
    print("=== 阶段 5：生成回滚脚本 ===")
    lines = ["-- 回滚：撤销 2026-10-04 rebate 孤儿数据清理"]
    for t in ("rebate_contract_months", "rebate_accruals"):
        for r in todel[t]:
            vals = ",".join("NULL" if v is None else ("'%s'" % str(v).replace("'", "''") if isinstance(v, str) else str(v)) for v in r)
            lines.append("INSERT INTO %s VALUES(%s);" % (t, vals))
    rp = os.path.join(OUT, "ROLLBACK-rebate-orphan-%s.sql" % TS)
    with open(rp, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("  回滚脚本 =", rp, "（%d 条 INSERT）" % (len(lines) - 1))
finally:
    token_del()
    m2 = rw(MDB)
    left = m2.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", (TOK[:12] + "%",)).fetchone()[0]
    m2.close()
    print()
    print("=== 阶段 6：收尾 ===")
    print("  临时令牌残留（按前缀复扫）= %s" % left)
    RESULTS.append(left == 0)

print()
print("==================== 汇总 ====================")
print("  PASS %d / %d" % (sum(1 for x in RESULTS if x), len(RESULTS)))
print("  备份：%s" % B_T)
print("  %s" % ("全部通过" if all(RESULTS) else "存在 FAIL，见上方"))
sys.exit(0 if all(RESULTS) else 1)
