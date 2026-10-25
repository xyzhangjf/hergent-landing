"""「这个商品在该伙伴那儿有没有历史单据」的**唯一实现**（v684）。

老板口径（2026-10-25）：采购退货 / 自提退单 / 车销退单**不再以「按原单退货」为主入口**，
默认允许自由选商品退货。选到「该供应商从没供过」或「该客户从没买过」的商品时，
系统**只提醒、不拦截** —— 现实里退的货常常是上次从别的渠道调的、或者跨期老货。

🔴 本模块只回答一个问题：这批 `product_id` 里，哪些在该伙伴的历史单据中出现过。
   不参与任何写库 / 校验 / 拦截。要拦截请另找地方，别在这里加。
🔴 为什么必须唯一实现：「历史存在性」的定义（哪些单据状态算数、草稿作废算不算）
   要是让四个建单页各写一份 SQL，迟早分岔且零报错 ——
   与 v683「单位价折算」同一个来路的坑（7.22 元/板 被算成 0.72 元/板）。

不算数的单据状态（`_SKIP_STATUS`）：
  · draft     —— 草稿：货没真进出，凑不出「历史采购/销售」这个事实
  · cancelled / void / rejected —— 作废或被拒
  · 采购单的 `confirmed` **算数**（货已在途/已收），销售单 `signed` 算数。
  生产实测：采购单 received(79)/draft(2)/confirmed(1)/cancelled(1)，销售单 signed(22505)。
"""
from db.connection import get_db

# 🔴 SQLite 变量上限 999（老版本更小）⇒ 分批查，别把整页商品 id 拼成一条 IN。
_BATCH = 400

_SKIP_STATUS = ("draft", "cancelled", "void", "rejected")

# kind → SQL 模板（%s 依次是：IN 占位符、状态占位符）
_SQL = {
    "purchase": (
        "SELECT DISTINCT i.product_id FROM purchase_order_items i "
        "JOIN purchase_orders o ON o.id = i.order_id "
        "WHERE o.supplier_id = ? AND i.product_id IN (%s) "
        "AND COALESCE(o.status, '') NOT IN (%s)"
    ),
    "sale": (
        "SELECT DISTINCT i.product_id FROM sale_order_items i "
        "JOIN sale_orders o ON o.id = i.order_id "
        "WHERE o.customer_id = ? AND i.product_id IN (%s) "
        "AND COALESCE(o.status, '') NOT IN (%s)"
    ),
}

#: 端点接受的 kind 集合 → 归一后的两类。任何别的值**一律按采购**（保守：
#: 采购侧的提醒文案不会让人误以为"客户买过"）。
_SALE_ALIASES = {"sale", "sale_return", "sell", "shipment"}


def norm_kind(kind):
    """把 kind 归一到 `purchase` / `sale` 两类。非法值落 `purchase`。"""
    k = str(kind or "").strip().lower()
    return "sale" if k in _SALE_ALIASES else "purchase"


def _norm_ids(product_ids):
    """去重 + 只留正整数，保持原顺序（返回顺序即前端入参顺序，便于对照）。"""
    out = []
    for x in (product_ids or []):
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if n > 0 and n not in out:
            out.append(n)
    return out


def missing_products(kind, partner_id, product_ids):
    """返 `{kind, partner_id, checked, matched, missing, skipped}`。

    · `partner_id <= 0`（还没选供应商/客户）⇒ `skipped=True`、`missing=[]`：
      **没有伙伴就没有"他的历史"，此时不该给任何行挂警告。**
    · 读库异常**向上抛**（端点回 500），**不要**降级成"全部缺失" ——
      那会给每一行挂上假警告，比不提醒更糟。
    """
    k = norm_kind(kind)
    try:
        pid = int(partner_id or 0)
    except (TypeError, ValueError):
        pid = 0
    pids = _norm_ids(product_ids)
    out = {
        "kind": k,
        "partner_id": pid,
        "checked": len(pids),
        "matched": [],
        "missing": [],
        "skipped": False,
    }
    if pid <= 0 or not pids:
        out["skipped"] = True
        # 没伙伴 ⇒ 既不算命中也不算缺失（missing 留空，前端不会误标）
        return out

    sql = _SQL[k]
    status_ph = ",".join("?" * len(_SKIP_STATUS))
    hit = set()
    with get_db() as db:                      # type: ignore[attr-defined]
        for i in range(0, len(pids), _BATCH):
            chunk = pids[i:i + _BATCH]
            q = sql % (",".join("?" * len(chunk)), status_ph)
            args = [pid] + chunk + list(_SKIP_STATUS)
            for r in db.execute(q, args).fetchall():
                try:
                    hit.add(int(r[0]))
                except (TypeError, ValueError, IndexError):
                    continue
    out["matched"] = [p for p in pids if p in hit]
    out["missing"] = [p for p in pids if p not in hit]
    return out
