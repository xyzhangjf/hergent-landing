#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v346 生产真机接口探针（hergent.cn，**只读**）。

要证的命题：v346 的两件事在**生产**上真的生效 ——
  ① `/api/import/preview` 会对危险列回 `validation.risky_columns / risky_detail` + 一条告警；
  ② 记忆命中时 `remembered.direct_ok / block_reason` 的三种取值（放行 / 危险列拦 / 改账目类目拦）。

手法：真账号登录拿 token → 真 `POST /api/import/preview`（该端点只 `_auth`，不落库）
     → **读正文**（不是只看 200）。带一条**反例对照**（干净模板必须 risky_columns=0），
     否则"命中"可能只是这个探针恒真。

🔴 只读纪律：唯一写动作 = 探针自己发的 `POST /api/auth/login`；结束补 `logout`。
   `/api/import/preview` 是只读端点（不写库、不建表），全程无第二个写请求。
🔴 登录只试 **1 次**：生产有「15 分钟内 5 次失败即锁定 30 分钟」的限流，不能拿它当轮询用。
"""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("HG_BASE", "https://hergent.cn")
USER = os.environ.get("HG_USER", "mptest")
PASS = os.environ.get("HG_PASS", "Mptest@1")

checks = []


def chk(name, cond, detail=""):
    checks.append((name, bool(cond), detail))
    print("  %-58s %-8s %s" % (name, "OK" if cond else "**FAIL**", detail))


def _req(path, data=None, headers=None, method=None):
    url = BASE + path
    h = dict(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, "EXC:%s" % e


def multipart(path, token, category, filename, content):
    """裸发 multipart（不引第三方库）。"""
    bd = "----v346probe" + str(os.getpid())
    parts = []
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"category\"\r\n\r\n%s\r\n" % (bd, category)).encode())
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
                  "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
                  % (bd, filename)).encode())
    parts.append(content)
    parts.append(("\r\n--%s--\r\n" % bd).encode())
    body = b"".join(parts)
    req = urllib.request.Request(BASE + path, data=body, method="POST", headers={
        "Content-Type": "multipart/form-data; boundary=" + bd,
        "Authorization": "Bearer " + token,
        "X-Tenant-Id": "1",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, "EXC:%s" % e


def xlsx(rows):
    import io
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


print("=" * 78)
print("① 登录（只试 1 次）")
print("=" * 78)
st, txt = _req("/api/auth/login", {"username": USER, "password": PASS})
print("  HTTP=%s 正文前 160 字=%s" % (st, txt[:160]))
token = ""
if st == 200:
    try:
        token = (json.loads(txt).get("token") or json.loads(txt).get("access_token") or "")
    except Exception:
        pass
chk("L1 登录成功且拿到 token", st == 200 and bool(token), "HTTP=%s token=%s" % (st, bool(token)))
if not token:
    print("\n⚠️ 拿不到 token，后面的接口探针无法进行（不重试，避免触发登录锁定限流）。")
    sys.exit(2)

DANGER = [["商品名称", "金额", "到期日"],
          ["探针用商品", "1000", "2026-10-31"]]
CLEAN = [["商品名称", "规格", "单位", "数量", "成本价"],
         ["探针用商品", "1*10", "件", "10", "9.5"]]
DANGER_INV = [["门店名称", "数量", "批次"],
              ["探针用门店", "10", "P20260901"]]

print("\n" + "=" * 78)
print("② 应收表带「商品名称」列 ⇒ 必须报 1 列危险（真机读正文）")
print("=" * 78)
st, txt = multipart("/api/import/preview", token, "receivables", "v346-probe-danger.xlsx", xlsx(DANGER))
print("  HTTP=%s" % st)
d = {}
try:
    d = json.loads(txt)
except Exception:
    print("  正文前 300 字=%s" % txt[:300])
v = (d or {}).get("validation") or {}
det = v.get("risky_detail") or []
print("  risky_columns=%s" % v.get("risky_columns"))
for x in det:
    print("     · %s → %s (%s)：%s" % (x.get("header"), x.get("field"), x.get("risk"), x.get("reason")))
print("  warnings=%s" % (v.get("warnings") or []))
print("  remembered=%s" % (d.get("remembered"),))
chk("P1 HTTP=200 且 risky_columns == 1", st == 200 and v.get("risky_columns") == 1,
    "HTTP=%s risky=%s" % (st, v.get("risky_columns")))
chk("P2 点名「商品名称」且 risk=generic",
    bool(det) and det[0].get("header") == "商品名称" and det[0].get("risk") == "generic",
    "实测=%s" % det)
chk("P3 命中字段是 contact_name（客户名）",
    bool(det) and det[0].get("field") == "contact_name",
    "实测=%s" % (det[0].get("field") if det else None))
chk("P4 有「识别不确定」告警",
    any("识别不确定" in str(w) for w in (v.get("warnings") or [])),
    "warnings=%s" % (v.get("warnings") or []))

print("\n" + "=" * 78)
print("③ 【反例对照】干净库存模板 ⇒ risky_columns 必须 == 0")
print("=" * 78)
st, txt = multipart("/api/import/preview", token, "inventory", "v346-probe-clean.xlsx", xlsx(CLEAN))
d2 = json.loads(txt) if st == 200 else {}
v2 = (d2 or {}).get("validation") or {}
print("  HTTP=%s risky_columns=%s risky_detail=%s" % (st, v2.get("risky_columns"), v2.get("risky_detail")))
chk("P5 干净模板 risky_columns == 0（⇒ P1 不是恒真）",
    st == 200 and v2.get("risky_columns") == 0,
    "HTTP=%s risky=%s" % (st, v2.get("risky_columns")))

print("\n" + "=" * 78)
print("④ 库存表带「门店名称」列 ⇒ 报 1 列危险（反向：客户名被商品名吞掉）")
print("=" * 78)
st, txt = multipart("/api/import/preview", token, "inventory", "v346-probe-inv.xlsx", xlsx(DANGER_INV))
d3 = json.loads(txt) if st == 200 else {}
v3 = (d3 or {}).get("validation") or {}
det3 = v3.get("risky_detail") or []
for x in det3:
    print("     · %s → %s (%s)：%s" % (x.get("header"), x.get("field"), x.get("risk"), x.get("reason")))
chk("P6 库存表「门店名称」被标危险",
    v3.get("risky_columns") == 1 and [x.get("header") for x in det3] == ["门店名称"],
    "实测=%s / %s" % (v3.get("risky_columns"), [x.get("header") for x in det3]))

print("\n" + "=" * 78)
print("⑤ 记忆命中判据：三个类目的 direct_ok 真值（生产库里可能已有记忆）")
print("=" * 78)
for cat, hdrs, f, note in (("inventory", CLEAN, "v346-probe-clean.xlsx", "干净"),
                           ("receivables", DANGER, "v346-probe-danger.xlsx", "有危险列"),
                           ("payment_receipts", [["客户名称", "回款金额", "回款日期", "收款方式"],
                                                 ["探针用门店", "500", "2026-09-30", "微信"]],
                            "v346-probe-pay.xlsx", "改账目类目")):
    st, txt = multipart("/api/import/preview", token, cat, f, xlsx(hdrs))
    dd = json.loads(txt) if st == 200 else {}
    rm = (dd or {}).get("remembered") or {}
    print("  [%s/%s] HTTP=%s remembered=%s" % (cat, note, st, rm))
    if rm.get("applied"):
        print("      → direct_ok=%r block_reason=%r" % (rm.get("direct_ok"), rm.get("block_reason")))
        if cat == "payment_receipts":
            chk("P7 收款流水：即使记忆命中也不直通（改账目类目）", rm.get("direct_ok") is False,
                "实测=%r" % rm.get("direct_ok"))
        elif cat == "receivables":
            chk("P8 应收表有危险列：不直通", rm.get("direct_ok") is False, "实测=%r" % rm.get("direct_ok"))
        else:
            chk("P9 干净模板：direct_ok=True 且 block_reason 为空",
                rm.get("direct_ok") is True and not rm.get("block_reason"),
                "实测=%r / %r" % (rm.get("direct_ok"), rm.get("block_reason")))
    else:
        print("      → 该指纹在生产库里还没有记忆（未命中）⇒ 本条不适用（不记为失败）")

print("\n" + "=" * 78)
print("⑥ 注销（自证：除 login/logout 外全程只读）")
print("=" * 78)
st, txt = _req("/api/auth/logout", {}, {"Authorization": "Bearer " + token}, method="POST")
print("  logout HTTP=%s" % st)

bad = [c for c in checks if not c[1]]
print("\n总判定：%d / %d 通过" % (len(checks) - len(bad), len(checks)))
for n, _, dt in bad:
    print("  ❌ %s  %s" % (n, dt))
print("=" * 78)
sys.exit(1 if bad else 0)
