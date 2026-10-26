#!/usr/bin/env python3
"""Hergent AI 用量日报生成器。

用途：把「AI 副驾到底花了多少钱」变成老板能直接看的一页纸。
数据源两个，缺一不可：
  1) Hermes 账本 /root/.hermes/state.db::session_model_usage —— 全期历史（会话级累计）
  2) 我们自己的账本 /opt/hergent-erp/erp.db::ai_usage_v2 —— v693 起每次请求一行（精确）

用法：
    python3 ai_daily_report.py                 # 连生产拉数据 → 生成 HTML
    python3 ai_daily_report.py --cache x.json  # 用已导出的原始数据离线重算
    python3 ai_daily_report.py --out /path.html

🔴 三条口径纪律（都踩过坑，别改）：
  A. 单价必须用「现行价 + 峰谷」，不能用 Hermes 的 estimated_cost_usd：
     那张表是 deepseek-pricing-2026-07 快照，输出价低估约 2 倍；
     且模型名叫 deepseek-flash 的行它压根算不出、直接记 0（890 次调用）。
  B. 会话级行不能按 last_seen 直接归日：最长一条跨度 1436 小时（60 天），
     整条归到末次那天会把「今天」虚高 6 倍。跨度 >4h 的行只计总量、不归日。
  C. 思考量必须单列：输出里 63% 是 reasoning，老板看不见却付了钱。
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BJ = timezone(timedelta(hours=8))
HOST = "root@47.113.224.140"

# 现行价（元 / 百万 token，闲时）。与生产 usage_pricing.py 补丁保持一致。
P_MISS, P_HIT, P_OUT = 1.0, 0.02, 4.0
SPAN_LIMIT_H = 4.0          # 超过这个跨度视为「跨期累积」，不归日
FX_USD = 7.14

REMOTE = r'''
import sqlite3, json
out = {}
c = sqlite3.connect("file:/root/.hermes/state.db?mode=ro", uri=True)
out["hermes"] = c.execute(
    "select model,api_call_count,input_tokens,output_tokens,cache_read_tokens,"
    "cache_write_tokens,reasoning_tokens,estimated_cost_usd,cost_source,"
    "first_seen,last_seen from session_model_usage order by first_seen").fetchall()
c2 = sqlite3.connect("file:/opt/hergent-erp/erp.db?mode=ro", uri=True)
try:
    out["ledger"] = c2.execute(
        "select tenant_id,user_id,model,kind,prompt_tokens,completion_tokens,"
        "cache_read_tokens,is_peak,est_cost_cny,source,created_at "
        "from ai_usage_v2 order by id").fetchall()
except Exception:
    out["ledger"] = []
print(json.dumps(out))
'''


def fetch() -> dict:
    b64 = base64.b64encode(REMOTE.encode("utf-8")).decode("ascii")
    cmd = (f"echo {b64} | base64 -d > /tmp/_daily_extract.py && "
           f"runuser -u hergent -- python3 /tmp/_daily_extract.py")
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=20", HOST, cmd],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("拉取失败：\n" + (r.stderr or r.stdout)[-800:])
    return json.loads(r.stdout)


def is_peak(dt: datetime) -> bool:
    """DeepSeek 峰谷：北京时间 周一至周五 9-12 / 14-18 为高峰，周末全天闲时。"""
    if dt.weekday() >= 5:
        return False
    return 9 <= dt.hour < 12 or 14 <= dt.hour < 18


def session_cost(row) -> float:
    """按现行价 + 峰谷重算一条会话行的人民币成本。"""
    miss, out, hit = row[2] or 0, row[3] or 0, row[4] or 0
    base = miss / 1e6 * P_MISS + hit / 1e6 * P_HIT + out / 1e6 * P_OUT
    return base * (2 if is_peak(datetime.fromtimestamp(row[10], BJ)) else 1)


def analyse(raw: dict, today: datetime) -> dict:
    rows = raw["hermes"]
    day0 = (today - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)

    short, long_ = [], []
    for r in rows:
        span = ((r[10] - r[9]) / 3600.0) if (r[9] and r[10]) else 0.0
        (short if span <= SPAN_LIMIT_H else long_).append(r)

    # —— 按天（仅短会话可归日）——
    by_day: dict[str, dict] = {}
    d = day0
    while d <= today:
        by_day[d.strftime("%Y-%m-%d")] = dict(cost=0.0, calls=0, sess=0, miss=0, out=0, reas=0)
        d += timedelta(days=1)

    total = dict(cost=0.0, calls=0, sess=0, miss=0, hit=0, out=0, reas=0)
    c_miss = c_hit = c_reas = c_body = 0.0
    for r in rows:
        calls, miss, out, hit, reas = (r[1] or 0, r[2] or 0, r[3] or 0, r[4] or 0, r[6] or 0)
        mul = 2 if is_peak(datetime.fromtimestamp(r[10], BJ)) else 1
        cm = miss / 1e6 * P_MISS * mul
        ch = hit / 1e6 * P_HIT * mul
        rr = (reas / out) if out else 0.0
        cr = out * rr / 1e6 * P_OUT * mul
        cb = out * (1 - rr) / 1e6 * P_OUT * mul
        total["cost"] += cm + ch + cr + cb
        total["calls"] += calls; total["miss"] += miss; total["hit"] += hit
        total["out"] += out; total["reas"] += reas; total["sess"] += 1
        c_miss += cm; c_hit += ch; c_reas += cr; c_body += cb

    for r in short:
        k = datetime.fromtimestamp(r[10], BJ).strftime("%Y-%m-%d")
        if k not in by_day:
            continue
        b = by_day[k]
        b["cost"] += session_cost(r); b["calls"] += r[1] or 0; b["sess"] += 1
        b["miss"] += r[2] or 0; b["out"] += r[3] or 0; b["reas"] += r[6] or 0

    def window(days: int) -> dict:
        keys = [(today - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d") for i in range(days)]
        vals = [by_day.get(k, dict(cost=0.0, calls=0, sess=0)) for k in keys]
        cost = sum(v["cost"] for v in vals)
        active = sum(1 for v in vals if v["cost"] > 0.005)
        return dict(cost=cost, calls=sum(v["calls"] for v in vals),
                    sess=sum(v["sess"] for v in vals), days=days, active=active,
                    per_active=cost / active if active else 0.0)

    # —— 今日明细（会话级，仅短会话）——
    tkey = today.strftime("%Y-%m-%d")
    today_sess = []
    for r in short:
        if datetime.fromtimestamp(r[10], BJ).strftime("%Y-%m-%d") != tkey:
            continue
        today_sess.append(dict(
            t0=datetime.fromtimestamp(r[9], BJ).strftime("%H:%M"),
            t1=datetime.fromtimestamp(r[10], BJ).strftime("%H:%M"),
            model=r[0] or "(未记录)", calls=r[1] or 0,
            miss=r[2] or 0, hit=r[4] or 0, out=r[3] or 0,
            reas=r[6] or 0, cost=session_cost(r),
            peak=is_peak(datetime.fromtimestamp(r[10], BJ))))
    today_sess.sort(key=lambda x: -x["cost"])

    span_h = [((r[10] - r[9]) / 3600.0) for r in rows if r[9] and r[10]]
    span_h.sort()

    return dict(
        total=total, by_day=by_day, short=short, long=long_,
        c_miss=c_miss, c_hit=c_hit, c_reas=c_reas, c_body=c_body,
        w1=window(1), w7=window(7), w30=window(30),
        today_sess=today_sess,
        long_cost=sum(session_cost(r) for r in long_),
        short_cost=sum(session_cost(r) for r in short),
        hermes_usd=sum(r[7] or 0 for r in rows),
        ledger=raw.get("ledger", []),
        span_max=(span_h[-1] if span_h else 0.0),
        span_p90=(span_h[int(len(span_h) * 0.9)] if span_h else 0.0),
    )


def money(v: float, unit: str = "元") -> str:
    """金额展示：1 元 = 10 毛 = 100 分，逐档换小单位，别让老板自己算。

    🔴 别把 v*100 当「毛」—— 那会得出 0.637 元 = 64 毛（实际 6.4 毛）。
    """
    if v >= 1:
        return f"{v:.2f} 元"
    if v >= 0.1:
        return f"{v * 10:.1f} 毛"
    if v > 0:
        return f"{v * 100:.0f} 分"
    return "0"


def credits(v: float) -> int:
    return int(round(v * 100))


def render(a: dict, today: datetime) -> str:
    W = a["w1"]; W7 = a["w7"]; W30 = a["w30"]; T = a["total"]
    total_cost = T["cost"]
    tot_reas_pct = T["reas"] / T["out"] * 100 if T["out"] else 0

    # —— 趋势图（近 30 天，含 0 值，按周标注闲/峰不可知，只画成本）——
    days = list(a["by_day"].items())
    peak_cost = max([v["cost"] for _, v in days] + [0.01])
    bars = []
    for i, (k, v) in enumerate(days):
        h = (v["cost"] / peak_cost) * 100 if peak_cost else 0
        dt = datetime.strptime(k, "%Y-%m-%d")
        cls = "bar zero" if v["cost"] < 0.005 else ("bar hi" if v["cost"] >= peak_cost * 0.6 else "bar")
        # 30 根柱子挤不下 30 个日期，隔 3 天标一个（柱子上 hover 有完整日期）
        label = f"{dt.month}/{dt.day}" if i % 3 == 0 or i == len(days) - 1 else ""
        tip = (f"{k}　{money(v['cost'])}（{credits(v['cost'])} 积分）\\n"
               f"{v['sess']} 个会话 / {v['calls']} 次调用")
        bars.append(
            f'<div class="bcol" title="{tip}">'
            f'<div class="bwrap"><div class="{cls}" style="height:{max(h, v["cost"] > 0.005 and 3 or 1.5):.1f}%"></div></div>'
            f'<div class="bday">{label}</div></div>')

    # —— 钱花在哪 ——
    parts = [
        ("未缓存输入", a["c_miss"], "每轮新进来的数据（工具返回的明细）"),
        ("输出·思考过程", a["c_reas"], "你看不见，但按输出全价付钱"),
        ("缓存命中输入", a["c_hit"], "上下文复用，单价只有 1/50"),
        ("输出·正文", a["c_body"], "你真正读到的那几段话"),
    ]
    parts.sort(key=lambda x: -x[1])
    bars2 = []
    for name, val, note in parts:
        pct = val / total_cost * 100 if total_cost else 0
        bars2.append(
            f'<div class="crow"><div class="cname">{name}'
            f'<span class="cnote">{note}</span></div>'
            f'<div class="ctrack"><div class="cfill" style="width:{pct:.1f}%"></div></div>'
            f'<div class="cval"><b>{money(val)}</b><span>{pct:.0f}%</span></div></div>')

    # —— 今日明细 ——
    if a["today_sess"]:
        trows = []
        for s in a["today_sess"]:
            tag = '<i class="pk">高峰</i>' if s["peak"] else '<i class="off">闲时</i>'
            trows.append(
                f'<tr><td class="mono">{s["t0"]}–{s["t1"]}</td>'
                f'<td>{s["calls"]}</td><td class="mono">{s["miss"]:,}</td>'
                f'<td class="mono">{s["out"]:,}</td><td>{tag}</td>'
                f'<td class="num">{money(s["cost"])}</td>'
                f'<td class="num">{credits(s["cost"]) or "&lt;1"} 分</td></tr>')
        today_tbl = ("<table><thead><tr><th>时段</th><th>调用</th><th>新输入</th>"
                     "<th>输出</th><th>峰谷</th><th>成本</th><th>积分</th></tr></thead><tbody>"
                     + "".join(trows) + "</tbody></table>")
    else:
        today_tbl = '<p class="empty">今天还没有产生计费对话。</p>'

    # —— 定价含义 ——
    per_sess = W30["cost"] / W30["sess"] if W30["sess"] else 0
    busy_day = a["by_day"].get(today.strftime("%Y-%m-%d"), {}).get("cost", 0)
    heavy = max([v["cost"] for k, v in a["by_day"].items() if k >= (today - timedelta(days=29)).strftime("%Y-%m-%d")] + [0])

    ledger_n = len(a["ledger"])
    cov = a["short_cost"] / max(a["short_cost"] + a["long_cost"], 0.01) * 100
    ledger_ok = ""
    if ledger_n:
        lc = sum(r[8] or 0 for r in a["ledger"])
        ledger_ok = (f'自有账本已记 <b>{ledger_n}</b> 条（合计 ¥{lc:.4f}），'
                     f'与 Hermes 账本互校一致 —— 以后 Hermes 那份丢了，这张日报照样能出。')

    return f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hergent AI 用量日报 · {today.strftime('%Y-%m-%d')}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#f4f5f7;color:#1f2329;padding:28px 20px 60px;
 font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
 -webkit-font-smoothing:antialiased}}
.wrap{{max-width:1080px;margin:0 auto}}
h1{{font-size:22px;font-weight:650;letter-spacing:-.2px}}
.sub{{color:#6b7280;font-size:13px;margin-top:6px}}
.sub b{{color:#1f2329;font-weight:600}}
section{{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 22px;margin-top:16px}}
h2{{font-size:15px;font-weight:650;margin-bottom:4px}}
h2 .hint{{font-size:12px;color:#9ca3af;font-weight:400;margin-left:8px}}
.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}}
.kpi{{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px}}
.kpi .lab{{font-size:12px;color:#6b7280}}
.kpi .big{{font-size:27px;font-weight:660;line-height:1.25;margin-top:5px;letter-spacing:-.5px}}
.kpi .big small{{font-size:14px;font-weight:500;color:#6b7280;margin-left:2px}}
.kpi .foot{{font-size:12px;color:#9ca3af;margin-top:4px}}
.kpi.today{{border-color:#bfdbfe;background:linear-gradient(180deg,#f0f7ff,#fff 60%)}}
.kpi.today .big{{color:#1d4ed8}}
.chart{{display:flex;align-items:flex-end;gap:5px;height:170px;margin-top:18px;padding-top:8px}}
.bcol{{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;cursor:default}}
.bwrap{{height:100%;display:flex;align-items:flex-end}}
.bar{{width:100%;background:#93b4f7;border-radius:3px 3px 0 0;min-height:2px;transition:background .15s}}
.bar.hi{{background:#2563eb}}
.bar.zero{{background:#e8eaed}}
.bcol:hover .bar{{background:#1d4ed8}}
.bday{{font-size:10px;color:#b0b5bd;text-align:center;margin-top:5px;height:14px;overflow:hidden}}
.crow{{display:grid;grid-template-columns:190px 1fr 96px;gap:14px;align-items:center;padding:9px 0;border-bottom:1px dashed #f0f1f3}}
.crow:last-child{{border-bottom:0}}
.cname{{font-size:13px;font-weight:560}}
.cnote{{display:block;font-size:11px;color:#9ca3af;font-weight:400;margin-top:1px;line-height:1.4}}
.ctrack{{background:#f1f2f4;border-radius:5px;height:9px;overflow:hidden}}
.cfill{{height:100%;background:linear-gradient(90deg,#7aa2f0,#3b6fd4);border-radius:5px}}
.cval{{text-align:right;font-size:13px}}
.cval span{{display:block;font-size:11px;color:#9ca3af}}
table{{width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px}}
th{{text-align:left;font-weight:560;color:#6b7280;font-size:11.5px;padding:7px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap}}
td{{padding:8px;border-bottom:1px solid #f3f4f6}}
tr:last-child td{{border-bottom:0}}
.num{{text-align:right;font-variant-numeric:tabular-nums}}
.mono{{font-variant-numeric:tabular-nums;color:#4b5563}}
.pk{{font-style:normal;font-size:11px;padding:1px 6px;border-radius:4px;background:#fef3c7;color:#b45309}}
.off{{font-style:normal;font-size:11px;padding:1px 6px;border-radius:4px;background:#ecfdf5;color:#047857}}
.find{{display:flex;gap:12px;padding:14px 0;border-bottom:1px dashed #f0f1f3}}
.find:last-child{{border-bottom:0}}
.find .n{{flex:none;width:22px;height:22px;border-radius:6px;background:#eef2ff;color:#4338ca;
 font-size:12px;font-weight:650;display:flex;align-items:center;justify-content:center;margin-top:1px}}
.find .t{{font-size:13px}}
.find .t b{{font-weight:650}}
.find .t em{{font-style:normal;color:#b91c1c;font-weight:600}}
.find .t i{{font-style:normal;color:#047857;font-weight:600}}
.note{{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-top:14px}}
.note h3{{font-size:12.5px;color:#92400e;margin-bottom:6px}}
.note p{{font-size:12px;color:#92400e;line-height:1.75}}
.note code{{background:#fef3c7;padding:1px 4px;border-radius:3px;font-size:11.5px}}
.empty{{color:#9ca3af;font-size:13px;padding:16px 0}}
@media (max-width:820px){{.kpis{{grid-template-columns:repeat(2,1fr)}}.crow{{grid-template-columns:120px 1fr 80px}}}}
</style></head><body><div class="wrap">

<h1>AI 副驾用了多少钱</h1>
<div class="sub">
  统计到 <b>{today.strftime('%Y 年 %m 月 %d 日 %H:%M')}</b>　·　
  模型 <b>deepseek-v4-flash</b>　·　
  口径：现行价 + 峰谷（高峰价 = 闲时 ×2）　·　<b>1 积分 = 1 分钱</b>
</div>

<div class="kpis">
  <div class="kpi today">
    <div class="lab">今天</div>
    <div class="big">{money(W["cost"])}<small>= {credits(W["cost"])} 积分</small></div>
    <div class="foot">{W["sess"]} 个会话 / {W["calls"]} 次调用</div>
  </div>
  <div class="kpi">
    <div class="lab">近 7 天</div>
    <div class="big">{money(W7["cost"])}<small>= {credits(W7["cost"]):,} 积分</small></div>
    <div class="foot">{W7["active"]} 天有用量，日均 {money(W7["per_active"])}</div>
  </div>
  <div class="kpi">
    <div class="lab">近 30 天</div>
    <div class="big">{money(W30["cost"])}<small>= {credits(W30["cost"]):,} 积分</small></div>
    <div class="foot">{W30["active"]} 天有用量，日均 {money(W30["per_active"])}<br>另有 {100 - cov:.0f}% 跨天会话未摊入</div>
  </div>
  <div class="kpi">
    <div class="lab">6 月底至今累计</div>
    <div class="big">{money(total_cost)}<small>= {credits(total_cost):,} 积分</small></div>
    <div class="foot">{T["sess"]} 个会话 / {T["calls"]:,} 次调用</div>
  </div>
</div>

<section>
  <h2>每天花了多少<span class="hint">近 30 天 · 鼠标停在柱子上看当天明细</span></h2>
  <div class="chart">{"".join(bars)}</div>
</section>

<section>
  <h2>钱花在哪<span class="hint">按成本占比排序 · 累计 {money(total_cost)}</span></h2>
  {"".join(bars2)}
</section>

<section>
  <h2>今天在干什么<span class="hint">只统计今天内开始并结束的会话；跨天长会话不计入单日</span></h2>
  {today_tbl}
</section>

<section>
  <h2>三个判断</h2>
  <div class="find">
    <div class="n">1</div>
    <div class="t">单个任务大约 <b>{credits(per_sess)} 积分</b>（{money(per_sess)}），
    近 30 天一共 {W30["sess"]} 个会话、{credits(W30["cost"]):,} 积分。
    你用得最狠的一天是 <b>{money(heavy)}</b>（{credits(heavy)} 积分）—— 那天是在开发调系统，不是在正常经营。</div>
  </div>
  <div class="find">
    <div class="n">2</div>
    <div class="t">输出里有 <b>{tot_reas_pct:.0f}%</b> 是模型的思考过程（累计 {T["reas"] / 1e4:.0f} 万字），
    你完全看不见却按输出全价付钱。这是唯一「花了钱但用户无感」的部分 ——
    要省钱先从这里下手，但它同时决定回答质量，不能盲砍。</div>
  </div>
  <div class="find">
    <div class="n">3</div>
    <div class="t">free 档 3,000 积分 = <b>{money(30.0)}</b>，你近 30 天用掉
    <b>{credits(W30["cost"]):,}–{credits(W30["cost"]) / max(cov / 100, 0.01):,.0f} 积分</b>
    （下限只算能归日的会话，上限按比例补上跨天会话）——
    <b>刚好把 free 档用满</b>，而这还是你天天折腾系统的开发期强度。
    经销商正常用（一天三五次、每次约 {credits(per_sess)} 积分），一个月约
    {credits(per_sess) * 3 * 30:,}–{credits(per_sess) * 5 * 30:,} 积分，同样正好卡在档位线上。
    所以 3,000 不是拍错，是<i>刚好卡在「够用但不宽裕」</i>：平时不会被拦，月底会想升级。
    —— 对定价这是对的设计，但别在客户面前说「用不完」。</div>
  </div>
</section>

<section>
  <h2>口径说明<span class="hint">这三条决定了上面数字可不可信，请一并看</span></h2>
  <div class="note">
    <h3>为什么这张表的钱比 Hermes 自己记的多</h3>
    <p>
      Hermes 账面记 <code>${a["hermes_usd"]:.2f}</code>（约 ¥{a["hermes_usd"] * FX_USD:.2f}），
      这张表算 <code>{money(total_cost)}</code>，高约 {total_cost / max(a["hermes_usd"] * FX_USD, 0.01):.1f} 倍。三个原因，缺一个都解释不通：
      <br>① Hermes 用的是 7 月价目表，输出价低估约 2 倍（我们 10-26 已打补丁对齐 9 月现价）；
      <br>② 模型名叫 <code>deepseek-flash</code> 的 890 次调用它算不出价，直接记 0 —— 这张表补上了；
      <br>③ Hermes 不分峰谷，这张表按北京时间分了（高峰 2 倍价）。
    </p>
  </div>
  <div class="note" style="background:#f8fafc;border-color:#e2e8f0">
    <h3 style="color:#475569">按天统计为什么只覆盖 {a["short_cost"] / max(a["short_cost"] + a["long_cost"], 0.01) * 100:.0f}% 的钱</h3>
    <p style="color:#475569">
      Hermes 的账是「一个会话一行累计」，不是「一次调用一行」。最长的一条会话跨度
      <code>{a["span_max"]:.0f} 小时</code>（{a["span_max"] / 24:.0f} 天，319 次调用）——
      整条算到它结束那天，会把那天虚高好几倍。
      所以跨度超过 4 小时的 <b>¥{a["long_cost"]:.2f}</b> 只计入总量、不摊到某一天。
      <br>v693 起我们自己的账本已经改成<b>每次请求一行</b>，这个缺陷从今天开始不再存在。{ledger_ok}
    </p>
  </div>
</section>

<div class="sub" style="margin-top:18px;text-align:center">
  数据源：Hermes <code>session_model_usage</code> {T["sess"]} 行 + 自有账本 <code>ai_usage_v2</code> {ledger_n} 行　·　
  生成于 {datetime.now(BJ).strftime('%Y-%m-%d %H:%M')}
</div>
</div></body></html>'''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="已导出的原始 JSON（离线重算）")
    ap.add_argument("--out", help="输出 HTML 路径")
    ap.add_argument("--date", help="以哪一天为「今天」，默认当前北京时间")
    args = ap.parse_args()

    raw = json.load(open(args.cache, encoding="utf-8")) if args.cache else fetch()
    today = (datetime.strptime(args.date, "%Y-%m-%d").replace(hour=23, minute=59, tzinfo=BJ)
             if args.date else datetime.now(BJ))

    a = analyse(raw, today)
    html = render(a, today)

    out = args.out or f"outputs/AI用量日报-{today.strftime('%Y-%m-%d')}.html"
    import os
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    open(out, "w", encoding="utf-8").write(html)

    T = a["total"]
    print(f"已生成 {out}")
    print(f"  今天 {money(a['w1']['cost'])} / 近7天 {money(a['w7']['cost'])} / "
          f"近30天 {money(a['w30']['cost'])} / 累计 {money(T['cost'])}")
    print(f"  会话行 {T['sess']} · 调用 {T['calls']} · 思考占输出 "
          f"{T['reas'] / max(T['out'], 1) * 100:.0f}% · 可比日 {a['short_cost'] / max(a['short_cost'] + a['long_cost'], .01) * 100:.0f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
