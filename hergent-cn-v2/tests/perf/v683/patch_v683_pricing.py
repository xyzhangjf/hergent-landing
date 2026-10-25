# -*- coding: utf-8 -*-
"""v683 后端补丁 ①：单位×价格联动的唯一实现 + 定价端点。

幂等：
  · 新文件 db/queries/product_pricing.py 直接覆盖（本文件即唯一源）
  · routers/psi.py 插入 import 与端点，已存在则跳过
每次改动前留 .bak-20261025-v683-pricing 备份。
"""
import os
import shutil
import subprocess
import sys

BASE = "/opt/hergent-erp"
PSI = os.path.join(BASE, "routers/psi.py")
PRICING = os.path.join(BASE, "db/queries/product_pricing.py")
NEW_SRC = "/root/product_pricing.py"
SUFFIX = ".bak-20261025-v683-pricing"

IMPORT_ANCHOR = """from db.queries.units import (
    unit_options as _unit_options,
    conversion_text as _conv_text,
)"""
IMPORT_ADD = IMPORT_ANCHOR + """

# v683：单位 × 价格联动的**唯一实现**（四个建单页共用）。端点只透传，前端不许自己乘除。
from db.queries.product_pricing import resolve_pricing as _resolve_pricing"""

ROUTE_ANCHOR = '@router.get("/refs")'
ROUTE_ADD = '''@router.get("/product-pricing")
def psi_product_pricing(request: Request, product_id: int = 0, kind: str = "sale",
                        customer_id: int = 0, supplier_id: int = 0):
    """建单页「单位 × 价格」联动：可用档位 + 预选档 + 每档该填的单价及其来源。

    `kind`：purchase | purchase_return | sale | sale_return | gift | transfer
    `customer_id` / `supplier_id`：给了就**优先**带出该客户/该供应商的上次成交价。

    返回 `unit_options[i] = {key,name,ratio,price,price_source,archive_price}`，
    `price_source` ∈ last_owner / last / last_legacy / archive / none。

    🔴 计价与换算**全在 `db/queries/product_pricing.py`**，本端点只透传。
       前端不许自己乘除 —— 那正是「7.22 元/板 被算成 0.72 元/板」的来路。
    """
    _auth(request)
    return _resolve_pricing(product_id, kind=kind,
                            customer_id=customer_id, supplier_id=supplier_id)


@router.get("/refs")'''


def backup(path):
    if not os.path.exists(path):
        return
    if not os.path.exists(path + SUFFIX):
        shutil.copy2(path, path + SUFFIX)
        print("  备份 ->", path + SUFFIX)


def main():
    if not os.path.exists(NEW_SRC):
        print("!! 找不到", NEW_SRC)
        return 1

    # ① 落唯一实现
    old = open(PRICING, "rb").read() if os.path.exists(PRICING) else b""
    new = open(NEW_SRC, "rb").read()
    if old != new:
        backup(PRICING)
        open(PRICING, "wb").write(new)
        print("  写入", PRICING, "(%d bytes)" % len(new))
    else:
        print("  已是最新", PRICING)

    # ② 给 psi.py 加 import 与端点
    src = open(PSI, encoding="utf-8").read()
    changed = False
    if "_resolve_pricing" not in src:
        if IMPORT_ANCHOR not in src:
            print("!! 找不到 units import 锚点，放弃")
            return 2
        src = src.replace(IMPORT_ANCHOR, IMPORT_ADD, 1)
        changed = True
        print("  + import")
    else:
        print("  import 已存在")

    if '"/product-pricing"' not in src and "/product-pricing" not in src:
        if ROUTE_ANCHOR not in src:
            print("!! 找不到 /refs 锚点，放弃")
            return 3
        src = src.replace(ROUTE_ANCHOR, ROUTE_ADD, 1)
        changed = True
        print("  + 端点 /api/psi/product-pricing")
    else:
        print("  端点已存在")

    if changed:
        backup(PSI)
        open(PSI, "w", encoding="utf-8").write(src)
        print("  写入", PSI)

    # ③ 语法自检
    for f in (PRICING, PSI):
        r = subprocess.run([sys.executable, "-m", "py_compile", f],
                           capture_output=True, text=True)
        print("  py_compile %-32s %s" % (os.path.basename(f), "PASS" if r.returncode == 0 else "FAIL"))
        if r.returncode != 0:
            print(r.stderr[:800])
            return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
