# -*- coding: utf-8 -*-
"""v365 生产接口层真机探针（真 HTTP；写循环可完全复原）。

为什么必须做这一层：影子库验收脚本是**直接调函数**的，绕过了 FastAPI 路由注册与 nginx
转发 —— 而本项目反复栽在「路由遮蔽 / 方法不放行 / 响应体字段没真的出去」上。
这一段专门补这个缺口，验的是：

  ① `/api/rebate-rules/{id}/arrival-skips` 的 PUT/DELETE 回执里**真的**带 `affected_periods`，
     且每项带最终结论 `excluded`（不是只有"被打中"）；
  ② `/api/forecast/auto-period` 的 `preview[*]` **真的**带 `excluded / exclude_reason`，
     且 `excluded_count` 与 preview 里 excluded 的条数**自洽**；
  ③ 反例：只停一个品牌 ⇒ `excluded=False` 且点名另一个品牌（界面据此说"仍会按期建"）；
  ④ 全停 ⇒ `excluded=True`；取消停单 ⇒ 回执 effect=restore；
  ⑤ 无 token ⇒ 401/403；新路由没被 `/{rule_id}` 遮蔽。

★ 写循环的安全性：只动 2026-10 月、规则 10/11 的停单日，**运行前先快照、finally 强制复原**；
  且所涉期次的填报窗口（10-04 16:00 ~ 10-05 21:00）在运行时**尚未打开** ⇒
  即使中途异常退出，也不会在此期间真的少建一期（有数天余量可人工修）。

运行：/usr/bin/python3 v365-api-probe.py
"""
import json
import re
import sys
import urllib.error
import urllib.request

BASE = "https://hergent.cn"
RULES = "/api/rebate-rules"
YM = (2026, 10)

_P, _F = [], []


def ok(name, cond, detail=""):
    (_P if cond else _F).append(name)
    print(("  PASS  " if cond else "  🔴FAIL ") + name + ((" | " + str(detail)) if detail else ""))


def sec(t):
    print("\n" + "=" * 76 + "\n" + t + "\n" + "=" * 76)


def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("X-Client", "web")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"_raw": raw[:300]}
    except Exception as e:
        return 0, {"_err": str(e)}


def creds():
    src = open("/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/"
               "hergent-forecast-smoke.mjs", encoding="utf-8").read()
    return (re.search(r"HG_USER \|\| '([^']*)'", src).group(1),
            re.search(r"HG_PASS \|\| '([^']*)'", src).group(1))


def skips_of(rule_id, tok):
    _s, d = req("GET", "%s/%d/arrival-skips?year=%d&month=%d" % (RULES, rule_id, YM[0], YM[1]), tok)
    return ((d.get("data") or {}).get("skip_dates_stored") or "").strip()


def put_skips(rule_id, tok, days):
    return req("PUT", "%s/%d/arrival-skips" % (RULES, rule_id), tok,
               {"year": YM[0], "month": YM[1], "skip_dates": days})


def del_skips(rule_id, tok):
    return req("DELETE", "%s/%d/arrival-skips?year=%d&month=%d" % (RULES, rule_id, YM[0], YM[1]), tok)


def auto_period(tok):
    _s, d = req("GET", "/api/forecast/auto-period", tok)
    return (d.get("data") or {})


U, P = creds()
# 这两个日子是生产真实到货日（2026-10-09 ⇒ 报单日 10-05；10-13 ⇒ 报单日 10-09）
D_REAL = "2026-10-09"
D_NOISE = "2026-10-10"          # 不是到货日 ⇒ 不该影响任何期次
D_EXIST = "2026-10-07"          # v368：生产期次#23 的到货日（测「已存在期次」的 skipped）
R_MILK_LOW, R_MILK_FRESH = 10, 11

sec("0. 登录 + 运行前快照（复原用）")
st, d = req("POST", "/api/auth/login", body={"username": U, "password": P})
TOK = d.get("access_token") or d.get("token") or ""
ok("0.1 登录成功", st == 200 and bool(TOK), "status=%s user=%s" % (st, U))
if not TOK:
    print(json.dumps(d, ensure_ascii=False)[:400])
    sys.exit(2)

SNAP = {}
try:
    for rid in (R_MILK_LOW, R_MILK_FRESH):
        SNAP[rid] = skips_of(rid, TOK)
    ok("0.2 运行前快照已记录（finally 会按它复原）", True,
       {k: (v or "<空>") for k, v in SNAP.items()})
except Exception as e:
    print("  无法取快照，放弃（不冒险写生产）：", e)
    sys.exit(2)

try:
    sec("1. 路由与既有契约：GET /{id}/arrival-skips 没被 /{rule_id} 遮蔽")
    st, s11 = req("GET", "%s/%d/arrival-skips?year=%d&month=%d" % (RULES, R_MILK_FRESH, YM[0], YM[1]), TOK)
    dg = s11.get("data") or {}
    ok("1.1 GET 返回 200", st == 200, st)
    ok("1.2 是到货排程返回体（有 system_dates / ym）",
       isinstance(dg, dict) and "system_dates" in dg and dg.get("ym") == "2026-10", list(dg.keys())[:8])
    ok("1.3 v364 字段仍在（skip_dates_stored / count / count_override）",
       "skip_dates_stored" in dg and "count" in dg, (dg.get("count"), repr(dg.get("skip_dates_stored"))))
    ok("1.4 v365 刻意**不**在 GET 上挂 affected_periods（它是「保存回执」，不是列表字段）",
       "affected_periods" not in dg)

    sec("2. 报单自动化预览：excluded / excluded_count 真的从接口出来了")
    ap0 = auto_period(TOK)
    pv0 = ap0.get("preview") or []
    ok("2.1 GET /api/forecast/auto-period 返回 200 且带 preview", st == 200 and len(pv0) > 0, len(pv0))
    ok("2.2 每一期都带 excluded 布尔 + exclude_reason 字符串",
       all(isinstance(p.get("excluded"), bool) and isinstance(p.get("exclude_reason"), str) for p in pv0),
       [(p.get("order_date"), p.get("excluded")) for p in pv0[:4]])
    ok("2.3 顶层带 excluded_count（不是前端自己数）", "excluded_count" in ap0, ap0.get("excluded_count"))
    ok("2.4 🔴 excluded_count 与 preview 里 excluded 的真数**自洽**",
       int(ap0.get("excluded_count") or 0) == len([p for p in pv0 if p.get("excluded")]),
       (ap0.get("excluded_count"), len([p for p in pv0 if p.get("excluded")])))
    BASE_EX = int(ap0.get("excluded_count") or 0)
    ok("2.5 起点：当前没有停单 ⇒ 无期次被排除（快照也确实是空）",
       all(not (v or "").strip() for v in SNAP.values()), SNAP)

    sec("3. 只停**一个**品牌 ⇒ [v368 反转] 回执必须说「不再自动新建」并交代谁跟着停")
    st, r1 = put_skips(R_MILK_LOW, TOK, D_REAL)
    dd1 = r1.get("data") or {}
    af1 = dd1.get("affected_periods") or {}
    ok("3.1 PUT 放行（200）", st == 200, st)
    ok("3.2 回执带 affected_periods（v365 新字段真的出去了）",
       isinstance(af1, dict) and "affected" in af1, list(af1.keys())[:8])
    ok("3.3 computed=True（不是「算不出来」）", af1.get("computed") is True, af1.get("computed"))
    ok("3.4 brand_joins=True（该品牌参与报单编排）", af1.get("brand_joins") is True, af1.get("brand_joins"))
    a_hit = [x for x in (af1.get("affected") or []) if x.get("arrival_date") == D_REAL]
    ok("3.5 🔴 10-09 那一期被列进 affected（打中了）", len(a_hit) == 1, af1.get("affected"))
    p1 = a_hit[0] if a_hit else {}
    # 🔴🔴 v368 反转（老板拍板）：原判「全停才排除」⇒ 现「**任一品牌停 ⇒ 整期不建**」。
    #     旧文（v365）：「excluded=False —— 界面不能据此说『不再自动新建』」—— 已失效，勿照抄。
    ok("3.6 [v368 反转 v365] 🔴🔴 它的**最终结论** excluded=**True** —— 界面必须说"
       "「不再自动新建」（任一品牌不到货 ⇒ 整期不建）",
       p1.get("excluded") is True, (p1.get("excluded"), p1.get("reason")))
    ok("3.7 并点名那天照常到货的品牌（蒙牛鲜奶）—— 判据变了，交代义务没变",
       "蒙牛鲜奶" in (p1.get("still_arriving") or []), p1.get("still_arriving"))
    ok("3.7b 🆕 v368：`skipped_brands` 点名「是谁停的」（界面说「谁仍标记不到货」要靠它）",
       "蒙牛低温" in (p1.get("skipped_brands") or []), p1.get("skipped_brands"))
    ok("3.8 [v368 反转 v365] reason 里写明「不再自动新建期次」+「整期不建」",
       "不再自动新建" in (p1.get("reason") or "") and "整期不建" in (p1.get("reason") or ""),
       p1.get("reason"))
    ok("3.9 window=future（填报窗口 10-04 16:00 才开）", p1.get("window") == "future", p1.get("window"))
    ok("3.10 [v368 反转 v365] excluded_count 回执 = 1（只停一个品牌也会排除这一期）",
       int(af1.get("excluded_count") or 0) == 1, af1.get("excluded_count"))
    st, r1b = put_skips(R_MILK_LOW, TOK, D_REAL + "," + D_NOISE)
    d1b = r1b.get("data") or {}
    ok("3.11 反向：10-10 不是到货日 ⇒ 不产生新的 affected 条目",
       len((((d1b.get("affected_periods") or {}).get("affected")) or [])) == 1,
       ((d1b.get("affected_periods") or {}).get("affected")))

    sec("4. 正例：两个品牌都停 ⇒ excluded=True，且两处预览同步变化")
    st, r2 = put_skips(R_MILK_FRESH, TOK, D_REAL + "," + D_NOISE)
    dd2 = r2.get("data") or {}
    af2 = dd2.get("affected_periods") or {}
    a2 = [x for x in (af2.get("affected") or []) if x.get("arrival_date") == D_REAL]
    ok("4.1 鲜奶也停 ⇒ 那一期 excluded=True", a2 and a2[0].get("excluded") is True,
       (a2 or [{}])[0].get("excluded"))
    ok("4.2 still_arriving 为空（那天没有品牌到货了）",
       a2 and a2[0].get("still_arriving") == [], (a2 or [{}])[0].get("still_arriving"))
    ok("4.3 reason 写明「不再自动新建期次」",
       a2 and "不再自动新建" in (a2[0].get("reason") or ""), (a2 or [{}])[0].get("reason"))
    ok("4.4 回执 excluded_count = 1", int(af2.get("excluded_count") or 0) == 1, af2.get("excluded_count"))
    ap1 = auto_period(TOK)
    pv1 = ap1.get("preview") or []
    ok("4.5 🔴 报单自动化预览同步：excluded_count = 起点 + 1",
       int(ap1.get("excluded_count") or 0) == BASE_EX + 1, (ap1.get("excluded_count"), BASE_EX))
    row1 = [p for p in pv1 if p.get("arrival_date") == D_REAL]
    ok("4.6 🔴 该行 excluded=True（前端据此划线 + 挂「不到货 · 不会建」标记）",
       row1 and row1[0].get("excluded") is True, (row1 or [{}])[0].get("excluded"))
    ok("4.7 该行的 exclude_reason 也出去了（可作 title 提示）",
       row1 and "不到货" in (row1[0].get("exclude_reason") or ""), (row1 or [{}])[0].get("exclude_reason"))
    ok("4.8 未被打中的期次 excluded=False（不是整表都标红）",
       len([p for p in pv1 if p.get("excluded")]) == BASE_EX + 1)

    sec("5. 取消停单：回执必须按「取消之后」算（本轮探针抓到的缺陷的回归）")
    # 此刻两个品牌都停着 10-09 ⇒ 这一期不建。先取消**鲜奶**（低温仍停着）：
    st, r3 = del_skips(R_MILK_FRESH, TOK)
    dd3 = r3.get("data") or {}
    af3 = dd3.get("affected_periods") or {}
    a3 = [x for x in (af3.get("affected") or []) if x.get("arrival_date") == D_REAL]
    ok("5.1 DELETE 放行（200）", st == 200, st)
    ok("5.2 回执里 effect=restore（语义：这些期次会**恢复**）",
       a3 and a3[0].get("effect") == "restore", (a3 or [{}])[0].get("effect"))
    ok("5.3 [v368 反转 v365] 🔴🔴 取消鲜奶之后 excluded=**True** —— 低温仍停 ⇒ 任一品牌停就不建。"
       "界面要说「仍不会自动新建」，说「会恢复」就是与后端结论相反",
       a3 and a3[0].get("excluded") is True, (a3 or [{}])[0])
    ok("5.3b 🆕 v368：`skipped_brands` 点名「还在停的是谁」（蒙牛低温）⇒ 界面才能说清楚",
       a3 and a3[0].get("skipped_brands") == ["蒙牛低温"], (a3 or [{}])[0].get("skipped_brands"))
    ok("5.4 still_arriving 点名刚取消的那一家（蒙牛鲜奶）",
       a3 and a3[0].get("still_arriving") == ["蒙牛鲜奶"], (a3 or [{}])[0].get("still_arriving"))
    ok("5.5 回执 skip_dates_stored 已清空", (dd3.get("skip_dates_stored") or "") == "",
       repr(dd3.get("skip_dates_stored")))

    sec("5b. 🔴 界面真正走的那条路：PUT + skip_dates 空串（前端从不调 DELETE）")
    st, r4 = put_skips(R_MILK_LOW, TOK, "")
    dd4 = r4.get("data") or {}
    af4 = dd4.get("affected_periods") or {}
    a4 = [x for x in (af4.get("affected") or []) if x.get("arrival_date") == D_REAL]
    ok("5b.1 PUT 清空停单（= 界面上把停单日全点掉再保存）⇒ 200", st == 200, st)
    ok("5b.2 🔴 回执 effect=restore —— **不是**「本月停的这几天不影响期次」那种「无影响」",
       a4 and a4[0].get("effect") == "restore", af4)
    ok("5b.3 🔴 且 excluded=False（两个品牌都不停了 ⇒ 这一期会照常自动建）",
       a4 and a4[0].get("excluded") is False, (a4 or [{}])[0])
    ap2 = auto_period(TOK)
    ok("5b.4 🔴 报单自动化预览 excluded_count 回到起点（已完全复原）",
       int(ap2.get("excluded_count") or 0) == BASE_EX, (ap2.get("excluded_count"), BASE_EX))

    sec("6. 只读保护与遮蔽（只读项）")
    st, _ = req("GET", "%s/%d/arrival-skips?year=%d&month=%d" % (RULES, R_MILK_FRESH, YM[0], YM[1]))
    ok("6.1 未带 token ⇒ 401/403（不是 200）", st in (401, 403), st)
    st, _ = req("PUT", "%s/%d/arrival-skips" % (RULES, R_MILK_FRESH),
                None, {"year": YM[0], "month": YM[1], "skip_dates": "2026-10-09"})
    ok("6.2 未带 token 的 PUT 被拦（写路径没裸奔）", st in (401, 403), st)
    st, _ = req("GET", "/api/forecast/auto-period")
    ok("6.3 /api/forecast/auto-period 未带 token ⇒ 401/403", st in (401, 403), st)

    sec("8. 🆕 v368：期次列表的 skipped（④「本期少了 N 期」）与一键作废端点（③）")
    st, lp0 = req("GET", "/api/forecast/periods", TOK)
    ok("8.1 GET /api/forecast/periods 返回 200 且带 skipped 键", st == 200 and "skipped" in lp0,
       (st, list(lp0.keys())[:8]))
    ok("8.2 🔴 无停单 ⇒ skipped 为空、skipped_dates 为空（不误报：不能把正常期次说成「货不来」）",
       lp0.get("skipped") == [] and lp0.get("skipped_dates") == [],
       (lp0.get("skipped"), lp0.get("skipped_dates")))
    ok("8.3 既有字段一个没少（periods / current / open / open_stale / auto_reap_on）",
       all(k in lp0 for k in ("periods", "current", "open", "open_stale", "auto_reap_on")),
       list(lp0.keys()))
    # 生产真实期次#23：报单日 2026-10-03 / 到货 2026-10-07 / status=open
    # ⇒ 把 10-07 标记「不到货」，它就变成「本不该建」的那一期（v368③的受众）。
    # 🔴 只写停单表（v364 的表）、不建期次 —— 建 open 期次会挡住自动建表（v354/355 死锁）。
    st8, r8 = put_skips(R_MILK_LOW, TOK, D_EXIST)
    ok("8.4 标记 10-07 不到货 ⇒ PUT 200", st8 == 200, st8)
    st, lp1 = req("GET", "/api/forecast/periods", TOK)
    sk1 = lp1.get("skipped") or []
    hit23 = [s for s in sk1 if s.get("arrival_date") == D_EXIST]
    ok("8.5 🔴 skipped 点名了已存在的那一期（④的数据来源）", bool(hit23), sk1)
    ok("8.6 该项带 id / name / arrival_date / status 四件套（界面要显示 + 要作废）",
       hit23 and all(k in hit23[0] for k in ("id", "name", "arrival_date", "status")),
       (hit23 or [{}])[0])
    ok("8.7 它是「还没作废」的 open 期次（界面据此才显示「一键作废」按钮）",
       hit23 and hit23[0].get("status") == "open", (hit23 or [{}])[0].get("status"))
    ok("8.8 skipped_dates 去重列出到货日（界面点名用）",
       lp1.get("skipped_dates") == [D_EXIST], lp1.get("skipped_dates"))
    st, ob1 = req("GET", "/api/forecast/order-board", TOK)
    bd1 = ob1.get("board") or []
    r23 = next((r for r in bd1 if str(r.get("arrival_date") or "") == D_EXIST), None)
    ok("8.9 🔴 GET /order-board 行内 arrival_skipped=1（历史页据此显示「那天不到货」+ 按钮）",
       r23 is not None and r23.get("arrival_skipped") == 1, r23 and r23.get("arrival_skipped"))
    ok("8.10 未打中的期次 arrival_skipped=0（不是整表都标）",
       all(int(r.get("arrival_skipped") or 0) == 0
           for r in bd1 if str(r.get("arrival_date") or "") != D_EXIST))
    # 🔴 void 端点存在性判据：404 的 detail 是我们自己写的「期次不存在或已删除」，
    #    而 FastAPI 路由不存在时 detail 是 "Not Found" ⇒ 两者可区分 ⇒ 断言有判别力。
    #    用 999999（必然不存在）⇒ 零副作用，不碰生产在用的期次。
    st, vd = req("POST", "/api/forecast/periods/999999/void", TOK)
    ok("8.11 🔴 作废端点**已注册**：POST /periods/999999/void ⇒ 404 且 detail 是我们那条"
       "（若路由不存在，detail 会是 FastAPI 的 Not Found）",
       st == 404 and "期次不存在" in str(vd.get("detail") or ""), (st, vd.get("detail")))
    st, _ = req("POST", "/api/forecast/periods/999999/void")
    ok("8.12 作废端点未带 token ⇒ 401/403（写路径没裸奔）", st in (401, 403), st)
    # 复原：清掉这一节写的停单（finally 还会再兜一次）
    del_skips(R_MILK_LOW, TOK)
    st, lp2 = req("GET", "/api/forecast/periods", TOK)
    ok("8.13 复原后 skipped 回到空（不留下脏数据）",
       (lp2.get("skipped") or []) == [], lp2.get("skipped"))

finally:
    sec("7. 复原（无论前面成败都执行）")
    for rid in (R_MILK_LOW, R_MILK_FRESH):
        want = SNAP.get(rid) or ""
        if want:
            st, _r = put_skips(rid, TOK, want)
        else:
            st, _r = del_skips(rid, TOK)
        now = skips_of(rid, TOK)
        ok("7.%d 规则 %d 已复原为运行前状态" % (1 if rid == R_MILK_LOW else 2, rid),
           now == want, "want=%r got=%r status=%s" % (want, now, st))

sec("汇总")
print("  合计 %d 项：PASS %d / FAIL %d" % (len(_P) + len(_F), len(_P), len(_F)))
if _F:
    print("  🔴 失败项：")
    for f in _F:
        print("     -", f)
sys.exit(1 if _F else 0)
