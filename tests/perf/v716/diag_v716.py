#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v716 诊断：报表页到底长什么样、API 是否 401、利润表 tab 叫什么。"""
import sys

TOKEN = sys.argv[1]
from playwright.sync_api import sync_playwright

BASE = "https://erp.hergent.cn"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1680, "height": 1200})
    ctx.add_cookies([{"name": "erp_token", "value": TOKEN, "url": BASE}])

    api = []
    page = ctx.new_page()
    page.on("response", lambda r: api.append((r.status, r.url)) if "/api/" in r.url else None)
    page.on("pageerror", lambda e: print("JSERR:", str(e)[:100], flush=True))

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(4000)
    print("URL_after_root:", page.url, flush=True)
    print("COOKIES:", [(c["name"], c["value"][:12]) for c in ctx.cookies()], flush=True)
    print("DOC_COOKIE:", page.evaluate("document.cookie")[:200], flush=True)
    print("LS_KEYS:", page.evaluate("Object.keys(localStorage)")[:20], flush=True)

    page.goto(BASE + "/#/reports", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(4000)
    print("\nURL_reports:", page.url, flush=True)

    tabs = page.evaluate("""() => {
      const out=[];
      document.querySelectorAll('a,button,[role=tab],.tab,.nav-tab,li').forEach(e=>{
        const t=(e.innerText||'').trim();
        if(t && t.length<20) out.push(t);
      });
      return [...new Set(out)];
    }""")
    print("TABS:", tabs[:40], flush=True)

    print("\nAPI calls:", flush=True)
    for s, u in api:
        if any(k in u for k in ("report", "pnl", "balance", "kpi")):
            print("  %s %s" % (s, u[:120]), flush=True)
    bad = [(s, u) for s, u in api if s >= 400]
    print("非 2xx 共 %d 个" % len(bad), flush=True)
    for s, u in bad[:8]:
        print("  %s %s" % (s, u[:120]), flush=True)

    page.screenshot(path="v716-diag.png", full_page=True)
    print("\nTEXT_HEAD:", page.inner_text("body")[:600], flush=True)
    ctx.close()
    b.close()
