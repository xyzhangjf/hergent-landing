# -*- coding: utf-8 -*-
"""v282 验收：① D20 均单提示三件套是否打通 ② 自动开表排程是否仍逐条不变（只读）。"""
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request

BASE = "/opt/hergent-erp"
API = "http://127.0.0.1:8700"
TENANT = 1
TS = time.strftime("%Y%m%d-%H%M%S")

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
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)      # 活库：绝不用 immutable
    c.row_factory = sqlite3.Row
    return c


TOK = None


def token_add():
    global TOK
    m = sqlite3.connect(BASE + "/erp.db")
    m.execute("PRAGMA busy_timeout=8000")
    m.row_factory = sqlite3.Row
    u = m.execute("SELECT id, username, display_name FROM users WHERE role='boss'"
                  " AND COALESCE(is_active,1)=1 ORDER BY id LIMIT 1").fetchone()
    TOK = "v282v-" + TS + "-boss"
    have = {r[1] for r in m.execute("PRAGMA table_info(sessions)").fetchall()}
    cand = [("token", TOK), ("user_id", u["id"]), ("username", u["username"]),
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
    return u["id"], u["display_name"]


def token_del():
    if not TOK:
        return 0
    m = sqlite3.connect(BASE + "/erp.db")
    m.execute("DELETE FROM sessions WHERE token=?", (TOK,))
    m.commit()
    n = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (TOK,)).fetchone()[0]
    m.close()
    return n


PASS, FAIL = [], []


def ck(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print("   %-6s %s%s" % ("PASS" if cond else "FAIL", name,
                            ("  <<< " + str(extra)) if (extra and not cond) else ""))


print("=" * 74)
print("v282 验收（只读）· TS =", TS)
print("=" * 74)

try:
    token_add()
    print("   临时令牌已注入（只读用途）")

    print("\n【A】先取当前 open 期次 id（avg-target 的必需入参）")
    st, rp = req("/api/forecast/periods", token=TOK)
    # ⚠️ 变量名**绝不能叫 `_op`** —— 模块级 `_op` 是 HTTP opener，遮蔽它会让之后
    #    每一个请求都抛 `'dict' object has no attribute 'open'`（本轮实测踩过一次）。
    _open_period = (rp or {}).get("open") or (rp or {}).get("current") or {}
    pid = (_open_period or {}).get("id") if isinstance(_open_period, dict) else _open_period
    print("   HTTP", st, "｜open 期次 id =", pid,
          "｜名称 =", (_open_period or {}).get("name") if isinstance(_open_period, dict) else "")
    ck("取到 open 期次 id", bool(pid), rp if st != 200 else pid)

    print("\n【A2】D20：GET /api/product-targets/avg-target 原始返回结构")
    st, r = req("/api/product-targets/avg-target?period_id=%s&product_ids=1596" % pid, token=TOK)
    print("   HTTP", st)
    print("   顶层键 =", sorted(r.keys()) if isinstance(r, dict) else type(r))
    print("   原样（前 2000 字符）：")
    print("   " + json.dumps(r, ensure_ascii=False)[:2000])

    print("\n【B】三条样板一起看（1556 / 1494 / 1596）")
    st, r2 = req("/api/product-targets/avg-target?period_id=%s&product_ids=1596,1556,1494" % pid,
                 token=TOK)
    ck("avg-target 返回 HTTP 200（先验状态码，防 404 体造成假 PASS）", st == 200, st)
    # 🔴 实测：`items` 是 **按商品 id 的 dict**（`{"1596": {...}}`），不是 list。
    #    上一版只找 list ⇒ 找不到 ⇒ 下面那批断言**一条都没执行**，而计数照样 17/17（有水分）。
    #    这里两种形状都吃，并且加一条「确实解析出来了」的断言，防止再次空跑。
    items = None
    if isinstance(r2, dict):
        _v = r2.get("items")
        if isinstance(_v, dict):
            items = list(_v.values())
            print("   items 为 dict（按商品 id），取 values() 得 %d 项" % len(items))
        elif isinstance(_v, list):
            items = _v
            print("   items 为 list，%d 项" % len(items))
    ck("确实解析出 items 列表（防断言空跑）", bool(items), (type(r2.get("items")).__name__ if isinstance(r2, dict) else type(r2).__name__))
    if items:
        for it in items:
            fl = sorted(k for k, v in (it.get("flags") or {}).items() if v)
            print("   pid=%-6s brand=%-8s 行内单位=%-4s per_unit=%-34s avg_box=%-8s flags=%s"
                  % (it.get("product_id"), it.get("brand"), it.get("unit"),
                     json.dumps(it.get("per_unit") or {}, ensure_ascii=False),
                     it.get("avg_box"), fl))
        m1596 = [x for x in items if int(x.get("product_id") or 0) == 1596]
        ck("返回里含 1596 这一项", len(m1596) == 1, len(m1596))
        if m1596:
            fl = m1596[0].get("flags") or {}
            ck("🔴 1596 无 no_rule（品牌到货规则生效）", not fl.get("no_rule"), fl)
            ck("🔴 1596 无 no_convert（上轮补的换算生效）", not fl.get("no_convert"), fl)
            ck("🔴 1596 无 no_target（新样板目标生效）", not fl.get("no_target"), fl)
            ck("🔴 1596 无 no_dates", not fl.get("no_dates"), fl)
            ck("🔴 D20 真正可观测：四类缺口 flag 全清", not any(fl.get(k) for k in
               ("no_target", "no_convert", "no_rule", "no_dates")), fl)
            ck("1596 算出均单目标数值（非空）",
               bool(m1596[0].get("per_unit") or m1596[0].get("avg_box")), m1596[0])
            # 单位同源：行内单位 = order_unit，必须能在 per_unit 里取到对应的键（v279 判据）
            _pu = m1596[0].get("per_unit") or {}
            _ou = m1596[0].get("unit")
            ck("🔴 行内单位(%s) 能直接取到 per_unit[%s]（前后端同源）" % (_ou, _ou),
               _ou in _pu, _pu)
    print("\n   arrivals（各品牌到货日历 —— reason 必须为空字符串）")
    for b, info in ((r2 or {}).get("arrivals") or {}).items():
        print("     %-8s reason=%-10r effective_count=%-3s remaining=%-3s dates=%d"
              % (b, info.get("reason"), info.get("effective_count"),
                 info.get("remaining"), len(info.get("dates") or [])))
    _arr = (r2 or {}).get("arrivals") or {}
    ck("🔴 蒙牛鲜奶 的 reason 已不是 no_rule", (_arr.get("蒙牛鲜奶") or {}).get("reason") == "",
       _arr.get("蒙牛鲜奶"))
    ck("🔴 蒙牛鲜奶 与 蒙牛低温 的 effective_count 相等（同节奏）",
       (_arr.get("蒙牛鲜奶") or {}).get("effective_count")
       == (_arr.get("蒙牛低温") or {}).get("effective_count") == 15, _arr)

    print("\n【C】自动开表排程：GET /api/rebate-rules/auto-period-preview")
    st, r3 = req("/api/rebate-rules/auto-period-preview?horizon_days=14", token=TOK)
    _d = (r3 or {}).get("data") or r3 or {}
    per = (_d or {}).get("periods") or []
    print("   main_brand =", (_d or {}).get("main_brand"), "｜periods =", len(per))
    for p in per[:3]:
        print("     ", p.get("order_date"), "→ 到货", p.get("arrival_date"), "｜品牌", p.get("brands"))
    ck("排程仍为 7 条", len(per) == 7, len(per))
    ck("主品牌仍是蒙牛低温（未被抢）", (_d or {}).get("main_brand") == "蒙牛低温",
       (_d or {}).get("main_brand"))
    _dates = [p.get("order_date") for p in per]
    ck("排程日期与写入前逐条一致",
       _dates == ["2026-09-27", "2026-09-29", "2026-10-01", "2026-10-03", "2026-10-05",
                  "2026-10-07", "2026-10-09"], _dates)
    ck("每条期次同时列出蒙牛低温 + 蒙牛鲜奶（显示层）",
       all(set(p.get("brands") or []) == {"蒙牛低温", "蒙牛鲜奶"} for p in per),
       [p.get("brands") for p in per[:2]])

    print("\n【D】返利域回归：现有两条规则数值未变")
    for rid, want_tv, want_rate in ((9, 80000.0, 0.12), (10, 8684000.0, 0.1)):
        st, rr = req("/api/rebate-rules/%d" % rid, token=TOK)
        d = (rr or {}).get("data") or rr or {}
        ck("规则#%d 目标值仍为 %s" % (rid, want_tv), float((d or {}).get("target_value") or 0) == want_tv,
           (d or {}).get("target_value"))
        ck("规则#%d 返利率仍为 %s" % (rid, want_rate), float((d or {}).get("rebate_rate") or 0) == want_rate,
           (d or {}).get("rebate_rate"))

    print("\n【E】节奏规则不得产生返利：POST /api/rebate-rules/simulate")
    # 🔴 契约是 `{rule_id, actual_value}`（**不是** /{id}/simulate —— 上一版这里写错了路径、
    #    拿到 404 体，而 `float((404体).get("rebate_amount") or 0) == 0` 恰好成立 ⇒ **假 PASS**。
    #    修法：① 走对路径 ② 先断言 HTTP 200，再断言字段。）
    st, r5 = req("/api/rebate-rules/simulate", token=TOK, method="POST",
                 body={"rule_id": 11, "actual_value": 900000})
    print("   HTTP", st, json.dumps(r5, ensure_ascii=False)[:500])
    ck("simulate 返回 HTTP 200", st == 200, st)
    _rd = (r5 or {}).get("data") or {}
    ck("节奏规则试算返利 = 0", float((_rd or {}).get("rebate_amount") or 0) == 0,
       (_rd or {}).get("rebate_amount"))
    ck("节奏规则试算不触发", not (_rd or {}).get("triggered"), (_rd or {}).get("triggered"))
    ck("节奏规则的达成率为 None（不编百分比）", (_rd or {}).get("achievement") is None,
       (_rd or {}).get("achievement"))
finally:
    left = token_del()
    ck("临时令牌残留 = 0", left == 0, left)

print("\n【F】月份锁（判据：节奏规则不许占月）")
c = live(BASE + "/tenant_1.db")
n = c.execute("SELECT COUNT(*) FROM rebate_rule_month_lock").fetchone()[0]
mine = c.execute("SELECT COUNT(*) FROM rebate_rule_month_lock WHERE rule_id=11").fetchone()[0]
print("   锁总行数 =", n, "｜其中 rule_id=11 占的 =", mine)
ck("🔴 节奏规则(11) 占 0 个月份锁", mine == 0, mine)
ck("锁总行数仍为 13（未被改动）", n == 13, n)
c.close()

print("\n" + "=" * 74)
print("通过 %d / 共 %d" % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print("失败项：")
    for x in FAIL:
        print("   -", x)
    sys.exit(1)
print("RESULT: ALL PASS")
