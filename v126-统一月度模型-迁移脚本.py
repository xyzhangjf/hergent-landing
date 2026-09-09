# -*- coding: utf-8 -*-
"""
v126 统一月度模型 —— 存量数据迁移（tenant_1）

用户拍板：
  1. 没有年返 → 不加年度统算块
  2. 逐月填   → 返利率每月独立
  3. 留年度的 → 蒙牛低温 8/9 月保留年度规则 #10 的 15%，停用单期 #6/#8 的 10%

本脚本做四件事：
  ① 备份 tenant_1.db
  ② 单期规则归一化：按生效期把 target_value 落进 monthly_amounts（统一月表）
  ③ 停用 #6（蒙牛8月 10%）/#8（蒙牛9月 10%）—— 让位给年度 #10 的 15%
  ④ 重建月份锁表（只给启用规则上锁）

用法：
  python3 v126_migrate.py          # dry-run，只打印不写库
  python3 v126_migrate.py --apply  # 真正执行
  python3 v126_migrate.py --rollback  # 恢复备份
"""
import os
import sys
import json
import shutil
import sqlite3
from datetime import datetime

DB = "/opt/hergent-erp/tenant_1.db"
BACKUP_DIR = "/root/hergent-backup"

# 需要停用的单期规则（让位给年度规则）
DEACTIVATE = {
    6: "蒙牛低温 8月 单期 100万/10%  → 让位 #10(08=95万/15%)",
    8: "蒙牛低温 9月 单期 100万/10%  → 让位 #10(09=100万/15%)",
}
# 需要归一化（补 monthly_amounts）的单期规则
NORMALIZE = {6: "08", 7: "08", 8: "09", 9: "09"}


def month_of(s):
    s = (s or "").strip()
    return s[5:7] if len(s) >= 7 and s[4] == "-" else ""


def covered_months(r):
    """与 domain/rebate_period.covered_months 同口径（此处内联，避免依赖服务进程）"""
    try:
        amounts = json.loads(r["monthly_amounts"] or "{}") or {}
    except Exception:
        amounts = {}
    amounts = {str(k).zfill(2): float(v) for k, v in amounts.items()
               if str(k).zfill(2).isdigit() and 1 <= int(str(k).zfill(2)) <= 12}
    eff_s = (r["effective_start"] or "").strip()
    eff_e = (r["effective_end"] or "").strip()
    year = r["target_year"]
    if not year:
        year = int(eff_s[:4]) if len(eff_s) >= 4 else datetime.now().year
    if amounts or r["period_type"] == "year":
        keys = sorted(amounts.keys()) if amounts else ["%02d" % i for i in range(1, 13)]
        out = set()
        for mm in keys:
            ym = "%04d-%s" % (year, mm)
            if eff_s and ym + "-31" < eff_s:
                continue
            if eff_e and ym + "-01" > eff_e:
                continue
            out.add(ym)
        return out
    # 单期：按生效期展开
    if not eff_s and not eff_e:
        return set()
    out = set()
    y0, m0 = int(eff_s[:4]), int(eff_s[5:7])
    e = eff_e or eff_s
    y1, m1 = int(e[:4]), int(e[5:7])
    y, m = y0, m0
    for _ in range(120):
        out.add("%04d-%02d" % (y, m))
        if (y, m) >= (y1, m1):
            break
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def main():
    apply = "--apply" in sys.argv
    rollback = "--rollback" in sys.argv
    print("=" * 66)
    print("v126 统一月度模型 · 存量迁移", "【APPLY】" if apply else
          ("【ROLLBACK】" if rollback else "【DRY-RUN】"))
    print("=" * 66)

    if rollback:
        bks = sorted([f for f in os.listdir(BACKUP_DIR) if f.startswith("tenant_1.db.v126")])
        if not bks:
            print("没有找到 v126 备份，回滚中止")
            return
        src = os.path.join(BACKUP_DIR, bks[-1])
        shutil.copy2(src, DB)
        os.system("chown hergent:hergent " + DB)
        print("已回滚到", src)
        return

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    print("\n--- 迁移前 ---")
    for r in conn.execute("SELECT * FROM rebate_target_rules ORDER BY id"):
        d = dict(r)
        ma = json.loads(d["monthly_amounts"] or "{}") or {}
        print("  #%-3s %-8s %-6s active=%s  period=%-6s value=%-10s %s" % (
            d["id"], d["scope_name"], "启用" if d["is_active"] else "停用",
            d["is_active"], d["period_type"], d["target_value"],
            ("月表%s格" % len(ma)) if ma else "无月表"))

    if not apply:
        print("\n[dry-run] 将要执行：")
        for rid_mm in NORMALIZE.items():
            print("  归一化 #%d → monthly_amounts={'%s': target_value}" % rid_mm)
        for rid, why in DEACTIVATE.items():
            print("  停用   #%d  %s" % (rid, why))
        print("\n确认无误后加 --apply 执行")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    bk = os.path.join(BACKUP_DIR, "tenant_1.db.v126.%s" % datetime.now().strftime("%Y%m%d%H%M%S"))
    conn.close()
    shutil.copy2(DB, bk)
    print("\n已备份 →", bk)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    # ② 单期归一化
    print("\n--- 归一化单期规则 ---")
    for rid, mm in NORMALIZE.items():
        r = conn.execute("SELECT * FROM rebate_target_rules WHERE id=?", (rid,)).fetchone()
        if not r:
            print("  #%d 不存在，跳过" % rid)
            continue
        d = dict(r)
        ma = json.loads(d["monthly_amounts"] or "{}") or {}
        if ma:
            print("  #%d 已有月表，跳过" % rid)
            continue
        if not mm:
            print("  #%d 生效期无法定位月份，跳过" % rid)
            continue
        conn.execute("UPDATE rebate_target_rules SET monthly_amounts=?, period_type='year' WHERE id=?",
                     (json.dumps({mm: float(d["target_value"] or 0)}), rid))
        print("  #%d → monthly_amounts={'%s': %.0f}" % (rid, mm, float(d["target_value"] or 0)))

    # ③ 停用冲突单期规则
    print("\n--- 停用让位规则 ---")
    for rid, why in DEACTIVATE.items():
        conn.execute("UPDATE rebate_target_rules SET is_active=0 WHERE id=?", (rid,))
        print("  #%d 已停用  %s" % (rid, why))

    # ④ 重建月份锁表
    print("\n--- 重建月份锁 ---")
    conn.execute("DELETE FROM rebate_rule_month_lock")
    n = 0
    for r in conn.execute("SELECT * FROM rebate_target_rules WHERE is_active=1 ORDER BY id"):
        d = dict(r)
        for ym in sorted(covered_months(d)):
            conn.execute(
                "INSERT OR IGNORE INTO rebate_rule_month_lock"
                " (rule_id, dimension, target_type, scope_key, ym) VALUES (?,?,?,?,?)",
                (d["id"], d["dimension"], d["target_type"], d["scope_key"], ym))
            n += 1
    conn.commit()
    print("  锁行数:", n)
    for r in conn.execute("SELECT rule_id, scope_key, ym FROM rebate_rule_month_lock ORDER BY scope_key, ym"):
        print("   ", dict(r))

    print("\n--- 迁移后 ---")
    for r in conn.execute("SELECT * FROM rebate_target_rules ORDER BY id"):
        d = dict(r)
        ma = json.loads(d["monthly_amounts"] or "{}") or {}
        print("  #%-3s %-8s %-6s active=%s  period=%-6s value=%-10s %s" % (
            d["id"], d["scope_name"], "启用" if d["is_active"] else "停用",
            d["is_active"], d["period_type"], d["target_value"],
            ("月表%s格" % len(ma)) if ma else "无月表"))
    conn.close()
    print("\n完成。回滚：python3 %s --rollback" % os.path.basename(__file__))


if __name__ == "__main__":
    main()
