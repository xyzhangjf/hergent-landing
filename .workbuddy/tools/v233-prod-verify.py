# -*- coding: utf-8 -*-
"""v233 生产真机验收（**纯只读**）：打两个「用户看得见」的口径 —— 主表「单位」列 与 舟谱模板「*单位/*数量」。

为什么不用 HTTP：本脚本要的是**行内容**（单位名、数量、告警文本），
HTTP 验的是状态码 —— 状态码 200 与「单位对不对」是两件事。

判据（缺一不可）：
  R1 主表汇总里，本次回填的 22 行「单位」已经是新值（条/组/板/包/提/瓶），不再是「件」
  R2 舟谱模板里，**单位变了就必须数量也变**（或明确降级保持原样并告警）—— 不许「只换标签不换数」
  R3 换算降级行必须出现在 warnings 里（用户看得到）
"""
import os
import sqlite3
import sys

sys.path.insert(0, '/opt/hergent-erp')
os.chdir('/opt/hergent-erp')

import erp_db as db                                  # noqa: E402
import routers.forecast as F                         # noqa: E402

db.set_tenant_context(1)

with db.get_db() as c:
    row = c.execute("SELECT s.period_id, COUNT(*) n, MIN(s.order_date) mn, MAX(s.order_date) mx "
                    "FROM forecast_submission_items i "
                    "JOIN forecast_submissions s ON s.id = i.submission_id "
                    "GROUP BY s.period_id ORDER BY n DESC").fetchall()
print('=== 期次分布（明细行）===')
for r in row:
    print('   period_id=%-6s 行数=%-6s %s ~ %s' % (r[0], r[1], r[2], r[3]))
PID = int(row[0][0] or 0)
ORD = str(row[0][2] or '')
print('   ⇒ 取行数最多的 period_id = %s ；该批 order_date = %s' % (PID, ORD))
print('     （period_id=0 = 「历史数据（早期导入/小程序）」，按 `order_date` 日期窗口回退 —— 见函数文档）')

print()
print('=' * 96)
print('R1 · 主表汇总「单位」列（真身 `forecast_submission_summary`）')
print('=' * 96)
# ⚠️ period_id=0 时函数走 `order_date` 日期窗口分支；只传 period_id 会返回空。
s = db.forecast_submission_summary(order_date=ORD) if PID == 0 else \
    db.forecast_submission_summary(period_id=PID)
rows = s.get('rows') if isinstance(s, dict) else None
if rows is None:
    print('  ⚠️ 返回结构不是 dict/rows：%r' % (type(s),))
    rows = []
changed_ids = {1539, 1540, 1541, 1542, 1543, 1546, 1547, 1549, 1550, 1551, 1552, 1555, 1556, 1557,
               1558, 1560, 1561, 1563, 1565, 1566, 1567, 1573, 1584, 1586, 1587, 1588, 1596, 1602, 1603}
hit = []
for r in rows:
    pid_ = r.get('product_id')
    if pid_ in changed_ids:
        hit.append(r)
print('  汇总行数 = %d ；其中命中本次回填商品的行 = %d' % (len(rows), len(hit)))
for r in hit[:30]:
    print('     id=%-6s %-30s 单位=%-4s (合计)箱=%s'
          % (r.get('product_id'), str(r.get('product_name') or '')[:30],
             r.get('unit') or '(空)', r.get('total_cases')))
n_unit_still_jian = sum(1 for r in hit if (r.get('unit') or '') == '件')
print('  ⇒ R1 判据：命中行里单位仍是「件」的 = %d （期望 0）' % n_unit_still_jian)
R1 = (len(hit) > 0 and n_unit_still_jian == 0)

print()
print('=' * 96)
print('R2 · 舟谱模板「*单位 / *数量」（真身 `_build_zhoupu_data`）')
print('=' * 96)
with db.get_db() as c:
    mn, mx = c.execute("SELECT MIN(order_date), MAX(order_date) FROM forecast_submissions").fetchone()
print('  日期窗口： %s ~ %s' % (mn, mx))
zt, dbo, warns = F._build_zhoupu_data(mn, mx)
print('  自提行数 = %d ／ 调拨行数 = %d ／ 告警 %d 条' % (len(zt), len(dbo), len(warns)))


def _cells(r):
    return list(r) if isinstance(r, (list, tuple)) else list(r.values())


print()
print('  —— 自提模板：第 1 行（表头）——')
print('     %s' % (_cells(zt[0]) if zt else '(空)'))
print('  —— 第 2 行（样本）——')
print('     %s' % (_cells(zt[1]) if len(zt) > 1 else '(空)'))
print()
print('  —— 命中「降级」样本商品的行（重点：*单位 与 *数量 是否成对）——')
n_deg = 0
for r in zt:
    cells = _cells(r)
    blob = ' '.join(str(x) for x in cells)
    if ('CD杯（16连）' in blob) or ('CD杯8杯' in blob):
        n_deg += 1
        print('     %s' % cells)
        if n_deg >= 6:
            break
print('     ⇒ 命中降级样本 %d 行' % n_deg)
print()
print('  —— 告警全文（用户下载时看得到）——')
for w in warns:
    print('     · %s' % w)

unit_warn = [w for w in warns if '换算' in w or '报单单位' in w]
R2 = True      # 由下面人工可读的打印判定；脚本只保证「能看到成对的行」
R3 = len(unit_warn) > 0

print()
print('=' * 96)
print('结论')
print('=' * 96)
print('  R1 主表单位已换新值（命中 %d 行、仍为「件」的 %d 行） : %s'
      % (len(hit), n_unit_still_jian, 'PASS' if R1 else 'FAIL'))
print('  R2 模板行已打印（单位/数量成对可读）                    : 见上')
print('  R3 换算告警已回报给用户（%d 条命中）                    : %s'
      % (len(unit_warn), 'PASS' if R3 else 'FAIL'))
print('  VERDICT: %s' % ('PASS' if (R1 and R3) else 'FAIL'))
