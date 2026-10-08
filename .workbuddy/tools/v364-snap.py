#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在生产机上对 tenant_1.db 做只读快照（VACUUM INTO 到 /tmp），供本地影子库验证用。
⚠️ 只读源库；只写 /tmp。不改生产任何数据。"""
import os
import sqlite3

SRC = "/opt/hergent-erp/tenant_1.db"
DST = "/tmp/v364-tenant1-snap.db"

if os.path.exists(DST):
    os.remove(DST)
# mode=ro 打开源库 —— 保证本脚本不可能改到生产数据
src = sqlite3.connect("file:%s?mode=ro" % SRC, uri=True)
src.execute("VACUUM INTO ?", (DST,))
src.close()

c = sqlite3.connect(DST)
print("快照 %s  %.1f KB" % (DST, os.path.getsize(DST) / 1024.0))
print("integrity:", c.execute("PRAGMA integrity_check").fetchone()[0])
print("品牌规则（快照基线）:")
for r in c.execute("SELECT id,scope_name,order_first_date,order_cadence_days,order_lead_days,"
                   "arrival_mode,arrival_cadence_days,arrival_weekdays,arrival_count_override,"
                   "target_value FROM rebate_target_rules WHERE is_active=1 ORDER BY id"):
    print("   ", tuple(r))
print("同表是否存在:", c.execute(
    "SELECT COUNT(*) FROM sqlite_master WHERE name='rebate_arrival_skips'").fetchone()[0])
c.close()
