# -*- coding: utf-8 -*-
"""v233 P2-2/P2-3 影响试算：对（**副本**）库逐行比对模板行「*单位 / *数量」的新旧口径。

跑的是**真身函数**（`routers.forecast::_resolve_template_unit` / `_align_row_unit`），
不是复制一份逻辑 —— 复制就成了「第三份实现」，改一处不生效。

用法（**只对副本库**，绝不指向生产）：
    ERP_DB_PATH=/tmp/v233-dryrun/erp.db ERP_SECRET=<占位串> \
        python3 v233-template-unit-impact.py --tenant 1

输出：
  · 新旧口径**逐行**比对结果（一致 / 单位变 / 数量变 / 换算失败）
  · 单位会变的商品清单（前 40 条）

判据：`order_unit` **全空**（未回填）时，结论必须是「N 行全部一致」= **存量零变化**。
"""
import os
import sys

SRV = '/Users/zhangjunfeng/Documents/hergent-erp/server'
sys.path.insert(0, SRV)

TID = 1
for i, a in enumerate(sys.argv):
    if a == '--tenant' and i + 1 < len(sys.argv):
        TID = int(sys.argv[i + 1])

import erp_db as db                                    # noqa: E402
import routers.forecast as F                           # noqa: E402

db.set_tenant_context(TID)

with db.get_db() as conn:
    rows = conn.execute(
        "SELECT i.product_id pid, i.product_name pname, i.unit dunit, "
        "       MAX(i.quantity) qty, "
        "       p.name mname, p.spec, p.unit punit, p.order_unit, p.medium_unit, "
        "       p.medium_ratio, p.large_unit, p.large_ratio, p.barcode "
        "FROM forecast_submission_items i LEFT JOIN products p ON p.id=i.product_id "
        "WHERE TRIM(COALESCE(i.unit,'')) != '' "
        "GROUP BY i.product_id, i.product_name, i.unit "
        "ORDER BY i.product_id").fetchall()

unit_map = db.forecast_barcode_units_map()
print('租户 tenant_%d：明细去重后 %d 行；条码人工层 %d 条' % (TID, len(rows), len(unit_map)))

# 回填状态
n_ou = sum(1 for r in rows if str(r['order_unit'] or '').strip())
print('其中 `products.order_unit` 非空的行 = %d %s'
      % (n_ou, '（已回填）' if n_ou else '（**未回填** ⇒ 期望「存量零变化」）'))

same = unit_chg = qty_chg = failed = 0
lines = []
for r in rows:
    pid = int(r['pid'] or 0)
    dunit = str(r['dunit'] or '').strip()
    bc = F._fmt_barcode(r['barcode'])
    arc = {'name': r['mname'], 'spec': r['spec'], 'unit': r['punit'],
           'order_unit': r['order_unit'], 'medium_unit': r['medium_unit'],
           'medium_ratio': r['medium_ratio'], 'large_unit': r['large_unit'],
           'large_ratio': r['large_ratio']}
    qty = F._fmt_qty(r['qty'])

    # 旧口径（v233 之前）：条码人工层 > 明细单位 > 名称推断；**数量从不换算**
    u_old = str(unit_map.get(bc) or '').strip() or dunit or F._guess_unit(r['pname'])
    q_old = qty

    u_new, src = F._resolve_template_unit(bc, dunit, r['pname'], arc, unit_map)
    ustat = F._new_unit_stat()
    u_new, q_new = F._align_row_unit(u_new, qty, dunit, arc, ustat)

    if ustat['fail']:
        # 🔴 这一档**不是失败**，是**设计内的降级分支**（v233 的核心安全阀）。
        #   旧口径在这类行上会「只换标签不换数」（v217 那个错误的镜像）——
        #   所以新旧不一致**恰恰说明修对了**，而不是漂移。
        #   ⚠️ 曾把本档标成 'FAIL' ⇒ 复跑时误读成「107 行里 2 行不一致」＝回归。
        #      故标签改为 DEGR，并在末尾单独解释。
        failed += 1
        tag = 'DEGR'
    elif u_new == u_old and q_new == q_old:
        same += 1
        tag = 'same'
    elif u_new != u_old:
        unit_chg += 1
        tag = 'UNIT'
    else:
        qty_chg += 1
        tag = 'QTY '
    if tag != 'same':
        lines.append('  %s pid=%-6s %-28s %s/%s → %s/%s  (src=%s, 档案=%s spec=%s)' % (
            tag, pid, str(r['mname'] or r['pname'])[:28], u_old, q_old,
            u_new, q_new, src, str(r['punit'] or ''), str(r['spec'] or '')[:14]))

print()
print('=' * 96)
print('逐行比对（新旧口径）')
print('=' * 96)
for s in lines[:40]:
    print(s)
if len(lines) > 40:
    print('  … 另有 %d 条' % (len(lines) - 40))
print()
print('  完全一致        : %d' % same)
print('  单位变化        : %d' % unit_chg)
print('  仅数量变化      : %d' % qty_chg)
print('  换算失败(降级)  : %d' % failed)
print('  合计            : %d' % (same + unit_chg + qty_chg + failed))
if same == len(rows):
    print()
    print('  ⇒ **存量零变化**（未回填 `order_unit` 时新口径与旧口径逐行相同）')
if failed:
    print()
    print('  ⚠️ DEGR = **设计内降级**，不是失败：这些行的「明细单位 vs 报单单位」不一致、')
    print('     且**换算比求不出来**（无中/大单位换算，规格串又定位不到单位）⇒ 新口径')
    print('     **保持明细单位与数量原样**输出并在下载告警里点名。旧口径在这类行上会')
    print('     「只换标签不换数」（v217 那个错误的镜像）⇒ 新旧不一致 = **修对了**。')
    print('     要让这些行走「按档案换算」，需在商品档案里补中/大单位换算或规格。')
