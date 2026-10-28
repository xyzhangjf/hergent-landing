#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717 真机探针：确认费用在浏览器里**真的**走到净利，且营销页不再崩。

为什么必须真机（v697/v712 两次教训）：
  · 接口返回 sell_expense/admin_expense 只证明后端算了，不证明前端渲染；
  · 前端 chunk 是**就地改的**（/opt/static 无源码、无构建链）⇒ 必须确认没改坏语法
    （chunk 解析失败会整页空白，而不是报某个函数错）。

只看用户可见字面量，判据不带符号名。

用法：
    /usr/bin/python3 probe_v717_ui.py <token> <expected_eid>
"""
import re
import sys

TOKEN = sys.argv[1]
EID = sys.argv[2] if len(sys.argv) > 2 else ""

from playwright.sync_api import sync_playwright

BASE = "https://erp.hergent.cn"
MONTH = "2026-10"      # 当月无任何销售收入，只用来验「费用→净利」这半段
R = []


def ok(name, cond, extra=""):
    R.append((bool(cond), name, extra))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + str(extra)) if extra else ""),
          flush=True)


def click_text(page, text, exact=True):
    return page.evaluate(
        """([t, ex]) => {
          const els=[...document.querySelectorAll('a,button,li,div,span')];
          const hit=els.find(e=>e.innerText && (ex ? e.innerText.trim()===t
                                                   : e.innerText.includes(t)));
          if(hit){hit.click(); return true;} return false;
        }""", [text, exact])


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1680, "height": 1100})
    # /opt/static 的登录态是 localStorage.hergent_token（不是 cookie，也不认 hergent_auth）
    ctx.add_init_script("try{localStorage.setItem('hergent_token',%r)}catch(e){}" % TOKEN)
    ctx.add_cookies([{"name": "erp_token", "value": TOKEN, "url": BASE},
                     {"name": "hergent_auth", "value": "1", "url": BASE}])
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(4000)
    ok("登录态有效（未停在登录页）", "/login" not in page.url, "url=" + page.url[:60])
    # 首页必须有内容 —— chunk 被改坏时会整页空白
    body0 = page.inner_text("body")
    ok("首页有内容（chunk 未被改坏）", len(body0.strip()) > 200, "len=%d" % len(body0))

    # ---------------- 1. 营销 → 费用 tab（改前整页 500）----------------
    reached = False
    for path in ("#/marketing", "#/mkt", "#/expense"):
        page.goto(BASE + "/" + path, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2500)
        t = page.inner_text("body")
        if "费用" in t and ("预算" in t or "促销" in t):
            reached = True
            print("  营销页 reached via " + path, flush=True)
            break
    ok("能进入「营销」页", reached, "url=" + page.url[:60])
    mkt = page.inner_text("body")
    ok("营销页不是错误页", "Internal server error" not in mkt and "500" not in mkt[:400],
       mkt[:80].replace("\n", " "))
    ok("营销页出现「其他费用」以外的费用统计", ("费用" in mkt) or ("预算" in mkt))
    # 费用单是否列出来（改前 list 接口 500，一条也不会显示）
    ok("营销页能看到刚建的费用单", "1,000.00" in mkt or "1000.00" in mkt or "1,000" in mkt,
       "含金额字样=%s" % ("1,000.00" in mkt))

    # ---------------- 2. 报表 → 利润表(权责) ----------------
    nav = False
    for path in ("#/reports", "#/report", "#/financial-reports"):
        page.goto(BASE + "/" + path, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2500)
        if "利润表" in page.inner_text("body"):
            nav = True
            print("  报表页 reached via " + path, flush=True)
            break
    ok("能进入报表页", nav, "url=" + page.url[:60])

    # 入口按钮是 index.html 内联脚本注入的（v717c），依赖异步渲染 ⇒ 必须显式等，
    # 不能用固定 sleep（这正是 chunk 里 setTimeout 300ms 那段失效的原因）。
    injected = False
    try:
        page.wait_for_function("()=>!!document.getElementById('rptBtn_pnl-gl')", timeout=15000)
        injected = True
    except Exception as e:
        print("  等待入口按钮超时: " + str(e)[:80], flush=True)
    ok("「利润表(权责)」入口按钮出现在界面上", injected,
       "pnl-gl=%s bs-gl=%s" % (
           page.evaluate("()=>!!document.getElementById('rptBtn_pnl-gl')"),
           page.evaluate("()=>!!document.getElementById('rptBtn_bs-gl')")))

    if injected:
        page.evaluate("()=>document.getElementById('rptBtn_pnl-gl').click()")
    page.wait_for_timeout(1200)
    try:
        page.wait_for_function("()=>!!document.getElementById('pnlGlMonth')", timeout=12000)
    except Exception:
        pass
    try:
        sel = page.query_selector("#pnlGlMonth")
        if sel:
            sel.select_option(MONTH)
            page.wait_for_timeout(3000)
            print("  selected " + MONTH, flush=True)
        else:
            print("  #pnlGlMonth 未出现", flush=True)
    except Exception as e:
        print("  month select: " + str(e)[:80], flush=True)

    txt = page.inner_text("body")

    # 「费用明细」卡：必须是 4 段 + 合计共 5 行（改前只有 4 行，缺「其他费用」）
    card = page.evaluate("""() => {
      const els=[...document.querySelectorAll('div')];
      const t=els.find(e=>e.innerText && e.innerText.trim()==='费用明细');
      return t ? (t.parentElement ? t.parentElement.innerText : t.innerText) : '';
    }""")
    print("  费用明细卡文本: " + re.sub(r"\s+", " ", card)[:200], flush=True)
    ok("费用明细卡存在", bool(card))
    for label in ("销售费用", "管理费用", "财务费用", "其他费用", "费用合计"):
        ok("费用明细含「%s」" % label, label in card, "")

    # 数值判据：管理费用必须是 1,000
    ok("管理费用显示 1,000", bool(re.search(r"管理费用[\s\S]{0,20}1,?000\.00", card)), card[:120])
    ok("费用合计显示 1,000", bool(re.search(r"费用合计[\s\S]{0,20}1,?000\.00", card)), "")

    # 净利：当月无销售 ⇒ 净利 = -1,000（关键：证明「毛利 → 减费用 → 净利」真的算进去了）
    ok("页面出现净利润 -1,000", ("-1,000.00" in txt) or ("-1000.00" in txt),
       "净利字样=%s" % ("-1,000.00" in txt))
    ok("无 JS 运行时错误", len(errors) == 0, (";".join(errors[:2])[:140]) if errors else "")

    page.screenshot(path="v717-pnl.png", full_page=True)
    ctx.close()
    b.close()

fail = [x for x in R if not x[0]]
print("\n==== %d PASS / %d FAIL ====" % (len(R) - len(fail), len(fail)), flush=True)
for x in fail:
    print("  FAIL: " + x[1] + " | " + str(x[2])[:120], flush=True)
sys.exit(1 if fail else 0)
