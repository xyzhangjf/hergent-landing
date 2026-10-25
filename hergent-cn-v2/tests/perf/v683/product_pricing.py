"""单位 × 价格联动的**唯一实现**（v683）。

职责：给定「商品 + 业务类型 + 客户/供应商」，一次算出建单页需要的全部单位与价格 ——
可用档位、默认选哪一档、每档该填的单价、以及那个价格从哪来的（让界面能如实说明）。

🔴 为什么必须单独成文件、且全仓只准有这一份：
   这条规则原先在四个建单页各写了一遍，实测已经分岔出**真实的错价**：
     · 采购订单页把 `purchase_price` 当「元/大单位」，选「板」时把 7.22 元/板 算成
       0.72 元/板（差 10 倍）；生产 330 个有大包装的商品全受影响。
     · 采购退货页原样预填、切档连价都不重算。
     · 销售页只读不选；调拨页无价。
   ⇒ 统一收口到本文件，前端只调 `GET /api/psi/product-pricing`，**不许自己乘除**。

价格链（每档独立走一遍，取第一个命中的）：
   ① 同客户/供应商 + 同商品 + 同单位 的最近成交价  → source='last_owner'
   ② 同商品 + 同单位 的最近成交价（不分客户/供应商）→ source='last'
   ③ 同商品的历史成交价（**旧单据没有单位列**，其 unit_price 是元/小单位口径）
      只在小档生效；中/大档按 ratio 折算                  → source='last_legacy'
   ④ 商品档案价 × 该档 ratio                            → source='archive'
   ⑤ 0.0                                               → source='none'（界面允许手填）

🔴 **档案价的量纲（2026-10-25 生产实测定案，不是推测）**：
   `products.purchase_price` / `sale_price` 是**元/小单位**：
     · 「小优原味」小=板 / 大=箱(10)，purchase_price=7.22，真实采购成交 6.4 元/板
     · 「CD杯8杯」小=组 / 大=箱(12)，purchase_price=sale_price=7.67，成交 7.67 元/组
     · 销售侧 sale_price=0.91 元/杯，成交 0.91 元/杯（1件=96杯）
   而 `factory_price` 才是**元/大单位**：`factory ≈ purchase × large_ratio`，
   321 个双价商品里命中 263 个、完全相等 0 个。
   ⇨ 「按所选单位带出档案价」= `档案价 × 该档 ratio`。
      把 purchase_price 直接当大单位价是错的（v680 之前采购页的错误就在这里）。

🔴 默认档位（老板 2026-10-25 拍板「保持各页现状 + 档案优先」）：
   · 采购订单：`default_purchase_unit` → `order_unit` → **最大档**（现状是按箱进货）
   · 采购退货：`default_purchase_unit` → `order_unit` → **最小档**（退货按小单位退才对得上）
   · 销售类：`default_sale_unit` → `order_unit` → **最小档**
   · 赠送：`default_gift_unit` → `order_unit` → 最小档
   · 调拨：`order_unit` → 最小档（内部移库，无价格）
   档案里配了默认单位就以档案为准 —— 这三个字段过去**有控件、能保存、但零消费**
   （生产非空值 0 条），本次起才真正生效。
"""
import logging

from db.connection import get_db
from db.queries.units import unit_options, conversion_text

_log = logging.getLogger("hergent")

KINDS = ("purchase", "purchase_return", "sale", "sale_return", "gift", "transfer")

# kind -> (明细表, 表头表, 归属列, 日期列)；调拨无价格历史。
_LAST_SPEC = {
    "purchase":        ("purchase_order_items", "purchase_orders", "supplier_id", "order_date"),
    "purchase_return": ("purchase_order_items", "purchase_orders", "supplier_id", "order_date"),
    "sale":            ("sale_order_items", "sale_orders", "customer_id", "order_date"),
    "sale_return":     ("sale_order_items", "sale_orders", "customer_id", "order_date"),
    "gift":            ("sale_order_items", "sale_orders", "customer_id", "order_date"),
}

# kind -> 档案价字段（None = 该业务不带价）。
_ARCHIVE_FIELD = {
    "purchase": "purchase_price",
    "purchase_return": "purchase_price",
    "sale": "sale_price",
    "sale_return": "sale_price",
    "gift": "sale_price",
    "transfer": None,
}

# kind -> 档案默认单位字段（None = 无专属字段）。
_DEFAULT_FIELD = {
    "purchase": "default_purchase_unit",
    "purchase_return": "default_purchase_unit",
    "sale": "default_sale_unit",
    "sale_return": "default_sale_unit",
    "gift": "default_gift_unit",
    "transfer": None,
}

# 回退方向：True = 最大档（采购按箱进货），False = 最小档。
_FALLBACK_LARGE = {"purchase": True}


def _empty(pid, kind):
    return {
        "product_id": int(pid or 0), "kind": kind, "unit_options": [],
        "default_unit": "", "base_unit": "", "conv_text": "",
        "archive_price": 0.0, "archive_field": _ARCHIVE_FIELD.get(kind),
        "last_scoped": None,
    }


def _round4(v):
    try:
        return round(float(v or 0), 4)
    except (TypeError, ValueError):
        return 0.0


def _hit_last(db, pid, unit_name, kind, owner_id):
    """返回 `(unit_price, source)`；没命中返回 `(0.0, '')`。

    ① 先按归属（客户/供应商）；② 再全局。两档都要求**该行单位名一致**。
    🔴 表可能还没补 `unit` 列（迁移未跑完）⇒ 这里 `except` 返回未命中，
       而不是让整个定价接口 500。判据：宁可少一个「上次价」，也不能开不了单。
    """
    spec = _LAST_SPEC.get(kind)
    if not spec:
        return 0.0, ""
    item_t, head_t, owner_col, date_col = spec
    base = (
        "SELECT i.unit_price, i.unit, h.%s AS order_date, h.%s AS owner_id "
        "  FROM %s i JOIN %s h ON i.order_id = h.id "
        " WHERE i.product_id = ? AND i.unit_price > 0 " % (date_col, owner_col, item_t, head_t)
    )
    if owner_id:
        try:
            r = db.execute(
                base + " AND TRIM(COALESCE(i.unit,'')) = ? AND h.%s = ? "
                       " ORDER BY i.id DESC LIMIT 1" % owner_col,
                (pid, unit_name, owner_id)).fetchone()
            if r:
                return _round4(r["unit_price"]), "last_owner"
        except Exception as e:
            _log.debug(f"[pricing] 归属上次价查询跳过({kind}): {e}")
    try:
        r = db.execute(
            base + " AND TRIM(COALESCE(i.unit,'')) = ? "
                   " ORDER BY i.id DESC LIMIT 1",
            (pid, unit_name)).fetchone()
        if r:
            return _round4(r["unit_price"]), "last"
    except Exception as e:
        _log.debug(f"[pricing] 全局上次价查询跳过({kind}): {e}")
    return 0.0, ""


def _hit_legacy(db, pid, kind):
    """旧单据（没有单位列的历史行）的成交价 —— 口径是**元/小单位**。"""
    spec = _LAST_SPEC.get(kind)
    if not spec:
        return 0.0
    item_t, head_t, _owner_col, _date_col = spec
    try:
        r = db.execute(
            "SELECT i.unit_price FROM %s i JOIN %s h ON i.order_id = h.id "
            " WHERE i.product_id = ? AND i.unit_price > 0 "
            "   AND TRIM(COALESCE(i.unit,'')) = '' "
            " ORDER BY i.id DESC LIMIT 1" % (item_t, head_t),
            (pid,)).fetchone()
        return _round4(r["unit_price"]) if r else 0.0
    except Exception as e:
        _log.debug(f"[pricing] 历史成交价查询跳过({kind}): {e}")
        return 0.0


def default_unit_of(prod, kind="sale"):
    """该商品在该业务下的**预选单位名**。无可用档位返回 `''`。

    优先级：档案专属默认单位 → 报单单位 → 按业务回退（采购大档 / 其余小档）。
    🔴 档案里配了不存在的单位名（比如中单位被清空过）⇒ 视为没配，继续往下走，
       并把这件事写日志。**不静默沿用一个选不中的值** —— 那会让下拉显示空白，
       看着像「跟随档案」，实际选不中任何一项。
    """
    opts = unit_options(prod)
    if not opts:
        return ""
    names = [o["name"] for o in opts]
    field = _DEFAULT_FIELD.get(kind)
    if field:
        pref = str((prod or {}).get(field) or "").strip()
        if pref:
            if pref in names:
                return pref
            _log.warning(
                "[pricing] 商品 %s 的 %s='%s' 不在可用单位 %s 内 —— 已忽略（档案请改正）",
                (prod or {}).get("id"), field, pref, names)
    ou = str((prod or {}).get("order_unit") or "").strip()
    if ou and ou in names:
        return ou
    return names[-1] if _FALLBACK_LARGE.get(kind) else names[0]


def resolve_pricing(product_id, kind="sale", customer_id=0, supplier_id=0):
    """建单页要的全部单位与价格。纯读，不写库。"""
    kind = kind if kind in KINDS else "sale"
    pid = int(product_id or 0)
    if pid <= 0:
        return _empty(pid, kind)

    with get_db() as db:
        row = db.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        if not row:
            return _empty(pid, kind)
        prod = dict(row)
        opts = unit_options(prod)
        if not opts:
            return _empty(pid, kind)

        field = _ARCHIVE_FIELD.get(kind)
        archive = _round4(prod.get(field)) if field else 0.0
        owner_id = int((supplier_id if kind.startswith("purchase") else customer_id) or 0)

        legacy = _hit_legacy(db, pid, kind)
        items = []
        scoped = None
        for o in opts:
            ratio = _round4(o["ratio"]) or 1.0
            price, src = _hit_last(db, pid, o["name"], kind, owner_id)
            if price > 0 and src:
                if scoped is None:
                    scoped = {"unit": o["name"], "unit_price": price}
            if price <= 0 and o["key"] == "small" and legacy > 0:
                price, src = legacy, "last_legacy"
            if price <= 0 and archive > 0:
                price, src = _round4(archive * ratio), "archive"
            items.append({
                "key": o["key"], "name": o["name"], "ratio": ratio,
                "price": _round4(price) if price > 0 else 0.0,
                "price_source": src or "none",
                # 档案折算到该档是多少 —— 界面用于「档案价 ¥X/箱」这类说明与改价参考
                "archive_price": _round4(archive * ratio) if archive > 0 else 0.0,
            })

    return {
        "product_id": pid,
        "kind": kind,
        "base_unit": str(prod.get("unit") or ""),
        "conv_text": conversion_text(prod),
        "archive_price": archive,
        "archive_field": field,
        "default_unit": default_unit_of(prod, kind),
        "unit_options": items,
        "last_scoped": scoped,
    }


def price_of_unit(pricing, unit_name):
    """从 `resolve_pricing` 的结果里取某档的单价；取不到返回 0.0。"""
    for o in (pricing or {}).get("unit_options") or []:
        if o.get("name") == unit_name:
            return _round4(o.get("price"))
    return 0.0
