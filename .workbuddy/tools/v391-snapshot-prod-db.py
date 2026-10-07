"""在**生产机**上做两份库的一致性快照到 /tmp（只读源 + sqlite backup API）。

为什么要用 backup API 而不是 `scp *.db`：
  生产的 erp.db / tenant_1.db 都带 `-wal` / `-shm`。直接拷主文件会**丢掉 WAL 里未 checkpoint
  的事务** ⇒ 快照与线上不一致，用它做的验收结论不可信。`Connection.backup()` 会做一致性拷贝。

只读：源连接用 `mode=ro` URI，绝不写源库。
"""
import os
import sqlite3

BASE = "/opt/hergent-erp"
OUT = "/tmp/v391-snap"
os.makedirs(OUT, exist_ok=True)

for name in ("erp.db", "tenant_1.db"):
    src_p = os.path.join(BASE, name)
    dst_p = os.path.join(OUT, name)
    src = sqlite3.connect(f"file:{src_p}?mode=ro", uri=True)
    dst = sqlite3.connect(dst_p)
    with dst:
        src.backup(dst)
    # 自证：快照行数 vs 源行数（关键表）
    for t in ("inventory", "purchase_orders", "sale_orders"):
        a = src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        b = dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        flag = "OK" if a == b else "MISMATCH"
        print(f"{name:14} {t:18} src={a:>7} dst={b:>7} {flag}")
    # 快照自身的 wal 清干净，免得传输后带 -wal
    dst.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dst.close()
    src.close()
    print(f"{name} -> {dst_p}  ({os.path.getsize(dst_p)} bytes)")
print("done")
