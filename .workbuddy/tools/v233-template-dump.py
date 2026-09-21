# -*- coding: utf-8 -*-
"""v233 生产「模板存量零变化」取证：把**回填前**库与**回填后**库跑同一份真身 `_build_zhoupu_data`，
逐行比 (行号, 条码, *单位, *数量, *单价) —— 期望**逐字节相同**。

用法（生产机上）：
    # 回填前：把备份还原成一个独立目录（自带 erp.db）
    runuser -u hergent -- env ERP_SECRET=... ERP_DB_PATH=/tmp/v233pre/erp.db python3 x.py > /tmp/pre.txt
    runuser -u hergent -- env ERP_SECRET=... ERP_DB_PATH=/opt/hergent-erp/erp.db python3 x.py > /tmp/post.txt
    diff /tmp/pre.txt /tmp/post.txt   # 期望 0 行

为什么要这么比：「回填会改主表单位列」这件事已知；**未知且要回答的是**
「已经在导的舟谱模板会不会跟着变」。只有跑真身函数、真实数据才能回答。
"""
import os
import sys

sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

import erp_db as db                                  # noqa: E402
import routers.forecast as F                         # noqa: E402

db.set_tenant_context(1)

with db.get_db() as c:
    mn, mx = c.execute("SELECT MIN(order_date), MAX(order_date) FROM forecast_submissions").fetchone()

zt, dbo, warns = F._build_zhoupu_data(mn, mx)
print('# 日期窗口 %s ~ %s ／ 自提 %d 行 ／ 调拨 %d 行' % (mn, mx, len(zt), len(dbo)))


def dump(tag, rows):
    """只取「业务可读」的那几格（单号/条码/单位/数量/单价）—— 索引位置按表头对齐打印，不猜列名。
    刻意**不含**门店名之外的时间戳之类易变字段。"""
    for i, r in enumerate(rows):
        cells = list(r) if isinstance(r, (list, tuple)) else list(r.values())
        # 表头观察到的布局：0 单号 / 13 条码 / 14 单位 / 15 数量 / 16 单价
        pick = [cells[0], cells[13], cells[14], cells[15], cells[16]] if len(cells) > 16 else cells
        print('%s|%04d|%s' % (tag, i, '|'.join(str(x) for x in pick)))


dump('ZT', zt)
dump('DB', dbo)
print('# WARNINGS %d' % len(warns))
for w in warns:
    print('# W %s' % w)
