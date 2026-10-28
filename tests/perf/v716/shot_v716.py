#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v716 视觉确认：关掉引导/更新日志弹窗后，分别截「利润表(权责)」「资产负债表(权责)」。

后者是专门用来看**库存 −664 万**在界面上到底长什么样 —— 这是数据缺口的真实信号，
不是渲染 bug，但要确认它不会显示成乱码/截断/异常格式。
"""
import sys

TOKEN = sys.argv[1]
from playwright.sync_api import sync_playwright

BASE = "https://erp.hergent.cn"


def dismiss(page):
    """关掉引导弹窗与更新日志弹窗。"""
    for _ in range(4):
        done = page.evaluate("""() => {
          const cands=[...document.querySelectorAll('button,a,span,div')];
          const kw=['知道了','我知道了','下一步','跳过','关闭','✕','×'];
          let n=0;
          for(const e of cands){
            const t=(e.innerText||'').trim();
            if(kw.includes(t) && e.offsetParent!==null){
              try{e.click(); n++;}catch(_){}
            }
          }
          return n;
        }""")
        page.wait_for_timeout(700)
        if not done:
            break
    page.wait_for_timeout(500)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1680, "height": 1100})
    ctx.add_init_script("try{localStorage.setItem('hergent_token',%r)}catch(e){}" % TOKEN)
    ctx.add_cookies([{"name": "erp_token", "value": TOKEN, "url": BASE}])
    page = ctx.new_page()
    page.goto(BASE + "/#/reports", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(4000)
    dismiss(page)

    def click_tab(label):
        return page.evaluate(
            """(lb) => {
              const els=[...document.querySelectorAll('a,button,li,div,span')];
              const hit=els.find(e=>e.innerText && e.innerText.trim()===lb);
              if(hit){hit.click(); return true;} return false;
            }""",
            label,
        )

    # --- 利润表(权责) ---
    print("click 利润表(权责):", click_tab("利润表(权责)"), flush=True)
    page.wait_for_timeout(3000)
    dismiss(page)
    try:
        s = page.query_selector("#pnlGlMonth")
        if s:
            s.select_option("2026-09")
            page.wait_for_timeout(3000)
            print("month=2026-09", flush=True)
    except Exception as e:
        print("month select:", str(e)[:60], flush=True)
    page.screenshot(path="v716-pnl-clean.png", full_page=False)
    print("saved v716-pnl-clean.png", flush=True)

    # --- 资产负债表(权责) ---
    ok = click_tab("资产负债表(权责)")
    if not ok:
        ok = page.evaluate(
            """() => {
              const els=[...document.querySelectorAll('a,button,li,div,span')];
              const hit=els.find(e=>e.innerText && e.innerText.trim().startsWith('资产负债表'));
              if(hit){hit.click(); return true;} return false;
            }"""
        )
    print("click 资产负债表:", ok, flush=True)
    page.wait_for_timeout(3500)
    dismiss(page)
    page.screenshot(path="v716-bs-clean.png", full_page=False)
    print("saved v716-bs-clean.png", flush=True)

    txt = page.inner_text("body")
    for line in txt.splitlines():
        s2 = line.strip()
        if s2 and ("库存" in s2 or "资产总计" in s2 or "应收账款" in s2 or "负" in s2):
            print("  " + s2[:100], flush=True)

    ctx.close()
    b.close()
