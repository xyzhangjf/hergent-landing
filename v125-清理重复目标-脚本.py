#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v125 · 清理「同品牌同月重复目标」的安全脚本（tenant_1）

背景：蒙牛低温 2026-08 / 2026-09 各存在两条启用中的目标
      · #6  单期 100 万（2026-08）      · #8  单期 100 万（2026-09）
      · #10 年度 901 万（12 月分解，含 08=95 万 / 09=100 万）
      两条同时生效 → 目标、达成、返利全部重复计入。

默认动作（方案 A）：**软停用** #6 / #8（is_active=0，不物理删除，可回滚），
                    保留年度 #10，并把 8/9 月的月份锁归还给 #10。

用法（在生产服务器执行）：
    python3 v125-清理重复目标-脚本.py             # 预演，不动数据
    python3 v125-清理重复目标-脚本.py --apply      # 执行
    python3 v125-清理重复目标-脚本.py --rollback   # 回滚（恢复 #6/#8 启用 + 重算锁）

安全设计：
  · 执行前自动 cp 备份整库到 /root/hergent-backup/
  · 全部写操作在单个事务内，任一步失败即 rollback
  · 只改 is_active，不删行、不动达成填报（rebate_achievements 不绑 rule_id）
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB = "/opt/hergent-erp/tenant_1.db"
BACKUP_DIR = "/root/hergent-backup"
DEACTIVATE_IDS = (6, 8)      # 单期（月）规则
KEEP_ID = 10                 # 年度总纲
SCOPE = "蒙牛低温"

APPLY = "--apply" in sys.argv
ROLLBACK = "--rollback" in sys.argv


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def covered_months_of(year, monthly_amounts_json, eff_s, eff_e):
    """与 domain/rebate_period.covered_months 同口径（此处内联，避免依赖服务环境）。"""
    import json
    amounts = {}
    try:
        amounts = json.loads(monthly_amounts_json or "{}") or {}
    except Exception:
        amounts = {}
    eff_s = (eff_s or "").strip()
    eff_e = (eff_e or "").strip()
    keys = sorted(amounts.keys()) if amounts else ["%02d" % m for m in range(1, 13)]
    out = []
    for mm in keys:
        ym = "%04d-%s" % (year, mm)
        if eff_s and (ym + "-31") < eff_s:
            continue
        if eff_e and (ym + "-01") > eff_e:
            continue
        out.append(ym)
    return out


def snapshot(c):
    rows = c.execute(
        "SELECT id, rule_name, period_type, is_active, target_year, monthly_amounts,"
        " effective_start, effective_end FROM rebate_target_rules ORDER BY id").fetchall()
    print("\n当前规则：")
    for r in rows:
        flag = "启用" if r[3] else "停用"
        print("   #%-3d %-22s %-5s %s  年=%s 生效=%s~%s"
              % (r[0], r[1] or "", r[2], flag, r[4], r[6] or "不限", r[7] or "不限"))
    locks = c.execute(
        "SELECT rule_id, COUNT(*) FROM rebate_rule_month_lock GROUP BY rule_id").fetchall()
    print("月份锁：", "  ".join("#%d:%d 个月" % (a, b) for a, b in locks) or "（无）")


def main():
    if not os.path.exists(DB):
        print("找不到数据库：", DB)
        return 1
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row

    print("=" * 72)
    print("模式：", "回滚" if ROLLBACK else ("执行" if APPLY else "预演（未加 --apply，不会写库）"))
    print("=" * 72)
    snapshot(c)

    if ROLLBACK:
        print("\n[回滚] 恢复 #%s 启用并重算月份锁" % ", #".join(str(i) for i in DEACTIVATE_IDS))
        if not APPLY and not ROLLBACK:
            pass
        try:
            c.execute("BEGIN")
            for rid in DEACTIVATE_IDS:
                c.execute("UPDATE rebate_target_rules SET is_active=1, updated_at=? WHERE id=?",
                          (now(), rid))
            resync_locks(c)
            c.commit()
            print("回滚完成")
        except Exception as e:
            c.rollback()
            print("回滚失败：", e)
            return 1
        snapshot(c)
        return 0

    # 待停用明细
    targets = c.execute(
        "SELECT id, rule_name, period_type, target_year, monthly_amounts,"
        " effective_start, effective_end FROM rebate_target_rules WHERE id IN (%s)"
        % ",".join("?" * len(DEACTIVATE_IDS)), DEACTIVATE_IDS).fetchall()
    keep = c.execute("SELECT * FROM rebate_target_rules WHERE id=?", (KEEP_ID,)).fetchone()

    print("\n将要执行：")
    for r in targets:
        print("   停用 #%d「%s」(%s) —— %s"
              % (r["id"], r["rule_name"], r["period_type"],
                 covered_months_of(r["target_year"] or 2026, r["monthly_amounts"],
                                   r["effective_start"], r["effective_end"])))
    if keep:
        print("   保留 #%d「%s」(%s，全年 12 个月)，归还其占用的全部月份锁"
              % (keep["id"], keep["rule_name"], keep["period_type"]))
    print("   影响：8 月目标 100 万 → 95 万（年度 8 月值）；8/9 月返利率 10% → 15%")
    print("   达成填报 rebate_achievements 不绑 rule_id，不受影响")

    if not APPLY:
        print("\n预演结束，未写库。确认后加 --apply 执行。")
        return 0

    # 备份
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, "tenant_1.db.bak-%s" % datetime.now().strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(DB, bak)
    print("\n已备份 →", bak)

    try:
        c.execute("BEGIN")
        for rid in DEACTIVATE_IDS:
            c.execute("UPDATE rebate_target_rules SET is_active=0, updated_at=? WHERE id=?",
                      (now(), rid))
        # 停用即释放月份锁
        for rid in DEACTIVATE_IDS:
            c.execute("DELETE FROM rebate_rule_month_lock WHERE rule_id=?", (rid,))
        resync_locks(c)
        c.commit()
        print("已提交")
    except Exception as e:
        c.rollback()
        print("失败已回滚：", e)
        return 1

    snapshot(c)
    print("\n回滚命令： python3 %s --rollback" % os.path.basename(__file__))
    return 0


def resync_locks(c):
    """按当前启用规则重算整张月份锁表（先到先得，重复跳过）。"""
    c.execute("DELETE FROM rebate_rule_month_lock")
    rows = c.execute(
        "SELECT id, dimension, target_type, scope_key, period_type, target_year,"
        " monthly_amounts, effective_start, effective_end"
        " FROM rebate_target_rules WHERE is_active=1 ORDER BY id").fetchall()
    n = 0
    for r in rows:
        if r[4] != "year" and not (r[7] or r[8]):
            continue  # 口径不明（生效期两端皆空且非年度）→ 不占锁
        for ym in covered_months_of(r[5] or 2026, r[6], r[7], r[8]):
            try:
                c.execute(
                    "INSERT OR IGNORE INTO rebate_rule_month_lock"
                    " (rule_id, dimension, target_type, scope_key, ym) VALUES (?,?,?,?,?)",
                    (r[0], r[1], r[2], r[3], ym))
                n += 1
            except Exception:
                continue
    print("   月份锁重算：%d 行" % n)


if __name__ == "__main__":
    sys.exit(main())
