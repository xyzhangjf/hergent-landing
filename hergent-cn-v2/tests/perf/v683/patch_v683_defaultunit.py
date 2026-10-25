# -*- coding: utf-8 -*-
"""v683 后端补丁 ④：商品档案三个「默认开单单位」写入校验。

背景：`default_purchase_unit` / `default_sale_unit` / `default_gift_unit` 三个字段
      过去**只写不读**（生产非空值 0 条），配什么都不会有任何后果。
      v683 起它们决定建单页预选哪一档 ⇒ 配一个不存在的单位名，界面会「看着像跟随
      档案、实际选不中任何一项」。必须在写入口挡住，而不是等用户开单时才发现。
"""
import os
import shutil
import subprocess
import sys

DATA = "/opt/hergent-erp/routers/data.py"
SUFFIX = ".bak-20261025-v683-defaultunit"

ANCHOR = '        body["order_unit"] = _ou\n'

NEW = ANCHOR + '''    # ===================== v683：三个「默认开单单位」的写入校验 =====================
    #   起因：`default_purchase_unit` / `default_sale_unit` / `default_gift_unit` 自 v234 起
    #   就有控件、能保存，但**全仓无任何读取点**（生产非空值 0 条）⇒ 配错也没有任何后果，
    #   所以从没人发现它们不生效。v683 起它们决定建单页预选哪一档（见
    #   `db/queries/product_pricing.py::default_unit_of`），配一个不存在的单位名会让
    #   下拉「看着像跟随档案、实际选不中任何一项」——必须在这里挡住。
    #   🔴 校验用「**将要生效**的档位名」：同一次 PUT 里可能同时把 `unit` / `medium_unit`
    #      改名，若只读库里的旧值，会出现"改名 + 设默认单位"这一组操作被误拒。
    _DU_FIELDS = (
        ("default_purchase_unit", "采购默认单位"),
        ("default_sale_unit", "销售默认单位"),
        ("default_gift_unit", "赠送默认单位"),
    )
    if any(_f in body for _f, _lab in _DU_FIELDS):
        _cur = db.product_get(pid) or {}
        _tier_keys = ("unit", "medium_unit", "large_unit")
        _tiers = []
        for _k in _tier_keys:
            _v = str((body[_k] if _k in body else _cur.get(_k)) or "").strip()
            if _v:
                _tiers.append(_v)
        for _f, _lab in _DU_FIELDS:
            if _f not in body:
                continue
            _val = str(body.get(_f) or "").strip()
            body[_f] = _val
            if _val and _val not in _tiers:
                raise HTTPException(
                    400,
                    "「%s」填的是「%s」，但这个商品的单位只有：%s —— 请从这些里选，"
                    "或留空表示「跟随档案单位」" % (
                        _lab, _val, " / ".join(_tiers) if _tiers else "（还没配任何单位）"))
'''


def main():
    src = open(DATA, encoding="utf-8").read()
    if "_DU_FIELDS" in src:
        print("  已存在，跳过")
    elif src.count(ANCHOR) != 1:
        print("!! 锚点命中 %d 次（要求 1）—— 放弃" % src.count(ANCHOR))
        return 1
    else:
        if not os.path.exists(DATA + SUFFIX):
            shutil.copy2(DATA, DATA + SUFFIX)
            print("  备份 ->", DATA + SUFFIX)
        open(DATA, "w", encoding="utf-8").write(src.replace(ANCHOR, NEW, 1))
        print("  已替换")

    r = subprocess.run([sys.executable, "-m", "py_compile", DATA], capture_output=True, text=True)
    print("  py_compile data.py", "PASS" if r.returncode == 0 else "FAIL\n" + r.stderr[:800])
    return 0 if r.returncode == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
