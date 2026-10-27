#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""删表前的最后一道备份：三库一致性快照 + 副本表原始数据单独导出。

为什么单独导一份：整库快照能回滚，但"这次到底删了哪些行"在整库里看不出来。
删完之后要能立刻回答「tenant_1.users 原来有几行、是谁」，所以把 6 张副本表
逐表导出成 `<ts>/legacy_copies_dump.db`（表名前缀 t<租户id>_）。
"""
import os
import sqlite3
import time

APP = "/opt/hergent-erp"
DBS = ["erp.db", "tenant_1.db", "tenant_10.db"]
TARGETS = [("tenant_1.db", 1), ("tenant_10.db", 10)]
TABLES = ["users", "sessions", "tenants", "user_tenants", "invite_codes", "invite_uses"]


def q(name):
    return '"' + name.replace('"', '""') + '"'


def main():
    os.chdir(APP)
    d = "backups/pre-v706-drop-%s" % time.strftime("%Y%m%d-%H%M%S")
    os.makedirs(d, exist_ok=True)
    for f in DBS:
        s = sqlite3.connect(f)
        t = sqlite3.connect(os.path.join(d, f))
        with t:
            s.backup(t)
        t.close()
        s.close()
        print("备份 %-14s %d bytes" % (f, os.path.getsize(os.path.join(d, f))))

    dump = sqlite3.connect(os.path.join(d, "legacy_copies_dump.db"))
    for f, tid in TARGETS:
        src = sqlite3.connect("file:%s?mode=ro" % f, uri=True)
        for tb in TABLES:
            try:
                rows = src.execute("SELECT * FROM %s" % q(tb)).fetchall()
            except Exception:
                continue
            cols = [r[1] for r in src.execute("PRAGMA table_info(%s)" % q(tb))]
            name = "t%d_%s" % (tid, tb)
            dump.execute("DROP TABLE IF EXISTS %s" % q(name))
            dump.execute("CREATE TABLE %s (%s)" % (q(name), ", ".join(q(c) for c in cols)))
            dump.executemany("INSERT INTO %s VALUES (%s)"
                             % (q(name), ", ".join("?" * len(cols))), rows)
            print("  导出 %-22s %d 行" % (name, len(rows)))
        src.close()
    dump.commit()
    dump.close()
    print("DIR", d)


if __name__ == "__main__":
    main()
