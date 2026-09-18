#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成一份**能被 forecast_cross 导入器正确识别**的最小样本 xlsx（v193 沙箱真机验证用）。

为什么要一个专门的生成器，而不是手搓／复用现成文件：
  · 导入接口是 `multipart/form-data` + `openpyxl.load_workbook` ⇒ 必须真 xlsx，
    不能拿 CSV 顶替（`execute_import` 一律用 openpyxl 打开）。
  · 列识别走 `mapping`（由前端预览产出）；探针直连接口时自备 mapping ⇒
    列名只需能对上 `_execute_forecast_cross` 的两个判据：
      ① 客户列：表头非空、非纯数字、**不以「价」结尾**、不含 `_CROSS_SKIP_KEYWORDS`；
      ② 身份列：列名命中 COLUMN_PATTERNS["forecast_cross"]（本文件取 name/barcode/price/rhythm）。
  · barcode 用的是**沙箱库中真实存在**的条码（6900000000193 系虚构占位，
    导入器对未知条码会走「零档案建档」，会产生副作用）—— 故这里刻意用
    一个**查得到**的条码，让导入落在「复用已有商品」这条干净路径上。

用法：python3 make-fc-cross-sample.py <输出路径.xlsx> [客户列名1] [客户列名2]
"""
import sys

from openpyxl import Workbook

# 与 COLUMN_PATTERNS["forecast_cross"] 对齐的表头（顺序无关，mapping 里显式指定）
IDENTITY_HEADERS = ["商品名称", "条码", "规格", "单位", "单价", "到货周期"]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fc_cross_sample.xlsx"
    c1 = sys.argv[2] if len(sys.argv) > 2 else "永辉"
    c2 = sys.argv[3] if len(sys.argv) > 3 else "分销"
    barcode = sys.argv[4] if len(sys.argv) > 4 else "6923644201203"

    wb = Workbook()
    ws = wb.active
    ws.title = "订单汇总"
    ws.append(IDENTITY_HEADERS + [c1, c2])
    ws.append(["v193门禁探针商品", barcode, "1*10", "箱", 45, "+7天", 3, 2])
    wb.save(out)
    print("OK " + out)


if __name__ == "__main__":
    main()
