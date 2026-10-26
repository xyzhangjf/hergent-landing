#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697b：给「预付款」开一条 HTTP 端点（`POST /api/psi/purchase-orders/{oid}/prepayments`）。

为什么和 `.../payments` 分成两条端点（不是加一个 `is_prepay` 参数）：
  · `.../payments` 的前置条件 = 有应付行 + 金额 ≤ 未结（货已到、结货款）；
  · `.../prepayments` 的前置条件 = `status='approved'` + 不碰应付（货未到、先给钱）。
  两套校验完全不同。合进一个端点后，"到底按哪套判断"取决于参数，而参数是客户端给的
  —— 等于把「用哪套安全闸」的决定权交给了调用方。钱的操作不这样设计。

权限：`/api/psi` 前缀在 `server.py::_PATH_MODULE_MAP` 里已登记为 `inventory`
（首个 startswith 命中即停）⇒ 新子路径自动继承，**无需改权限表**，
也不会出现「页面能开、接口 403」那种假配置。

用法：
    python3 patch_v697b_prepay_route.py --target=/opt/hergent-erp/routers/psi.py [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/psi.py")

IMPORT_OLD = '''    purchase_payment_create as _db_po_payment_create,'''

IMPORT_NEW = '''    purchase_payment_create as _db_po_payment_create,
    purchase_prepayment_create as _db_po_prepay_create,   # v697 预付款（货未到先给钱）'''

ROUTE_ANCHOR = '''@router.get("/purchase-orders/{oid}/inbound")'''

ROUTE_NEW = '''@router.post("/purchase-orders/{oid}/prepayments")
async def psi_create_purchase_prepayment(oid: int, request: Request):
    """登记一笔**预付款**（货款 tab 的「预付款」按钮，v697）。

    与 `.../payments` 的分工写在数据层 `purchase_prepayment_create` 的 docstring 里：
    本端点只服务「货还没到、先给供应商打钱」，要求 `status='approved'`，
    **不碰应付行**（那时还没有应付）；`.../payments` 服务「货已到、结货款」。

    入参复用 `_PaymentModel`（amount / account / note）—— 两者结构确实一样，
    但**校验逻辑不共用**：这里没有「≤ 未结」那道闸（老板定了预付不设上限），
    由数据层按 `prepaid_amount` 单独判断超付并在货款页明示。
    """
    u = _auth(request)
    o = db.purchase_order_get(oid)
    if not o or not _doc_owner_ok(o.get("order"), u):
        raise HTTPException(404, "订单不存在")
    try:
        body = _PaymentModel(**(await request.json()))
    except ValidationError as e:
        raise HTTPException(422, pydantic_error_detail(e))
    except Exception:
        raise HTTPException(400, "请求体不是合法 JSON")
    r = _db_po_prepay_create(oid, body.amount, account=body.account, note=body.note,
                             operator_id=str(u.get("id") or ""))
    if "error" in r:
        raise HTTPException(400, r["error"])
    return {"success": True, **r}


'''


def apply(text, old, new, label, results):
    if new in text:
        results.append(("SKIP", label, "已是新版"))
        return text
    if old not in text:
        results.append(("FAIL", label, "锚点未命中"))
        return text
    if text.count(old) != 1:
        results.append(("FAIL", label, f"锚点出现 {text.count(old)} 次，不唯一"))
        return text
    results.append(("OK", label, ""))
    return text.replace(old, new, 1)


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    target = DEFAULT_TARGET
    for a in args:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print(f"目标文件不存在: {target}")
        return 1

    src = target.read_text(encoding="utf-8")
    out = src
    results = []
    out = apply(out, IMPORT_OLD, IMPORT_NEW, "1. 导入 purchase_prepayment_create", results)
    out = apply(out, ROUTE_ANCHOR, ROUTE_NEW + ROUTE_ANCHOR,
                "2. 新增 POST .../prepayments 端点", results)

    print("=" * 62)
    for st, label, note in results:
        mark = {"OK": "✅", "SKIP": "⏭ ", "FAIL": "❌"}[st]
        print(f"{mark} {label}" + (f"  ← {note}" if note else ""))
    print("=" * 62)
    if any(r[0] == "FAIL" for r in results):
        print("有锚点未命中，未写入。")
        return 2
    if out == src:
        print("内容无变化，未写入。")
        return 0
    if dry:
        print("--dry-run：未写入文件。")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = target.with_suffix(target.suffix + f".bak-v697b-{ts}")
    shutil.copy2(target, bak)
    target.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(target), doraise=True)
    except Exception as e:
        shutil.copy2(bak, target)
        print(f"❌ 语法检查失败，已回滚：{e}")
        return 3
    print(f"✅ 已写入 {target}\n   备份 {bak}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
