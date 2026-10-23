"""去掉模块级常量 `_ALLOWED_PAGES`，改为就地拼接（按行处理，避免块边界对不上）。

为什么：`tools/v411-p24-colprefs/probe_p24.py` 这类自检是 **exec 源码片段**跑的
（只保留 `_KEEP` 里的函数 + 模块级赋值，不做真 import）。新增模块级常量会让这类脚本
在 `_clean_page` 里撞 `NameError` —— 生产不受影响，但把既有自检打成红不该做，
而且以后还会有人用同样方式拼装这个模块。

内联开销可忽略（两个小元组拼接，每请求一次）。
⚠️ 别"优化"回模块级常量，除非同时把这些自检脚本的 `_KEEP` 一起改。
"""
import io
import re
import sys

TARGET = "/opt/hergent-erp/db/queries/ui_prefs.py"
lines = io.open(TARGET, encoding="utf-8").read().split("\n")
orig = list(lines)

# ---- 1) 删掉常量定义 + 紧邻的两行注释 + 其后多余空行（保留两行标准间距） ----
idx = None
for i, ln in enumerate(lines):
    if ln.startswith("_ALLOWED_PAGES = "):
        idx = i
        break
if idx is not None:
    start = idx
    # 往上吃掉紧邻的注释行
    while start - 1 >= 0 and lines[start - 1].startswith("#"):
        start -= 1
    end = idx + 1
    # 往下吃掉多余空行，之后补回正好两个空行（模块级：定义与 def 之间）
    while end < len(lines) and lines[end].strip() == "":
        end += 1
    lines = lines[:start] + ["", ""] + lines[end:]

src = "\n".join(lines)

# ---- 2) _clean_page 内联 ----
src = src.replace("    if p not in _ALLOWED_PAGES:",
                  "    if p not in COL_PREF_PAGES and p not in GENERIC_KV_PAGES:", 1)
src = src.replace("                         % (p, len(_ALLOWED_PAGES)))",
                  "                         % (p, len(COL_PREF_PAGES) + len(GENERIC_KV_PAGES)))", 1)

# ---- 3) col_pref_pages 内联 + docstring 对齐事实（27→28，且不再提常量名） ----
src = src.replace(
    "    🔴 2026-10-23 修：原来只回 `COL_PREF_PAGES` 三页，而实际可用 27 个 —— 名字叫\"全部\"\n"
    "       却只回三页，等于对外撒谎，也让人误以为\"只有三页会同步\"。现按 `_ALLOWED_PAGES` 全量返回。\n",
    "    🔴 2026-10-23 修：原来只回 `COL_PREF_PAGES` 三页，而实际可用 28 个（27 个列配置页 + 界面密度）\n"
    "       —— 名字叫\"全部\"却只回三页，等于对外撒谎，也让人误以为\"只有三页会同步\"。\n"
    "       现按「两组白名单之和」全量返回。\n", 1)
src = src.replace(
    '    return [{"page": k, "label": _PAGE_LABEL.get(k, k)} for k in _ALLOWED_PAGES]',
    '    return [{"page": k, "label": _PAGE_LABEL.get(k, k)}\n'
    '            for k in COL_PREF_PAGES + GENERIC_KV_PAGES]', 1)

if "_ALLOWED_PAGES" in src:
    for i, ln in enumerate(src.split("\n"), 1):
        if "_ALLOWED_PAGES" in ln:
            print("残留 line %d: %s" % (i, ln))
    raise SystemExit("仍有 _ALLOWED_PAGES 残留，停止")

if src == "\n".join(orig):
    print("NO_CHANGE")
    sys.exit(0)

io.open(TARGET, "w", encoding="utf-8").write(src)
print("PATCHED 去掉 _ALLOWED_PAGES")

sys.path.insert(0, "/opt/hergent-erp")
import importlib
import db.queries.ui_prefs as m
importlib.reload(m)
assert not hasattr(m, "_ALLOWED_PAGES")
assert m._clean_page("ui-density") == "ui-density"
assert m._clean_page("INV-SALE-LIST") == "INV-SALE-LIST"
assert m._clean_page(" forecast ") == "forecast"
pg = m.col_pref_pages()
assert len(pg) == len(m.COL_PREF_PAGES) + len(m.GENERIC_KV_PAGES) == 28, len(pg)
assert [x for x in pg if x["page"] == "forecast"][0]["label"] == "预报订单汇总表"
try:
    m._clean_page("purchse")
except ValueError as e:
    assert "登记" in str(e), "错误信息应含下一步动作"
else:
    raise SystemExit("拼错竟然通过")
print("SELFCHECK_OK pages=%d" % len(pg))
