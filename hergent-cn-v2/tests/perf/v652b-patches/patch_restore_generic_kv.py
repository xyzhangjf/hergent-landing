#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补回被误删的 GENERIC_KV_PAGES（上一次补丁把这块连同 COL_PREF_PAGES 一起替换掉了）。

只做**最小插入**：在白名单元组收尾的 `)` 之后、`_PAGE_LABEL` 之前插入常量定义。
幂等：已存在则跳过。
"""
import io
import sys

TARGET = "/opt/hergent-erp/db/queries/ui_prefs.py"
src = io.open(TARGET, encoding="utf-8").read()

if "GENERIC_KV_PAGES = " in src:
    print("NO_CHANGE 已存在")
    sys.exit(0)

anchor = '''    "settlement",  # 三张主表（有中文名）
)


# 页面 → 中文名'''
assert src.count(anchor) == 1, "锚点不唯一，停止（避免插错位置）"

block = '''    "settlement",  # 三张主表（有中文名）
)

# 「通用界面偏好」页面 —— 复用本端点存**单个偏好值**，不是列配置。
# 为什么不并进 `COL_PREF_PAGES`：那一组是"列顺序/可见性/冻结列"的宿主页，密度只有一个
# 枚举值，混进去会让「哪些页面有列配置」这份清单变味。分开放，但**同样受白名单保护**
# （page 是主键，放任任意字符串就会静默留下永远读不到的孤儿行）。
# 🩸 这条 400 曾静默了一整个版本周期：前端 `useDensity.js` 注释写着"该端点无白名单"，
#    后端却一直是白名单 —— 注释与实现不符时，**以代码为准，并立刻改注释**。
GENERIC_KV_PAGES = ("ui-density",)


# 页面 → 中文名'''

src = src.replace(anchor, block, 1)
io.open(TARGET, "w", encoding="utf-8").write(src)
print("INSERTED GENERIC_KV_PAGES")

sys.path.insert(0, "/opt/hergent-erp")
import importlib
import db.queries.ui_prefs as m
importlib.reload(m)
assert m.GENERIC_KV_PAGES == ("ui-density",)
assert m._ALLOWED_PAGES == tuple(m.COL_PREF_PAGES) + ("ui-density",)
assert m._clean_page("ui-density") == "ui-density"
pg = m.col_pref_pages()
assert len(pg) == len(m._ALLOWED_PAGES)
assert {"forecast", "purchase", "settlement"} <= {x["page"] for x in pg}
assert [x for x in pg if x["page"] == "forecast"][0]["label"] == "预报订单汇总表"
for key in ("CUSTOMER-ARCHIVE", "INV-SALE-LIST", "price-channels-matrix", "bid-radar", "loss-workflow"):
    assert m._clean_page(key) == key, key
for bad in ("", None, "purchse", "UI-DENSITY"):
    try:
        m._clean_page(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("非法 page %r 通过了白名单" % (bad,))
print("SELFCHECK_OK allowed=%d pages=%d labels=%d"
      % (len(m._ALLOWED_PAGES), len(pg), sum(1 for x in pg if x["label"] != x["page"])))
