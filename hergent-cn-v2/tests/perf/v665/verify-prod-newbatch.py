#!/usr/bin/env python3
"""v665 真机验收（补充）：**内容变了必须开新批**，内容复原又回到原批。

为什么单列一条：上面那条验收只能证明「同内容不吃号」；而用户真实的场景恰恰是
「各品牌到货不同 ⇒ 分批 ⇒ 内容不同」，如果这条不成立，整套唯一性就是空转。

手法：临时把一条报单配置 `is_active` 置 0（少一个报单对象 ⇒ 本批内容必然不同），
生成一次，**立刻恢复**，再生成一次 —— 内容复原后必须回到第 1 批原号段（这也是
「指纹真的按内容走」的正面证据）。改的是 1 行配置的开关，脚本 finally 里强制恢复。
"""
import json
import secrets
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8700"
DB = "/opt/hergent-erp/erp.db"
TENANT_DB = "/opt/hergent-erp/tenant_1.db"
TOK = "v665probe2" + secrets.token_hex(16)
VICTIM = 17          # 「东津」活跃的那条（id=3 是它的停用旧档）

fails = []


def ok(cond, label, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (" " + str(extra) if extra else ""))
    if not cond:
        fails.append(label)


def call(path, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + TOK})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def tdb():
    c = sqlite3.connect(TENANT_DB)
    c.row_factory = sqlite3.Row
    return c


def set_active(a):
    c = tdb()
    c.execute("UPDATE report_mapping SET is_active=? WHERE id=?", (a, VICTIM))
    c.commit()
    v = c.execute("SELECT is_active FROM report_mapping WHERE id=?", (VICTIM,)).fetchone()[0]
    c.close()
    return v


def ledger():
    c = tdb()
    rows = [dict(x) for x in c.execute(
        "SELECT id,prefix,batch_no,seq_from,seq_to,doc_count,filename FROM forecast_template_exports"
        " ORDER BY id")]
    c.close()
    return rows


def water():
    c = tdb()
    r = c.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix='ZT'").fetchone()
    c.close()
    return int(r["last_seq"]) if r else 0


def cleanup():
    c = tdb()
    c.execute("DELETE FROM forecast_template_exports WHERE period_id>0")
    c.execute("DELETE FROM forecast_doc_seq WHERE period_id>0")
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM forecast_template_exports").fetchone()[0]
    w = c.execute("SELECT COUNT(*) FROM forecast_doc_seq").fetchone()[0]
    c.close()
    return left, w


def issue_token():
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,last_activity,user_agent_hash)"
              " VALUES(?,2,datetime('now','localtime'),datetime('now','localtime','+1 day'),"
              " datetime('now','localtime'),'v665-probe2')", (TOK,))
    c.commit()
    c.close()


def main():
    issue_token()
    c = tdb()
    p = c.execute(
        "SELECT id,name,order_start,order_end,arrival_date FROM forecast_periods"
        " ORDER BY id DESC LIMIT 1").fetchone()
    c.close()
    body = {"start": p["order_start"], "end": p["order_end"]}
    # 🔴 记录**原始值**再恢复，绝不硬设 1：这条配置在生产的真实状态是用户的资产，
    #    脚本只能改它再复原，不能"顺便"把一条停用配置变成启用。
    c = tdb()
    orig_active = c.execute("SELECT is_active FROM report_mapping WHERE id=?",
                            (VICTIM,)).fetchone()
    c.close()
    orig_active = int(orig_active[0]) if orig_active else -1
    if orig_active != 1:
        print("SKIP: 报单配置 #%d 当前 is_active=%s（不是活跃态），不拿它做实验（退出 0）"
              % (VICTIM, orig_active))
        return 0
    print("期次 #%s %s 窗口 %s~%s（临时停用报单配置 #%d，finally 必恢复原值 %d）"
          % (p["id"], p["name"], p["order_start"], p["order_end"], VICTIM, orig_active))
    print()
    try:
        print("① 基线：完整内容生成")
        st, h, _ = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        ok(st == 200, "HTTP 200")
        base_seq, base_batch = h.get("x-template-seq"), h.get("x-template-batch")
        print("     batch=%s seq=%s rows=%s" % (base_batch, base_seq, h.get("x-template-rows")))
        ok(base_seq == "ZT=01-02;DB=-", "基线号段 01–02", "(%s)" % base_seq)
        w0 = water()

        print("② 内容变化：停用报单配置 #%d 后再生成" % VICTIM)
        set_active(0)
        st2, h2, _ = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        changed_seq, changed_batch = h2.get("x-template-seq"), h2.get("x-template-batch")
        print("     batch=%s seq=%s rows=%s reuse=%s"
              % (changed_batch, changed_seq, h2.get("x-template-rows"), h2.get("x-template-reuse")))
        ok(st2 == 200, "HTTP 200（少一个对象仍能出模板）")
        ok(h2.get("x-template-reuse") == "0", "内容变了 ⇒ 新批（不是复用）")
        ok(changed_seq == "ZT=03-03;DB=-", "新批接在上一批之后（03），不复用 01–02",
           "(%s)" % changed_seq)
        ok(changed_batch == "ZT=2;DB=0", "批次号 = 2", "(%s)" % changed_batch)
        ok(water() == w0 + 1, "水位只涨 1（本批 1 单）", "(%d → %d)" % (w0, water()))

        print("③ 恢复配置 #%d（内容复原）后再生成" % VICTIM)
        back = set_active(1)
        ok(back == 1, "配置已恢复为活跃")
        st3, h3, _ = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        print("     batch=%s seq=%s reuse=%s"
              % (h3.get("x-template-batch"), h3.get("x-template-seq"), h3.get("x-template-reuse")))
        ok(h3.get("x-template-seq") == base_seq, "内容复原 ⇒ 回到第 1 批原号段（指纹真的按内容走）",
           "(%s)" % h3.get("x-template-seq"))
        ok(h3.get("x-template-reuse") == "1", "标记复用")
        ok(water() == w0 + 1, "水位不再上涨", "(水位 %d)" % water())

        print("④ 台账")
        L = ledger()
        for x in L:
            print("     #%d %s 第%d批 %02d–%02d %d 单 %s"
                  % (x["id"], x["prefix"], x["batch_no"], x["seq_from"], x["seq_to"],
                     x["doc_count"], x["filename"]))
        ok(len(L) == 2, "台账 2 条（完整内容 1 条 + 变化内容 1 条）", "(实际 %d)" % len(L))
        if len(L) == 2:
            a = set(range(L[0]["seq_from"], L[0]["seq_to"] + 1))
            b = set(range(L[1]["seq_from"], L[1]["seq_to"] + 1))
            ok(not (a & b), "两条号段无交集", "(%s vs %s)" % (sorted(a), sorted(b)))
            ok(L[1]["seq_to"] > L[0]["seq_to"], "后一批号段更大（单调递增）")
    finally:
        # 🔴 无论如何都要恢复成**原值**
        set_active(orig_active)
        c = tdb()
        v = c.execute("SELECT is_active FROM report_mapping WHERE id=?", (VICTIM,)).fetchone()
        c.close()
        v = int(v[0]) if v else -1
        left, w = cleanup()
        c2 = sqlite3.connect(DB)
        n = c2.execute("DELETE FROM sessions WHERE token LIKE 'v665probe2%'").rowcount
        c2.commit()
        c2.close()
        print()
        print("⑤ 清理")
        print("     报单配置 #%d 已恢复 is_active=%d（原值 %d，一致=%s）；"
              "台账剩余 %d、水位剩余 %d、临时会话撤销 %d"
              % (VICTIM, v, orig_active, v == orig_active, left, w, n))

    if fails:
        print("FAILED(%d): %s" % (len(fails), "；".join(fails)))
        return 1
    print("PASS —— 内容变化必开新批、内容复原回到原批、号段单调且无交集")
    return 0


if __name__ == "__main__":
    sys.exit(main())
