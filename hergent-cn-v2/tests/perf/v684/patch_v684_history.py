#!/usr/bin/env python3
"""v684 后端补丁：自由退货的「商品不在该伙伴历史记录中」提醒。

做三件事（全部幂等，可重复执行）：
  1. 落地 `db/queries/partner_history.py`（唯一实现）
  2. `routers/psi.py` 加 import
  3. `routers/psi.py` 加 `GET /api/psi/partner-product-history`

🔴 不碰任何表结构、不写任何业务数据 —— 本补丁只加一个**只读**查询端点。
"""
import os
import py_compile
import shutil
import sys
import time

BASE = "/opt/hergent-erp"
HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(BASE, "db/queries/partner_history.py")
PSI = os.path.join(BASE, "routers/psi.py")
STAMP = time.strftime("%Y%m%d%H%M%S")


def backup(path):
    if not os.path.exists(path):
        return
    shutil.copy2(path, path + ".bak-v684-" + STAMP)
    print("backup:", path + ".bak-v684-" + STAMP)


def put_module():
    src = os.path.join(HERE, "partner_history.py")
    if not os.path.exists(src):
        sys.exit("missing local partner_history.py")
    new = open(src, encoding="utf-8").read()
    old = open(TARGET, encoding="utf-8").read() if os.path.exists(TARGET) else ""
    if old == new:
        print("module: unchanged")
        return
    backup(TARGET)
    with open(TARGET, "w", encoding="utf-8") as f:
        f.write(new)
    print("module: written %d bytes" % len(new.encode("utf-8")))


IMPORT_ANCHOR = "from db.queries.product_pricing import resolve_pricing as _resolve_pricing"
IMPORT_NEW = (
    IMPORT_ANCHOR
    + "\n# v684：自由退货的「这个商品在该供应商/客户那儿有没有历史」提醒（只读，唯一实现）\n"
    + "from db.queries.partner_history import missing_products as _missing_products"
)

ENDPOINT = '''@router.get("/partner-product-history")
def psi_partner_product_history(request: Request, kind: str = "purchase",
                                partner_id: int = 0, product_ids: str = ""):
    """自由退货前的**提醒**：这批商品在该供应商/该客户的历史单据里出现过吗？

    `kind`：purchase（采购退货用）| sale（自提退单 / 车销退单用），其余值按 purchase。
    `partner_id`：供应商 id（purchase）或客户 id（sale）。0 = 还没选人 ⇒ `skipped=True`。
    `product_ids`：逗号分隔的商品 id。

    返回 `{kind, partner_id, checked, matched, missing, skipped}`：
      · `missing` —— 该伙伴**从没**经手过的商品 id。前端据此在行上挂提醒，
        **绝不拦提交**（老板口径：现实里退的货常常是别的渠道调的）。
      · `skipped=True` —— 没选伙伴或没商品，此时 `missing` 恒为空。

    🔴 判定口径（哪些单据状态算数）**只在 `db/queries/partner_history.py`**，
       本端点只解析参数 + 透传，不在路由层写第二条 SQL。
    """
    _auth(request)
    raw = str(product_ids or "").replace("，", ",").replace(" ", "")
    ids = [x for x in raw.split(",") if x.strip()]
    return _missing_products(kind, partner_id, ids)


@router.get("/refs")'''


def patch_psi():
    s = open(PSI, encoding="utf-8").read()
    if "partner-product-history" in s:
        print("psi: endpoint already present")
        return
    if IMPORT_ANCHOR not in s:
        sys.exit("psi: import anchor not found — 代码已漂移，人工核对后再跑")
    if s.count('@router.get("/refs")') != 1:
        sys.exit("psi: /refs anchor is not unique (%d) — 人工核对" % s.count('@router.get("/refs")'))
    s = s.replace(IMPORT_ANCHOR, IMPORT_NEW, 1)
    s = s.replace('@router.get("/refs")', ENDPOINT, 1)
    backup(PSI)
    with open(PSI, "w", encoding="utf-8") as f:
        f.write(s)
    print("psi: patched")


def compile_all():
    for p in (TARGET, PSI):
        py_compile.compile(p, doraise=True)
        print("compile ok:", p)


if __name__ == "__main__":
    put_module()
    patch_psi()
    compile_all()
    print("PATCH v684 OK")
