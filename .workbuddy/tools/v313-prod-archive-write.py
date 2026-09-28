# -*- coding: utf-8 -*-
"""v313：生产 tenant_1 的**授权**档案写入 —— 别名 + 员工建档 + 促销品建档。

用户 2026-09-28 的三条拍板（逐条对应）：
  ① 「卞和店 vs 卞河店是一家店；蒙牛酸奶那两家是两个签约主体（福宝 / 恒滋）」
       ⇒ 不能靠模糊归一化，只能**逐条显式别名**。
  ② 「促销品不建档案」→ 后经核实「蒙牛玻璃杯大号」是 ¥5,376 的真实采购且独占一张单，
      用户改口「就建这一个商品档案」。
  ③ 「员工要建」+「李琴是独立的另一个人」⇒ 建谢雯 / 仲嫚嫚 / 李琴。

用法（在服务器上）：
    /usr/bin/python3 v313-prod-archive-write.py           # dry-run（默认）
    /usr/bin/python3 v313-prod-archive-write.py --apply   # 真写

纪律（来自 hergent-authorized-prod-data-write）：
  · 默认 dry-run、`--apply` 才写；
  · 先整库备份，断言备份非空；
  · 一切 UPDATE 按主键 id=? 定位 + rowcount==1 断言；
  · **建档走真实 HTTP 接口**（留痕、校验、updated_at 全是免费的），只有 DDL 才直连库；
  · 临时令牌用完即删，并断言残留 = 0。
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

# ── ① 别名（type, id, 档案名, 别名）──────────────────────────────────────────
ALIASES = [
    ("supplier", 2912, "蒙牛酸奶-恒滋", "蒙牛酸奶（湖北恒滋）"),
    ("customer", 2221, "美联（卞河店）", "美联（卞和店）"),
]

# ── ② 员工建档（contacts.type='employee'）—— 导入侧经办人匹配用的就是这一套 ──
EMPLOYEES = ["谢雯", "仲嫚嫚", "李琴"]

# ── ③ 商品建档 ─────────────────────────────────────────────────────────────
PRODUCTS = [
    # unit 必须逐字取自舟谱侧「单位名称」列（'个'），否则匹配时的单位校验过不去。
    # 不填换算比：技能 §五硬约束「换算比只能来自权威来源，绝不自己编」
    #   （备注「80箱玻璃杯」虽暗示 1 箱 = 48 个，但不进 large_ratio）。
    {"name": "蒙牛玻璃杯大号", "unit": "个", "spec": "", "barcode": ""},
]

FAILS = []


def ck(label, cond, extra=""):
    if not cond:
        FAILS.append(label)
    print("   %s %s%s" % ("PASS" if cond else "FAIL", label,
                          ("  " + str(extra)) if extra else ""))
    return cond


def http(method, path, payload=None, token=None):
    """真实 HTTP。**禁代理**（否则回环也被本地代理劫持 —— 技能 §6.1）。"""
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
    print("v313 生产档案写入   模式 = %s" % ("真写 --apply" if APPLY else "dry-run（不写）"))
    print("=" * 78)

    # ── 0) 备份 ────────────────────────────────────────────────────────────
    print()
    print("[0] 备份")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    bk = os.path.join(BASE, "backups", "tenant_1.db.before-v313-archive-%s.bak" % stamp)
    if APPLY:
        os.makedirs(os.path.dirname(bk), exist_ok=True)
        src = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        dst = sqlite3.connect(bk)
        src.backup(dst)
        dst.close()
        src.close()
        ck("备份已生成且非空", os.path.getsize(bk) > 100000, "%s (%.1f MB)"
           % (bk, os.path.getsize(bk) / 1048576.0))
        ck("备份里 contacts 行数 > 0",
           sqlite3.connect(bk).execute("SELECT COUNT(*) FROM contacts").fetchone()[0] > 0)
    else:
        print("   （dry-run 跳过备份；真跑时会生成 %s）" % bk)

    # ── 1) DDL：alias 列（唯一必须直连库的一步）───────────────────────────────
    print()
    print("[1] DDL：contacts.alias")
    c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    has = any(x[1] == "alias" for x in c.execute("PRAGMA table_info(contacts)"))
    c.close()
    print("   当前是否已有 alias 列: %s" % has)
    if APPLY and not has:
        w = sqlite3.connect(TENANT_DB)
        w.execute("PRAGMA busy_timeout=8000")
        w.execute("ALTER TABLE contacts ADD COLUMN alias TEXT DEFAULT ''")
        w.commit()
        w.close()
        c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        has2 = any(x[1] == "alias" for x in c.execute("PRAGMA table_info(contacts)"))
        c.close()
        ck("ALTER 后 alias 列存在", has2)
    elif APPLY:
        ck("alias 列已存在（幂等跳过）", True)

    # ── 2) 写别名（按主键，rowcount==1）────────────────────────────────────
    print()
    print("[2] 写档案别名")
    r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    # ⚠️ dry-run 时列还没加 ⇒ 不能写死 `COALESCE(alias,'')`（会 no such column）。
    #    与 zhoupu_documents.RefIndex 同一条纪律：先探测列，再决定 SELECT 形态。
    sel = ("SELECT id,name,type,COALESCE(alias,'') FROM contacts WHERE id=?" if has
           else "SELECT id,name,type,'' FROM contacts WHERE id=?")
    for ty, cid, nm, al in ALIASES:
        row = r.execute(sel, (cid,)).fetchone()
        ok = row and row[2] == ty and row[1] == nm
        ck("目标档案 id=%d 是 %s「%s」" % (cid, ty, nm), bool(ok),
           ("实际=%r" % (row,)) if not ok else "")
        if APPLY and ok:
            w = sqlite3.connect(TENANT_DB)
            w.execute("PRAGMA busy_timeout=8000")
            w.execute("BEGIN IMMEDIATE")
            cur = w.execute("UPDATE contacts SET alias=? WHERE id=?", (al, cid))
            n = cur.rowcount
            # 技能 §5.1：直改库不会自动维护 updated_at，业务函数会 ⇒ 抄它。
            w.execute("UPDATE contacts SET updated_at=datetime('now','localtime') "
                      "WHERE id=?", (cid,))
            w.commit()
            w.close()
            ck("  别名已写入（rowcount==1）", n == 1, "rowcount=%d" % n)
    r.close()

    # ── 3) 建档：走真实 API ────────────────────────────────────────────────
    print()
    print("[3] 建档（走真实 HTTP API）")
    tok = None
    if APPLY:
        m = sqlite3.connect(MASTER_DB)
        m.execute("PRAGMA busy_timeout=8000")
        tok = "v313write-%d" % int(time.time())
        m.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,"
                  "ip_address,user_agent_hash,last_activity) VALUES "
                  "(?,?,datetime('now','localtime'),datetime('now','localtime','+1 hour'),"
                  "'127.0.0.1','',datetime('now','localtime'))", (tok, TOKEN_USER_ID))
        m.commit()
        m.close()
        st, _b = http("GET", "/api/contacts?limit=1&type=employee", token=tok)
        ck("临时令牌可用（GET /api/contacts）", st == 200, "HTTP %d" % st)
    else:
        print("   （dry-run 跳过；真跑时会建 %d 个员工 + %d 个商品，走 POST /api/contacts "
              "与 POST /api/products）" % (len(EMPLOYEES), len(PRODUCTS)))

    try:
        if APPLY:
            for nm in EMPLOYEES:
                st, body = http("POST", "/api/contacts",
                                {"name": nm, "type": "employee", "source": "zhoupu_import"},
                                token=tok)
                ok = st == 200 and json.loads(body).get("success")
                ck("建档员工「%s」" % nm, ok, "HTTP %d %s" % (st, body[:80]))
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
            left = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (tok,)).fetchone()[0]
            m.close()
            ck("临时令牌残留 = 0", left == 0, "残留 %d" % left)

    # ── 4) 验证 ────────────────────────────────────────────────────────────
    print()
    print("[4] 数据库层验证")
    if APPLY:
        r = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
        for ty, cid, nm, al in ALIASES:
            v = r.execute("SELECT COALESCE(alias,'') FROM contacts WHERE id=?", (cid,)).fetchone()
            ck("id=%d alias == %r" % (cid, al), v and v[0] == al, "实际=%r" % (v[0] if v else None))
        for nm in EMPLOYEES:
            v = r.execute("SELECT id FROM contacts WHERE name=? AND type='employee' "
                          "AND COALESCE(is_active,1)=1", (nm,)).fetchone()
            ck("员工「%s」已建档且启用" % nm, bool(v), "id=%s" % (v[0] if v else None))
        for p in PRODUCTS:
            v = r.execute("SELECT id,unit FROM products WHERE name=? "
                          "AND COALESCE(is_active,1)=1", (p["name"],)).fetchone()
            ck("商品「%s」已建档" % p["name"], bool(v), "id/unit=%r" % (v,))
            if v:
                ck("  单位逐字取自舟谱（'个'）", v[1] == "个", "实际 unit=%r" % v[1])
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
