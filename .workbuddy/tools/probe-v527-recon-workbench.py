# -*- coding: utf-8 -*-
"""v527 对账工作台取数端点探针（spreadsheet_query 新函数 + reconciliation 认列建议）。

零生产写入：全部用内存/临时目录里的合成 xlsx；erp 后端模块以 stub core/erp_db 方式
按路径加载（不 import server 主文件，避免启动期同步改库 —— 同 v198 探针纪律）。

断言（T1–T7）：
  T1 舟谱式文件（表头在第 5 行）按 header_row=4 读 ⇒ 列名/数据行正确
  T2 同一文件 header_row=0（第 1 行当表头）⇒ 列名是标题垃圾 ⇒ 证明"不选表头行必错"
  T3 猜列建议：舟谱式 ⇒ two_col + 日期/收入/支出/往来单位/单据编号全认对
  T4 猜列建议：微信式（金额+收/支）⇒ one_col_dir + amount_col/direction_col
  T5 合计行提示：末尾"合计"行被 _total_row_hints 标出（列名+行号）
  T6 行数上限：超 max_rows 抛 HTTPException 且文案含"上限"（绝不静默截断）
  T7 回归：_load_sheets（第 1 行表头）行为逐字不变；重名列加 #2 后缀不丢列
"""
import os
import sys
import types
import importlib.util

ERP = "/Users/zhangjunfeng/Documents/hergent-erp/server"
sys.path.insert(0, ERP)

from fastapi import HTTPException  # noqa: E402

# --- stub core / erp_db（reconciliation.py 顶部 import 它们；按路径加载避免启动副作用）
_core = types.ModuleType("core")
_core._auth = lambda request: {"id": 1, "role": "boss"}
_core.pydantic_error_detail = lambda e: str(e)
sys.modules["core"] = _core
sys.modules["erp_db"] = types.ModuleType("erp_db")

_spec = importlib.util.spec_from_file_location(
    "recon_router_probe", os.path.join(ERP, "routers", "reconciliation.py"))
rr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rr)

import spreadsheet_query as sq  # noqa: E402

TMP = "/tmp/v527-probe"
os.makedirs(TMP, exist_ok=True)


def _write_xlsx(path, rows, title="Sheet1"):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = title
    for r in rows:
        ws.append(r)
    wb.save(path)


def _zhoupu_like():
    """舟谱式：前 4 行标题/筛选噪音，第 5 行表头，数据 + 末尾合计行。"""
    rows = [
        ["舟谱账户收支明细表", "", "", "", "", ""],
        ["期间：2026-09-01 至 2026-09-30", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["筛选：全部账户", "", "", "", "", ""],
        ["单据时间", "单据编号", "往来单位", "收入金额", "支出金额", "备注"],
        ["2026-09-03 10:11", "SK2609030001", "蒙牛酸奶（福宝）", "135317.90", "", "9月货款"],
        ["2026-09-05 09:00", "XD2609050002", "蒙牛酸奶（福宝）", "", "570.00", "退货"],
        ["2026-09-08 14:22", "SK2609080003", "美联（卞和店）", "8420.00", "", ""],
        ["", "", "合计", "143737.90", "570.00", ""],
    ]
    p = os.path.join(TMP, "zhoupu.xlsx")
    _write_xlsx(p, rows, title="账户收支明细")
    return p


def _wechat_like():
    """微信式：单金额列 + 收/支方向列。"""
    rows = [
        ["交易时间", "交易对方", "收/支", "金额(元)", "备注"],
        ["2026-09-03 12:00", "蒙牛酸奶（福宝）", "支出", "50050.00", ""],
        ["2026-09-04 08:30", "美联（卞和店）", "收入", "420.00", "微信40+20"],
        ["2026-09-06 20:00", "微信提现", "/", "78070.00", "提现到银行卡"],
    ]
    p = os.path.join(TMP, "wechat.xlsx")
    _write_xlsx(p, rows)
    return p


PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  ✅ " if cond else "  🔴 ") + name + ((" | " + str(detail)) if detail else ""))


print("== T1 舟谱式 header_row=4（第 5 行）==")
zp = _zhoupu_like()
cols, data, total = sq._load_sheet_rows(zp, "账户收支明细", 4)
check("T1a 列名正确", cols[:5] == ["单据时间", "单据编号", "往来单位", "收入金额", "支出金额"], cols)
check("T1b 数据 4 行（3 业务 + 1 合计行——合计行按设计留在数据里，由 skip_types 排除）",
      len(data) == 4 and data[-1].get("往来单位") == "合计", len(data))
check("T1c 首行业务值", data[0].get("往来单位") == "蒙牛酸奶（福宝）", data[0])

print("== T2 同一文件 header_row=0（不选表头行的后果）==")
cols0, data0, _ = sq._load_sheet_rows(zp, "账户收支明细", 0)
check("T2 第 1 行当表头 ⇒ 列名是标题垃圾（证明必须选表头行）",
      "单据时间" not in cols0 and any("舟谱" in c for c in cols0), cols0[:3])

print("== T3 猜列：舟谱式 ⇒ two_col ==")
s = rr._suggest_mapping(cols)
check("T3a mode=two_col", s["mode"] == "two_col", s["mode"])
check("T3b date=单据时间", s["date_col"] == "单据时间", s["date_col"])
check("T3c in/out=收入金额/支出金额", (s["in_col"], s["out_col"]) == ("收入金额", "支出金额"), (s["in_col"], s["out_col"]))
check("T3d counterparty=往来单位", s["counterparty_col"] == "往来单位", s["counterparty_col"])
check("T3e key=单据编号", s["key_col"] == "单据编号", s["key_col"])
check("T3f confidence>=4（date/in/out/counterparty 四关键列；key 不计入）", s["confidence"] >= 4, s["confidence"])

print("== T4 猜列：微信式 ⇒ one_col_dir ==")
wx = _wechat_like()
wcols, wdata, _ = sq._load_sheet_rows(wx, "Sheet1", 0)
sw = rr._suggest_mapping(wcols)
check("T4a mode=one_col_dir", sw["mode"] == "one_col_dir", sw["mode"])
check("T4b amount_col=金额(元)", sw["amount_col"] == "金额(元)", sw["amount_col"])
check("T4c direction_col=收/支", sw["direction_col"] == "收/支", sw["direction_col"])
check("T4d date=交易时间", sw["date_col"] == "交易时间", sw["date_col"])
check("T4e counterparty=交易对方", sw["counterparty_col"] == "交易对方", sw["counterparty_col"])

print("== T5 合计行提示 ==")
hints = rr._total_row_hints(data, cols)
check("T5a 标出合计行（数据第 4 行 + 列名 + 值）", len(hints) == 1 and hints[0]["column"] == "往来单位"
      and hints[0]["value"] == "合计" and hints[0]["row_index"] == 4, hints)

print("== T6 行数上限（超限报错不截断）==")
try:
    sq._load_sheet_rows(zp, "账户收支明细", 4, max_rows=2)
    check("T6 超限应抛 HTTPException", False, "未抛")
except HTTPException as e:
    check("T6 超限抛 400 且文案含上限", e.status_code == 400 and "上限" in str(e.detail), e.detail)

print("== T7 回归：_load_sheets 行为不变 + 重名列 ==")
sh = sq._load_sheets(zp)
check("T7a _load_sheets 仍以第 1 行为表头（语义不变）",
      list(sh["账户收支明细"][0].keys())[0].startswith("舟谱"), list(sh["账户收支明细"][0].keys())[:2])
dup = os.path.join(TMP, "dup.xlsx")
_write_xlsx(dup, [["金额", "金额", "日期"], ["1", "2", "2026-09-01"]])
dcols, ddata, _ = sq._load_sheet_rows(dup, "Sheet1", 0)
check("T7b 重名列加 #2 后缀（后列不覆盖前列）",
      dcols[0] == "金额" and dcols[1] == "金额#2", dcols)
check("T7c 两列值都在", ddata[0].get("金额") == "1" and ddata[0].get("金额#2") == "2", ddata)

print()
print("通过 %d / %d" % (len(PASS), len(PASS) + len(FAIL)))
if FAIL:
    print("失败：", FAIL)
    sys.exit(1)
print("ALL GREEN")
