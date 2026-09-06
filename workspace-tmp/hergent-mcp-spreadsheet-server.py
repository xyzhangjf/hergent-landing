#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hergent Spreadsheet MCP Server
================================
把后端 routers.chat_attachment 里的 _run_query（Excel/CSV 全量计算：汇总 / 求和 /
分组 / 筛选 / 对账）以 MCP 工具暴露给 Hermes，让 AI 副驾能直接对上传的整张表做计算，
而不是只读被截断的预览文本。

设计原则：复用而非重写
  - 直接 import routers.chat_attachment 调用其 _run_query（生产已验证的计算逻辑）
  - 跨文件对账（spreadsheet_reconcile_files）复用同一模块的 _load_sheets / _to_float 解析层，
    并套用与 _run_query(match) 完全一致的 only_in_a / only_in_b / mismatch 语义，
    不重写解析、不重复造对账算法。
  - core._auth 用本地 stub 顶替（MCP 工具不需要请求级鉴权；文件按不可猜测的 file_id 定位）

传输方式（由环境变量 SPREADSHEET_MCP_TRANSPORT 控制，默认 stdio）：
  - stdio：Hermes 以子进程方式拉起本服务（Hermes 自带 mcp SDK 不支持 streamable-http，
           故生产走 stdio 最稳）。
  - http / sse：本地调试用，监听 127.0.0.1:18766，要求 Bearer ${SPREADSHEET_MCP_KEY}。

工具（均为只读）：
  - spreadsheet_summary(file_id): 列出所有工作表 / 行数 / 列名
  - spreadsheet_query(file_id, op, ...): sum / groupby / filter / match / columns
  - spreadsheet_reconcile_files(file_a, file_b, ...): 两个独立文件跨文件对账（match 语义一致）
"""
import os
import re
import sys
import glob
import logging

# ---- 让 `from core import _auth` 成功（stub 顶替真实鉴权）----
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "stubs"))
# ---- 让 `from routers import chat_attachment` 成功（生产后端目录）----
sys.path.insert(1, "/opt/hergent-erp")

from fastapi import HTTPException  # noqa: E402  (chat_attachment 顶层依赖)
from routers import chat_attachment  # noqa: E402

from fastmcp import FastMCP  # noqa: E402

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("hergent-mcp-spreadsheet")

CHAT_FILES_ROOT = "/opt/hergent-erp/data/chat_files"
EXPECTED_KEY = os.environ.get("SPREADSHEET_MCP_KEY", "")

mcp = FastMCP("hergent-spreadsheet")


def _locate(file_id: str):
    """按 file_id 在所有用户目录下定位原文件（file_id 为不可猜测的 32 位 hex）。"""
    if not re.fullmatch(r"[0-9a-f]{32}", file_id or ""):
        return None
    for uid_dir in glob.glob(os.path.join(CHAT_FILES_ROOT, "*")):
        if not os.path.isdir(uid_dir):
            continue
        for fn in os.listdir(uid_dir):
            if fn.startswith(file_id + "."):
                return os.path.join(uid_dir, fn)
    return None


def _reconcile_files(path_a, path_b, key, amount, sheet_a="", sheet_b=""):
    """跨文件对账：复用后端 _load_sheets / _to_float 解析，套用与 _run_query(match) 完全一致语义。
    返回结构也与 match 对齐（only_in_a / only_in_b / mismatch / samples_*），便于前端/Hermes 统一消费。"""
    if not key:
        raise HTTPException(400, "跨文件对账需要指定对账键列 key（如 订单号/单号/凭证号，两边须同名列）")
    sa = chat_attachment._load_sheets(path_a)
    sb = chat_attachment._load_sheets(path_b)
    name_a = sheet_a or next(iter(sa), "")
    name_b = sheet_b or next(iter(sb), "")
    da = sa.get(name_a)
    db = sb.get(name_b)
    if da is None:
        raise HTTPException(400, f"文件A 找不到工作表 {name_a!r}")
    if db is None:
        raise HTTPException(400, f"文件B 找不到工作表 {name_b!r}")
    to_float = chat_attachment._to_float

    def _index(rows):
        m = {}
        for r in rows:
            k = str(r.get(key, "")).strip()
            if k:
                m.setdefault(k, []).append(r)
        return m

    ia, ib = _index(da), _index(db)
    only_a, only_b, mismatch = [], [], []
    for k, rs in ia.items():
        if k not in ib:
            only_a.extend(rs)
        else:
            va = sum(to_float(x.get(amount)) or 0 for x in rs) if amount else 0.0
            vb = sum(to_float(x.get(amount)) or 0 for x in ib[k]) if amount else 0.0
            if amount and abs(va - vb) > 0.001:
                mismatch.append({"key": k, "a": round(va, 2), "b": round(vb, 2)})
    for k in ib:
        if k not in ia:
            only_b.extend(ib[k])
    return {"file_a_sheet": name_a, "file_b_sheet": name_b, "key": key, "amount": amount,
            "only_in_a": len(only_a), "only_in_b": len(only_b),
            "mismatch": mismatch[:50], "mismatch_count": len(mismatch),
            "samples_only_a": only_a[:10], "samples_only_b": only_b[:10]}


@mcp.tool
def spreadsheet_summary(file_id: str) -> dict:
    """列出已上传 Excel/CSV 的所有工作表、每个表的行数与列名。
    在调用任何计算前，先用本工具了解文件结构（有哪些 sheet、列叫什么）。"""
    log.info("spreadsheet_summary file_id=%s", file_id)
    path = _locate(file_id)
    if not path:
        return {"error": "文件不存在或 file_id 无效（请确认上传成功且 file_id 正确）"}
    try:
        return chat_attachment._run_query(path, "summary", {})
    except HTTPException as e:
        return {"error": str(e.detail)}


@mcp.tool
def spreadsheet_query(file_id: str, op: str, sheet: str = "", column: str = "",
                      sheet_a: str = "", sheet_b: str = "",
                      key: str = "", amount: str = "", by: str = "", value: str = "") -> dict:
    """对上传的整张表做计算（只读）。op 可选：
    - sum: 对某一列求和，需 column
    - groupby: 按 by 列分组后对 column 列求和，需 by + column
    - filter: 筛选 column 列包含 value 的行，需 column + value
    - columns: 返回某表的列名，需 sheet
    - match: 对账。sheet_a 与 sheet_b 两张表（同一文件内）按 key 列对齐，比较 amount 列的差异。
             返回仅存在于A / 仅存在于B / 金额不一致(mismatch) 三类。
             需 sheet_a + sheet_b + key + amount
    调用前请先用 spreadsheet_summary 确认 sheet 名与列名，再传准确参数。"""
    log.info("spreadsheet_query file_id=%s op=%s sheet=%s", file_id, op, sheet)
    path = _locate(file_id)
    if not path:
        return {"error": "文件不存在或 file_id 无效（请确认上传成功且 file_id 正确）"}
    body = {k: v for k, v in dict(sheet=sheet, column=column, sheet_a=sheet_a,
            sheet_b=sheet_b, key=key, amount=amount, by=by, value=value).items() if v}
    try:
        return chat_attachment._run_query(path, op, body)
    except HTTPException as e:
        return {"error": str(e.detail)}


@mcp.tool
def spreadsheet_reconcile_files(file_a: str, file_b: str, key: str = "", amount: str = "",
                                sheet_a: str = "", sheet_b: str = "") -> dict:
    """对【两个独立】Excel/CSV 文件做跨文件对账（只读）。
    典型场景：用户分别上传「银行流水.xlsx」与「系统收支.csv」，要核对两边金额是否一致。
    file_a / file_b 为各自的 file_id；sheet_a / sheet_b 可选（不填取各文件第一个工作表）。
    key=对账键列（如 订单号/单号/凭证号，两边必须同名列）；amount=金额列（不填则只比对有无、不算金额差）。
    对账语义与单文件 match 完全一致：返回仅存在于A / 仅存在于B / 金额不一致(mismatch) 三类。
    调用前请先用 spreadsheet_summary 分别看清两个文件的 sheet 名与列名，再传准确的 key/amount/sheet 参数。"""
    log.info("spreadsheet_reconcile_files a=%s b=%s key=%s amount=%s", file_a, file_b, key, amount)
    pa = _locate(file_a)
    pb = _locate(file_b)
    if not pa:
        return {"error": f"文件A(file_id={file_a})不存在或无效"}
    if not pb:
        return {"error": f"文件B(file_id={file_b})不存在或无效"}
    try:
        return _reconcile_files(pa, pb, key, amount, sheet_a, sheet_b)
    except HTTPException as e:
        return {"error": str(e.detail)}


if __name__ == "__main__":
    transport = os.environ.get("SPREADSHEET_MCP_TRANSPORT", "stdio").lower()
    if transport == "stdio":
        # Hermes 以子进程方式拉起：走标准 stdio MCP 协议，无需网络/鉴权头
        mcp.run(transport="stdio")
    else:
        # 本地调试用 HTTP/SSE：仅监听 127.0.0.1，强制 Bearer 校验（fail-closed）
        if not EXPECTED_KEY:
            raise SystemExit("SPREADSHEET_MCP_KEY 未设置，拒绝启动 HTTP 模式（fail-closed）")
        from starlette.middleware.base import BaseHTTPMiddleware
        from starlette.responses import JSONResponse

        class AuthMiddleware(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                auth = request.headers.get("authorization", "")
                if auth != f"Bearer {EXPECTED_KEY}":
                    return JSONResponse({"error": "unauthorized"}, status_code=401)
                return await call_next(request)

        import uvicorn
        app = mcp.http_app(path="/mcp")
        app.add_middleware(AuthMiddleware)
        uvicorn.run(app, host="127.0.0.1", port=18766)
