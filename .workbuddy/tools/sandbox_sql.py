#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""沙箱租户库的只读/可写 SQL 助手（仅限沙箱，跑在**服务器上**）。

为什么需要它：`sandbox_tenant.py` 只管 up/down，而验证过程中几乎每一步都要
「看一眼沙箱库里的真实状态」（期次几条、导入登记几行、`period_id` 落了几号）——
生产机**没有 `sqlite3` CLI**，于是每次都得现搓一段 `python3 -c`，
而内联 python 的引号/`datetime(...)` 极易在 ssh 里被吃掉（本项目踩过）。
固化成工具一次，后续所有沙箱验证直接复用。

用法（在服务器 /opt/hergent-erp 下）：
    python3 /tmp/sandbox_sql.py --id 9997 --db tenant "SELECT COUNT(*) FROM forecast_periods"
    python3 /tmp/sandbox_sql.py --id 9997 --db tenant --write "DELETE FROM forecast_periods"
    python3 /tmp/sandbox_sql.py --id 9997 --db main "SELECT name FROM sqlite_master LIMIT 3"

安全边界（三条硬校验，任一不过即退出，绝不放宽）：
  1. `--id` 必须 >= 9997 —— tenant_1（生产主租户）/ tenant_10（演示）绝不可当沙箱；
  2. `--db tenant` 时目标文件固定拼成 `tenant_<id>.db`，**不接受任意路径**；
  3. `--write` 必须显式给（默认只读，且默认在事务里 dry-run 回滚 —— 见 --commit）。
     写操作默认**回滚**，要真落库必须再加 `--commit`：防止「本来只想看看」的
     查询语句手滑带了 DELETE 就真删了。
"""
import argparse
import os
import sqlite3
import sys

SANDBOX_MIN = 9997
ERP_DIR = "/opt/hergent-erp"


def _resolve_db(sandbox_id, which):
    if sandbox_id < SANDBOX_MIN:
        sys.exit("拒绝：沙箱 id %d 小于隔离下限 %d —— tenant_1 / tenant_10 绝不可当沙箱"
                 % (sandbox_id, SANDBOX_MIN))
    name = "tenant_%d.db" % sandbox_id if which == "tenant" else "erp.db"
    path = os.path.join(ERP_DIR, name)
    if not os.path.exists(path):
        sys.exit("拒绝：目标库不存在 %s（沙箱没建？先跑 sandbox_tenant.py up）" % path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", type=int, required=True, help="沙箱租户 id（必须 >= %d）" % SANDBOX_MIN)
    ap.add_argument("--db", choices=("tenant", "main"), default="tenant")
    ap.add_argument("--write", action="store_true",
                    help="声明这是写语句；**默认仍在事务里回滚**，需再加 --commit 才真落库")
    ap.add_argument("--commit", action="store_true", help="真正提交（配合 --write）")
    ap.add_argument("sql", help="要执行的 SQL")
    a = ap.parse_args()

    path = _resolve_db(a.id, a.db)
    conn = sqlite3.connect(path)
    try:
        cur = conn.cursor()
        cur.execute(a.sql)
        if cur.description:  # 有结果集 ⇒ 只读查询
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            print("cols: " + " | ".join(cols))
            print("rows: %d" % len(rows))
            for r in rows:
                print("  " + " | ".join("" if v is None else str(v) for v in r))
        else:
            print("changes: %d" % cur.rowcount)
        if a.write and a.commit:
            conn.commit()
            print("COMMITTED on %s" % path)
        else:
            conn.rollback()
            print("ROLLED BACK on %s%s" % (path, "" if a.write else "（未声明 --write）"))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
