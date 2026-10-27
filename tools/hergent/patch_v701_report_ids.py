#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v701：报表明细端点补回单据 id —— 没有它，单号根本点不动。

=====================================================================
🔴 现状（生产实测）
=====================================================================
老板要「点报表里的单号看明细」。但三张明细报表的接口**只返回 order_no，
不返回主键 id**：

    /api/reports/sales-detail
      SELECT s.order_no, COALESCE(c.name,'未知客户') customer, ...
    /api/reports/purchase-detail
      SELECT p.order_no, COALESCE(c.name,'未知供应商') supplier, ...
    /api/reports/transfer-detail
      SELECT t.order_no, t.product_name, ...

而详情页路由是**按 id** 的：
    /inventory/sale/:id      → InvSaleDetail
    /inventory/purchase/:id  → InvPurchaseDetail

⇒ 前端拿 order_no 拼不出可跳的地址（拿单号当 id 用会 404 / 打开别人的单）。

=====================================================================
修法（3 处，各加一个字段，不动任何现有字段与排序）
=====================================================================
`SELECT s.order_no,` → `SELECT s.id, s.order_no,`（p / t 同理）

⚠️ 三个端点都是 `SELECT ... FROM <表> LEFT JOIN contacts`，加主键不会改变行数、
   不会改变 LIMIT/OFFSET 行为、也不会影响 CSV 导出（导出按列定义取值，多一个
   字段不会被吐出来 —— ReportTable 的 exportCsv 只遍历 columns）。

⚠️ 关于调拨：`transfer_orders` 一行就是**一个商品**（含 product_name/quantity），
   没有「单头 + 明细」两层，所以调拨页的下探只到「行」为止，前端不会做跳转。
   这里仍补 id，是为了将来若加调拨详情页可直接用，且保持三张表字段同构。

用法：
    python3 patch_v701_report_ids.py [--target=/opt/hergent-erp/routers/reports.py] [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/reports.py")

PATCHES = [
    (
        '''                "SELECT s.order_no, COALESCE(c.name,'未知客户') customer, s.order_date, "''',
        '''                "SELECT s.id, s.order_no, COALESCE(c.name,'未知客户') customer, s.order_date, "''',
        "1. sales-detail 补 s.id",
    ),
    (
        '''                "SELECT p.order_no, COALESCE(c.name,'未知供应商') supplier, p.order_date, "''',
        '''                "SELECT p.id, p.order_no, COALESCE(c.name,'未知供应商') supplier, p.order_date, "''',
        "2. purchase-detail 补 p.id",
    ),
    (
        '''                "SELECT t.order_no, t.product_name, fw.name from_wh, tw.name to_wh, "''',
        '''                "SELECT t.id, t.order_no, t.product_name, fw.name from_wh, tw.name to_wh, "''',
        "3. transfer-detail 补 t.id",
    ),
]


def apply(text, old, new, label, results):
    if new in text:
        results.append(("SKIP", label, "已是新版，跳过"))
        return text
    if old not in text:
        results.append(("FAIL", label, "锚点未命中"))
        return text
    if text.count(old) != 1:
        results.append(("FAIL", label, f"锚点出现 {text.count(old)} 次，不唯一"))
        return text
    results.append(("OK", label, ""))
    return text.replace(old, new, 1)


def main():
    args = list(sys.argv[1:])
    dry = "--dry-run" in args
    target = DEFAULT_TARGET
    for a in args:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print(f"目标文件不存在: {target}")
        return 1

    src = target.read_text(encoding="utf-8")
    out = src
    results = []
    for old, new, label in PATCHES:
        out = apply(out, old, new, label, results)

    print("=" * 62)
    for st, label, note in results:
        mark = {"OK": "✅", "SKIP": "⏭ ", "FAIL": "❌"}[st]
        print(f"{mark} {label}" + (f"  ← {note}" if note else ""))
    print("=" * 62)
    if any(r[0] == "FAIL" for r in results):
        print("有锚点未命中，未写入任何文件。")
        return 2
    if out == src:
        print("内容无变化（已是新版），未写入。")
        return 0
    if dry:
        print("--dry-run：未写入文件。")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = target.with_suffix(target.suffix + f".bak-v701-{ts}")
    shutil.copy2(target, bak)
    target.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(target), doraise=True)
    except Exception as e:
        shutil.copy2(bak, target)
        print(f"❌ 语法检查失败，已回滚：{e}")
        return 3
    print(f"✅ 已写入 {target}\n   备份 {bak}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
