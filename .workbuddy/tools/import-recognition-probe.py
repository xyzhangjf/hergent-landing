"""只读评估探针：量化 Hergent 现有列识别能力。

方法说明（重要）：
  · COLUMN_PATTERNS 用 ast 从**生产同源的源码**里提取字面量（不手抄，避免抄错）。
  · _guess_mapping / _dedup_payment_mapping 的算法**逐字复现**源码（已通读 349-415 行）。
  · 因此本探针测的是「源码真实算法」的结果，不是"我以为的算法"。
  · 全程只读：不改任何文件、不连数据库、不联网。
"""

import ast

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py"
src = open(SRC, encoding="utf-8").read()
tree = ast.parse(src)

PATTERNS = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == "COLUMN_PATTERNS":
                PATTERNS = ast.literal_eval(node.value)
assert PATTERNS, "未提取到 COLUMN_PATTERNS"

_PAY_NAME_HINTS = ("名称", "客户名", "门店", "单位名")
_PAY_AMOUNT_HINTS = ("实收", "回款", "到账", "收款")


def _dedup_payment_mapping(mapping, headers):
    out = dict(mapping)
    for field, hints in (("contact_name", _PAY_NAME_HINTS), ("amount", _PAY_AMOUNT_HINTS)):
        idxs = sorted([int(i) for i, f in out.items() if f == field])
        if len(idxs) < 2:
            continue
        prefer = [i for i in idxs
                  if any(h in str(headers[i] if i < len(headers) else "") for h in hints)]
        keep = prefer[0] if prefer else idxs[0]
        for i in idxs:
            if i != keep:
                out.pop(i, None)
                out.pop(str(i), None)
    return out


def _guess_mapping(headers, category):
    patterns = PATTERNS.get(category, {})
    mapping = {}
    for i, h in enumerate(headers):
        h_lower = h.strip().lower()
        for field, keywords in patterns.items():
            if any(kw.lower() in h_lower for kw in keywords):
                mapping[i] = field
                break
    for field in ("factory_price",):
        idxs = [i for i, f in mapping.items() if f == field]
        if len(idxs) < 2:
            continue
        legacy = [i for i in idxs
                  if any(k in str(headers[i]) for k in ("厂价", "出厂价", "工厂价"))]
        keep = legacy[0] if legacy else idxs[0]
        for i in idxs:
            if i != keep:
                mapping.pop(i)
    if category == "payment_receipts":
        mapping = _dedup_payment_mapping(mapping, headers)
    return mapping


# ============ 测试用例：真实导出风格的表头 ============
CASES = [
    # ---- 舟谱（用户当前上游）----
    ("舟谱·库存", "inventory",
     ["商品名称", "规格", "单位", "条码", "品牌", "分类", "库存数量", "成本价", "批次号", "生产日期", "到期日期"]),
    ("舟谱·应收", "receivables",
     ["客户名称", "客户编码", "应收金额", "已收金额", "未收金额", "到期日", "单据日期"]),
    ("舟谱·收款流水", "payment_receipts",
     ["客户名称", "收款单号", "收款方式", "收款日期", "实收金额", "摘要"]),
    ("舟谱·订单明细", "order_items",
     ["订单号", "订单日期", "客户名称", "商品名称", "规格", "单位", "数量", "单价", "金额"]),
    # ---- 有开放平台的竞品 ERP（战略上要点名的接入对象）----
    ("畅捷通·库存", "inventory",
     ["存货编码", "存货名称", "规格型号", "主计量单位", "结存数量", "结存单价", "结存金额", "批号", "有效期至"]),
    ("金蝶·库存", "inventory",
     ["物料编码", "物料名称", "规格型号", "计量单位", "库存数量", "成本单价", "批次", "保质期截止日期"]),
    ("用友·应收", "receivables",
     ["客户编码", "客户名称", "单据编号", "单据日期", "应收金额", "已核销金额", "余额"]),
    ("畅捷通·订单明细", "order_items",
     ["单据编号", "单据日期", "往来单位", "存货名称", "主计量单位", "数量", "含税单价", "价税合计"]),
    # ---- 非标准结构：表头不在第 1 行（真实导出件几乎必然）----
    ("舟谱·库存（带前置标题行）", "inventory",
     ["库存查询表", "导出时间：2026-09-30 08:00:00", "商品名称", "规格", "单位", "条码",
      "库存数量", "成本价", "批次号", "到期日期"]),
]

# 每类目「最小可用字段集」——缺任一则该类目导不进去（按后端 execute 的必需字段推定）
MIN_REQUIRED = {
    "inventory": ["product_name", "quantity"],
    "receivables": ["contact_name", "amount"],
    "payment_receipts": ["contact_name", "amount", "paid_at"],
    "order_items": ["product_name", "quantity"],
    "products": ["name"],
}

print("=" * 74)
print("Hergent 列识别能力量化（真实算法复现 · 只读）")
print("=" * 74)

for label, cat, headers in CASES:
    m = _guess_mapping(headers, cat)
    hit = [(headers[i], f) for i, f in sorted(m.items())]
    miss = [h for i, h in enumerate(headers) if i not in m]
    req = MIN_REQUIRED.get(cat, [])
    got = set(m.values())
    missing_req = [f for f in req if f not in got]
    rate = len(m) / len(headers) * 100 if headers else 0
    verdict = "可导入" if not missing_req else ("缺关键列→会失败" )
    print()
    print("【%s】类目=%s  命中 %d/%d 列（%.0f%%）→ %s"
          % (label, cat, len(m), len(headers), rate, verdict))
    print("   命中: " + (", ".join("%s→%s" % (h, f) for h, f in hit) or "（无）"))
    print("   未命中: " + (", ".join(miss) or "（无）"))
    if missing_req:
        print("   🔴 缺必需字段: " + ", ".join(missing_req))
