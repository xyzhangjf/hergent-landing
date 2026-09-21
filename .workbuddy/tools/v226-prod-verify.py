#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226 上线后真机验收（**只读**，打生产 https://hergent.cn）。

验收判据（对应本轮「厂价 → 进价 术语统一」）：
  A. 产物回读（第⑥层判别串计数）：**先取线上 index.html → 解析当前 index chunk →
     再取 Forecast chunk**（不能硬编 chunk 名 —— 产物文件名会被后续轮次重建替换），
     断言「厂价」只出现 1 次（= 白名单里那句给老模版用户的别名提示），「进价」≥ 20 次。
  B. `GET /api/import/template/products`：列里**只有一个**「进价」，且**没有**「厂价」。
  C. `GET /api/forecast/factory-price-gate`：note 含「进价」、不含「厂价」。
  D. `GET /api/import/factory-price-template`：导出的 xlsx 表头末列 = 「进价（请填写）」，无「厂价」。
  E. `GET /api/products`：`factory_price` 字段仍在（v223 白名单放行不回归）。
  F. 全程零 5xx。
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = "https://hergent.cn"
USER = os.environ.get("HG_USER", "mptestsp")
PASS = os.environ.get("HG_PASS", "Mpsup@1")

# 本机有本地代理（HTTP(S)_PROXY）⇒ 一律走直连，避免代理干扰
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

RESULTS = []


def assert_(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)))
    print("  %s %s%s" % ("✅" if ok else "❌", name, ("  — " + str(detail)) if detail else ""))


def req(path, token=None, raw=False):
    url = path if path.startswith("http") else BASE + path
    r = urllib.request.Request(url)
    r.add_header("User-Agent", "hergent-v226-verify/1.0")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    with OPENER.open(r, timeout=30) as resp:
        body = resp.read()
        return resp.status, (body if raw else body.decode("utf-8", "replace"))


def main():
    print("=== A. 线上产物回读（判别串计数）===")
    st, html = req("/index.html")
    m = re.search(r'assets/(index-[A-Za-z0-9_-]{8}\.js)', html)
    assert_("index.html 可解析出 index chunk", bool(m), m.group(1) if m else html[:80])
    if not m:
        return 1
    st, idx = req("/assets/" + m.group(1))
    fm = re.search(r'Forecast-([A-Za-z0-9_-]{8})\.js', idx)
    assert_("index chunk 里解析出 Forecast chunk", bool(fm), fm.group(0) if fm else "未命中")
    if not fm:
        return 1
    st, fc = req("/assets/Forecast-%s.js" % fm.group(1))
    n_old, n_new = fc.count("厂价"), fc.count("进价")
    assert_("线上 Forecast chunk「厂价」= 1（仅白名单别名提示）", n_old == 1, "实测 %d" % n_old)
    assert_("线上 Forecast chunk「进价」≥ 20", n_new >= 20, "实测 %d" % n_new)
    i = fc.find("厂价")
    if i >= 0:
        print("     白名单上下文：…%s…" % fc[max(0, i - 30):i + 20].replace("\n", " "))

    print("\n=== 登录 ===")
    data = json.dumps({"username": USER, "password": PASS}).encode()
    r = urllib.request.Request(BASE + "/api/auth/login", data=data,
                               headers={"Content-Type": "application/json"})
    with OPENER.open(r, timeout=30) as resp:
        lg = json.loads(resp.read().decode("utf-8", "replace"))
    token = lg.get("token")
    assert_("登录成功", bool(token), USER)

    if token:
        print("\n=== B. 导入模版列（products）===")
        st, body = req("/api/import/template/products", token)
        assert_("template/products 200", st == 200, st)
        try:
            cols = json.loads(body).get("columns", [])
        except Exception as e:
            cols = []
            assert_("template/products 可解析 JSON", False, e)
        assert_("列里只有一个「进价」", sum(1 for c in cols if "进价" in c) == 1,
                "cols=%s" % cols)
        assert_("列里没有「厂价」", not any("厂价" in c for c in cols), "cols=%s" % cols)

        print("\n=== C. 进价闸门口径文案 ===")
        st, body = req("/api/forecast/factory-price-gate", token)
        assert_("factory-price-gate 200", st == 200, st)
        try:
            note = json.loads(body).get("note", "")
        except Exception:
            note = body
        assert_("note 含「进价」", "进价" in note, note[:80])
        assert_("note 不含「厂价」", "厂价" not in note, note[:80])

        print("\n=== D. 待补清单 xlsx 表头 ===")
        st, blob = req("/api/import/factory-price-template", token, raw=True)
        assert_("factory-price-template 200", st == 200, "%d B" % len(blob))
        tmp = "/tmp/v226-fp-template.xlsx"
        with io.open(tmp, "wb") as f:
            f.write(blob)
        try:
            import openpyxl
            # 🔴 舟谱类导出必须用**常规模式**读（read_only 会因 dimension 异常只回 1 行）
            wb = openpyxl.load_workbook(tmp)
            ws = wb[wb.sheetnames[0]]
            hdr = [c.value for c in ws[1]]
            assert_("xlsx 表头含「进价（请填写）」", any("进价" in str(h) for h in hdr if h), hdr)
            assert_("xlsx 表头无「厂价」", not any("厂价" in str(h) for h in hdr if h), hdr)
            print("     数据行数 = %d" % (ws.max_row - 1))
        except Exception as e:
            assert_("xlsx 可读", False, e)

        print("\n=== E. 商品接口 factory_price 不回归 ===")
        st, body = req("/api/products?limit=5", token)
        assert_("products 200", st == 200, st)
        try:
            items = json.loads(body).get("items", [])
        except Exception:
            items = []
        assert_("products 返回非空", len(items) > 0, "n=%d" % len(items))
        if items:
            assert_("首行带 factory_price 字段", "factory_price" in items[0],
                    sorted(items[0].keys())[:14])

    print("\n=== F. 零 5xx 校验 ===")
    codes = [("/api/health", req("/api/health")[0])]
    if token:
        codes.append(("/api/import/template/products",
                      req("/api/import/template/products", token)[0]))
    assert_("关键端点无 5xx", all(s < 500 for _, s in codes), codes)

    bad = [r for r in RESULTS if not r[1]]
    print("\n==== 汇总：%d 项断言，%d 项失败 ====" % (len(RESULTS), len(bad)))
    for n, _, d in bad:
        print("  ❌ %s  %s" % (n, d))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
