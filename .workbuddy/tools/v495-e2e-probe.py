#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v495 端到端探针：内部通道 → 令牌 → 预览（只读，不写任何数据）"""
import glob
import json
import os
import sys
import uuid

CHAT_ROOT = "/opt/hergent-erp/data/chat_files"
USER_ID = "2"          # boss（张俊峰）
key = ""
for line in open("/opt/hergent-erp/.env", encoding="utf-8"):
    if line.startswith("MCP_INTERNAL_KEY="):
        key = line.split("=", 1)[1].strip()
os.environ["HERGENT_MCP_KEY"] = key
os.environ["HERMES_BACKEND_ROOT"] = "/opt/hergent-erp"

sys.path.insert(0, "/opt/hergent-mcp-import")
import openpyxl
import import_server as m

# 1) 造一个绝不会匹配到真实客户的测试往来单位
uid_dir = os.path.join(CHAT_ROOT, USER_ID)
os.makedirs(uid_dir, exist_ok=True)
file_id = uuid.uuid4().hex
path = os.path.join(uid_dir, file_id + ".xlsx")
wb = openpyxl.Workbook()
ws = wb.active
ws.append(["名称", "类型", "电话", "结算方式", "账期天数"])
ws.append(["__v495_链路测试单位__", "客户", "13900000000", "现结", 0])
ws.append(["__v495_链路测试单位2__", "客户", "13900000001", "现结", 0])
wb.save(path)
print("测试文件:", path, "file_id =", file_id)

# 2) 反查上传者（多租户隔离的关键）
p, uid = m._locate(file_id)
print("定位:", os.path.basename(p) if p else None, "| 反查出上传者 uid =", uid)

# 3) 换令牌
tok = m._internal_token(uid)
print("令牌: 拿到 =", bool(tok), "| 长度 =", len(tok))

# 4) 预览（只读）
res = m.import_preview(file_id=file_id, category="contacts")
print("\n=== preview 返回的键 ===")
print(list(res.keys()) if isinstance(res, dict) else type(res))
print("\n=== preview 摘要 ===")
if isinstance(res, dict):
    for k in ("success", "filename", "total_rows", "headers", "mapping",
              "suggestions", "sample", "uploaded", "upload"):
        if k in res:
            print(" ", k, "=", json.dumps(res[k], ensure_ascii=False)[:300])

# 5) 闸门验证：confirm=false 必须不落库
print("\n=== execute(confirm=false) 闸门 ===")
gate = m.import_execute(file_id=file_id, category="contacts", confirm=False)
print(" 已落库 =", gate.get("已落库"), "| success =", gate.get("success"))
print(" 说明 =", str(gate.get("说明") or gate.get("error"))[:120])

# 6) 不可撤销类目必须拦住
print("\n=== 不可撤销闸门（receivables）===")
blk = m.import_execute(file_id=file_id, category="receivables", confirm=True)
print(" 已落库 =", blk.get("已落库"), "| error =", str(blk.get("error"))[:150])

with open("/tmp/v495_fid.txt", "w") as f:
    f.write(file_id)