#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v344 本地沙箱端到端验收（真实端点 + 真实库调用，库是**副本**）。

隔离声明：
  · 库指向 `/tmp/v344-sandbox/erp.db`（`ERP_DB_PATH` 是唯一切库开关，
    `db/connection.py` 里 `DB_PATH` 与 `DB_DIR` 由它派生 ⇒ 租户库也落在沙箱目录）。
  · **不碰生产**、不碰本仓 `server/erp.db`；身份是进程内桩（不打生产接口）。
  · 唯一"写"发生在沙箱副本库里。

四个场景（后两个是**单点回退对照**，用来证明断言真的有判别力）：
  A 新代码 + T1（带前置标题行 + 尾部合计行）⇒ 表头=第3行、合计行被跳过且逐条点名
  B 新代码 + T2（裸模板，表头第1行）    ⇒ 表头=第1行、行为逐字等于改造前（回归底线）
  C 仅回退 `_detect_header_row` ⇒ **必须复现**「headers[0] == 库存查询表」这个静默错位
  D 仅回退 `_is_summary_row`    ⇒ **必须复现**「找不到商品: 合计」这条错账
"""
import io
import json
import os
import sqlite3
import sys

SANDBOX_DB = "/tmp/v344-sandbox/erp.db"
os.environ["ERP_DB_PATH"] = SANDBOX_DB
os.environ.setdefault("ERP_SECRET", "sandbox-only-not-a-secret")
# hermes_core 在**导入期**就要求这个键存在（只是个构建期断言）；沙箱里给占位值。
# 本脚本已把 `_ai_guess_mapping` 桩成空 ⇒ 任何真实模型调用都不会发生。
os.environ.setdefault("DEEPSEEK_API_KEY", "sandbox-dummy-never-used")
os.environ["LOGIN_SCOPE_ENFORCE"] = "0"
sys.path.insert(0, os.getcwd())

import openpyxl                                     # noqa: E402
from fastapi.testclient import TestClient           # noqa: E402

import server as S                                  # noqa: E402
import core as C                                    # noqa: E402
import routers.import_router as IR                  # noqa: E402

FAKE = {"id": 1, "username": "sandbox", "display_name": "沙箱", "role": "admin"}

# ── 进程内身份桩（避免打生产登录接口 / 不猜任何密码）─────────────────────────
C._get_user = lambda r: FAKE
C._auth = lambda r: FAKE
C._check_perm = lambda user, module, action="read", tenant_id=None: True
C.user_effective_readonly = lambda user: False
C.tenant_is_readonly = lambda tid: False
S._get_user = lambda r: FAKE
IR._auth = lambda r: FAKE
IR._ai_guess_mapping = lambda headers, category: {}      # 关掉大模型兜底 ⇒ 结果可复现
if hasattr(S, "db"):
    S.db.check_user_tenant = lambda uid, tid: True

HDR = ["商品名称", "规格", "单位", "数量", "成本价", "批次号", "到期日"]

# ── 取两个沙箱库里真实存在的商品名（保证 execute 能走到成功分支）────────────
_c = sqlite3.connect(SANDBOX_DB)
try:
    _rows = _c.execute("SELECT name FROM products WHERE is_active=1 ORDER BY id LIMIT 2").fetchall()
except Exception:
    _rows = []
_c.close()
NAMES = [r[0] for r in _rows] or ["蒙牛纯牛奶", "蒙牛酸牛奶"]
print("沙箱真实商品名：%s" % NAMES)

DATA = [[NAMES[0], "250ml*12", "件", 120, 45.5, "P20260901", "2026-10-15"],
        [NAMES[1], "100g*24", "件", 80, 38.0, "P20260902", "2026-10-20"]]
SUMROW = ["合计", "", "", 200, "", "", ""]


def make_xlsx(preamble: bool, with_sum: bool) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    if preamble:
        ws.append(["库存查询表"])
        ws.append(["导出时间：2026-09-30 08:00:00"])
    ws.append(HDR)
    for r in DATA:
        ws.append(r)
    if with_sum:
        ws.append(SUMROW)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def preview(client, content):
    r = client.post("/api/import/preview",
                    data={"category": "inventory"},
                    files={"file": ("t.xlsx", content, "application/octet-stream")},
                    headers={"X-Tenant-Id": "1", "Authorization": "Bearer sandbox"})
    if r.status_code != 200:
        print("     [诊断] HTTP=%s 响应体=%s" % (r.status_code, r.text[:300]))
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {}


def execute(client, content, mapping):
    r = client.post("/api/import/execute",
                    data={"category": "inventory", "mapping": json.dumps(mapping),
                          "check_dupes": "0"},
                    files={"file": ("t.xlsx", content, "application/octet-stream")},
                    headers={"X-Tenant-Id": "1", "Authorization": "Bearer sandbox"})
    if r.status_code != 200:
        print("     [诊断] HTTP=%s 响应体=%s" % (r.status_code, r.text[:300]))
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {}


def mapping_from(sug):
    return {str(s["index"]): s["suggested_field"] for s in (sug or []) if s.get("suggested_field")}


checks = []


def chk(name, cond, detail=""):
    checks.append((name, bool(cond), detail))
    print("  %-62s %-8s %s" % (name, "OK" if cond else "**FAIL**", detail))


with TestClient(S.app) as client:
    print("\n" + "=" * 84)
    print("场景 A：新代码 + T1（前置标题行 + 尾部合计行）")
    print("=" * 84)
    T1 = make_xlsx(True, True)
    st, d = preview(client, T1)
    v = d.get("validation") or {}
    print("  preview HTTP=%s header_row=%s headers=%s" % (st, d.get("header_row"), d.get("headers")))
    print("  预览内合计行=%s  note=%s" % (v.get("summary_rows_in_preview"), d.get("header_row_note")))
    chk("A1 preview HTTP=200", st == 200, "实测=%s" % st)
    chk("A2 headers 逐字 == 真实表头", d.get("headers") == HDR, "实测=%s" % (d.get("headers"),))
    chk("A3 header_row == 3", d.get("header_row") == 3, "实测=%s" % d.get("header_row"))
    chk("A4 有 header_row_note", bool(d.get("header_row_note")), "实测=%r" % (d.get("header_row_note"),))
    chk("A5 预览内识别到 1 行合计", v.get("summary_rows_in_preview") == 1,
        "实测=%s" % v.get("summary_rows_in_preview"))
    _mapA = mapping_from(d.get("suggestions"))
    print("  映射=%s" % _mapA)
    st, d2 = execute(client, T1, _mapA)
    rs = d2.get("results") or {}
    errs = [e for e in (rs.get("errors") or [])]
    print("  execute HTTP=%s success=%s summary_rows_skipped=%s errors=%s"
          % (st, rs.get("success"), rs.get("summary_rows_skipped"), errs))
    chk("A6 execute HTTP=200 且 success==2", st == 200 and rs.get("success") == 2,
        "HTTP=%s success=%s" % (st, rs.get("success")))
    chk("A7 summary_rows_skipped == 1", rs.get("summary_rows_skipped") == 1,
        "实测=%s" % rs.get("summary_rows_skipped"))
    chk("A8 回执里有 1 条 type=warn 的「汇总行已跳过」",
        sum(1 for e in errs if e.get("type") == "warn" and "汇总行" in str(e.get("msg", ""))) == 1,
        "warn 条数=%s" % sum(1 for e in errs if e.get("type") == "warn"))
    chk("A9 合计行**没有**变成一条错账（无「找不到商品: 合计」）",
        not any("合计" in str(e.get("msg", "")) and "找不到商品" in str(e.get("msg", "")) for e in errs),
        "errors=%s" % errs)
    chk("A10 回执里点名了「被识别为表头」",
        any(e.get("type") == "warn" and "识别为表头" in str(e.get("msg", "")) for e in errs),
        "warn 明细=%s" % [e.get("msg", "")[:26] for e in errs if e.get("type") == "warn"])

    print("\n" + "=" * 84)
    print("场景 B：新代码 + T2（裸模板，表头第1行）—— 回归底线")
    print("=" * 84)
    T2 = make_xlsx(False, False)
    st, d = preview(client, T2)
    print("  preview HTTP=%s header_row=%s headers=%s" % (st, d.get("header_row"), d.get("headers")))
    chk("B1 preview HTTP=200", st == 200, "实测=%s" % st)
    chk("B2 headers 逐字 == 模板表头", d.get("headers") == HDR, "实测=%s" % (d.get("headers"),))
    chk("B3 header_row == 1", d.get("header_row") == 1, "实测=%s" % d.get("header_row"))
    chk("B4 无合计行", not (d.get("validation") or {}).get("summary_rows_in_preview"),
        "实测=%s" % (d.get("validation") or {}).get("summary_rows_in_preview"))
    st, d3 = execute(client, T2, mapping_from(d.get("suggestions")))
    rs3 = d3.get("results") or {}
    chk("B5 execute HTTP=200 且 success==2", st == 200 and rs3.get("success") == 2,
        "HTTP=%s success=%s" % (st, rs3.get("success")))
    chk("B6 没有汇总行被跳过（summary_rows_skipped 缺失或 0）",
        not rs3.get("summary_rows_skipped"),
        "实测=%s" % rs3.get("summary_rows_skipped"))

    print("\n" + "=" * 84)
    print("场景 C：单点回退 `_detect_header_row`（模拟改造前）—— 必须复现静默错位")
    print("=" * 84)
    _real_detect = IR._detect_header_row
    IR._detect_header_row = lambda rows, category="": {
        "index": 0, "detected": True, "hits": 0, "non_empty": 0, "scanned": 0, "note": ""}
    st, d = preview(client, T1)
    print("  preview HTTP=%s headers=%s" % (st, d.get("headers")))
    chk("C1 复现 bug：headers[0] == 「库存查询表」",
        (d.get("headers") or [""])[0] == "库存查询表", "实测=%r" % ((d.get("headers") or [""])[0],))
    IR._detect_header_row = _real_detect

    print("\n" + "=" * 84)
    print("场景 D：单点回退 `_is_summary_row`（模拟改造前）—— 必须复现合计行错账")
    print("=" * 84)
    _real_sum = IR._is_summary_row
    IR._is_summary_row = lambda row: False
    st, d = preview(client, T1)
    st, d4 = execute(client, T1, mapping_from(d.get("suggestions")))
    rs4 = d4.get("results") or {}
    _msgs = [str(e.get("msg", "")) for e in (rs4.get("errors") or [])]
    print("  execute HTTP=%s success=%s errors=%s" % (st, rs4.get("success"), _msgs))
    chk("D1 复现 bug：出现「找不到商品: 合计」（合计行被当成真数据）",
        any("找不到商品" in m and "合计" in m for m in _msgs), "实测 messages=%s" % _msgs)
    IR._is_summary_row = _real_sum

    print("\n" + "=" * 84)
    print("场景 E：新代码 + products 类目（覆盖「条码冲突预扫描」这条独有路径）")
    print("=" * 84)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["商品资料导出"])
    ws.append(["商品名称", "规格", "单位", "商品条码", "品牌", "进价", "售价"])
    ws.append(["沙箱测试品A", "1*10", "件", "9900000000011", "测试牌", "10.5", "12"])
    ws.append(["沙箱测试品B", "1*10", "件", "9900000000012", "测试牌", "11.5", "13"])
    ws.append(["合计", "", "", "", "", "22", "25"])
    _buf = io.BytesIO()
    wb.save(_buf)
    T3 = _buf.getvalue()

    def _prev_p(client, content):
        r = client.post("/api/import/preview",
                        data={"category": "products"},
                        files={"file": ("p.xlsx", content, "application/octet-stream")},
                        headers={"X-Tenant-Id": "1", "Authorization": "Bearer sandbox"})
        return r.status_code, (r.json() if r.status_code == 200 else {})

    def _exec_p(client, content, mapping):
        r = client.post("/api/import/execute",
                        data={"category": "products", "mapping": json.dumps(mapping), "check_dupes": "0"},
                        files={"file": ("p.xlsx", content, "application/octet-stream")},
                        headers={"X-Tenant-Id": "1", "Authorization": "Bearer sandbox"})
        return r.status_code, (r.json() if r.status_code == 200 else {})

    st, dp = _prev_p(client, T3)
    print("  preview HTTP=%s header_row=%s headers=%s" % (st, dp.get("header_row"), dp.get("headers")))
    chk("E1 products preview HTTP=200 且 header_row==2", st == 200 and dp.get("header_row") == 2,
        "HTTP=%s header_row=%s" % (st, dp.get("header_row")))
    chk("E2 products headers 逐字 == 真实表头",
        dp.get("headers") == ["商品名称", "规格", "单位", "商品条码", "品牌", "进价", "售价"],
        "实测=%s" % (dp.get("headers"),))
    st, dp2 = _exec_p(client, T3, mapping_from(dp.get("suggestions")))
    rs5 = dp2.get("results") or {}
    print("  execute HTTP=%s success=%s skipped=%s summary=%s barcode_conflicts=%s"
          % (st, rs5.get("success"), rs5.get("skipped"), rs5.get("summary_rows_skipped"),
             len(dp2.get("barcode_conflicts") or [])))
    chk("E3 products execute HTTP=200 且 success==2", st == 200 and rs5.get("success") == 2,
        "HTTP=%s success=%s" % (st, rs5.get("success")))
    chk("E4 products summary_rows_skipped == 1", rs5.get("summary_rows_skipped") == 1,
        "实测=%s" % rs5.get("summary_rows_skipped"))
    chk("E5 没有被当成商品的「合计」（无相关报错）",
        not any("合计" in str(e.get("msg", "")) and "找不到商品" in str(e.get("msg", ""))
                for e in (rs5.get("errors") or [])),
        "errors=%s" % [str(e.get("msg", ""))[:24] for e in (rs5.get("errors") or [])][:6])

print("\n" + "=" * 84)
bad = [c for c in checks if not c[1]]
print("总判定：%d / %d 通过" % (len(checks) - len(bad), len(checks)))
if bad:
    print("未通过项：")
    for n, _, dt in bad:
        print("  · %s   %s" % (n, dt))
print("=" * 84)
sys.exit(1 if bad else 0)
