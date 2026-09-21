#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 术语统一 pass-C：修盲替换制造的假话与污染。

pass-B 是纯字符串替换，必然产生三类副作用，本步逐条修回：
  ① **子串污染**：「出厂价」/「工厂价」里含「厂价」⇒ 被换成「出进价」/「工进价」；
  ② **引文被改**：用户原话引文「厂价就是进价」被改成「进价就是进价」（自反废话，且伪造了引文）；
  ③ **自反句**：「进价 ≠ 进价」「进价或进价」「(既不是标准售价、也不是进价)」等。
默认 dry-run；--apply 才落盘。每条都是**唯一子串**，命中数不为 1 即报错（不猜）。
"""
import io
import sys

APPLY = "--apply" in sys.argv
FE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/"
BE = "/Users/zhangjunfeng/Documents/hergent-erp/server/"
MP = "/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram/"

# (文件, 旧子串, 新子串, 期望命中数)
FIXES = [
    # ① 子串污染
    (FE + "pages/Forecast.vue", "出进价", "出厂价", -1),
    (BE + "routers/import_router.py", "出进价", "出厂价", -1),
    (BE + "routers/import_router.py", "工进价", "工厂价", -1),

    # ② 引文被改 —— 恢复用户原话，并注明 v224 起界面统一叫「进价」
    (FE + "pages/ProductArchive.vue",
     "（用户 2026-09-14 定调原话「进价就是进价」）。",
     "（用户 2026-09-14 定调原话「厂价就是进价」；v224 起界面统一叫「进价」）。", 1),
    (BE + "routers/forecast.py",
     "# v165：进价（用户口径「进价就是进价」）⇒ 新增中间档 purchase_rows；",
     "# v165：两列是同一个量（用户口径「厂价就是进价」；v224 起界面统一叫「进价」）⇒ 新增中间档 purchase_rows；", 1),
    (BE + "routers/forecast.py",
     "v165：进价（用户口径「进价就是进价」）⇒ 中间档取档案进价；fallback 只剩真缺价行。\"\"\"",
     "v165：两列是同一个量（用户口径「厂价就是进价」；v224 起界面统一叫「进价」）⇒ 中间档取档案进价；\n    fallback 只剩真缺价行。\"\"\"", 1),
    (BE + "db/queries/products.py",
     "# 🔴 业务口径（用户 2026-09-14 定调原话「进价就是进价」）：",
     "# 🔴 业务口径（用户 2026-09-14 定调原话「厂价就是进价」；v224 起界面统一叫「进价」）：", 1),

    # ③ 自反句
    (FE + "pages/ProductArchive.vue",
     "// 「待补进价」= 进价与进价**都没有**的启用商品（改前只看 factory_price ⇒ 真实租户 269 全中，",
     "// 「待补进价」= 连进价都没有的启用商品（改前只看 factory_price ⇒ 真实租户 269 全中，", 1),
    (FE + "pages/Forecast.vue",
     "v165：判据口径已改「进价 → 进价」（进价），故不再只看 factory_price 一列。 -->",
     "v165：判据口径已改「进价 → 标准售价」两档（原「厂价列 / 进价列」两列合一），故不再只看 factory_price 一列。 -->", 1),
    (FE + "pages/Forecast.vue",
     "<p v-else class=\"imp-arch-note\">本次导入的商品都有价（进价或进价），没有行被拒收。</p>",
     "<p v-else class=\"imp-arch-note\">本次导入的商品都有进价，没有行被拒收。</p>", 1),
    (FE + "pages/Forecast.vue",
     "（取档案的进价（原进价列优先，缺则取原进价列））不是同一个数：档案里「进价 ≠ 进价」的商品，",
     "（取档案的进价：原厂价列优先、缺则取原进价列）不是同一个数：档案里「原厂价列 ≠ 原进价列」的商品，", 1),
    (BE + "routers/data.py",
     "#   凡档案里「进价 ≠ 进价」的商品，预报页的「单价(进价/箱)」与报单金额都与后端算的对不上。",
     "#   凡档案里「原厂价列 ≠ 原进价列」的商品，预报页的「单价(进价/箱)」与报单金额都与后端算的对不上。", 1),

    # 舟谱映射表：盲替换后「进价」出现 3 次（后键覆盖前键，且「出厂价」被污染）⇒ 恢复原样并加注释
    (BE + "routers/import_router.py",
     'ZHOUPU_PRODUCT_MAP = {"商品名称":"name","规格":"spec","单位":"unit","条码":"barcode","品牌":"brand","分类":"category","进价":"purchase_price","进价":"factory_price","出进价":"factory_price","分销价":"dist_price","售价":"sale_price","安全库存":"safety_stock","保质期(天)":"expiry_days"}',
     "# 🔴 v224 起**界面**把 factory_price 叫「进价」，但本表是**舟谱导出格式的适配器**：\n"
     "#   舟谱自己的列名里，「进价」列进的是 purchase_price、「厂价」列进的是 factory_price ——\n"
     "#   这是第三方格式的既有语义，**不要**跟着界面改（改了 = 舟谱订单导入行为变更）。\n"
     'ZHOUPU_PRODUCT_MAP = {"商品名称":"name","规格":"spec","单位":"unit","条码":"barcode","品牌":"brand","分类":"category","进价":"purchase_price","厂价":"factory_price","出厂价":"factory_price","分销价":"dist_price","售价":"sale_price","安全库存":"safety_stock","保质期(天)":"expiry_days"}', 1),

    # 「【进价】…（既不是标准售价、也不是进价）」—— 自相矛盾，重写
    (BE + "routers/import_router.py",
     "\"【进价】厂家结算价，用于计算「本期需付款」（既不是标准售价、也不是进价）。\" + (",
     "\"【进价】厂家跟你结算的价，就是你的进货成本，用于计算「本期需付款」。\" + (", 1),
    (BE + "routers/import_router.py",
     "\"【进价是什么】厂家跟你结算的价（不是标准售价、也不是进价）；\"\n        \"「本期需付款 = 定稿量 × 进价」用的就是它。\",",
     "\"【进价是什么】厂家跟你结算的价，就是你的进货成本；\"\n        \"「本期需付款 = 定稿量 × 进价」用的就是它。\",", 1),
]

fail = 0
plan = []
# 🔴 必须**按文件累积**再写：同一文件的多条改动若各自基于原始内容计算、顺序落盘，
#    后一次写盘会覆盖前一次 ⇒ 只有最后一条生效（本脚本第一版就踩了这个坑）。
accum = {}
for path, old, new, expect in FIXES:
    try:
        src = accum.get(path) or io.open(path, encoding="utf-8").read()
    except Exception as e:
        print("!! 读不到 %s: %s" % (path, e))
        fail += 1
        continue
    n = src.count(old)
    # n == 0 = 该条已生效（脚本重跑），不算失败
    if expect >= 0 and n not in (0, expect):
        print("!! 命中数 %d（期望 %d）—— 不改：%s" % (n, expect, path.split("/")[-1]))
        print("     锚点: %s" % old[:110])
        fail += 1
        continue
    if n == 0:
        continue
    accum[path] = src.replace(old, new)
    plan.append((path, n, old[:80]))

plan_paths = sorted(set(p for p, _, _ in plan))
for path, n, anchor in plan:
    print("  %-40s ×%d  %s" % (path.split("/")[-1], n, anchor))
print("\n将改动文件 = %d   锚点失败 = %d" % (len(plan_paths), fail))

if fail:
    print("\n[ABORT] 有锚点不匹配，未写入任何文件。")
    sys.exit(1)

if APPLY:
    for path in plan_paths:
        io.open(path, "w", encoding="utf-8").write(accum[path])
    print("[APPLIED] %d 个文件" % len(plan_paths))
else:
    print("[DRY-RUN] 未写入。加 --apply 落盘。")
