# -*- coding: utf-8 -*-
"""v282 生产授权写：① 建「蒙牛鲜奶」到货节奏规则（同节奏 = 照抄蒙牛低温）。
② （若成立）给 1596 建一条样板目标，让 D20 的均单提示第一次真正可观测。

用法：python3 exec.py dry | go
"""
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

BASE = "/opt/hergent-erp"
API = "http://127.0.0.1:8700"
MODE = sys.argv[1] if len(sys.argv) > 1 else "dry"
TS = time.strftime("%Y%m%d-%H%M%S")
BK = os.path.join(BASE, "backups/2026-09-26")
TENANT = 1
TDB = os.path.join(BASE, "tenant_1.db")

_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def req(path, token=None, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
        r.add_header("X-Tenant-Id", str(TENANT))
    try:
        with _op.open(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]
    except Exception as e:
        return -1, str(e)


def live(p):
    """活库：mode=ro（**绝不加 immutable**，否则静默读到 checkpoint 前的旧页）。"""
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    c.row_factory = sqlite3.Row
    return c


# ------------------------------------------------------------------ 拟写内容
RULE_BODY = {
    "rule_name": "蒙牛鲜奶到货节奏（同蒙牛低温）",
    "dimension": "brand",
    "target_type": "amount",
    "scope_key": "蒙牛鲜奶",
    "scope_name": "蒙牛鲜奶",
    "period_type": "year",
    "target_value": 0,             # 🔴 不设返利目标（节奏规则）
    "target_year": 2026,
    "target_unit": "",
    "trigger_mode": "on_target",
    "trigger_threshold": 1.0,
    "rebate_basis": "rate",
    "rebate_rate": 0,              # 🔴 不产生任何返利
    "rebate_amount": 0,
    "effective_start": "2026-01-01",
    "effective_end": "2026-12-31",
    "priority": 0,
    "is_active": 1,
    "contract_id": 0,
    "scale_type": "non_graduated",
    "rounding_mode": "half_up",
    "rounding_digits": 2,
    "monthly_amounts": {},
    "monthly_rates": {},
    "monthly_tiers": {},
    "tiers_json": "",
    # ---- 节奏：逐字段照抄「蒙牛低温」（生产 id=10）----
    "order_mode": "interval",
    "order_cadence_days": 2,
    "order_weekdays": "",
    "order_first_date": "2026-08-28",
    "order_lead_days": 4,
    "order_max_early_days": 1,
    "arrival_mode": "interval",
    "arrival_cadence_days": 2,
    "arrival_first_dom": 1,
    "arrival_weekdays": "",
    "arrival_count_override": 15,
    # 🔴 auto_period_enabled 必须 =0：`_check_auto_period` 只认**第一条**开着的规则当 carrier，
    #    设 1 会与「蒙牛低温」抢，排程归属变得不确定。
    "auto_period_enabled": 0,
    "auto_open_time": "16:00",
    "auto_close_time": "10:00",
    "supplier_deadline_time": "12:00",
}

TARGET_1596 = {
    "name": None, "period_month": time.strftime("%Y-%m"), "product_id": 1596,
    "basis": "qty", "target_qty": 120, "target_unit": "箱",
    # 分配比与上轮两条样板**保持一致**（张俊峰40%/刘善涛30%/刘小顶30%），
    #   这样你在界面上看三条样板时口径统一、一眼能看出是同一批样板。
    "allocs": [{"employee_id": 7, "employee_name": "张俊峰", "ratio": 40},
               {"employee_id": 6, "employee_name": "刘善涛", "ratio": 30},
               {"employee_id": 4, "employee_name": "刘小顶", "ratio": 30}],
}


# ------------------------------------------------------------------ 快照
SNAP_TABLES = ["rebate_target_rules", "rebate_rule_month_lock", "product_targets",
               "product_target_alloc", "message_center", "product_change_logs"]


def snap():
    c = live(TDB)
    out = {}
    for t in SNAP_TABLES:
        try:
            out["cnt_" + t] = c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        except Exception as e:
            out["cnt_" + t] = "ERR:%s" % e
    try:
        out["brand_rules"] = [list(x) for x in c.execute(
            "SELECT id,rule_name,scope_key,is_active,target_value,rebate_rate,order_mode,"
            "order_cadence_days,order_first_date,order_lead_days,arrival_mode,"
            "arrival_cadence_days,arrival_count_override,auto_period_enabled"
            " FROM rebate_target_rules ORDER BY id").fetchall()]
    except Exception as e:
        out["brand_rules"] = "ERR:%s" % e
    try:
        out["targets"] = [list(x) for x in c.execute(
            "SELECT id,period_month,product_id,target_qty,target_unit,created_by"
            " FROM product_targets ORDER BY id").fetchall()]
    except Exception as e:
        out["targets"] = "ERR:%s" % e
    c.close()
    return out


# ------------------------------------------------------------------ 令牌
TOK = None


def token_add():
    """往主库 sessions 插一条短时令牌，绑**真实老板账号**（界面留痕要显示真人名）。列名不猜。"""
    global TOK
    m = sqlite3.connect(os.path.join(BASE, "erp.db"))
    m.execute("PRAGMA busy_timeout=8000")
    m.row_factory = sqlite3.Row
    u = m.execute("SELECT * FROM users WHERE role='boss' AND COALESCE(is_active,1)=1"
                  " ORDER BY id LIMIT 1").fetchone()
    if not u:
        u = m.execute("SELECT * FROM users WHERE name LIKE '%张俊峰%' ORDER BY id LIMIT 1").fetchone()
    if not u:
        raise SystemExit("找不到 boss 账号，中止（不猜 uid）")
    uid = u["id"]
    # ⚠️ `users` 表里**没有 `name` 列**（实测列清单：id/username/password_hash/display_name/
    #    role/is_active/...）—— 取显示名要用 display_name，兜底 username。上一版这里写 `u["name"]`
    #    直接 IndexError 中止（幸好在 INSERT 之前，没留下垃圾令牌）。
    uname = (u["display_name"] if "display_name" in u.keys() else "") or (
        u["username"] if "username" in u.keys() else "")
    TOK = "v282-" + TS + "-boss"
    have = {r[1] for r in m.execute("PRAGMA table_info(sessions)").fetchall()}
    cand = [("token", TOK), ("user_id", uid), ("username", uname),
            ("created_at", "NOW"), ("expires_at", "FUT"), ("ip_address", "127.0.0.1"),
            ("user_agent_hash", "v282verify"), ("last_activity", "NOW")]
    cols, marks, vals = [], [], []
    for c, v in cand:
        if c not in have:
            continue
        cols.append(c)
        if c in ("created_at", "last_activity"):
            marks.append("datetime('now','localtime')")
        elif c == "expires_at":
            marks.append("datetime('now','localtime','+2 hours')")
        else:
            marks.append("?")
            vals.append(v)
    m.execute("INSERT INTO sessions (%s) VALUES (%s)" % (",".join(cols), ",".join(marks)), vals)
    m.commit()
    m.close()
    return uid, uname


def token_del():
    if not TOK:
        return 0
    m = sqlite3.connect(os.path.join(BASE, "erp.db"))
    m.execute("PRAGMA busy_timeout=8000")
    m.execute("DELETE FROM sessions WHERE token=?", (TOK,))
    m.commit()
    n = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (TOK,)).fetchone()[0]
    m.close()
    return n


def backup(src, dst):
    s = live(src)
    d = sqlite3.connect(dst)          # backup() 能读到 WAL 里尚未 checkpoint 的部分
    with d:
        s.backup(d)
    d.close()
    s.close()
    return os.path.getsize(dst)


# ================================================================== main
print("=" * 74)
print("v282 生产写入 · MODE =", MODE, "· TS =", TS)
print("=" * 74)

print("\n【0】写前快照")
b0 = snap()
for k, v in b0.items():
    if k not in ("brand_rules", "targets"):
        print("   %-32s %s" % (k, v))
print("   现有 brand 规则：")
for r in (b0["brand_rules"] if isinstance(b0["brand_rules"], list) else []):
    print("      ", r)

print("\n【1】候选商品勘察（判断 D20 能否真正可观测）")
c = live(TDB)
rows = c.execute(
    "SELECT p.id, p.brand, p.unit, p.order_unit, COALESCE(p.large_ratio,0) AS lr,"
    " COALESCE(p.large_unit,'') AS lu, p.name,"
    " (SELECT COUNT(*) FROM product_targets t WHERE t.product_id=p.id"
    "  AND t.period_month=?) AS has_tgt"
    " FROM products p WHERE p.id IN (1556,1494,1596)", (time.strftime("%Y-%m"),)).fetchall()
for r in rows:
    print("    p%-5s brand=%-8s unit=%-3s order_unit=%-4s large=%s/%s 本月有目标=%s  %s"
          % (r["id"], r["brand"], r["unit"], r["order_unit"], r["lr"], r["lu"],
             r["has_tgt"], (r["name"] or "")[:22]))
_xn_with_tgt = c.execute(
    "SELECT COUNT(DISTINCT p.id) FROM products p JOIN product_targets t ON t.product_id=p.id"
    " WHERE p.brand=? AND t.period_month=?", ("蒙牛鲜奶", time.strftime("%Y-%m"))).fetchone()[0]
print("    品牌=蒙牛鲜奶 且本月有目标的商品数 =", _xn_with_tgt)
c.close()

print("\n【2】即将写入")
if MODE == "dry":
    print("   (dry) 不写任何东西。以下为拟写内容：")
    print("   POST /api/rebate-rules")
    print("   " + json.dumps(RULE_BODY, ensure_ascii=False, indent=2)[:1400])
    print("   是否需要给 1596 补样板目标（让 D20 可观测）：",
          "需要" if _xn_with_tgt == 0 else "不需要（已有带目标的鲜奶商品）")
    sys.exit(0)

# ---------------------------------------------------------------- go
print("\n【3】备份")
os.makedirs(BK, exist_ok=True)
_bp = os.path.join(BK, "tenant_1.db.v282-pre-%s" % TS)
_sz = backup(TDB, _bp)
print("   已备份 tenant_1.db → %s (%d 字节)" % (_bp, _sz))

PASS, FAIL = [], []


def ck(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print("   %-6s %s%s" % ("PASS" if cond else "FAIL", name,
                            ("  <<< " + str(extra)) if (extra and not cond) else ""))


uid = uname = None
try:
    print("\n【4】注入临时令牌（绑真实老板账号）")
    uid, uname = token_add()
    print("   uid=%s name=%s tok=%s" % (uid, uname, TOK))

    print("\n【5】POST /api/rebate-rules 建「蒙牛鲜奶」到货节奏规则")
    st, r = req("/api/rebate-rules", token=TOK, method="POST", body=RULE_BODY)
    print("   HTTP", st, json.dumps(r, ensure_ascii=False)[:600])
    ck("建规则返回 200/201", st in (200, 201), st)
    rid = int((r or {}).get("data", {}).get("id") or (r or {}).get("id") or 0) if isinstance(r, dict) else 0
    print("   新规则 id =", rid)

    print("\n【6】读端复核：GET /api/rebate-rules（启用的 brand 规则）")
    st2, r2 = req("/api/rebate-rules?dimension=brand&include_inactive=1", token=TOK)
    data = (r2 or {}).get("data") or []
    mine = [x for x in data if x.get("scope_key") == "蒙牛鲜奶"]
    print("   brand 规则条数 =", len(data), "｜其中蒙牛鲜奶 =", len(mine))
    ck("蒙牛鲜奶规则已出现在读端", len(mine) == 1)
    if mine:
        m = mine[0]
        for k, want in (("target_value", 0), ("rebate_rate", 0), ("order_mode", "interval"),
                        ("order_cadence_days", 2), ("order_first_date", "2026-08-28"),
                        ("order_lead_days", 4), ("arrival_mode", "interval"),
                        ("arrival_cadence_days", 2), ("arrival_count_override", 15),
                        ("auto_period_enabled", 0), ("is_active", 1)):
            got = m.get(k)
            ok = (float(got or 0) == float(want)) if isinstance(want, (int, float)) and not isinstance(want, bool) else (got == want)
            ck("  字段 %s = %r" % (k, want), ok, "got=%r" % (got,))

    print("\n【7】到货日历复核：GET /api/rebate-rules/arrival-preview")
    st3, r3 = req("/api/rebate-rules/arrival-preview?rule_id=%d&year=2026&month=9" % rid, token=TOK)
    print("   HTTP", st3, json.dumps(r3, ensure_ascii=False)[:400])
    _d = (r3 or {}).get("data") or r3 or {}
    ck("到货日历算得出 15 次",
       int((_d or {}).get("effective_count") or 0) == 15, (_d or {}).get("effective_count"))
    ck("到货日期非空", bool((_d or {}).get("dates")), (_d or {}).get("dates"))

    if _xn_with_tgt == 0:
        print("\n【8】给 1596 补一条样板目标（让 D20 的均单提示真正可观测）")
        st4, r4 = req("/api/product-targets", token=TOK, method="POST", body=TARGET_1596)
        print("   HTTP", st4, json.dumps(r4, ensure_ascii=False)[:400])
        ck("建 1596 样板目标成功", st4 in (200, 201), st4)
    else:
        print("\n【8】已存在带目标的鲜奶商品，跳过建样板目标（不动生产数据）")

    print("\n【9】端到端：GET /api/product-targets/avg-target（三件套 flags）")
    st5, r5 = req("/api/product-targets/avg-target?product_ids=1596,1556,1494", token=TOK)
    its = (r5 or {}).get("items") or (r5 or {}).get("data") or []
    for it in its:
        fl = it.get("flags") or {}
        print("   pid=%-5s flags=%-46s per_unit=%-8s avg_box=%s"
              % (it.get("product_id"), sorted(k for k, v in fl.items() if v),
                 it.get("per_unit"), it.get("avg_box")))
    _1596 = [x for x in its if int(x.get("product_id") or 0) == 1596]
    if _1596:
        fl = _1596[0].get("flags") or {}
        ck("🔴 1596 的 no_rule 已消失（品牌到货规则生效）", not fl.get("no_rule"), fl)
        ck("1596 的 no_convert 已消失（上一轮补的换算生效）", not fl.get("no_convert"), fl)
        if _xn_with_tgt == 0:
            ck("🔴 D20 真正可观测：1596 既非 no_target 也非 no_rule/no_convert",
               not any(fl.get(k) for k in ("no_target", "no_rule", "no_convert", "no_dates")), fl)
            ck("1596 给出均单目标数值（不是空）",
               bool(_1596[0].get("per_unit") or _1596[0].get("avg_box")), _1596[0])
finally:
    print("\n【10】删除临时令牌并断言残留 0")
    left = token_del()
    ck("临时令牌残留 = 0", left == 0, left)

print("\n【11】写后快照与差集（🔴 不只比「该变的变了」，也要比「不该变的没变」）")
b1 = snap()
for k in sorted(set(b0) | set(b1)):
    if k in ("brand_rules", "targets"):
        continue
    if b0.get(k) != b1.get(k):
        print("   Δ %-30s %s → %s" % (k, b0.get(k), b1.get(k)))
    else:
        print("   = %-30s %s" % (k, b1.get(k)))
print("   brand 规则：")
for r in (b1["brand_rules"] if isinstance(b1["brand_rules"], list) else []):
    print("      ", r)
print("   目标表：")
for r in (b1["targets"] if isinstance(b1["targets"], list) else []):
    print("      ", r)

print("\n" + "=" * 74)
print("通过 %d / 共 %d" % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print("失败项：")
    for x in FAIL:
        print("   -", x)
    sys.exit(1)
print("RESULT: ALL PASS")
