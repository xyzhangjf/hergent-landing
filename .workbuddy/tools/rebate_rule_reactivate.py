#!/usr/bin/env python3
"""
返利目标规则「重新启用」—— Hergent 生产库定向写操作（**必须用户显式授权**）

背景（2026-09-15）：
    用户在「目标与返利 → 目标与返利」列表里清理单月目标，
    对 id=10「蒙牛低温2026年目标」点了「停用」（is_active=0，**不是删除**），
    导致「启用中的返利规则数 = 0」⇒
      ①目标与返利·仪表盘  ②预报页·返利冲刺看板
    双双空白。数据本身完好（12 个月分解齐全，合计 8,684,000）。

    同批操作里 id=6/7/8 是走「删除」按钮（DELETE ?hard=1）**物理删除**，
    库里已无；如需重建须从 /root/backup_*/tenant_1.db 取。

用法（在生产上以 hergent 身份跑）：
    # 1) 只读预览（默认，安全）
    python3 rebate_rule_reactivate.py --tenant 1 --ids 10
    # 2) 真正执行（先自动在线备份）
    python3 rebate_rule_reactivate.py --tenant 1 --ids 10 --apply

安全设计：
    · 默认 dry-run，必须显式 --apply 才写
    · --apply 前把 tenant_N.db + -wal + -shm 一起复制到
      /root/backup_reactivate_<ts>/（含 -wal，避免备份本身是过期快照）
    · 事务内按**主键**精确定位，逐项断言改前/改后值，异常即 rollback
    · 只改 is_active 与 updated_at 两列，不动任何目标金额
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

ERP_DIR = "/opt/hergent-erp"
BACKUP_ROOT = "/root"


def now():
    return datetime.now().isoformat(timespec="seconds")


def _snapshot(conn, ids):
    q = "SELECT id, rule_name, dimension, scope_key, scope_name, period_type, " \
        "target_value, monthly_amounts, effective_start, effective_end, is_active, updated_at " \
        "FROM rebate_target_rules WHERE id IN (%s) ORDER BY id" % ",".join("?" * len(ids))
    out = []
    for r in conn.execute(q, ids).fetchall():
        d = dict(r)
        try:
            ma = json.loads(d.get("monthly_amounts") or "{}")
        except Exception:
            ma = {}
        filled = sorted(k for k, v in ma.items() if v)
        d["monthly_filled"] = filled
        d["monthly_sum"] = sum(float(ma[k]) for k in filled if ma[k])
        out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", type=int, required=True)
    ap.add_argument("--ids", required=True, help="逗号分隔的规则 id，如 10 或 9,10")
    ap.add_argument("--apply", action="store_true", help="真正写库（默认只预览）")
    a = ap.parse_args()

    if a.tenant < 1:
        sys.exit("拒绝：租户 id 必须 >= 1")
    ids = [int(x) for x in str(a.ids).split(",") if x.strip()]
    if not ids:
        sys.exit("拒绝：--ids 为空")

    db = os.path.join(ERP_DIR, "tenant_%d.db" % a.tenant)
    if not os.path.exists(db):
        sys.exit("找不到库：%s" % db)

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    before = _snapshot(conn, ids)
    if not before:
        sys.exit("拒绝：id=%s 在 tenant_%d 里不存在" % (ids, a.tenant))

    print("=" * 72)
    print("改前状态（tenant_%d）" % a.tenant)
    for d in before:
        print("  id=%-3s %r" % (d["id"], d["rule_name"]))
        print("        品牌=%r 周期=%s 目标值=%s 生效=%s~%s is_active=%s"
              % (d["scope_name"] or d["scope_key"], d["period_type"], d["target_value"],
                 d["effective_start"], d["effective_end"], d["is_active"]))
        if d["monthly_filled"]:
            print("        月分解 %d 个月 = %s（合计 %s）"
                  % (len(d["monthly_filled"]), d["monthly_filled"], int(d["monthly_sum"])))
        print("        updated_at=%s" % d["updated_at"])

    todo = [d for d in before if d["is_active"] == 0]
    done = [d for d in before if d["is_active"] != 0]
    if done:
        print("\n  ⚠️ 以下规则已是启用状态，将被跳过：%s" % [d["id"] for d in done])
    if not todo:
        print("\n已无需改动（全部处于启用状态）。")
        conn.close()
        return

    print("\n将执行：把 id=%s 的 is_active 置为 1（仅此一列 + updated_at）" % [d["id"] for d in todo])

    if not a.apply:
        print("\n【dry-run】未写库。加 --apply 才会执行。")
        conn.close()
        return

    # ── 在线备份（连 -wal/-shm 一起，否则备份本身可能是过期快照）──
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bdir = os.path.join(BACKUP_ROOT, "backup_reactivate_%s" % ts)
    os.makedirs(bdir, exist_ok=True)
    for suf in ("", "-wal", "-shm"):
        if os.path.exists(db + suf):
            shutil.copy2(db + suf, os.path.join(bdir, "tenant_%d.db%s" % (a.tenant, suf)))
    print("\n已在线备份 → %s" % bdir)
    for f in sorted(os.listdir(bdir)):
        print("   %s  (%d bytes)" % (f, os.path.getsize(os.path.join(bdir, f))))

    # ── 事务内写 ──
    try:
        conn.execute("BEGIN")
        n = conn.execute(
            "UPDATE rebate_target_rules SET is_active=1, updated_at=? WHERE id IN (%s)"
            % ",".join("?" * len(todo)),
            [now()] + [d["id"] for d in todo],
        ).rowcount
        if n != len(todo):
            raise AssertionError("受影响行数 %s != 预期 %s" % (n, len(todo)))
        # 断言：金额/月分解未被触碰
        after = _snapshot(conn, [d["id"] for d in todo])
        for b, af in zip(todo, after):
            if af["is_active"] != 1:
                raise AssertionError("id=%s is_active 未变为 1" % b["id"])
            if (af["target_value"] != b["target_value"]
                    or af["monthly_filled"] != b["monthly_filled"]
                    or int(af["monthly_sum"]) != int(b["monthly_sum"])):
                raise AssertionError("id=%s 目标金额被意外改动，回滚" % b["id"])
        conn.commit()
    except Exception as e:
        conn.rollback()
        print("\n❌ 失败已回滚：%s" % e)
        sys.exit(1)

    print("\n✅ 已提交。改后状态：")
    for d in after:
        print("   id=%s %r is_active=%s updated_at=%s"
              % (d["id"], d["rule_name"], d["is_active"], d["updated_at"]))
    print("\n回滚方式：把 %s/tenant_%d.db* 复制回 %s/（连 -wal/-shm 一起）"
          % (bdir, a.tenant, ERP_DIR))
    conn.close()


if __name__ == "__main__":
    main()
