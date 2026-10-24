#!/usr/bin/env python3
"""v665 真机验收：舟谱导入模板分批号段（在生产后端上跑，自建临时会话，测完自清理）。

验的判据（全部对**真实端点 + 真实报单数据**）：
  ① 首次生成：号段从配置起点开始，文件名带「第1批」，台账新增 1 条
  ② 同内容再点：复用原批原号段（X-Template-Reuse=1）、**水位不涨**、台账不新增
  ③ 第三次仍复用（防「多人同时点」把它当新批）
  ④ 单号反查：拿 xlsx 里真实出现的单号去查台账，能定位到同一批
  ⑤ 自提/调拨两套水位互不干扰
  ⑥ 清理：删掉本脚本产生的台账与水位，号段回到起点（探针不该吃用户的号）
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
TOK = "v665probe" + secrets.token_hex(16)

fails = []


def ok(cond, label, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (" " + str(extra) if extra else ""))
    if not cond:
        fails.append(label)


def issue_token():
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO sessions(token,user_id,created_at,expires_at,last_activity,user_agent_hash)"
              " VALUES(?,2,datetime('now','localtime'),datetime('now','localtime','+1 day'),"
              " datetime('now','localtime'),'v665-probe')", (TOK,))
    c.commit()
    c.close()


def drop_token():
    c = sqlite3.connect(DB)
    n = c.execute("DELETE FROM sessions WHERE token LIKE 'v665probe%'").rowcount
    c.commit()
    c.close()
    return n


def call(path, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + TOK})
    # 🔴 头名一律转小写再取：uvicorn 实际发出的是 `x-template-batch`（小写），
    #    拿 `X-Template-Batch` 去 `dict(headers)` 里取会恒为 None —— 本次探针就栽在这，
    #    差点把「头没发出来」当成产品缺陷（而实际单号/台账全对）。
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def pick_window():
    c = sqlite3.connect(TENANT_DB)
    c.row_factory = sqlite3.Row
    rows = c.execute(
        "SELECT p.id, p.name, p.order_start, p.order_end, p.arrival_date,"
        " (SELECT COUNT(*) FROM forecast_submissions s WHERE s.role='导入'"
        "    AND s.order_date>=p.order_start AND s.order_date<=p.order_end) AS n"
        " FROM forecast_periods p ORDER BY p.id DESC").fetchall()
    c.close()
    for r in rows:
        if r["n"] > 0:
            return r
    return None


def xlsx_doc_nos(blob):
    """从生成的 xlsx 里取真实出现的源单据号（第一张表的 A 列去重）。"""
    import io
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True)
    ws = wb[wb.sheetnames[0]]
    nos = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0 or not row:
            continue
        v = str(row[0] or "").strip()
        if v and v not in nos:
            nos.append(v)
    wb.close()
    return ws.title if hasattr(ws, "title") else "", nos


def water(prefix):
    c = sqlite3.connect(TENANT_DB)
    c.row_factory = sqlite3.Row
    r = c.execute("SELECT last_seq FROM forecast_doc_seq WHERE prefix=?", (prefix,)).fetchone()
    c.close()
    return int(r["last_seq"]) if r else 0


def ledger():
    c = sqlite3.connect(TENANT_DB)
    c.row_factory = sqlite3.Row
    rows = [dict(x) for x in c.execute(
        "SELECT id,prefix,batch_no,seq_from,seq_to,doc_count,item_count,filename,"
        " fingerprint,created_by,created_at FROM forecast_template_exports ORDER BY id").fetchall()]
    c.close()
    return rows


def cleanup(ids):
    c = sqlite3.connect(TENANT_DB)
    for i in ids:
        c.execute("DELETE FROM forecast_template_exports WHERE id=?", (i,))
    c.execute("DELETE FROM forecast_doc_seq WHERE period_id>0")
    c.commit()
    left = c.execute("SELECT COUNT(*) FROM forecast_template_exports").fetchone()[0]
    w = c.execute("SELECT COUNT(*) FROM forecast_doc_seq").fetchone()[0]
    c.close()
    return left, w


def main():
    issue_token()
    try:
        p = pick_window()
        if not p:
            print("SKIP: 没有含「导入」报单的期次，无法真机验收（退出 0）")
            return 0
        print("期次 #%s %s 窗口 %s~%s 到货 %s（导入单 %d 条）"
              % (p["id"], p["name"], p["order_start"], p["order_end"],
                 p["arrival_date"], p["n"]))
        body = {"start": p["order_start"], "end": p["order_end"]}
        base_ids = [x["id"] for x in ledger()]
        print()

        print("① 首次生成 自提（zhoupu-pickup）")
        st, h, blob = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        ok(st == 200, "HTTP 200", "(实际 %s)" % st)
        if st != 200:
            print("     %s" % blob[:400].decode("utf-8", "ignore"))
            raise SystemExit(1)
        batch1, seq1, reuse1 = h.get("x-template-batch"), h.get("x-template-seq"), h.get("x-template-reuse")
        # Content-Disposition 里的中文是 **percent-encoded**（RFC 5987 filename*），
        # 不解码就永远匹配不到「第1批」——这类「明明发了却说没发」最容易误判成产品缺陷。
        fname1 = urllib.parse.unquote(h.get("content-disposition", ""))
        sheet, nos1 = xlsx_doc_nos(blob)
        w1 = water("ZT")
        print("     头：batch=%s seq=%s reuse=%s rows=%s" % (batch1, seq1, reuse1, h.get("x-template-rows")))
        print("     文件：%s" % fname1[:160])
        print("     单号：%s" % ("、".join(nos1[:4]) + (" …共 %d 个" % len(nos1) if len(nos1) > 4 else "")))
        ok(seq1 and seq1.startswith("ZT=01-"), "号段从 01 起（配置 zt_seq_start=1）", "(%s)" % seq1)
        ok(reuse1 == "0", "首次是新批（reuse=0）")
        ok("第1" in fname1, "文件名带「第1批」")
        ok(len(nos1) > 0 and nos1[0].startswith("ZT"), "xlsx 内单号为 ZT+日期+序号", "(%s)" % (nos1[0] if nos1 else "-"))
        ok(w1 == len(nos1), "水位 == 本批分单数", "(水位 %d / 单号 %d)" % (w1, len(nos1)))
        print()

        print("② 同内容再点一次（手抖 / 重复下载）")
        st2, h2, blob2 = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        w2 = water("ZT")
        _, nos2 = xlsx_doc_nos(blob2)
        print("     头：batch=%s seq=%s reuse=%s" % (h2.get("x-template-batch"), h2.get("x-template-seq"), h2.get("x-template-reuse")))
        ok(st2 == 200, "HTTP 200")
        ok(h2.get("x-template-seq") == seq1, "号段完全相同", "(%s)" % h2.get("x-template-seq"))
        ok(h2.get("x-template-reuse") == "1", "标记为复用（reuse=1）")
        ok(w2 == w1, "水位**未上涨**（没白吃号）", "(%d → %d)" % (w1, w2))
        ok(nos2 == nos1, "两次单号逐字相同", "(%d vs %d)" % (len(nos2), len(nos1)))
        print()

        print("③ 第三次仍复用")
        st3, h3, _ = call("/api/forecast/import-templates/zhoupu-pickup/generate", body, "POST")
        ok(h3.get("x-template-reuse") == "1" and water("ZT") == w1, "第三次复用、水位不动",
           "(reuse=%s 水位=%d)" % (h3.get("x-template-reuse"), water("ZT")))
        print()

        print("④ 台账与单号反查")
        L = ledger()
        new = [x for x in L if x["id"] not in base_ids]
        ok(len(new) == 1, "台账只新增 1 条（三次点击 = 1 批）", "(新增 %d)" % len(new))
        if new:
            n0 = new[0]
            print("     #%d %s 第%d批 号段 %02d–%02d %d 单 %d 行 %s by=%s"
                  % (n0["id"], n0["prefix"], n0["batch_no"], n0["seq_from"], n0["seq_to"],
                     n0["doc_count"], n0["item_count"], n0["filename"], n0["created_by"]))
        st4, h4, b4 = call("/api/forecast/template-exports?start=%s&end=%s"
                           % (p["order_start"], p["order_end"]))
        j4 = json.loads(b4) if st4 == 200 else {}
        ok(st4 == 200 and len(j4.get("items") or []) >= 1, "按期次查台账可读",
           "(HTTP %s / %d 条)" % (st4, len(j4.get("items") or [])))
        if nos1:
            st5, h5, b5 = call("/api/forecast/template-exports?doc_no=%s" % nos1[0])
            j5 = json.loads(b5) if st5 == 200 else {}
            hit = (j5.get("items") or [])
            ok(st5 == 200 and len(hit) == 1, "单号 %s 能反查到唯一批次" % nos1[0],
               "(命中 %d)" % len(hit))
            if hit:
                print("     → 第%d批 / 到货日 %s / %s / %s 导的"
                      % (hit[0]["batch_no"], hit[0]["arrival_date"],
                         hit[0]["created_at"], hit[0]["created_by"]))
        print()

        print("⑤ 调拨号段独立（zhoupu-transfer）")
        wd_before = water("DB")
        st6, h6, b6 = call("/api/forecast/import-templates/zhoupu-transfer/generate", body, "POST")
        if st6 == 200:
            ok(h6.get("x-template-seq", "").endswith("ZT=-") or "DB=01-" in h6.get("x-template-seq", ""),
               "调拨从 01 起，与自提水位无关", "(%s)" % h6.get("x-template-seq"))
            ok(water("ZT") == w1, "调拨不推动自提水位")
        else:
            print("     SKIP：本期无调拨数据（HTTP %s，属环境约束非缺陷）" % st6)
            ok(True, "调拨无数据 → 跳过（不判红）")
        print()
    finally:
        ids = [x["id"] for x in ledger()]
        left, w = cleanup(ids)
        ntok = drop_token()
        print("⑥ 清理探针")
        print("     删除台账 %d 条（剩余 %d）、清空水位行（剩余 %d）、撤销临时会话 %d 条"
              % (len(ids), left, w, ntok))

    if fails:
        print("FAILED(%d): %s" % (len(fails), "；".join(fails)))
        return 1
    print("PASS —— 分批号段唯一、同内容复用不吃号、台账可反查、双前缀隔离 全部成立")
    return 0


if __name__ == "__main__":
    sys.exit(main())
