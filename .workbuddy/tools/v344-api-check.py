#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v344 线上 API 级复核（只调用 /api/import/preview + /api/auth/demo-login）。

只读声明：`/api/import/preview` 只解析文件、不落业务数据（后端 `_READ_ONLY_POST` 把它
纠偏为 read），**不写任何业务表**；本脚本不做 execute、不建任何记录。

用法： python3 v344-api-check.py before|after

判据（写死，不靠"看起来对"）：
  T1（带前置标题行 + 尾部合计行，模拟舟谱库存导出）
      before ⇒ headers 第 1 格是「库存查询表」（**这就是那个静默错位**）、无 header_row 字段
      after  ⇒ header_row == 3、headers 逐字等于真实表头、note 非空、预览内合计行 ≥1
  T2（裸模板，表头第 1 行）—— 回归底线，before/after 都必须逐字一致
"""
import json
import sys
import urllib.request

BASE = "https://hergent.cn"
STAGE = (sys.argv[1] if len(sys.argv) > 1 else "after").lower()
for _i, _a in enumerate(sys.argv):
    if _a == "--api-base":
        BASE = sys.argv[_i + 1]

HDR = ["商品名称", "规格", "单位", "数量", "成本价", "批次号", "到期日"]
FILES = [("T1", "/tmp/v344-t1-inventory-preamble.xlsx", "带前置标题行+合计行"),
         ("T2", "/tmp/v344-t2-inventory-plain.xlsx", "裸模板（回归对照）")]


def multipart(fields, files):
    b = "----v344probe"
    out = b""
    for k, v in fields.items():
        out += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                % (b, k, v)).encode()
    for k, fn, data in files:
        out += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n" % (b, k, fn)).encode()
        out += data + b"\r\n"
    out += ("--%s--\r\n" % b).encode()
    return out, "multipart/form-data; boundary=%s" % b


def post(path, token=None, fields=None, files=None):
    data, ct = multipart(fields or {}, files or [])
    req = urllib.request.Request(BASE + path, data=data, method="POST")
    req.add_header("Content-Type", ct)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, "EXC %s: %s" % (type(e).__name__, e)


print("=" * 78)
print("v344 线上 API 复核 · 阶段 = %s · %s" % (STAGE, BASE))
print("=" * 78)

st, body = post("/api/auth/demo-login")
tok = ""
if st == 200:
    try:
        _j = json.loads(body)
        tok = _j.get("token") or _j.get("access_token") or ""
    except Exception:
        pass
print("① demo-login  HTTP=%s  token=%s" % (st, "已取得（%d 字符）" % len(tok) if tok else "**未取得**"))
if not tok:
    print("   ⚠️ 取不到会话 ⇒ 复核无法进行，**不得当作通过**。响应片段：%s" % body[:200])
    sys.exit(1)

results = {}
for tag, path, desc in FILES:
    with open(path, "rb") as fh:
        filedata = fh.read()
    st, body = post("/api/import/preview", token=tok,
                    fields={"category": "inventory"},
                    files=[("file", path.split("/")[-1], filedata)])
    try:
        d = json.loads(body)
    except Exception:
        print("\n%s %s  HTTP=%s  **非 JSON 响应**：%s" % (tag, desc, st, body[:200]))
        results[tag] = None
        continue
    v = d.get("validation") or {}
    results[tag] = {
        "http": st, "headers": d.get("headers"),
        "has_field": "header_row" in d, "header_row": d.get("header_row"),
        "note": d.get("header_row_note") or v.get("header_row_note"),
        "sum": v.get("summary_rows_in_preview"),
        "det": v.get("header_row_detected"),
    }
    print("\n%s %s  HTTP=%s" % (tag, desc, st))
    print("   headers            = %s" % (results[tag]["headers"],))
    print("   有 header_row 字段   = %s" % results[tag]["has_field"])
    print("   header_row         = %s" % results[tag]["header_row"])
    print("   header_row_note    = %s" % results[tag]["note"])
    print("   预览内合计行数       = %s" % results[tag]["sum"])

print("\n" + "=" * 78)
print("判据核对（阶段 = %s）" % STAGE)
print("=" * 78)
checks = []


def chk(name, cond, detail):
    checks.append((name, bool(cond), detail))
    print("  %-56s %-8s %s" % (name, "OK" if cond else "**FAIL**", detail))


t1, t2 = results.get("T1"), results.get("T2")
if not t1 or not t2:
    chk("两个用例都有 JSON 响应", False, "T1=%s T2=%s" % (bool(t1), bool(t2)))
else:
    if STAGE == "after":
        chk("T1 headers 逐字 == 真实表头", t1["headers"] == HDR, "实测=%s" % (t1["headers"],))
        chk("T1 header_row == 3", t1["header_row"] == 3, "实测=%s" % t1["header_row"])
        chk("T1 有 header_row_note", bool(t1["note"]), "实测=%r" % (t1["note"],))
        chk("T1 预览内识别到合计行(≥1)", (t1["sum"] or 0) >= 1, "实测=%s" % t1["sum"])
    else:
        chk("（改造前）T1 headers 第1格 是「库存查询表」= bug 复现",
            (t1["headers"] or [""])[0] == "库存查询表",
            "实测=%r" % ((t1["headers"] or [""])[0],))
        chk("（改造前）无 header_row 字段", not t1["has_field"], "实测=%s" % t1["has_field"])
    chk("T2（回归底线）headers 逐字 == 模板表头", t2["headers"] == HDR,
        "实测=%s" % (t2["headers"],))

bad = [c for c in checks if not c[1]]
print("\n小结：%d / %d 通过" % (len(checks) - len(bad), len(checks)))
if bad:
    print("未通过项：" + " / ".join(c[0] for c in bad))
sys.exit(1 if bad else 0)
