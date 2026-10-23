"""合并回**单一白名单**：把 `ui-density` 并入 `COL_PREF_PAGES`，删掉 `GENERIC_KV_PAGES`。

起因：`tools/v411-p24-colprefs/probe_p24.py` 是 **exec 源码片段**跑的（只保留 `_KEEP` 里的
函数和已被它认识的模块级名字）。新加 `GENERIC_KV_PAGES` 这种模块级常量，在生产 import 下没事，
但在那类自检里就是 `NameError` —— 等于给"用 exec 拼装本模块"的所有脚本埋雷。

那就不加常量：`col_pref_pages()` 本来就如实返回全部页面（含 ui-density），
分两组已经不带来任何行为差异，只多一个漏点。**单一白名单 = 单一真源。**

顺带给 `ui-density` 补中文名（错误提示/日志说人话）。
"""
import io
import sys

TARGET = "/opt/hergent-erp/db/queries/ui_prefs.py"
src = io.open(TARGET, encoding="utf-8").read()
orig = src

# ---- 1) 删掉 GENERIC_KV_PAGES 定义块（含其上注释） ----
lines = src.split("\n")
idx = None
for i, ln in enumerate(lines):
    if ln.startswith("GENERIC_KV_PAGES = "):
        idx = i
        break
if idx is not None:
    start = idx
    while start - 1 >= 0 and lines[start - 1].startswith("#"):
        start -= 1
    end = idx + 1
    while end < len(lines) and lines[end].strip() == "":
        end += 1
    lines = lines[:start] + lines[end:]
src = "\n".join(lines)

# ---- 2) 把 ui-density 并入白名单（放在元组末尾，单独一行 + 说明） ----
old_tail = '    "settlement",  # 三张主表（有中文名）\n)'
new_tail = ('    "settlement",  # 三张主表（有中文名）\n'
            '    # 界面密度（紧凑/宽松）：存在这里的不是"列配置"，而是单个枚举值 `{density}`。\n'
            '    # 复用本端点是刻意的（不为一个布尔偏好单开接口），但 page 键**同样要登记** ——\n'
            '    # 不登记就是 400，而前端只 console 留痕、界面无感，2026-10 之前就因此静默失效过。\n'
            '    "ui-density",\n'
            ')')
assert src.count(old_tail) == 1, "白名单元组尾部锚点不唯一"
src = src.replace(old_tail, new_tail, 1)

# ---- 3) 内联处改回单一白名单 ----
src = src.replace("    if p not in COL_PREF_PAGES and p not in GENERIC_KV_PAGES:",
                  "    if p not in COL_PREF_PAGES:", 1)
src = src.replace("                         % (p, len(COL_PREF_PAGES) + len(GENERIC_KV_PAGES)))",
                  "                         % (p, len(COL_PREF_PAGES)))", 1)
src = src.replace("    return [{\"page\": k, \"label\": _PAGE_LABEL.get(k, k)}\n"
                  "            for k in COL_PREF_PAGES + GENERIC_KV_PAGES]",
                  "    return [{\"page\": k, \"label\": _PAGE_LABEL.get(k, k)} for k in COL_PREF_PAGES]", 1)

# ---- 4) 补中文名 ----
src = src.replace('    "settlement": "采购结算单列表",\n}',
                  '    "settlement": "采购结算单列表",\n    "ui-density": "界面密度",\n}', 1)

# ---- 5) docstring 里"两组"的说法改掉 ----
src = src.replace("现按「两组白名单之和」全量返回。", "现按白名单全量返回。", 1)
src = src.replace("实际可用 28 个（27 个列配置页 + 界面密度）", "实际可用 28 个（27 个列配置页 + 界面密度）", 1)

if "GENERIC_KV_PAGES" in src:
    for i, ln in enumerate(src.split("\n"), 1):
        if "GENERIC_KV_PAGES" in ln:
            print("残留 line %d: %s" % (i, ln))
    raise SystemExit("仍有 GENERIC_KV_PAGES 残留，停止")
if src == orig:
    print("NO_CHANGE")
    sys.exit(0)

io.open(TARGET, "w", encoding="utf-8").write(src)
print("PATCHED 合并为单一白名单")

sys.path.insert(0, "/opt/hergent-erp")
import importlib
import db.queries.ui_prefs as m
importlib.reload(m)
assert not hasattr(m, "GENERIC_KV_PAGES"), "常量应已移除"
assert not hasattr(m, "_ALLOWED_PAGES"), "不该有 _ALLOWED_PAGES"
assert len(m.COL_PREF_PAGES) == 28, len(m.COL_PREF_PAGES)
assert len(set(m.COL_PREF_PAGES)) == 28, "有重复项"
for k in ("ui-density", "forecast", "INV-SALE-LIST", "inv-stock", "PRODUCT-ARCHIVE"):
    assert m._clean_page(k) == k, k
assert m._clean_page(" forecast ") == "forecast"
pg = m.col_pref_pages()
assert len(pg) == 28 and all(x["label"] for x in pg)
assert [x for x in pg if x["page"] == "ui-density"][0]["label"] == "界面密度"
try:
    m._clean_page("purchse")
except ValueError as e:
    assert "登记" in str(e)
else:
    raise SystemExit("拼错竟然通过")
print("SELFCHECK_OK pages=%d labels=%d" % (len(pg), sum(1 for x in pg if x["label"] != x["page"])))
