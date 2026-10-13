#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v495 完整闭环探针：预检 → 落库 → 回执可查 → 撤销 → 确认无残留。

测试数据全部使用 `__v495_` 前缀，绝不触碰任何真实客户/供应商。
"""
import json
import os
import sqlite3
import sys
import uuid

CHAT_ROOT = "/opt/hergent-erp/data/chat_files"
USER_ID = "2"
MARK = "__v495_"

key = ""
for line in open("/opt/hergent-erp/.env", encoding="utf-8"):
    if line.startswith("MCP_INTERNAL_KEY="):
        key = line.split("=", 1)[1].strip()
os.environ["HERGENT_MCP_KEY"] = key
os.environ["HERMES_BACKEND_ROOT"] = "/opt/hergent-erp"
sys.path.insert(0, "/opt/hergent-mcp-import")

import openpyxl
import import_server as m

TENANT_DB = "/opt/hergent-erp/tenant_1.db"


def count_mark():
    c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    try:
        return c.execute("SELECT COUNT(*) FROM contacts WHERE name LIKE ?",
                         (MARK + "%",)).fetchone()[0]
    finally:
        c.close()


def receipts_mark():
    c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    try:
        return c.execute(
            "SELECT COUNT(*) FROM import_receipts WHERE file_name LIKE ?",
            ("%" + MARK + "%",)).fetchone()[0]
    finally:
        c.close()


uid_dir = os.path.join(CHAT_ROOT, USER_ID)
os.makedirs(uid_dir, exist_ok=True)
file_id = uuid.uuid4().hex
path = os.path.join(uid_dir, file_id + ".xlsx")
wb = openpyxl.Workbook()
ws = wb.active
ws.append(["名称", "类型", "电话", "结算方式", "账期天数"])
for i in (1, 2, 3):
    ws.append([MARK + "测试单位%d__" % i, "客户", "1390000000%d" % i, "现结", 0])
wb.save(path)

print("① 落库前 contacts 中 %s 记录数 = %d" % (MARK, count_mark()))

# ---- 预检 ----
pre = m.import_preview(file_id=file_id, category="contacts")
mapping = pre.get("mapping", "")
print("② 预检: success=%s 行数=%s 自动合成mapping=%s"
      % (pre.get("success"), pre.get("total_rows_estimate"), mapping))

# ---- confirm=false 闸门 ----
gate = m.import_execute(file_id=file_id, category="contacts", mapping=mapping, confirm=False)
print("③ 闸门(confirm=false): 已落库=%s  →库中记录数=%d"
      % (gate.get("已落库"), count_mark()))

# ---- 真正落库 ----
res = m.import_execute(file_id=file_id, category="contacts", mapping=mapping, confirm=True)
batch = res.get("batch_id", "")
print("④ 落库: 成功=%s batch_id=%s 可撤销=%s →库中记录数=%d"
      % (res.get("success"), batch, res.get("undoable"), count_mark()))

# ---- 历史可查 ----
his = m.import_history(user_id=USER_ID, limit=5)
hit = [r for r in his.get("记录", []) if r.get("文件名", "").find(MARK) >= 0]
print("⑤ 历史回执: 共%d条, 命中本次=%d条, 操作人=%s, 成功行数=%s"
      % (his.get("共", 0), len(hit),
         hit[0].get("操作人") if hit else "-", hit[0].get("成功行数") if hit else "-"))

# ---- 幂等：同一文件再导一次（应跳过而非重复）----
res2 = m.import_execute(file_id=file_id, category="contacts", mapping=mapping, confirm=True)
print("⑥ 重复导入: 成功=%s 跳过=%s →库中记录数=%d（应仍为3，不翻倍）"
      % (res2.get("success"), res2.get("skipped"), count_mark()))

# ---- 撤销 ----
undo = m.import_undo(batch_id=batch, user_id=USER_ID)
print("⑦ 撤销: %s" % json.dumps(undo, ensure_ascii=False)[:140])
print("   撤销后库中记录数 = %d（应为0）" % count_mark())
print("   撤销后回执数 = %d（回执保留=可追溯）" % receipts_mark())

for fn in (path,):
    try:
        os.remove(fn)
    except Exception:
        pass
print("完成" if count_mark() == 0 else "⚠️ 有残留")