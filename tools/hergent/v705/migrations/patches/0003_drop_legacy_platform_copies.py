"""0003 · 删除租户库里的遗留平台表副本。

## 这些表为什么会在租户库里

2026-09-13 之前，`db/connection.py::_ensure_tenant_db` 用 SQLite 的 `backup()` 建租户库
—— 那是**页级整库复制**，会把主库连同**数据**一起搬过去。生产 `tenant_1.db` 因此残留
主库当时的 `users`（**含 bcrypt 密码哈希**）、`sessions`（350 行）、`user_tenants`、
`tenants` 的旧快照。创建路径已改成 `iterdump()`（只复制 CREATE 语句），但**已有副本还在**。

## 为什么现在才敢删（三条证据，缺一不可）

1. **谁在读**：`tools/hergent/v706/scan_legacy_reads.py` 把 75 个引用函数按
   「连接类型 × 路由上下文」分类。唯一的「租户连接 + 租户上下文」是
   `GET /api/sales-targets` 的 `LEFT JOIN users` —— 已在 v706 第②步改成从主库取名合并。
   其余要么显式连主库，要么端点在 `_TENANT_MASTER_PREFIXES` 内（`/api/users`、
   `/api/tenants`、`/api/force-logout` 全是主库上下文，`get_db()` 回落主库）。
2. **有没有数据在承重**：生产实测 `tenant_1.sales_targets` 与 `tenant_10.sales_targets`
   均为 **0 行**，前端 `hergent-cn-v2` / `hergent-admin` 对 `/api/sales-targets`
   **零调用**。`tenant_10.users` 本就是 0 行 —— 若真有代码依赖它，那个租户早就该出错。
3. **删了会不会长回来**：v706 第②步已让 `tenant_db_init()` 不再复制这 6 张表，
   否则下一个新租户立刻再长出一张空 `users`，本版等于白做。

## 安全边界

- **主库一行不动**。本 patch 会先判定"这台库是不是主库"，是就跳过并记账。
  判定用 `PRAGMA database_list` 拿真实文件路径，与 `dbutil.master_db_path()` 比对；
  取不到就 **拒绝执行**（fail-closed）—— 宁可这版不生效，也不能把主库的 `users` 删掉。
- 删之前把每张表的行数写进 `schema_patches.note`，便于事后核对"删的是什么"。
- 完整库备份在 `backups/pre-v706-*/`（patch 执行前的三库一致性快照），
  另有本目录 `docs/批次B-遗留副本清理-*.md` 记录逐表行数。
"""

import os

LEGACY_TABLES = [
    "users",
    "sessions",
    "tenants",
    "user_tenants",
    "invite_codes",
    "invite_uses",
]


def _db_file(conn):
    """当前连接指向的库文件**真实**路径（取不到返回空串）。

    ⚠️ 必须 `realpath`：macOS 上 `/var` 是 `/private/var` 的符号链接，
    `PRAGMA database_list` 给的是 `/private/var/...`，而 `ERP_DB_PATH` 常写成
    `/var/...` ⇒ 直接字符串比较会把**主库判成租户库**，然后删掉主库的 `users`。
    这不是理论风险：本 patch 的离线测试第一次跑就踩中了（测试库建在
    `/var/folders/...` 临时目录下）。
    """
    try:
        row = conn.execute("PRAGMA database_list").fetchone()
        return os.path.realpath(row[2]) if row and row[2] else ""
    except Exception:
        return ""


def _master_file():
    """主库路径。优先用包内 dbutil（与 doctor/runner 同一口径），否则按约定推算。"""
    try:
        from migrations import dbutil
        return os.path.realpath(dbutil.master_db_path())
    except Exception:
        pass
    p = os.environ.get("ERP_DB_PATH")
    if p:
        return os.path.realpath(p)
    # <app>/migrations/patches/0003_x.py → <app>
    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.realpath(os.path.join(here, "erp.db"))


def _table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def upgrade(conn):
    cur = _db_file(conn)
    master = _master_file()
    if not cur or not master:
        # fail-closed：判不出"这是不是主库"就绝不动手。
        raise RuntimeError("无法判定当前库/主库路径（cur=%r master=%r），拒绝执行" % (cur, master))
    if cur == master:
        return "master：平台表是正本，不动"

    dropped, absent = [], []
    for t in LEGACY_TABLES:
        if not _table_exists(conn, t):
            absent.append(t)
            continue
        n = conn.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        conn.execute("DROP TABLE %s" % t)
        dropped.append("%s(%d行)" % (t, n))

    # 回读核对：DROP 之后不许还存在
    for t in LEGACY_TABLES:
        if _table_exists(conn, t):
            raise RuntimeError("表 %s 删除后仍存在（回读核对失败）" % t)

    note = "删除 " + (", ".join(dropped) if dropped else "无（本库无副本）")
    if absent:
        note += "；本就没有 %s" % ",".join(absent)
    return note
