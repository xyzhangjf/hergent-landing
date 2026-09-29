# -*- coding: utf-8 -*-
"""v313c：生产 tenant_1 —— 建商品「简爱0蔗糖原味高蛋白希腊酸奶…135mL*2杯*12组」（条码 6970618573316）。

**为什么是建档而不是加别名**（这是本轮的关键判断，写在这里以防后人重犯）：

  舟谱侧  条码 6970618573316 · 名称「简爱0蔗糖原味高蛋白希腊酸奶风味发酵乳135mL*2杯*12组」· 单位「杯」
  系统侧  条码 6970618573330 · 名称「简爱PROTÑ 0蔗糖原味高蛋白希腊酸奶135mLx2杯x12组」      · 单位「件」

  两条**条码差一位**（3316 vs 3330）、**单位也不同**（杯 vs 件）。
  ⇒ 名字像 ≠ 同一商品。相似度 0.83 是**假信号**：若按相似度绑别名，
    这两个不同条码的商品会被并成一条，采购金额会记到错误的档案上。

  「别名的正确用法」= 同一个东西的不同叫法（如「卞和店」是「卞河店」的错别字，
  由用户人工确认）。条码不同 ⇒ 只能建档，不能绑。

用法（在服务器上）：
    /usr/bin/python3 v313c-prod-product.py           # dry-run（默认）
    /usr/bin/python3 v313c-prod-product.py --apply   # 真写

纪律（hergent-authorized-prod-data-write）：
  · 默认 dry-run、`--apply` 才写；先整库备份并断言非空；
  · 建档走真实 HTTP 接口（留痕 / 校验 / updated_at 免费）；
  · 临时令牌用完即删并断言残留 = 0；
  · 换算比**不填**（技能 §五：换算比只能来自权威来源，绝不自己编）。
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request

BASE = "/opt/hergent-erp"
TENANT_DB = os.path.join(BASE, "tenant_1.db")
MASTER_DB = os.path.join(BASE, "erp.db")
API = "http://127.0.0.1:8700"
TOKEN_USER_ID = 2          # boss（张俊峰本人）
TENANT_ID = 1

APPLY = "--apply" in sys.argv

# 逐字取自舟谱「20260801-20260831采购单明细.xlsx」的那一行（不照抄系统档案的写法）
PRODUCTS = [
    {
        "name": "简爱0蔗糖原味高蛋白希腊酸奶风味发酵乳135mL*2杯*12组",
        "unit": "杯",                 # 舟谱「单位名称」列逐字
        "spec": "135mL*2杯*12组",
        "barcode": "6970618573316",   # 舟谱「条形码」列；系统里不存在此条码 ⇒ 不撞 UNIQUE
        "source": "zhoupu_import",
    },
]
EXPECT_UNIT = "杯"
EXPECT_BARCODE = "6970618573316"

FAILS = []


def ck(label, cond, extra=""):
    if not cond:
        FAILS.append(label)
    print("   %s %s%s" % ("PASS" if cond else "FAIL", label,
                          ("  " + str(extra)) if extra else ""))
    return cond


def http(method, path, payload=None, token=None):
    """真实 HTTP。**禁代理**（回环也会被本地代理劫持 —— 技能 §6.1）。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
        req.add_header("X-Tenant-Id", str(TENANT_ID))
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, str(e)


def main():
    print("=" * 78)
    print("v313c 建档商品（简爱 3316）   模式 = %s"
          % ("真写 --apply" if APPLY else "dry-run（不写）"))
    print("=" * 78)

    # ── 0) 前置断言：条码确实不存在（否则就是该走别名而不是建档）─────────────
    print()
    print("[0] 前置断言")
    r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    for p in PRODUCTS:
        dup = r.execute("SELECT id,name FROM products WHERE barcode=?",
                        (p["barcode"],)).fetchall()
        ck("条码 %s 在系统里不存在（故须建档）" % p["barcode"], not dup,
           "已存在=%r" % (dup,))
        same = r.execute("SELECT id,name FROM products WHERE name=?",
                         (p["name"],)).fetchall()
        ck("同名档案不存在（不重复建档）", not same, "已存在=%r" % (same,))
    # 守住「别把 3330 那条改了」的边界
    guard = r.execute("SELECT id,name,unit,barcode FROM products WHERE id=1606").fetchone()
    ck("id=1606（3330 那条）原样未被改", bool(guard) and guard[3] == "6970618573330",
       "实际=%r" % (guard,))
    r.close()

    # ── 1) 备份 ────────────────────────────────────────────────────────────
    print()
    print("[1] 备份")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    bk = os.path.join(BASE, "backups",
                      "tenant_1.db.before-v313c-product-%s.bak" % stamp)
    if APPLY:
        os.makedirs(os.path.dirname(bk), exist_ok=True)
        src = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        dst = sqlite3.connect(bk)
        src.backup(dst)
        dst.close()
        src.close()
        ck("备份已生成且非空", os.path.getsize(bk) > 100000,
           "%s (%.1f MB)" % (bk, os.path.getsize(bk) / 1048576.0))
        ck("备份里 products 行数 > 0",
           sqlite3.connect(bk).execute("SELECT COUNT(*) FROM products").fetchone()[0] > 0)
    else:
        print("   （dry-run 跳过备份；真跑时会生成 %s）" % bk)

    # ── 2) 建档：走真实 API ────────────────────────────────────────────────
    print()
    print("[2] 建档（走真实 HTTP API）")
    tok = None
    if APPLY:
        m = sqlite3.connect(MASTER_DB)
        m.execute("PRAGMA busy_timeout=8000")
        tok = "v313cwrite-%d" % int(time.time())
        m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,"
                  "ip_address,user_agent_hash,last_activity) VALUES "
                  "(?,?,datetime('now','localtime'),datetime('now','localtime','+1 hour'),"
                  "'127.0.0.1','',datetime('now','localtime'))", (tok, TOKEN_USER_ID))
        m.commit()
        m.close()
        st, _b = http("GET", "/api/products?limit=1", token=tok)
        ck("临时令牌可用（GET /api/products）", st == 200, "HTTP %d" % st)
    else:
        print("   （dry-run 跳过；真跑时会建 %d 个商品）" % len(PRODUCTS))

    try:
        if APPLY:
            for p in PRODUCTS:
                st, body = http("POST", "/api/products", p, token=tok)
                ok = st == 200 and json.loads(body).get("success")
                ck("建档商品「%s」" % p["name"], ok, "HTTP %d %s" % (st, body[:120]))
    finally:
        if tok:
            m = sqlite3.connect(MASTER_DB)
            m.execute("PRAGMA busy_timeout=8000")
            m.execute("DELETE FROM sessions WHERE token=?", (tok,))
            m.commit()
            left = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?",
                             (tok,)).fetchone()[0]
            m.close()
            ck("临时令牌残留 = 0", left == 0, "残留 %d" % left)

    # ── 3) 验证 ────────────────────────────────────────────────────────────
    print()
    print("[3] 数据库层验证")
    if APPLY:
        r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        for p in PRODUCTS:
            v = r.execute("SELECT id,unit,barcode FROM products WHERE name=? "
                          "AND COALESCE(is_active,1)=1", (p["name"],)).fetchone()
            ck("商品「%s」已建档" % p["name"][:24], bool(v), "id/unit/bc=%r" % (v,))
            if v:
                ck("  单位 == %r" % EXPECT_UNIT, v[1] == EXPECT_UNIT,
                   "实际=%r" % v[1])
                ck("  条码 == %s" % EXPECT_BARCODE, v[2] == EXPECT_BARCODE,
                   "实际=%r" % v[2])
        # 边界：1606 仍未被动过
        g = r.execute("SELECT id,unit,barcode FROM products WHERE id=1606").fetchone()
        ck("id=1606 依旧原样（unit=件 / bc=3330）",
           bool(g) and g[1] == "件" and g[2] == "6970618573330", "实际=%r" % (g,))
        r.close()

    print()
    print("=" * 78)
    if FAILS:
        print("结果：%d 项失败" % len(FAILS))
        for f in FAILS:
            print("   - " + f)
        sys.exit(1)
    print("结果：全部通过" + ("（已真写）" if APPLY else "（dry-run，未写任何数据）"))


if __name__ == "__main__":
    main()
