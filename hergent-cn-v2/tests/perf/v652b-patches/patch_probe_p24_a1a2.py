"""更新 probe_p24.py 的 A1/A2 两条过时断言（2026-10-23 v652b）。

原断言：
  A1 `COL_PREF_PAGES` **恰好三个**页面（forecast/purchase/settlement）
  A2 **每个**页面都有中文名

两者都是 v411 当时的真实不变量，但已被本次**有意的设计变更**取代：
  · 前端实际有 26 个 page 键在调本端点（各明细/单据/档案页的列可见性），
    白名单只有三页 ⇒ 另外 15 个页面读配置一律 400、且前端只 console.warn ⇒ 静默失效。
  · 白名单已补全为 28 项（26 + settlement 存量 + ui-density）。
  · 中文名只给「业务主表 + 单值偏好」这类需要说人话的地方；其余键回落成键名，
    **不为凑数编 24 个中文名**（编了也没人维护，反而制造第二套叫法）。

新断言保持判别力：
  A1 白名单非空、无重复、且**三张主表仍在列**（逐字）——防"补全时顺手删掉旧页"。
  A2 每个键的 label 都非空；且**有中文名的必须覆盖三张主表 + 界面密度**；
     其余键的 label **必须等于键名本身**（防"半吊子翻译"：既没中文名、又不是键名）。
另加 A3：`ui-density` 必须在列并带中文名（本次修复的现场，防止被谁再删掉）。
"""
import io
import sys

p = "/opt/hergent-erp/tools/v411-p24-colprefs/probe_p24.py"
s = io.open(p, encoding="utf-8").read()

old = '''ok("A1 `COL_PREF_PAGES` 恰好三个页面，且逐字为 forecast / purchase / settlement",
   tuple(_CONSTS.get("COL_PREF_PAGES") or ()) == ("forecast", "purchase", "settlement"),
   "实际 = %r" % (_CONSTS.get("COL_PREF_PAGES"),))

ok("A2 每个页面都有中文名（错误信息/日志说人话，不给业务人员看机器名）",
   set((_CONSTS.get("_PAGE_LABEL") or {}).keys()) == set(_CONSTS.get("COL_PREF_PAGES") or ()),
   "实际 = %r" % (_CONSTS.get("_PAGE_LABEL"),))'''

new = '''# 2026-10-23 更新：这两条原断言（"恰好三个页面"/"每个页面都有中文名"）已被**有意的设计变更**取代
# —— 前端实际有 26 个 page 键在调本端点，白名单只有三页时另外 15 个页面读配置一律 400
#    （前端只 console.warn，界面无感 ⇒ 静默失效，见 v652b 交付说明）。
# 改成保持判别力的新不变量：补全名单时不能把旧页弄丢；tag 要么说人话、要么老老实实回落键名。
_PAGES = tuple(_CONSTS.get("COL_PREF_PAGES") or ())
_LABELS = _CONSTS.get("_PAGE_LABEL") or {}
ok("A1 白名单非空、无重复、且三张主表仍在列（`forecast`/`purchase`/`settlement` 逐字）",
   bool(_PAGES) and len(set(_PAGES)) == len(_PAGES)
   and {"forecast", "purchase", "settlement"} <= set(_PAGES),
   "实际 %d 项 = %r" % (len(_PAGES), _PAGES))

ok("A2 每个键都有 label；有中文名的必须覆盖三张主表+界面密度，其余**恰好等于键名**（不半吊子翻译）",
   all((_LABELS.get(k) or k) for k in _PAGES)
   and {"forecast", "purchase", "settlement", "ui-density"} <= set(_LABELS)
   and all(lbl == k for k, lbl in _LABELS.items() if k not in ("forecast", "purchase", "settlement", "ui-density")),
   "实际 = %r" % (_LABELS,))

ok("A3 `ui-density` 在列且带中文名（v652b 修复的现场，防止被谁再删掉）",
   "ui-density" in _PAGES and bool(_LABELS.get("ui-density")),
   "实际 = %r / %r" % (_PAGES, _LABELS.get("ui-density")))'''

if s.count(old) != 1:
    raise SystemExit("锚点不唯一 count=%d" % s.count(old))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
print("PATCHED A1/A2 + 新增 A3")
