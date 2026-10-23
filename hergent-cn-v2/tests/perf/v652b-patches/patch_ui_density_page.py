#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v652 修复：/api/ui/col-prefs?page=ui-density 恒 400

根因：`db/queries/ui_prefs.py` 的 `_clean_page` 只认 `COL_PREF_PAGES`（三页列配置），
      而前端 `useDensity.js` 用同一端点的 `page=ui-density` 存「界面密度」偏好
      ⇒ 每次进预报页都 400，密度云端同步从未成功（一直静默回落 localStorage）。

为什么不直接把 ui-density 加进 COL_PREF_PAGES：
  ① `col_pref_pages()` 只回「列配置页面」，被 `probe_p24.py:369` 断言为三页；
  ② 语义不同：三页存的是列顺序/可见性/冻结列，密度是单个枚举值，不该出现在
     「哪些页面有列配置」的清单里。
⇒ 另开一组 `GENERIC_KV_PAGES`：**可读写、但不进页面清单**。
   白名单仍在（`page` 是主键，放任任意串会留孤儿行），只是分成两类。

幂等：重复执行不会重复插入。
"""
import io
import re
import sys

TARGET = "/opt/hergent-erp/db/queries/ui_prefs.py"

src = io.open(TARGET, encoding="utf-8").read()
orig = src

# ---- 1) 在 COL_PREF_PAGES 之后插入 GENERIC_KV_PAGES ----
anchor = 'COL_PREF_PAGES = ("forecast", "purchase", "settlement")\n'
assert src.count(anchor) == 1, "锚点 COL_PREF_PAGES 出现次数不为 1，停止（避免改错）"

insert = anchor + '''
# 「通用界面偏好」页面 —— 复用本端点存**单个偏好值**，不是列配置。
# 为什么另开一组而不是塞进 `COL_PREF_PAGES`：
#   ① `col_pref_pages()` 的语义是「哪些页面有列配置」，密度不该出现在那份清单里
#      （历史自检 `tools/v411-p24-colprefs/probe_p24.py` 也断言它是三页）；
#   ② 仍必须是**白名单**：`page` 是主键，放任任意字符串就会静默留下永远读不到的孤儿行。
# 🩸 这条 400 曾经静默了整整一个版本周期：前端 `useDensity.js` 写着"该端点无白名单"，
#    而后端有 —— 注释与实现对不上时，**以代码为准并立刻改注释**。
GENERIC_KV_PAGES = ("ui-density",)
'''
if "GENERIC_KV_PAGES = " not in src:
    src = src.replace(anchor, insert, 1)

# ---- 2) _clean_page 的校验并入两组白名单 ----
old_check = '''    if p not in COL_PREF_PAGES:
        raise ValueError("未知的页面「%s」，仅支持：%s"
                         % (p, " / ".join(COL_PREF_PAGES)))
    return p'''
new_check = '''    if p not in COL_PREF_PAGES and p not in GENERIC_KV_PAGES:
        raise ValueError("未知的页面「%s」，仅支持：%s"
                         % (p, " / ".join(COL_PREF_PAGES + GENERIC_KV_PAGES)))
    return p'''
assert src.count(old_check) == 1, "锚点 _clean_page 校验块出现次数不为 1，停止"
src = src.replace(old_check, new_check, 1)

if src == orig:
    print("NO_CHANGE 已是目标状态")
    sys.exit(0)

io.open(TARGET, "w", encoding="utf-8").write(src)
print("PATCHED %s" % TARGET)

# ---- 3) 自检：三页清单没被污染 + 新页面可通过校验 ----
sys.path.insert(0, "/opt/hergent-erp")
import importlib
import db.queries.ui_prefs as m
importlib.reload(m)
assert m.col_pref_pages() and len(m.col_pref_pages()) == 3, "col_pref_pages 仍应是三页，实际 %r" % (m.col_pref_pages(),)
assert [x["page"] for x in m.col_pref_pages()] == ["forecast", "purchase", "settlement"], "页面清单被改动"
assert m._clean_page("ui-density") == "ui-density", "ui-density 未通过校验"
assert m._clean_page(" forecast ") == "forecast", "既有页面 strip 行为被破坏"
for bad in ("", None, "purchse", "UI-DENSITY"):
    try:
        m._clean_page(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("非法 page %r 竟然通过了校验（白名单被放宽）" % (bad,))
print("SELFCHECK_OK pages=%d ui-density=OK 非法输入仍 400" % len(m.col_pref_pages()))
