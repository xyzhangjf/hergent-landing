#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v285 收尾：微信提审账号一键清退（审核通过后执行）

用法：
  python3 teardown.py           # DRY：只报告命中面，不删
  GO=1 python3 teardown.py      # 真删

纪律（技能 §14）：
  · 🔴 「事件台账」≠「账号内容」—— audit_logs(哈希链) / login_attempts / ai_usage **一行都不碰**
  · 按 username / 语义名**精确定位**，不用 id 硬编码；每一步断言 rowcount
  · 删 report_mapping 前先确认「门店不会因此没人报单」——本次两条是**为提审新增的**，
    门店 2225/2868 原本各挂在员工 4 / 员工 7 的配置上（id=2 / id=3，本次不动）⇒ 删了不影响
  · 审核员可能真的提交过报单 ⇒ 一并清理该账号产生的 forecast_submissions
"""
import os, sys, json, sqlite3, datetime

GO = os.environ.get("GO", "0") == "1"
DRY = not GO

MAIN = "/opt/hergent-erp/erp.db"
T1 = "/opt/hergent-erp/tenant_1.db"
BAK = "/opt/hergent-erp/backups"
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
USERS = ("mptest", "mptestsp")
EMP_NAMES = ("微信审核-销售", "微信审核-主管")
ALIASES = ("美联（保康店）", "永辉东津店")
# 台账白名单：永不动
LEDGER = ("audit_logs", "login_attempts", "ai_usage")

print("=" * 74)
print("v285 提审账号清退   GO=%s   TS=%s" % (GO, TS))
print("=" * 74)

m = sqlite3.connect(MAIN)
m.row_factory = sqlite3.Row
t = sqlite3.connect(T1)
t.row_factory = sqlite3.Row


def cols_of(conn, table):
    try:
        return [r[1] for r in conn.execute("PRAGMA table_info(%s)" % table)]
    except Exception:
        return []


def pick(table, cands, conn):
    cs = cols_of(conn, table)
    for k in cands:
        if k in cs:
            return k
    return None


# ---- 定位 ----
uids = [r["id"] for r in m.execute(
    "SELECT id FROM users WHERE username IN (%s)" % ",".join("?" * len(USERS)), USERS)]
eids = [r["id"] for r in t.execute(
    "SELECT id FROM hr_employees WHERE name IN (%s)" % ",".join("?" * len(EMP_NAMES)), EMP_NAMES)]
mids = [r["id"] for r in t.execute(
    "SELECT id FROM report_mapping WHERE employee_id IN (%s) AND report_alias IN (%s)"
    % (",".join("?" * len(eids) or "NULL"), ",".join("?" * len(ALIASES))),
    tuple(eids) + ALIASES)] if eids else []

print("\n【0】定位结果")
print("   uids  = %s  （username IN %s）" % (uids, USERS))
print("   eids  = %s  （name IN %s）" % (eids, EMP_NAMES))
print("   mids  = %s  （employee_id∈eids 且 alias∈%s）" % (mids, ALIASES))
if not uids and not eids:
    print("\n   两个账号/员工都已不存在 ⇒ 无需清理。")
    sys.exit(0)

# 门店安全性前置：确认这两家店还有**别的** active 配置兜着
print("\n【0b】门店安全性前置（删配置会不会让门店没人报单）")
for sid, alias in ((2225, ALIASES[0]), (2868, ALIASES[1])):
    others = t.execute(
        "SELECT id,employee_id,report_alias FROM report_mapping "
        "WHERE counterparty_id=? AND is_active=1 AND id NOT IN (%s)"
        % (",".join("?" * len(mids)) or "NULL"), tuple([sid] + mids)).fetchall()
    print("   门店 %s（%s）：其它 active 配置 = %s %s" % (
        sid, alias, [dict(r) for r in others], "✅ 安全" if others else "🔴 删了就没人报单！"))

# ---- 快照 ----
SNAP_M = ("users", "user_tenants", "sessions", "tenants")
SNAP_T = ("hr_employees", "report_mapping", "forecast_submissions", "forecast_submission_items",
          "contacts", "employee_stores", "forecast_periods")
def snap():
    o = {}
    for x in SNAP_M:
        o["main." + x] = m.execute("SELECT COUNT(*) FROM " + x).fetchone()[0]
    for x in SNAP_T:
        o["t1." + x] = t.execute("SELECT COUNT(*) FROM " + x).fetchone()[0]
    for x in LEDGER:
        o["台账." + x] = t.execute("SELECT COUNT(*) FROM " + x).fetchone()[0] \
            if cols_of(t, x) else m.execute("SELECT COUNT(*) FROM " + x).fetchone()[0]
    return o

before = snap()
print("\n【1】删前快照\n   %s" % json.dumps(before, ensure_ascii=False))


def run(conn, table, where, params, label):
    try:
        n = conn.execute("SELECT COUNT(*) FROM %s WHERE %s" % (table, where), params).fetchone()[0]
    except Exception as e:
        print("   %-30s !! %s" % (table, e))
        return
    print("   %-30s %-34s 命中 %d" % (table, label, n))
    if n and not DRY:
        cur = conn.execute("DELETE FROM %s WHERE %s" % (table, where), params)
        conn.commit()
        print("        ⇒ 已删 %d 行" % cur.rowcount)


# ---- 备份 ----
if not DRY:
    print("\n【2】在线备份")
    for p, tag in ((MAIN, "erp.db"), (T1, "tenant_1.db")):
        b = os.path.join(BAK, "%s.before-v285-teardown-%s.bak" % (tag, TS))
        s = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
        d = sqlite3.connect(b)
        s.backup(d); d.close(); s.close()
        assert os.path.getsize(b) > 100000
        print("   %s → %s (%d B)" % (tag, b, os.path.getsize(b)))
else:
    print("\n【2】[DRY] 跳过备份")

# ---- 删除 ----
print("\n【3】删除（DRY=%s）" % DRY)
uq = ",".join("?" * len(uids)) or "NULL"
eq = ",".join("?" * len(eids)) or "NULL"
mq = ",".join("?" * len(mids)) or "NULL"

print("   -- 主库 erp.db")
run(m, "users", "username IN (%s)" % ",".join("?" * len(USERS)), USERS, "账号本体")
run(m, "user_tenants", "user_id IN (%s)" % uq, uids, "企业成员关系")
run(m, "sessions", "user_id IN (%s)" % uq, uids, "登录会话（干净）")

print("   -- 租户库 tenant_1.db")
run(t, "report_mapping", "id IN (%s)" % mq, mids, "报单配置（本次新增）")
run(t, "hr_employees", "id IN (%s)" % eq, eids, "员工档案")
if eids:
    c = pick("mp_events", ("user_id", "employee_id", "uid"), t)
    if c:
        run(t, "mp_events", "%s IN (%s)" % (c, eq if c == "employee_id" else uq),
            eids if c == "employee_id" else uids, "小程序埋点（%s）" % c)
    else:
        print("   %-30s 列名不匹配，跳过（列=%s）" % ("mp_events", cols_of(t, "mp_events")))
    c = pick("chat_sessions", ("user_id", "employee_id"), t)
    if c:
        run(t, "chat_sessions", "%s IN (%s)" % (c, uq if c == "user_id" else eq),
            uids if c == "user_id" else eids, "AI 副驾会话（%s）" % c)
    else:
        print("   %-30s 列名不匹配，跳过（列=%s）" % ("chat_sessions", cols_of(t, "chat_sessions")))
    c = pick("salary_details", ("employee_id",), t)
    if c:
        run(t, "salary_details", "employee_id IN (%s)" % eq, eids, "工资草稿")
    c = pick("salary_structures", ("employee_id",), t)
    if c:
        run(t, "salary_structures", "employee_id IN (%s)" % eq, eids, "工资结构")
    # 审核员可能点过提交 ⇒ 清该账号产生的报单。
    # 🔴 必须**先取 submission id 再级联删明细** —— `forecast_submission_items` 只有
    #    submission_id、没有 user_id，直接按账号条件删不到它 ⇒ 会留下孤儿明细。
    print("   -- 报单相关表列名：")
    for tb in ("forecast_submissions", "forecast_submission_items"):
        print("      %s = %s" % (tb, cols_of(t, tb)))
    subs = [r[0] for r in t.execute(
        "SELECT id FROM forecast_submissions WHERE user_id IN (%s)" % uq, uids)]
    run(t, "forecast_submissions", "user_id IN (%s)" % uq, uids, "审核员提交的报单")
    if subs:
        iq = ",".join("?" * len(subs))
        ic = pick("forecast_submission_items", ("submission_id", "submissionId", "sub_id"), t)
        if ic:
            n = t.execute("SELECT COUNT(*) FROM forecast_submission_items WHERE %s IN (%s)"
                          % (ic, iq), subs).fetchone()[0]
            if DRY:
                print("   %-30s %-34s 命中（级联待删）%d" % ("forecast_submission_items", ic, n))
            else:
                cur = t.execute("DELETE FROM forecast_submission_items WHERE %s IN (%s)" % (ic, iq), subs)
                t.commit()
                print("   %-30s %-34s ⇒ 已删 %d 行" % ("forecast_submission_items", ic, cur.rowcount))
        else:
            print("   🔴 forecast_submission_items 关联列未识别 ⇒ 需人工处置，勿盲目删")
    else:
        print("   （该账号无报单 ⇒ 无需级联）")

print("\n   -- 台账（**刻意不删**，技能 §14.1）")
for x in LEDGER:
    for conn, tag in ((t, "t1"), (m, "main")):
        if cols_of(conn, x):
            print("   %-30s [%s] 保留 %d 行" % (x, tag, conn.execute("SELECT COUNT(*) FROM " + x).fetchone()[0]))

# ---- 快照差集 ----
after = snap()
changed = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
EXPECTED = {"main.users", "main.user_tenants", "main.sessions", "t1.hr_employees", "t1.report_mapping"}
print("\n【4】快照差集")
unexp = []
for k in sorted(changed):
    okk = k in EXPECTED or (k.startswith("t1.") and "submission" in k)
    if not okk:
        unexp.append(k)
    print("   %-30s %-10s %s → %s" % (k, "应有" if okk else "!!非预期", before.get(k), after.get(k)))
print("   台账行数：%s" % {k: (before.get(k), after.get(k)) for k in before if k.startswith("台账.")})
if unexp:
    print("   🔴 非预期变化：%s" % unexp)
else:
    print("   ✅ 无「非预期变化」的表")

m.close()
t.close()
print("\n" + "=" * 74)
print("DRY 模式：未做任何删除。" if DRY else "清退完成。回滚见 /opt/hergent-erp/backups/ 下 .before-v285-teardown-*.bak")
print("=" * 74)
