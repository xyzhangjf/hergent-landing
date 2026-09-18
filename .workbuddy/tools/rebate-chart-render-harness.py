#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用**生产真实数据 + 真实组件**验证返利图表几何（有目标就该有柱子 / 灰轨道配色）。

为什么需要它：图表类改动的"对不对"是视觉问题，靠读代码说不清，靠看生产又没法造
出需要的数据形状。本工具在**本地**渲染真实组件，数据与返利金额全部来自生产——
数据只读导出，返利金额由**已部署的后端函数**算（前端不镜像算法）。

流程（三步，都由本工具串起来）：
  1. `dump`   只读拉取某租户的 rebate_target_rules / rebate_achievements，
              并用生产 `domain.rebate_calc.compute_rule_rebate` 按
              `buildSimItems` 的**同一顺序**产出目标档试算结果 → 写成
              `hergent-cn-v2/v186-data.json`
  2. `gen`    在 `hergent-cn-v2/` 生成 v186-harness.html / v186-harness.js
              （临时文件，见第 3 步清理）
  3. `probe`  起 `vite --port 5199` 后，用无头 Chromium 客观测量：
              每个系列 `rect.track` 的**根数 / 计算色 / 高度**，并截图到 /tmp/v186-shot/

用法：
  python3 .workbuddy/tools/rebate-chart-render-harness.py dump --tenant 1
  python3 .workbuddy/tools/rebate-chart-render-harness.py gen
  (cd hergent-cn-v2 && npx vite --port 5199 --strictPort &)
  python3 .workbuddy/tools/rebate-chart-render-harness.py probe
  python3 .workbuddy/tools/rebate-chart-render-harness.py clean

⚠️ 租户库一律 `mode=ro` 只读打开；本工具不写生产任何数据。
⚠️ `clean` 必须执行 —— 生成的三份文件**不能**留在仓库里（含租户数据）。
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # .workbuddy/tools
PROJ = os.path.dirname(os.path.dirname(HERE))              # laozhangai-product
FE = os.path.join(PROJ, "hergent-cn-v2")
DATA = os.path.join(FE, "v186-data.json")
HTML = os.path.join(FE, "v186-harness.html")
JS = os.path.join(FE, "v186-harness.js")
SSH_HOST = "root@47.113.224.140"
PORT = 5199

DUMP_PY = r'''
import calendar, json, os, sqlite3, sys
os.chdir("/opt/hergent-erp"); sys.path.insert(0, "/opt/hergent-erp")
from domain.rebate_calc import compute_rule_rebate
from domain.rebate_period import parse_monthly, rule_covers_month
YEAR = int(sys.argv[1]); TID = sys.argv[2]
DB = "/opt/hergent-erp/tenant_%s.db" % TID
def load(sql):
    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True); con.row_factory = sqlite3.Row
    try: return [dict(r) for r in con.execute(sql)]
    finally: con.close()
rules = load("SELECT * FROM rebate_target_rules WHERE is_active=1 ORDER BY id")
ach = load("SELECT period_month, dimension, scope_key, actual_amount, actual_qty,"
           " actual_rebate FROM rebate_achievements")
def month_target(rule, m):
    if rule.get("period_type") == "year":
        return float(parse_monthly(rule.get("monthly_amounts")).get("%02d" % m) or 0)
    es = str(rule.get("effective_start") or "")
    sm = int(es[5:7]) if len(es) >= 7 else None
    if sm and sm != m: return 0
    return float(rule.get("target_value") or 0)
# 与 buildYearMatrix 的 measure/kept 同口径（本工具只演示 amount 口径的租户）
kept = [r for r in rules if r["dimension"] == "brand" and (r.get("target_type") or "amount") != "quantity"]
# api 返回的 monthly_* 是对象（前端按月表对象用）；这里对齐成对象
for r in rules:
    for k in ("monthly_amounts", "monthly_rates"):
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            try: r[k] = json.loads(v)
            except Exception: r[k] = {}
        elif not v: r[k] = {}
keys, results = [], []
for m in range(1, 13):
    ref = "%04d-%02d-%02d" % (YEAR, m, calendar.monthrange(YEAR, m)[1])
    for r in kept:
        if not rule_covers_month(r, YEAR, m): continue
        t = month_target(r, m)
        if not (t > 0): continue
        res = compute_rule_rebate(r, t, 0.0, ref_date=ref)
        keys.append("r%s:m%02d:target" % (r["id"], m))
        results.append({"ok": True, "rule_id": r["id"], "basis_value": t, "ref_date": ref,
                        "target_value": res["target_value"], "rebate": res["rebate"],
                        "triggered": res["triggered"], "achievement_pct": res["achievement_pct"]})
print(json.dumps({"year": YEAR, "keys": keys, "results": results,
                  "achievements": ach, "rules": rules}, ensure_ascii=False))
'''

HARNESS_JS = r'''/** 返利图表渲染台（**临时文件，验证完毕即删** —— 见 rebate-chart-render-harness.py clean）
 * 数据来自生产租户（只读），返利金额来自已部署后端，本文件不含任何业务算法。 */
import { createApp, h } from 'vue'
import MonthlyAchvChart from './src/components/rebate/MonthlyAchvChart.vue'
import { buildYearMatrix, buildSimItems, applySimResults, ruleCoversMonth, monthTargetOf } from './src/components/rebate/useMonthlyAchv.js'
import DATA from './v186-data.json'

const YEAR = String(DATA.year)
const matrix = buildYearMatrix({ year: YEAR, rules: DATA.rules, achievements: DATA.achievements, brandSel: [] })
const { keys } = buildSimItems(matrix)
const same = keys.length === DATA.keys.length && keys.every((k, i) => k === DATA.keys[i])
const el = document.getElementById('align')
el.className = same ? 'ok' : 'bad'
el.textContent = same
  ? `✅ 试算键序一致：前端 ${keys.length} 项 == 后端 ${DATA.keys.length} 项`
  : `❌ 键序不一致\n前端(${keys.length})：${keys.join(',')}\n后端(${DATA.keys.length})：${DATA.keys.join(',')}`
applySimResults(matrix, DATA.results, keys)

const coverCount = matrix.months.filter(mo =>
  (DATA.rules || []).some(r => ruleCoversMonth(r, Number(YEAR), mo.m)
    && monthTargetOf(r, Number(YEAR), mo.m) > 0)).length

createApp({ render: () => h(MonthlyAchvChart, { model: matrix, year: YEAR, yearOptions: [DATA.year, Number(YEAR) + 1, Number(YEAR) - 1] }) }).mount('#app')

const f = v => (Number(v) ? Number(v).toLocaleString('en-US') : '0')
const rows = matrix.months.map(mo => `<tr><td class="l">${mo.m} 月</td>
  <td>${mo.salesTarget > 0 ? '✓' : '—'}</td><td>${f(mo.salesTarget)}</td><td>${f(mo.salesAchv)}</td>
  <td>${mo.rebateTarget > 0 ? '✓' : '—'}</td><td>${f(mo.rebateTarget)}</td><td>${f(mo.actualRebate)}</td></tr>`).join('')
document.getElementById('tbl').innerHTML = `<div style="margin-top:14px;font-size:13px">
  <b>有目标的月份数 = ${coverCount} / 12</b>　合计目标 ¥${f(matrix.totals.salesTarget)}　
  合计达成 ¥${f(matrix.totals.salesAchv)}　应返合计 ¥${f(matrix.totals.rebateTarget)}　
  实际返利合计 ¥${f(matrix.totals.actualRebate)}</div>
  <table><thead><tr><th class="l">月份</th><th>有销量目标</th><th>销量目标</th><th>销量达成</th>
  <th>有返利目标</th><th>应返(灰轨道)</th><th>实际返利(填充)</th></tr></thead><tbody>${rows}</tbody></table>`
window.__v186 = { coverCount, matrix, keysMatched: same }
'''

HARNESS_HTML = r'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>返利图表渲染台（临时）</title><style>
body{margin:0;padding:18px 22px;background:#f6f8fb;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#0f172a}
#align{font-size:13px;margin:0 0 10px;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap}
.ok{color:#15803d}.bad{color:#b91c1c;font-weight:700}
.wrap{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;max-width:1180px}
table{border-collapse:collapse;margin-top:12px;font-size:12.5px}
th,td{border:1px solid #e2e8f0;padding:3px 7px;text-align:right}th{background:#f1f5f9}
td.l{text-align:left}</style></head><body>
<div id="align">对齐校验中…</div><div class="wrap"><div id="app"></div></div><div id="tbl"></div>
<script type="module" src="/v186-harness.js"></script></body></html>
'''

PROBE_JS = r'''/* 图表渲染台客观测量：数「有几根可见柱子」与计算色，不靠肉眼。产物 /tmp/v186-shot/ */
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core')
const OUT = '/tmp/v186-shot'; fs.mkdirSync(OUT, { recursive: true })
const PORT = process.env.HG_PORT || 'PORT_X'
const CHROME = process.env.AGENT_BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 2 })
  const errs = []; page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  await page.goto(`http://127.0.0.1:${PORT}/v186-harness.html`, { waitUntil: 'networkidle0', timeout: 30000 })
  await page.waitForFunction('window.__v186 && window.__v186.matrix', { timeout: 15000 })
  const data = await page.evaluate(() => {
    const out = { coverCount: window.__v186.coverCount, keysMatched: window.__v186.keysMatched,
                  alignText: document.getElementById('align').textContent.trim(), sections: [] }
    document.querySelectorAll('.mac-sec').forEach(sec => {
      const title = (sec.querySelector('.sec-hd b') || {}).textContent || '?'
      const tracks = [...sec.querySelectorAll('rect.track')].map(r => ({
        h: +r.getAttribute('height'), fill: getComputedStyle(r).fill }))
      const fills = [...sec.querySelectorAll('rect')].filter(r => !r.classList.contains('track')
        && r.getAttribute('fill') && !/transparent/.test(r.getAttribute('fill') || '')).map(r => getComputedStyle(r).fill)
      out.sections.push({ title: title.trim(), trackCount: tracks.length,
        tracksVisible: tracks.filter(t => t.h >= 1.5).length,
        trackFills: [...new Set(tracks.map(t => t.fill))],
        trackHeights: tracks.map(t => +t.h.toFixed(1)),
        fillCount: fills.length, fillColors: [...new Set(fills)] })
    })
    out.summary = (document.querySelector('#tbl div') || {}).textContent || ''
    out.tableText = (document.querySelector('#tbl table') || {}).innerText || ''
    return out
  })
  await page.screenshot({ path: path.join(OUT, 'full.png'), fullPage: true })
  const wrap = await page.$('.wrap'); if (wrap) await wrap.screenshot({ path: path.join(OUT, 'chart.png') })
  const tbl = await page.$('#tbl table'); if (tbl) await tbl.screenshot({ path: path.join(OUT, 'table.png') })
  data.jsErrors = errs
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(data, null, 1))
  console.log(JSON.stringify(data, null, 1)); await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
'''


def cmd_dump(a):
    code = DUMP_PY
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=20", SSH_HOST,
                        "python3 - %d %s" % (a.year, a.tenant)],
                       input=code, capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        print("dump 失败：", r.stderr[-800:]); return 1
    with open(DATA, "w", encoding="utf-8") as f:
        f.write(r.stdout)
    d = json.loads(r.stdout)
    print("✅ 已写 %s（规则 %d 条 / 达成 %d 行 / 试算 %d 项 / %d 年）"
          % (DATA, len(d["rules"]), len(d["achievements"]), len(d["keys"]), d["year"]))
    print("   试算键序：", ", ".join(d["keys"])[:300])
    return 0


def cmd_gen(a):
    for p, c in ((HTML, HARNESS_HTML), (JS, HARNESS_JS)):
        open(p, "w", encoding="utf-8").write(c)
    open("/tmp/v186-harness-probe.js", "w", encoding="utf-8").write(PROBE_JS.replace("PORT_X", str(PORT)))
    print("✅ 已生成 %s / %s（临时，验证后务必 clean）" % (HTML, JS))
    print("   探针：/tmp/v186-harness-probe.js")
    return 0


def cmd_probe(a):
    env = dict(os.environ)
    env["HG_PROXY"] = ""
    env["NODE_PATH"] = "/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules"
    node = os.path.expanduser(
        "~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node")
    r = subprocess.run([node, "/tmp/v186-harness-probe.js"], cwd="/tmp", env=env,
                       capture_output=True, text=True)
    print(r.stdout or r.stderr[-1500:])
    return r.returncode


def cmd_clean(a):
    for p in (DATA, HTML, JS):
        if os.path.exists(p):
            os.remove(p); print("已删", p)
    return 0


ap = argparse.ArgumentParser(description=__doc__,
                             formatter_class=argparse.RawDescriptionHelpFormatter)
sub = ap.add_subparsers(dest="cmd", required=True)
d = sub.add_parser("dump"); d.add_argument("--tenant", required=True); d.add_argument("--year", type=int, default=2026); d.set_defaults(fn=cmd_dump)
sub.add_parser("gen").set_defaults(fn=cmd_gen)
sub.add_parser("probe").set_defaults(fn=cmd_probe)
sub.add_parser("clean").set_defaults(fn=cmd_clean)
_args = ap.parse_args()
sys.exit(_args.fn(_args))
