# -*- coding: utf-8 -*-
"""只读探查生产 tenant_1 的 contacts 表形态 —— 为「内部往来」档案的插入备齐必填列。"""
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hergent-erp/tenant_1.db"
c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)

print("=== contacts：NOT NULL 且无 DEFAULT 的列（插入时必须显式给值）===")
must = []
for r in c.execute("PRAGMA table_info(contacts)"):
    name, typ, notnull, dflt = r[1], r[2], r[3], r[4]
    if notnull and dflt is None:
        must.append(name)
        print("   %-24s %-10s NOT NULL / 无默认" % (name, typ))
if not must:
    print("   （无）")

print()
print("=== 现有 department 行（照抄这个形态）===")
cols = [x[1] for x in c.execute("PRAGMA table_info(contacts)")]
for r in c.execute("SELECT * FROM contacts WHERE type=? LIMIT 1", ("department",)):
    d = dict(zip(cols, r))
    print("   ", {k: v for k, v in d.items() if v not in (None, "", 0)})

print()
print("=== 名称是否已存在「内部往来」===")
for r in c.execute("SELECT id,name,type,is_active FROM contacts WHERE name=?", ("内部往来",)):
    print("   ", tuple(r))

print()
print("=== contacts 上的索引 / 唯一约束 ===")
for r in c.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='contacts'"):
    print("   %-40s | %s" % (r[0], (r[1] or "")[:100]))

print()
print("=== type 分布 ===")
for r in c.execute("SELECT type, COUNT(*) FROM contacts GROUP BY type ORDER BY 2 DESC"):
    print("   %-12s %d" % (r[0], r[1]))

print()
print("=== 最大 id ===")
print("   ", c.execute("SELECT MAX(id) FROM contacts").fetchone()[0])
c.close()
