#!/usr/bin/env python3
"""v709 期初凭证去重（tenant_*.db）

背景
----
`import_zhoupu.py: import_coa_openings()` 有两个缺陷，叠加造成期初虚增：
  ① 无幂等：每跑一次就全量 INSERT 一遍。生产实际跑了 **4 轮**（created_at
     15:33:47 / 15:36:26 / 15:38:37 / 16:01:03），每轮 52 行完全一样。
  ② 不跳父科目：舟谱「科目期初余额.xlsx」是科目明细表，父科目也有汇总行。
     脚本把父科目汇总行也当分录写借方 ⇒ 父 + 子双倍。
     实测 12 个父科目金额**逐分等于**其子科目合计，无一例外。

两层重复叠加：期初借方 12,601,306.36，真实值 2,141,500.44。

本脚本做两件事（都在单个事务里）：
  ① 每个库的 opening 凭证只保留 created_at 最早的一轮；
  ② 删掉「存在直接子科目」的父科目行。

删完借贷自动相等（实测 差 0.00），**不补任何调整分录**——期初数据本身是对的。

安全
----
- 只处理 tenant_*.db，**主库 erp.db 永不触碰**（realpath 比对 + 白名单）
- 删除前把每行完整字段写进 JSON 清单，`--revert` 可原样插回
- `--dry-run` 只报告不改库
- 执行后回读校验：期初借贷必须相等，否则整体回滚并报错
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime

ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
BACKUP_DIR = os.path.join(ERP, "backups", "v709-" + STAMP)

COLS = ["id", "voucher_no", "date", "account_code", "account_name", "debit", "credit",
        "ref_type", "ref_id", "summary", "operator_id", "created_at"]


def log(msg):
    print(msg, flush=True)


def tenant_dbs():
    """只列出 tenant_<数字>.db，主库与历史快照都排除（realpath 双重保险）。

    🔴 不能用 `startswith("tenant_")`：生产上还有
    `tenant_1.pre-v617-20261019-1148.db` / `tenant_1.pre-v618-...` 两个历史快照，
    那是归档，改它等于篡改历史证据。
    """
    master = os.path.realpath(os.path.join(ERP, "erp.db"))
    out = []
    for fn in sorted(os.listdir(ERP)):
        if not re.match(r"^tenant_\d+\.db$", fn):
            continue
        p = os.path.join(ERP, fn)
        if os.path.realpath(p) == master:
            raise RuntimeError("主库出现在 tenant 列表里，拒绝执行：%s" % p)
        out.append(p)
    return out


def plan(con):
    """算出要删的行，返回 (keep_ts, rows_to_delete, parents)。"""
    c = con.cursor()
    n = c.execute("SELECT COUNT(*) FROM journal_entries WHERE ref_type='opening'").fetchone()[0]
    if n == 0:
        return None, [], []
    keep_ts = c.execute(
        "SELECT MIN(created_at) FROM journal_entries WHERE ref_type='opening'").fetchone()[0]

    codes = sorted(r[0] for r in c.execute(
        "SELECT DISTINCT account_code FROM journal_entries WHERE ref_type='opening'"))
    # 父科目 = 存在编码前缀相同、长度 +2 的子科目（生产账套是 4/6/8 位标准层级）
    parents = [x for x in codes
               if any(y != x and y.startswith(x) and len(y) == len(x) + 2 for y in codes)]

    ph = ",".join("?" * len(parents)) if parents else "''"
    rows = c.execute(
        "SELECT %s FROM journal_entries WHERE ref_type='opening' AND (created_at <> ?%s)"
        % (",".join(COLS), (" OR account_code IN (%s)" % ph) if parents else ""),
        (keep_ts, *parents)).fetchall()
    return keep_ts, rows, parents


def dump_rows(path, db_name, rows):
    payload = {
        "v": "v709",
        "db": db_name,
        "cols": COLS,
        "rows": [list(r) for r in rows],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


def load_rows(path):
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return payload["cols"], payload["rows"]


def check_balanced(con, label):
    c = con.cursor()
    r = c.execute("SELECT ROUND(COALESCE(SUM(debit),0),2), ROUND(COALESCE(SUM(credit),0),2) "
                  "FROM journal_entries WHERE ref_type='opening'").fetchone()
    dr, cr = r
    ok = abs(dr - cr) <= 0.01
    log("     %s 期初：借 %.2f / 贷 %.2f / 差 %.2f → %s"
        % (label, dr, cr, dr - cr, "平 ✓" if ok else "不平 🔴"))
    return ok, dr, cr


def do_fix(dry):
    dbs = tenant_dbs()
    if not dbs:
        log("🔴 未找到 tenant_*.db，检查 ERP_DIR=%s" % ERP)
        return 1
    log("库文件 %d 个：%s" % (len(dbs), [os.path.basename(p) for p in dbs]))
    log("")

    if not dry:
        os.makedirs(BACKUP_DIR, exist_ok=True)

    total_rows = 0
    for path in dbs:
        name = os.path.basename(path)
        log("── %s" % name)
        con = sqlite3.connect(path)
        con.isolation_level = None
        keep_ts, rows, parents = plan(con)

        if keep_ts is None:
            log("   ⏭  无期初凭证，跳过")
            con.close()
            continue

        if not rows:
            log("   ⏭  已是单轮且无父科目行（幂等跳过）")
            check_balanced(con, "当前")
            con.close()
            continue

        log("   保留轮次：%s" % keep_ts)
        log("   父科目 %d 个：%s" % (len(parents), parents))
        log("   待删 %d 行（重复轮次 + 父科目行）" % len(rows))

        if dry:
            log("   [dry-run] 未改库")
            con.close()
            continue

        # ① 整库备份
        bak = os.path.join(BACKUP_DIR, name)
        con.close()
        con = sqlite3.connect(path)
        con.isolation_level = None
        src = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
        dst = sqlite3.connect(bak)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        log("   备份 → %s" % bak)

        # ② 删除清单落盘（可回滚）
        manifest = os.path.join(BACKUP_DIR, name + ".deleted.json")
        dump_rows(manifest, name, rows)
        log("   删除清单 → %s" % manifest)

        # ③ 事务删除 + 回读
        try:
            con.execute("BEGIN IMMEDIATE")
            n = 0
            for r in rows:
                cur = con.execute(
                    "DELETE FROM journal_entries WHERE id=? AND ref_type='opening'", (r[0],))
                n += cur.rowcount
            if n != len(rows):
                raise RuntimeError("删除行数不符：期望 %d 实删 %d" % (len(rows), n))
            ok, dr, cr = check_balanced(con, "清理后")
            if not ok:
                raise RuntimeError("清理后仍不平（借 %.2f / 贷 %.2f），已回滚" % (dr, cr))
            con.execute("COMMIT")
            log("   ✅ 已提交，删除 %d 行" % n)
            total_rows += n
        except Exception as e:
            con.execute("ROLLBACK")
            log("   🔴 %s" % e)
            con.close()
            return 2
        con.close()

    log("")
    log("合计删除 %d 行；备份目录 %s" % (total_rows, BACKUP_DIR if not dry else "(dry-run 未创建)"))
    return 0


def do_revert(manifest_path):
    cols, rows = load_rows(manifest_path)
    db_name = os.path.basename(manifest_path).replace(".deleted.json", "")
    path = os.path.join(ERP, db_name)
    if not os.path.exists(path):
        log("🔴 库不存在：%s" % path)
        return 1
    con = sqlite3.connect(path)
    con.isolation_level = None
    try:
        con.execute("BEGIN IMMEDIATE")
        n = 0
        for r in rows:
            cur = con.execute(
                "INSERT OR IGNORE INTO journal_entries (%s) VALUES (%s)"
                % (",".join(cols), ",".join("?" * len(cols))), r)
            n += cur.rowcount
        con.execute("COMMIT")
        log("✅ 已回填 %d 行到 %s" % (n, db_name))
        check_balanced(con, "回滚后")
    except Exception as e:
        con.execute("ROLLBACK")
        log("🔴 回滚失败：%s" % e)
        con.close()
        return 2
    con.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告不改库")
    ap.add_argument("--revert", metavar="MANIFEST", help="按删除清单回填")
    a = ap.parse_args()
    sys.exit(do_revert(a.revert) if a.revert else do_fix(a.dry_run))
