#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把若干 SQLite 库的「表 → 列」导成 `check_ddl_parity.py` 要的 schema JSON（只读）。

为什么单独一个脚本：DDL 对账要拿「真实库里到底有什么」跟「代码里声明了什么」比。
库这一侧**必须只读打开**（`file:...?mode=ro`）—— 体检脚本一旦能写库，跑一次就可能
改变它要检查的对象，这是本项目反复强调的纪律（见 migrations/README：别 import
`erp_db`，导入期就跑 389 条迁移）。

产出格式（`check_ddl_parity.py` 的 `--schema` 输入）：

    {"erp.db": {"users": ["id", "username", ...], ...}, "tenant_1.db": {...}}

用法：
    python3 dump_db_schema.py -o /tmp/schema_dump.json \\
        /opt/hergent-erp/erp.db /opt/hergent-erp/tenant_1.db

    # 不给 -o 时打到 stdout
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys


def dump(path):
    """只读打开一个库，返回 {表名: [列名]}。"""
    p = os.path.abspath(path)
    if not os.path.exists(p):
        sys.stderr.write("🔴 库文件不存在：%s\n" % p)
        sys.exit(2)
    con = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    try:
        out = {}
        for (name,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%'"):
            cols = [r[1] for r in con.execute("PRAGMA table_info(%s)" % name)]
            out[name] = cols
        return out
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dbs", nargs="+", help="一个或多个 .db 文件路径")
    ap.add_argument("-o", "--out", default="")
    a = ap.parse_args()

    data = {os.path.basename(os.path.abspath(p)): dump(p) for p in a.dbs}
    txt = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(txt)
        print("已写出 %s（%d 个库）" % (a.out, len(data)), file=sys.stderr)
        for k, v in sorted(data.items()):
            print("   %-16s 表 %d" % (k, len(v)), file=sys.stderr)
    else:
        print(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
