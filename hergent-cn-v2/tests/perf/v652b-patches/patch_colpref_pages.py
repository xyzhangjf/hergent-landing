#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v652b 修复：`ui_col_prefs` 白名单与前端实际用到的 page 键不同步

现场证据（tenant_1.db 的 `ui_col_prefs` 全表 17 行）：
    INV-SALE-LIST / INV-SALE-RETURN-LIST / INV-TRANSFER-LIST / PRODUCT-ARCHIVE /
    REPORT-MAPPING / inv-purchase-detail-goods / inv-purchase-detail-inbound /
    inv-sale-new / inv-stock / inv-transfer-new / price-channels-cust /
    price-channels-matrix / purchase-new / purchase-return-new / ui-density …
而 `COL_PREF_PAGES` 只有 `("forecast","purchase","settlement")`。
⇒ **15 个页面的列可见性云端同步一直在 400**（`pull()` 报 offline ⇒ 沿用本地）：
  这些页面上「换设备/换浏览器，列设置就丢」这个本该被修掉的问题至今仍在发生。
  表现极隐蔽 —— 前端只 `console.warn`，界面上什么都不显示。

本次做三件事（都不改行为路径，只让白名单与事实一致）：
  1. `COL_PREF_PAGES` 补全为**前端代码里真实出现**的全部 page 键（26 个，逐字保留大小写：
     前端既有 `INV-SALE-LIST` 也有 `inv-stock`，大小写不一致是历史事实，不能"统一"掉）；
  2. `col_pref_pages()` 改为返回**全部可用页面**（原来只回三页，等于对外撒谎 ——
     它的 docstring 写着"返回全部受支持的页面"）；
  3. 白名单本身**保留**：`page` 是主键，拼错会留下永远读不到的孤儿行，
     所以仍要把"拼错"变成当场的 400。只是名单得跟代码对齐。

幂等：重复执行无副作用。
"""
import io
import sys

TARGET = "/opt/hergent-erp/db/queries/ui_prefs.py"

# 前端 `src/**/*.{vue,js}` 里 `useColSettings('<key>'` / `useColPrefs('<key>'` 的全部实参
# （由本机 grep 抽取，见交付说明；`customer-archive` 只出现在 useColSettings 的注释示例里，不计入）
FRONTEND_KEYS = [
    "CUSTOMER-ARCHIVE", "INV-SALE-LIST", "INV-SALE-RETURN-LIST", "INV-TRANSFER-LIST",
    "PRODUCT-ARCHIVE", "REPORT-MAPPING", "bid-radar", "forecast", "forecast-history",
    "inv-purchase-detail-goods", "inv-purchase-detail-inbound", "inv-sale-detail",
    "inv-sale-new", "inv-stock", "inv-transfer-new", "loss-accounting", "loss-workflow",
    "payroll-workflow", "price-channels-cust", "price-channels-matrix", "product-target",
    "purchase", "purchase-new", "purchase-return-new", "rebate-achv", "rebate-rules",
]
# `settlement` 当前前端已无调用（InvPurchaseSettle 已下线），但库里可能有存量行 ⇒ 保留
LEGACY_KEYS = ["settlement"]

ALL_PAGES = sorted(set(FRONTEND_KEYS) | set(LEGACY_KEYS))

src = io.open(TARGET, encoding="utf-8").read()
orig = src

# ---------- 1) 重建白名单块 ----------
start_marker = 'COL_PREF_PAGES = ("forecast", "purchase", "settlement")'
i = src.find(start_marker)
assert i >= 0, "找不到 COL_PREF_PAGES 原定义，停止"
j = src.find("GENERIC_KV_PAGES = (", i)
assert j > i, "找不到 GENERIC_KV_PAGES，停止"
k = src.find("\n", src.find(")", j)) + 1

lines = []
lines.append("# 允许持久化的页面 —— **白名单**，不是后缀校验。")
lines.append("# 为什么必须白名单：page 是主键。前端一次拼错（`purchse`）就会在库里静默留下一行")
lines.append("# **永远读不到**的孤儿配置（不报错、不影响功能，只在将来没人说得清那行是什么）。")
lines.append("# 白名单把这类错误变成**当场的 400**。")
lines.append("#")
lines.append("# 🔴 2026-10-23 修：本名单原先只有 forecast/purchase/settlement 三页，而前端实际有")
lines.append("# 26 个页面在调本端点存列可见性 ⇒ 另外 15 个页面的云端同步**一直在 400**，")
lines.append("# 只是前端仅 console.warn、界面上毫无提示，所以「换设备列设置就丢」到现在才被发现。")
lines.append("# 教训：白名单本身没错，**错在没跟代码同步**。新增页面时务必在这里登记（见下方自检脚本）。")
lines.append("#")
lines.append("# ⚠️ 大小写不一致是**历史事实**（`INV-SALE-LIST` 与 `inv-stock` 并存）：这些字符串是")
lines.append("# 主键、也是前端实参，改大小写等于把存量配置变成孤儿。原样保留，别顺手统一。")
lines.append("COL_PREF_PAGES = (")
for key in ALL_PAGES:
    label = ""
    if key in ("forecast", "purchase", "settlement"):
        label = "  # 三张主表（有中文名）"
    lines.append('    "%s",%s' % (key, label))
lines.append(")")
lines.append("")

new_block = "\n".join(lines) + "\n"
src = src[:i] + new_block + src[k:]

# ---------- 2) _clean_page 校验合并两组 ----------
old = '''    if p not in COL_PREF_PAGES and p not in GENERIC_KV_PAGES:
        raise ValueError("未知的页面「%s」，仅支持：%s"
                         % (p, " / ".join(COL_PREF_PAGES + GENERIC_KV_PAGES)))
    return p'''
new = '''    if p not in _ALLOWED_PAGES:
        raise ValueError("未知的页面「%s」，仅支持本模块登记过的页面（共 %d 个）。"
                         "新增页面需在后端 db/queries/ui_prefs.py 的 COL_PREF_PAGES 里登记 —— "
                         "白名单是为了让拼错的 page 当场报错，而不是静默留下读不到的孤儿行。"
                         % (p, len(_ALLOWED_PAGES)))
    return p'''
assert src.count(old) == 1, "_clean_page 校验块锚点不唯一，停止"
src = src.replace(old, new, 1)

# ---------- 3) 校验用的合并常量（放在 _clean_page 之前） ----------
anchor = "def _ensure(conn):"
assert src.count(anchor) == 1, "_ensure 锚点不唯一"
src = src.replace(
    anchor,
    '# 校验用：列配置页面 + 通用偏好 KV（后者存单个偏好值，不是列配置）。\n'
    '# 两者都参与校验；`col_pref_pages()` 也如实把两组都列出来（对外说"全部受支持"）。\n'
    '_ALLOWED_PAGES = COL_PREF_PAGES + GENERIC_KV_PAGES\n\n\n' + anchor,
    1)

# ---------- 4) col_pref_pages() 如实返回全部 ----------
old_pages = '''def col_pref_pages():
    """返回全部受支持的页面（含中文名），供前端渲染/自检核对。"""
    return [{"page": k, "label": _PAGE_LABEL.get(k, k)} for k in COL_PREF_PAGES]'''
new_pages = '''def col_pref_pages():
    """返回**全部**受支持的页面（含中文名），供前端渲染/自检核对。

    🔴 2026-10-23 修：原来只回 `COL_PREF_PAGES` 三页，而实际可用 27 个 —— 名字叫"全部"
       却只回三页，等于对外撒谎，也让人误以为"只有三页会同步"。现按 `_ALLOWED_PAGES` 全量返回。
       没有中文名的键直接回落成键名（`_PAGE_LABEL.get(k, k)`），不编造。
    """
    return [{"page": k, "label": _PAGE_LABEL.get(k, k)} for k in _ALLOWED_PAGES]'''
assert src.count(old_pages) == 1, "col_pref_pages 锚点不唯一，停止"
src = src.replace(old_pages, new_pages, 1)

if src == orig:
    print("NO_CHANGE")
    sys.exit(0)

io.open(TARGET, "w", encoding="utf-8").write(src)
print("PATCHED %s" % TARGET)

# ---------- 自检 ----------
sys.path.insert(0, "/opt/hergent-erp")
import importlib
import db.queries.ui_prefs as m
importlib.reload(m)

assert m._ALLOWED_PAGES == tuple(m.COL_PREF_PAGES) + tuple(m.GENERIC_KV_PAGES), "合并常量不一致"
for key in FRONTEND_KEYS:
    assert m._clean_page(key) == key, "前端在用的 page 键 %r 仍未通过校验" % key
assert m._clean_page("ui-density") == "ui-density"
assert m._clean_page(" settlement ") == "settlement", "strip 行为被破坏"
assert m._clean_page("forecast ") == "forecast", "strip 行为被破坏"
for bad in ("", None, "purchse", "UI-DENSITY", "../etc/passwd"):
    try:
        m._clean_page(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("非法 page %r 竟然通过了（白名单被放宽）" % (bad,))

pg = m.col_pref_pages()
assert len(pg) == len(m._ALLOWED_PAGES), "pages 清单长度与白名单不一致"
assert {"forecast", "purchase", "settlement"} <= {x["page"] for x in pg}, "三张主表丢失"
assert all(x["label"] for x in pg), "存在空 label"
assert [x for x in pg if x["page"] == "forecast"][0]["label"] == "预报订单汇总表", "中文名丢失"
print("SELFCHECK_OK allowed=%d pages=%d 前端键=%d 非法输入仍 400"
      % (len(m._ALLOWED_PAGES), len(pg), len(FRONTEND_KEYS)))
