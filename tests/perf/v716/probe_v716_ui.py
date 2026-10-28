#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v716 真机探针：确认利润表在浏览器里**真的**显示出了成本与毛利。

为什么要真机：接口返回 cogs/gross_profit 只证明后端算对了，不证明前端把它们
渲染出来（v697 教训：24 项界面断言全过，老板线上却看不到入口）。
本探针只看**用户可见字面量**：页面文本里能不能找到具体金额。

用法：
    /usr/bin/python3 probe_v716_ui.py <token>
token 由 v716_mksess.py --create 生成，用完 --delete 删除。
"""
import re
import sys

TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
if not TOKEN:
    sys.exit("需要 token 参数")

from playwright.sync_api import sync_playwright

BASE = "https://erp.hergent.cn"
# 期望出现在页面上的数字（9 月 + 合计），多种格式都认
EXPECT = {
    "2026-09 收入": ["1,128,410.37", "1128410.37", "112.84"],
    "2026-09 成本": ["977,564.39", "977564.39", "97.76"],
    "2026-09 毛利": ["150,845.98", "150845.98", "15.08"],
    "合计收入": ["8,786,105.85", "8786105.85", "878.61"],
    "毛利率": ["11.39"],
}

R = []


def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + extra) if extra else ""), flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1680, "height": 1000})
    # 🔴 `/opt/static` 的登录态是 **localStorage.hergent_token**（不是 cookie、也不认 hergent_auth
    #    —— 后者是 /opt/hergent-cn-v2 的机制，在 /opt/static 里根本不存在）。
    #    cookie 仍要注：接口鉴权走 erp_token cookie。
    ctx.add_init_script("try{localStorage.setItem('hergent_token',%r)}catch(e){}" % TOKEN)
    # 🔴 只给 url，不能再给 path（v7xx 踩过）
    ctx.add_cookies([
        {"name": "erp_token", "value": TOKEN, "url": BASE},
        {"name": "hergent_auth", "value": "1", "url": BASE},
    ])
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(4000)
    ok("登录态有效（未停在登录页）", "#/login" not in page.url, "url=" + page.url[:70])

    # 找「报表」入口：先试 hash 直达，失败再点菜单
    nav_ok = False
    for path in ("#/reports", "#/report", "#/financial-reports"):
        page.goto(BASE + "/" + path, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        txt = page.inner_text("body")
        if any(k in txt for k in ("利润表", "资产负债表", "报表")):
            nav_ok = True
            print("  reached via " + path, flush=True)
            break
    if not nav_ok:
        # 回落：点侧栏含「报表」的项
        for sel in ['text=报表', 'text=财务报表', 'text=经营报表']:
            try:
                page.click(sel, timeout=5000)
                page.wait_for_timeout(3000)
                nav_ok = True
                print("  reached via click " + sel, flush=True)
                break
            except Exception:
                continue
    ok("能进入报表页", nav_ok, "url=" + page.url[:70])

    # 切到「利润表(权责)」—— GL 口径那张（v714/v715 修的就是它）。
    # 不能用 text= 选择器：页面上同时有「利润表 (P&L)」「利润表(权责)」「利润分析」，
    # 括号还会被当正则。直接在 DOM 里按 innerText 全等点。
    clicked = page.evaluate("""() => {
      const els=[...document.querySelectorAll('a,button,li,div,span')];
      const hit=els.find(e=>e.innerText && e.innerText.trim()==='利润表(权责)');
      if(hit){hit.click(); return true;}
      const alt=els.find(e=>e.innerText && /^利润表\\s*\\(权责\\)$/.test(e.innerText.trim()));
      if(alt){alt.click(); return true;}
      return false;
    }""")
    print("  click 利润表(权责): %s" % clicked, flush=True)
    page.wait_for_timeout(3500)

    # 选 2026-09（v715 修的下拉）
    try:
        sel = page.query_selector("#pnlGlMonth")
        if sel:
            sel.select_option("2026-09")
            page.wait_for_timeout(3000)
            print("  selected 2026-09", flush=True)
    except Exception as e:
        print("  month select: " + str(e)[:80], flush=True)

    txt = page.inner_text("body")
    page.screenshot(path="v716-pnl.png", full_page=True)

    # 判据：金额字面量
    found = 0
    for label, alts in EXPECT.items():
        hit = [a for a in alts if a in txt]
        ok("页面出现 " + label, bool(hit), ("命中 " + hit[0]) if hit else "未找到")
        found += 1 if hit else 0

    # 反向判据：不应该还是「全 0」或空态
    zero_like = txt.count("¥0.00")
    ok("不是空态（大量 ¥0.00 说明没渲染）", zero_like < 8, "¥0.00 出现 %d 次" % zero_like)
    ok("无 JS 运行时错误", len(errors) == 0, (";".join(errors[:2])[:120]) if errors else "")

    print("\n==== 页面文本片段（含金额的行）====", flush=True)
    n = 0
    for line in txt.splitlines():
        if re.search(r"\d{3},\d{3}|\d+\.\d{2}\s*%|毛利|成本|收入|利润", line):
            s = line.strip()
            if s:
                print("  " + s[:110], flush=True)
                n += 1
                if n >= 25:
                    break
    print("\nscreenshot: v716-pnl.png", flush=True)
    ctx.close()
    b.close()

fail = [x for x in R if not x[0]]
print("\n==== %d PASS / %d FAIL ====" % (len(R) - len(fail), len(fail)), flush=True)
sys.exit(1 if fail else 0)
