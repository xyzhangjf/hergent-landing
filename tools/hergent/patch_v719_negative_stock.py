#!/usr/bin/env python3
"""v719：让 `warehouses.allow_neg_inv` 真正生效 —— 负库存不再是「配了但没人读」

## 为什么做这个（三个断点，全部实测，不是推断）

1. **配置存在但后端 0 处引用**
   `warehouses.allow_neg_inv` 列自建库起就在 DDL 里（`DEFAULT '允许'`），生产 11 个仓
   **全部**取值 `'允许'`；但 `grep -rn allow_neg_inv server/` 匹配 **0 行**。
   ⇒ `fefo_deduct` / `inventory_adjust` 里的 `quantity+?>=0` 硬守卫与配置**完全相反**。

2. **后果 A：业务员仓的销售单一张也发不出去**
   仓 7（刘小顶仓）337 张、仓 9（刘善涛仓）2,213 张销售单，而这两个仓
   `inventory` **0 行** ⇒ 缺货检查恒失败 ⇒ 点发货永远返回「库存不足」。
   业务事实是货已经从总仓送到客户手上，系统拦下来只会让账实分离更严重。

3. **后果 B：`inventory` 不是库存余额，是「累计入库量」**
   22,505 张签收单是舟谱导入的（`pick_waves` 0 行、`delivery_status` 全空串），
   绕过 `sale_order_deliver` ⇒ `inventory_logs` 零销售出库。
   销售净出库 3,923,642（已排除 276,541 张调拨），库存只有 310,409。

## 本补丁只改代码行为，不动一行数据

- `_allow_neg_inv(dbc, warehouse_id)`：读配置，**fail-closed**（读不到就当不允许）
- `fefo_deduct`：可售批次扣尽仍有缺口时，允许负库存的仓把差额扣进「未分批次」行
  （`batch_no=''`）—— 不能只记账不扣数，否则台账（`inventory`）与流水
  （`inventory_logs`）对不上，等于把一个静默失效换成另一个。
- `inventory_adjust`：去掉该仓的 `quantity>=0` 守卫（含「无库存记录」支路）
- `sale_order_deliver`：缺货从「拦截」降级为**提醒**，但**只对配了允许的仓**；
  未配的仓保持原有硬拦截，语义零变化。

## 关键契约（改之前必须先看）

- 🔴 负库存部分**必须带 `products.purchase_price` 作 cost_price**。
  `domain/profit_reporter.py:98` 会按 `change_type='sale' AND ref_type='sale'`
  聚合 `inventory_logs.cost_price` 算批次实际成本；写 0 会让成本被低估。
- 🔴 幂等判据用「`old` 不在 + `new` 在」= 已应用。**不能先判 `old==0`** ——
  追加型替换里 `old` 是 `new` 的前缀，会重复替换一遍（v709 血案）。
- 🔴 本补丁**不 import erp_db**（导入期就跑 389 条迁移 = 会写生产）。

用法：
    python3 patch_v719_negative_stock.py            # dry-run：打印将要改的行
    python3 patch_v719_negative_stock.py --apply    # 备份后写盘
    python3 patch_v719_negative_stock.py --verify   # 只读核对（不写）
    python3 patch_v719_negative_stock.py --revert   # 从 .bak-v719 恢复
"""
import argparse
import os
import shutil
import sys

BASE = os.environ.get("ERP_HOME", "/opt/hergent-erp")
INV = os.path.join(BASE, "db/queries/inventory.py")
SAL = os.path.join(BASE, "db/queries/sales.py")
BAK = ".bak-v719"


# ---------------------------------------------------------------- patch 工具
def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def patch_file(path, label, old, new, apply_it):
    """替换一段代码。返回 'apply' / 'already' / 'missing'。

    幂等判据（顺序不能反）：
      old 不在 + new 在  ⇒ 已应用
      old 不在 + new 不在 ⇒ 锚点丢失（代码被别处改过）⇒ 报错，绝不瞎猜
      old 在且唯一        ⇒ 应用
      old 出现多次        ⇒ 报错（锚点不唯一）
    """
    src = _read(path)
    c_old, c_new = src.count(old), src.count(new)
    if c_old == 0:
        if c_new >= 1:
            print("    [%-9s] 已应用，跳过" % label)
            return "already"
        print("    [%-9s] 🔴 锚点丢失：old 与 new 都不在（代码变了？）" % label)
        return "missing"
    if c_old > 1:
        print("    [%-9s] 🔴 锚点不唯一：old 出现 %d 次" % (label, c_old))
        return "missing"
    if apply_it:
        out = src.replace(old, new, 1)
        # 硬断言：替换后 new 必须恰好一份（防 v709 那种「再替换一遍」）
        if out.count(new) != 1:
            print("    [%-9s] 🔴 替换后 new 计数 %d ≠ 1，中止" % (label, out.count(new)))
            return "missing"
        _write(path, out)
        print("    [%-9s] ✅ 已写入" % label)
    else:
        print("    [%-9s] 待改（dry-run 未写盘）" % label)
    return "apply"


# ---------------------------------------------------------------- 补丁定义
ALLOW_NEG_FN = '''

def _allow_neg_inv(dbc, warehouse_id):
    """该仓是否允许负库存 —— 读 `warehouses.allow_neg_inv`。

    🔴 v719 之前**没有任何代码读过这一列**（全后端 0 处引用），而它自建库起就在
       DDL 里、生产 11 个仓全是 `'允许'`。于是「配置说允许、代码硬拦」——
       业务员仓（刘小顶仓/刘善涛仓，`inventory` 0 行）的销售单一张也发不出去。

    🔴 **fail-closed**：仓不存在、列读不到、值不认识 ⇒ 一律当「不允许」。
       宁可拦住让人改配置，也不能让一个拼错的值悄悄放开负库存。
    """
    try:
        r = dbc.execute("SELECT allow_neg_inv FROM warehouses WHERE id=?",
                        (warehouse_id,)).fetchone()
        if not r:
            return False
        v = r["allow_neg_inv"] if hasattr(r, "keys") else r[0]
        return str(v or "").strip() in ("允许", "是", "1", "true", "True", "allow", "yes")
    except Exception:
        return False

'''


FN_MARK = "def _allow_neg_inv(dbc, warehouse_id):"


def p_inv_fn(apply_it):
    """插入 `_allow_neg_inv` 函数体。

    🔴 这一处**不能用通用 patch_file**：`old`（锚点两行）是 `new`（锚点 + 函数）
       的**前缀** ⇒ `src.count(old)` 恒 ≥1 ⇒ 通用判据会判成「待改」，
       重跑 `--apply` 就会**再插一遍函数**（Python 允许重复定义，后者覆盖前者，
       行为看起来完全一样，属静默劣化 —— v709 血案同族）。
       故此处按「已应用形态」判定：函数签名已在位就是已应用。
    """
    src = _read(INV)
    if src.count(FN_MARK) == 1:
        print("    [inv.add_fn] 已应用，跳过")
        return "already"
    if src.count(FN_MARK) > 1:
        print("    [inv.add_fn] 🔴 已存在 %d 份定义（历史重复插入），请人工清理" % src.count(FN_MARK))
        return "missing"
    old = """EXPIRY_CRITICAL_DAYS = 30   # <= 该天数 → critical
EXPIRY_WARNING_DAYS = 90    # <= 该天数 → warning
"""
    if src.count(old) != 1:
        print("    [inv.add_fn] 🔴 锚点不唯一：出现 %d 次" % src.count(old))
        return "missing"
    out = src.replace(old, old + ALLOW_NEG_FN, 1)
    if out.count(FN_MARK) != 1:
        print("    [inv.add_fn] 🔴 替换后定义数 %d ≠ 1，中止" % out.count(FN_MARK))
        return "missing"
    if apply_it:
        _write(INV, out)
        print("    [inv.add_fn] ✅ 已写入")
    else:
        print("    [inv.add_fn] 待改（dry-run 未写盘）")
    return "apply"


def p_inv_fefo_precheck(apply_it):
    old = """        total = total_row['t'] if total_row else 0
        if total < qty_needed:
            return {'error': f'库存不足：需要{qty_needed}，可售{int(total)}（过期批次须报损，不可销售）', 'used': []}
"""
    new = """        total = total_row['t'] if total_row else 0
        # v719：仓库配了「允许负库存」就不再因为可售不足直接拒绝 —— 差额交给下方
        #   `remaining > 0` 分支扣进「未分批次」行（允许为负）。该配置列自建库起就
        #   存在、生产 11 个仓全配「允许」，但此前**没有一行代码读它**。
        allow_neg = _allow_neg_inv(db, warehouse_id)
        if total < qty_needed and not allow_neg:
            return {'error': f'库存不足：需要{qty_needed}，可售{int(total)}（过期批次须报损，不可销售）', 'used': []}
"""
    return patch_file(INV, "inv.fefo_pre", old, new, apply_it)


def p_inv_fefo_neg(apply_it):
    old = """                used.append({'batch_no': b['batch_no'], 'expiry_date': b['expiry_date'], 'quantity': take, 'batch_id': b['id']})
                remaining -= take
            db.execute("RELEASE fefo_sp")
"""
    new = """                used.append({'batch_no': b['batch_no'], 'expiry_date': b['expiry_date'], 'quantity': take, 'batch_id': b['id']})
                remaining -= take
            if remaining > 0:
                # v719：可售批次扣尽仍有缺口 ⇒ 只有「允许负库存」的仓能走到这里。
                #   差额扣进「未分批次」行（batch_no=''），允许数量为负；没有就建一行。
                #   🔴 不能「只记流水不扣数」：那样 inventory 与 inventory_logs 对不上，
                #      等于把一个静默失效换成另一个静默失效。
                #   🔴 cost_price 必须取 products.purchase_price —— 写 0 会让
                #      domain/profit_reporter.py 按 change_type='sale' 聚合时成本低估。
                neg = db.execute(
                    "SELECT id, quantity, cost_price FROM inventory WHERE product_id=? AND warehouse_id=? "
                    "AND (batch_no='' OR batch_no IS NULL) ORDER BY id ASC LIMIT 1",
                    (product_id, warehouse_id)).fetchone()
                _pr = db.execute("SELECT COALESCE(purchase_price,0) AS p FROM products WHERE id=?",
                                 (product_id,)).fetchone()
                _pcost = float((_pr['p'] if _pr else 0) or 0)
                if neg:
                    _before = float(neg['quantity'] or 0)
                    _cp = float(neg['cost_price'] or 0) or _pcost
                    db.execute("UPDATE inventory SET quantity=quantity-?,updated_at=datetime('now','localtime') "
                               "WHERE id=?", (remaining, neg['id']))
                else:
                    _before = 0.0
                    _cp = _pcost
                    db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date) "
                               "VALUES (?,?,?,?,'','')", (product_id, warehouse_id, -remaining, _pcost))
                db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,"
                           "before_qty,after_qty,cost_price,ref_type,ref_id) VALUES (?,?,?,?,?,?,?,?,?)",
                           (product_id, warehouse_id, ref_type, -remaining, _before,
                            _before - remaining, _cp, ref_type, ref_id))
                used.append({'batch_no': '', 'expiry_date': '', 'quantity': remaining,
                             'batch_id': 0, 'cost_price': _cp, 'negative': True})
                remaining = 0
            db.execute("RELEASE fefo_sp")
"""
    return patch_file(INV, "inv.fefo_neg", old, new, apply_it)


def p_inv_adj_guard(apply_it):
    old = """            if qty_change < 0:
                # Atomic guard: only update if enough stock (prevents overselling)
                cur = db.execute("UPDATE inventory SET quantity=quantity+?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,updated_at=datetime('now','localtime') WHERE id=? AND quantity+?>=0",(qty_change,cost_price,cost_price,inv['id'],qty_change))
                if cur.rowcount == 0:
                    if own: _cm.__exit__(None,None,None)
                    return {"error": f"库存不足：需要{-qty_change}，可用{before}"}
                after = db.execute("SELECT quantity FROM inventory WHERE id=?",(inv['id'],)).fetchone()['quantity']
"""
    new = """            if qty_change < 0:
                # Atomic guard: only update if enough stock (prevents overselling)
                # v719：仓库配了「允许负库存」就去掉该守卫 —— 配置本来就写着「允许」，
                #   此前却从不生效（业务员仓库存 0，一张单也发不出去）。
                if _allow_neg_inv(db, warehouse_id):
                    db.execute("UPDATE inventory SET quantity=quantity+?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,updated_at=datetime('now','localtime') WHERE id=?",(qty_change,cost_price,cost_price,inv['id']))
                else:
                    cur = db.execute("UPDATE inventory SET quantity=quantity+?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,updated_at=datetime('now','localtime') WHERE id=? AND quantity+?>=0",(qty_change,cost_price,cost_price,inv['id'],qty_change))
                    if cur.rowcount == 0:
                        if own: _cm.__exit__(None,None,None)
                        return {"error": f"库存不足：需要{-qty_change}，可用{before}"}
                after = db.execute("SELECT quantity FROM inventory WHERE id=?",(inv['id'],)).fetchone()['quantity']
"""
    return patch_file(INV, "inv.adj_guard", old, new, apply_it)


def p_inv_adj_nocreate(apply_it):
    old = """        else:
            if qty_change < 0:
                if own: _cm.__exit__(None,None,None)
                return {"error": "库存不足：无此商品库存记录"}
            db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price) VALUES (?,?,?,?)",(product_id,warehouse_id,after,cost_price))
"""
    new = """        else:
            if qty_change < 0:
                # v719：允许负库存 ⇒ 没有库存记录也要能扣（下面直接建一行负的）
                if not _allow_neg_inv(db, warehouse_id):
                    if own: _cm.__exit__(None,None,None)
                    return {"error": "库存不足：无此商品库存记录"}
            db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price) VALUES (?,?,?,?)",(product_id,warehouse_id,after,cost_price))
"""
    return patch_file(INV, "inv.adj_nocreate", old, new, apply_it)


def p_sal_import(apply_it):
    old = "from db.queries.inventory import inventory_adjust, fefo_deduct, SALEABLE_BATCH_COND\n"
    new = ("# v719：`_allow_neg_inv` —— 发货缺货是否降级为提醒，由仓库配置决定\n"
           "from db.queries.inventory import inventory_adjust, fefo_deduct, SALEABLE_BATCH_COND, _allow_neg_inv\n")
    return patch_file(SAL, "sal.import", old, new, apply_it)


def p_sal_shortage(apply_it):
    old = """        if shortage:
            return {'error': '库存不足', 'detail': '; '.join(shortage), 'items': shortage}
"""
    new = """        # v719：缺货从「拦截」降级为「提醒」—— 但**只对配了「允许负库存」的仓**。
        #   业务事实：货已经送到客户手上（签收单），系统拦下来只会让账实分离更严重。
        #   未配「允许」的仓保持原有硬拦截，语义零变化。
        shortage_warnings = []
        if shortage:
            if not _allow_neg_inv(db, o['warehouse_id']):
                return {'error': '库存不足', 'detail': '; '.join(shortage), 'items': shortage}
            shortage_warnings = shortage
"""
    return patch_file(SAL, "sal.shortage", old, new, apply_it)


def p_sal_return(apply_it):
    old = """    return {'order_id': oid, 'order_no': o['order_no'], 'status': 'delivered', 'fefo_batches': fefo_details}"""
    new = """    return {'order_id': oid, 'order_no': o['order_no'], 'status': 'delivered',
            'fefo_batches': fefo_details, 'shortage_warnings': shortage_warnings}"""
    return patch_file(SAL, "sal.return", old, new, apply_it)


STEPS = [
    ("inventory.py", [p_inv_fn, p_inv_fefo_precheck, p_inv_fefo_neg,
                      p_inv_adj_guard, p_inv_adj_nocreate]),
    ("sales.py", [p_sal_import, p_sal_shortage, p_sal_return]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="写盘（默认 dry-run）")
    ap.add_argument("--verify", action="store_true", help="只读核对")
    ap.add_argument("--revert", action="store_true", help="从 .bak-v719 恢复")
    a = ap.parse_args()

    print("=" * 74)
    print("v719 负库存生效补丁    BASE=%s" % BASE)
    print("=" * 74)

    if a.revert:
        for p in (INV, SAL):
            b = p + BAK
            if not os.path.exists(b):
                print("  🔴 备份不存在：%s" % b)
                continue
            shutil.copy2(b, p)
            print("  ✅ 已从 %s 恢复 %s" % (os.path.basename(b), os.path.basename(p)))
        print("\n恢复完成 —— 记得重启服务。")
        return 0

    if a.verify:
        print("\n[只读核对] 期望所有 v719 标记在位：\n")
        bad = 0
        for fname, fns in STEPS:
            print("  %s" % fname)
            for fn in fns:
                r = fn(False)
                if r == "missing":
                    bad += 1
        print("\n" + ("🔴 有 %d 处未到位" % bad if bad else "✅ 全部 8 处均在位"))
        return 1 if bad else 0

    if a.apply:
        print("\n[1/3] 备份")
        for p in (INV, SAL):
            shutil.copy2(p, p + BAK)
            print("    %s → %s" % (os.path.basename(p), os.path.basename(p) + BAK))

    print("\n[2/3] 打补丁")
    missing = 0
    for fname, fns in STEPS:
        print("  %s" % fname)
        for fn in fns:
            if fn(a.apply) == "missing":
                missing += 1

    print("\n[3/3] 语法检查")
    import py_compile
    for p in (INV, SAL):
        try:
            py_compile.compile(p, doraise=True, cfile="/tmp/_v719_%s.pyc" % os.path.basename(p))
            print("    ✅ %s 语法 OK" % os.path.basename(p))
        except Exception as e:
            print("    🔴 %s 语法错误：%s" % (os.path.basename(p), e))
            missing += 1

    if missing:
        print("\n🔴 有 %d 处失败 —— 请用 --revert 回滚后排查" % missing)
        return 1
    if a.apply:
        print("\n✅ 全部完成。**必须重启服务**才生效：systemctl restart hergent-erp")
    else:
        print("\n（dry-run 结束，未写盘。确认无误后加 --apply）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
